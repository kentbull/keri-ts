/**
 * Pushing an identifier's KEL to its mailboxes as a runtime reaction: after a rotation completes, every
 * configured, active mailbox is told the new key state, because a mailbox authenticates the owner's polls
 * against the KEL it holds.
 *
 * The durable state is one record per (identifier, mailbox), `Baser.kpub`: the establishment event whose KEL
 * the mailbox last answered 2xx for, and, when publishing used up its budget, the event it gave up on. A
 * pass derives what is owed: for each local identifier (groups included) and each mailbox it has an
 * authorized role with and a URL for, a post is owed unless the record shows the identifier's latest
 * establishment event. A {@link RotatedCue} only wakes the fiber early, so a lost cue, a bare `Hab.rotate`, a
 * member that did not sign a group event, a crash and a one-shot CLI host are all found by derivation. A
 * crash between the post and the record costs one harmless resend, since a host drops duplicate events.
 *
 * An event is published only once it is complete: fully witnessed and, for a delegated identifier, its
 * authorizing source seal is stored (`Baser.aess`). Witnesses are not told; receipting already gives them
 * the event.
 *
 * A failed post is retried with a doubling delay up to {@link KEL_PUBLISH_MAX_DELAY_MS}, in memory, and given
 * up when the next attempt would start more than {@link KEL_PUBLISH_BUDGET_MS} after the first. Giving up
 * writes `failed` to the record and a change to the sink. A timed-out entry is not retried on its own: a new
 * rotation, a successful poll of that mailbox (the mailbox is evidently back), a successful 403 repair, a
 * `prompt`, or the next runtime open (memory starts empty, so each owed entry gets a fresh budget) re-arms it.
 * A host that cannot take a multi-message stream (KERIpy answers 400 or 406) is recorded as told: it does
 * not authenticate polls, so nothing is lost.
 */
import { type Operation } from "npm:effection@^3.6.0";
import type { RotatedCue } from "../../core/cues.ts";
import { Deck } from "../../core/deck.ts";
import { dgKey } from "../../db/core/keys.ts";
import { OwnerWake } from "../runtime/operation-owners.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { type ChangeSink, observeUntil, type WaitResult } from "../runtime/workflow-contract.ts";
import {
  holdsHeads,
  KEL_PUBLISH_HEADER_TIMEOUT_MS,
  kelHeads,
  type KelPublishingDeps,
  type MailboxPublication,
  pinKelPublished,
  postKelToMailbox,
} from "./kel-publishing.ts";
import { authorizedMailboxes, fetchEndpointUrls, preferredUrl } from "./mailboxing.ts";

/** Most posts one `processOnce` attempts, so a first pass over a large store cannot stall the fiber. */
export const KelSendsPerPass = 4;
/** Delay after a post's first failure; doubles per attempt up to {@link KEL_PUBLISH_MAX_DELAY_MS}. */
export const KEL_PUBLISH_BASE_MS = 1_000;
export const KEL_PUBLISH_MAX_DELAY_MS = 60_000;
/** Give up when the next attempt would start more than this long after the first. */
export const KEL_PUBLISH_BUDGET_MS = 300_000;
/** Pause between passes while a post waits to be retried, and while nothing does. */
export const KEL_PUBLISHER_BUSY_MS = 250;
export const KEL_PUBLISHER_IDLE_MS = 1_000;

/** Collaborators of the publisher. */
export interface KelPublisherDeps extends KelPublishingDeps {
  /** Optional sink told `{kind:"event", id:"<pre>:<sn>"}` after each attempt and when a publication is given up. */
  readonly changes?: ChangeSink;
}

/**
 * Where one (identifier, mailbox) stands: `published` (the record shows the latest establishment event),
 * `pending` (owed, being sent or waiting out a retry delay), `waiting` (owed but gated: unwitnessed,
 * unanchored or no URL) or `timed-out` (given up in this process; see the module comment for what re-arms it).
 */
export interface KelPublicationStatus {
  readonly pre: string;
  readonly mailbox: string;
  readonly state: "published" | "pending" | "waiting" | "timed-out";
  /** The establishment event the identifier's mailboxes should hold. */
  readonly said: string;
  readonly attempts: number;
  readonly lastFailure?: string;
  /** When the next attempt is due (ISO-8601), for a pending entry that has failed. */
  readonly retryAt?: string;
}

/** Every (identifier, mailbox) pair, derived from the stores at the time of the read. */
export interface KelPublisherStatus {
  readonly entries: readonly KelPublicationStatus[];
}

interface Derived {
  pre: string;
  mailbox: string;
  url: string | null;
  said: string;
  /** For a local group, the signing member's establishment SAID the mailbox must also hold. */
  member?: string;
  sn: number;
  published: boolean;
  hold: "unwitnessed" | "unanchored" | "no-url" | null;
}

/** Attempt budget of one (identifier, mailbox, establishment event), in memory. */
interface Budget {
  said: string;
  firstAt: number | null;
  attempts: number;
  lastFailure: string | null;
  retryAt: number;
  expired: boolean;
}

const idOf = (pre: string, mailbox: string) => `${pre}/${mailbox}`;

/** The deck of {@link RotatedCue}s wakes the publisher's fiber as a cue arrives. */
class WakingDeck extends Deck<RotatedCue> {
  constructor(private readonly onCue: () => void) {
    super();
  }
  override append(cue: RotatedCue): number {
    const length = super.append(cue);
    this.onCue();
    return length;
  }
}

/** Derives, sends and records the KEL posts a wallet's identifiers owe their mailboxes. */
export class KelPublisher {
  /** Completion points push here; a cue wakes the fiber and gives that identifier's entries a fresh budget. */
  readonly rotated: Deck<RotatedCue>;
  /** Ends the fiber's sleep, so a cue never waits for the idle cadence. */
  readonly wake = new OwnerWake();
  /** A failure that escapes a pass is counted and kept here; the fiber keeps running. */
  readonly health: { faults: number; last: { error: unknown; at: number } | null } = { faults: 0, last: null };
  readonly #deps: KelPublisherDeps;
  readonly #budgets = new Map<string, Budget>();
  readonly #inflight = new Set<string>();

  constructor(deps: KelPublisherDeps) {
    this.#deps = deps;
    this.rotated = new WakingDeck(this.wake.notify);
  }

  /**
   * Give `pre`'s entries a fresh budget and run the next pass now; with `mailbox`, re-arm only that mailbox's
   * entry, and only if it timed out (the poller calls this after a successful poll).
   */
  prompt(pre: string, mailbox?: string): void {
    if (mailbox !== undefined) {
      const id = idOf(pre, mailbox);
      if (!this.#budgets.get(id)?.expired) return;
      this.#budgets.delete(id);
    } else {
      for (const id of [...this.#budgets.keys()]) if (id.startsWith(`${pre}/`)) this.#budgets.delete(id);
    }
    this.wake.notify();
  }

  /**
   * A mailbox refused the owner's poll with 403: whatever the record says it holds, it cannot authenticate
   * the owner (it lost its state, or accepted a post it then escrowed). Forget what it was given, so the next
   * pass posts the KEL again, and give the entry a fresh budget. The poller calls this at most once per backoff
   * period, which is also the most this posts; a mailbox that never recovers is given up on like any other.
   */
  repair(pre: string, mailbox: string): void {
    const { hby } = this.#deps, record = hby.db.kpub.get([pre, mailbox]);
    if (!hby.readonly && record?.d) hby.db.kpub.pin([pre, mailbox], { d: null, dt: record.dt });
    this.#budgets.delete(idOf(pre, mailbox));
    this.wake.notify();
  }

  /**
   * Drain the cues, then send up to {@link KelSendsPerPass} due posts, each within `timeoutMs` for the
   * mailbox's answer. A post is recorded when the mailbox answers 2xx; a failure is retried on the schedule
   * until the budget is used up. Never throws on a remote failure; every attempt is returned.
   */
  *processOnce({ timeoutMs = KEL_PUBLISH_HEADER_TIMEOUT_MS }: { timeoutMs?: number } = {}): Operation<
    MailboxPublication[]
  > {
    const { clock, hby } = this.#deps;
    for (let cue = this.rotated.pull(); cue; cue = this.rotated.pull()) this.prompt(cue.pre);
    if (hby.readonly) return [];
    this.#prune();
    const owed = this.#derive().filter((entry) => !entry.published);
    const live = new Set(owed.map((entry) => idOf(entry.pre, entry.mailbox)));
    for (const id of [...this.#budgets.keys()]) if (!live.has(id)) this.#budgets.delete(id);
    const results: MailboxPublication[] = [];
    for (const entry of owed) {
      if (results.length >= KelSendsPerPass) break;
      const id = idOf(entry.pre, entry.mailbox), budget = this.#budget(id, entry.said);
      if (entry.hold || !entry.url || budget.expired || budget.retryAt > clock.now() || this.#inflight.has(id)) {
        continue;
      }
      this.#inflight.add(id);
      try {
        results.push(yield* this.#attempt(entry, entry.url, budget, timeoutMs));
      } finally {
        this.#inflight.delete(id);
      }
    }
    return results;
  }

  /** Whether a cue is waiting or a failed post is waiting out its retry delay; in memory, reads no store. */
  pending(): boolean {
    return !this.rotated.empty || [...this.#budgets.values()].some((budget) => !budget.expired && budget.attempts > 0);
  }

  /** Pure read of every (identifier, mailbox) pair and where it stands. */
  status(): KelPublisherStatus {
    if (this.#deps.hby.readonly) return { entries: [] };
    return {
      entries: this.#derive().map((entry): KelPublicationStatus => {
        const base = { pre: entry.pre, mailbox: entry.mailbox, said: entry.said };
        if (entry.published) return { ...base, state: "published", attempts: 0 };
        const budget = this.#budgets.get(idOf(entry.pre, entry.mailbox));
        const failed = this.#deps.hby.db.kpub.get([entry.pre, entry.mailbox])?.failed;
        if (entry.hold) return { ...base, state: "waiting", attempts: budget?.attempts ?? 0, lastFailure: entry.hold };
        if (budget?.expired) {
          return {
            ...base,
            state: "timed-out",
            attempts: failed?.attempts ?? budget.attempts,
            lastFailure: failed?.reason ?? budget.lastFailure ?? undefined,
          };
        }
        return {
          ...base,
          state: "pending",
          attempts: budget?.attempts ?? 0,
          ...(budget?.lastFailure ? { lastFailure: budget.lastFailure } : {}),
          ...(budget?.attempts ? { retryAt: new Date(budget.retryAt).toISOString() } : {}),
        };
      }),
    };
  }

  /**
   * Observe until every mailbox of `pre` is `published` or `timed-out`, or the deadline passes. Starts no
   * worker: the runtime's publisher fiber (or a host's own `processOnce`) makes the progress. A waiting entry
   * (unwitnessed, unanchored, no URL) keeps the wait open.
   */
  *waitForPublication(
    pre: string,
    { timeoutMs, pollMs = 50 }: { timeoutMs: number; pollMs?: number },
  ): Operation<WaitResult<KelPublisherStatus>> {
    const settled = () =>
      this.status().entries.every((entry) =>
        entry.pre !== pre || entry.state === "published" || entry.state === "timed-out"
      );
    const done = yield* observeUntil(settled, { timeoutMs, pollMs, clock: this.#deps.clock });
    const status = this.status();
    return done ? { outcome: "settled", status } : { outcome: "timed-out", status, timeoutMs };
  }

  /** The budget of `id` for establishment event `said`; a new event starts a new budget. */
  #budget(id: string, said: string): Budget {
    let budget = this.#budgets.get(id);
    if (!budget || budget.said !== said) {
      budget = { said, firstAt: null, attempts: 0, lastFailure: null, retryAt: 0, expired: false };
      this.#budgets.set(id, budget);
    }
    return budget;
  }

  /** Post once, then record: the record on 2xx (or a host that cannot take the stream), a delay or give-up otherwise. */
  *#attempt(entry: Derived, url: string, budget: Budget, timeoutMs: number): Operation<MailboxPublication> {
    const { clock, changes, hby } = this.#deps, id = idOf(entry.pre, entry.mailbox);
    budget.firstAt ??= clock.now();
    const result = yield* postKelToMailbox(this.#deps, entry.pre, { eid: entry.mailbox, url }, { timeoutMs });
    const unsupported = result.outcome === "failed" && (result.status === 400 || result.status === 406);
    if (result.outcome === "told" || unsupported) {
      pinKelPublished(hby.db, entry.pre, entry.mailbox, { d: entry.said, m: entry.member }, clock);
      this.#budgets.delete(id);
    } else {
      budget.attempts += 1;
      budget.lastFailure = result.reason;
      const delay = Math.min(KEL_PUBLISH_BASE_MS * 2 ** (budget.attempts - 1), KEL_PUBLISH_MAX_DELAY_MS);
      budget.retryAt = clock.now() + delay;
      if (budget.retryAt - budget.firstAt > KEL_PUBLISH_BUDGET_MS) {
        budget.expired = true;
        const record = hby.db.kpub.get([entry.pre, entry.mailbox]);
        hby.db.kpub.pin([entry.pre, entry.mailbox], {
          d: record?.d ?? null,
          ...(record?.m ? { m: record.m } : {}),
          dt: record?.dt ?? new Date(clock.now()).toISOString(),
          failed: {
            d: entry.said,
            dt: new Date(clock.now()).toISOString(),
            attempts: budget.attempts,
            reason: result.reason,
          },
        });
      }
    }
    changes?.push({ kind: "event", id: `${entry.pre}:${entry.sn}` });
    return result;
  }

  /** Every (identifier, mailbox) pair with an authorized role, from the stores alone. */
  #derive(): Derived[] {
    const { hby } = this.#deps, db = hby.db, derived: Derived[] = [];
    for (const hab of hby.habs.values()) {
      const kever = hab.kever;
      if (!kever || !hab.pre) continue;
      const heads = kelHeads(hby, hab.pre);
      if (!heads) continue;
      const said = heads.d;
      for (const mailbox of authorizedMailboxes(db, hab.pre)) {
        const url = preferredUrl(fetchEndpointUrls(hby, mailbox)) ?? null;
        const established = db.getEvtSerder(hab.pre, said);
        let hold: Derived["hold"] = null;
        if (!url) hold = "no-url";
        else if (!established || !db.fullyWitnessed(established)) hold = "unwitnessed";
        else if (kever.delegated && !db.aess.get(dgKey(hab.pre, said))) hold = "unanchored";
        derived.push({
          pre: hab.pre,
          mailbox,
          url,
          said,
          member: heads.m,
          sn: kever.sn,
          published: holdsHeads(db.kpub.get([hab.pre, mailbox]), heads),
          hold,
        });
      }
    }
    return derived;
  }

  /** Drop records of mailboxes whose role is no longer allowed (or whose identifier is gone). */
  #prune(): void {
    const { hby } = this.#deps, db = hby.db;
    const wanted = new Set<string>();
    for (const hab of hby.habs.values()) {
      if (hab.pre) for (const mailbox of authorizedMailboxes(db, hab.pre)) wanted.add(idOf(hab.pre, mailbox));
    }
    for (const [[pre, mailbox]] of [...db.kpub.getTopItemIter()]) {
      if (!wanted.has(idOf(pre!, mailbox!))) db.kpub.rem([pre!, mailbox!]);
    }
  }
}

/**
 * Run the publisher on its own fiber until halted: a pass, then a sleep of {@link KEL_PUBLISHER_BUSY_MS} while
 * a post waits to be retried and {@link KEL_PUBLISHER_IDLE_MS} otherwise, or less when a cue wakes it. A mailbox
 * that hangs holds up only this fiber, never the operation owners. A failure that escapes a pass is counted in
 * `publisher.health` and the loop keeps running.
 */
export function* kelPublisherDo(
  publisher: KelPublisher,
  clock: RuntimeClock,
  { busyMs = KEL_PUBLISHER_BUSY_MS, idleMs = KEL_PUBLISHER_IDLE_MS }: { busyMs?: number; idleMs?: number } = {},
): Operation<never> {
  while (true) {
    try {
      yield* publisher.processOnce();
    } catch (error) {
      publisher.health.faults++;
      publisher.health.last = { error, at: clock.now() };
    }
    yield* publisher.wake.sleep(clock, publisher.pending() ? busyMs : idleMs);
  }
}
