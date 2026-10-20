/**
 * Finite query workflows corresponding to `keri.app.querying` doers in KERIpy.
 *
 * Each operation expresses a particular accepted-state predicate. It enqueues
 * unsigned work with WitnessInquisitor, then observes local protocol state;
 * sending a query or receiving HTTP 204 never satisfies that predicate.
 * Composition must run the sender, cue worker and actual reply intake alongside
 * the workflow. HTTP replies arrive through independent mailbox/direct intake;
 * TCP may process replies on the sending connection.
 *
 * Unlike KERIpy's nested DoDoers, these operations borrow one composed sender.
 * Their caller owns cancellation/deadlines and keeps the Baser open until all
 * children have joined. Cancelling a wait does not withdraw an already enqueued
 * query. There is no workflow retry timer or implicit OOBI bootstrap here.
 */
import type { SealEvent } from "cesr-ts";
import type { Operation } from "effection";
import type { AgentCue } from "../core/cues.ts";
import type { Deck } from "../core/deck.ts";
import type { Baser } from "../db/basing.ts";
import { runtimeTurn } from "./runtime-turn.ts";
import type { WitnessInquisitor } from "./witness-inquisitor.ts";

/** Identity selection shared by the concrete workflows; copied on construction. */
interface QueryOptions {
  /** Local AID endorsing the query; omission uses the sender's configured/sole Hab. */
  signer?: string;
  /** Remote attester overrides; omission uses the subject's accepted endpoint roles. */
  wits?: string[];
}

/** Snapshot the caller's attester list before the workflow starts. */
function copyOptions(options: QueryOptions): QueryOptions {
  return { signer: options.signer, wits: options.wits ? [...options.wits] : undefined };
}

/** Preserve the existing nonnegative hex query ordinal convention. */
function hexOrdinal(value: number): string {
  return Math.max(0, value).toString(16);
}

/** Wait for an accepted KEL sequence, never for transport or queue completion. */
function* awaitSequence(db: Baser, pre: string, sn: number): Operation<void> {
  while (true) {
    const local = db.getKever(pre);
    if (local && local.sn >= sn) return;
    yield* runtimeTurn();
  }
}

/**
 * Ask an attester for current key state and recover the KEL if its notice is ahead.
 *
 * A saved KSN is a remote statement, not acceptance of the referenced KEL. A
 * matching notice completes immediately only when the local Kever has reached
 * its sequence. Otherwise a LogQuerier waits for that accepted sequence. The
 * first usable matching notice fixes this operation's target; later notices stay
 * queued rather than introducing moving-target task replacement.
 * The subject needs a local Kever before a notice can drive this comparison;
 * initial evidence discovery belongs to OOBI/bootstrap composition.
 *
 * keyStateSaved denotes a validated, persisted remote notice. Ordinary KEL
 * acceptance alone cannot satisfy the initial notice wait. Queued notices are
 * not correlated to a particular request or filtered for request-time freshness.
 */
export class KeyStateNoticer {
  private readonly options: QueryOptions;

  /**
   * Bind borrowed collaborators without starting I/O or consuming cues yet.
   *
   * @param db Baser receiving accepted KEL updates from the independently running intake.
   * @param inquisitor Query sender over that same state; its delivery worker must run concurrently.
   * @param pre Subject AID, distinct from the local signer and selected attester.
   * @param cues Command-owned input Deck; this noticer is its sole consumer. The
   * application cue owner must be wired to transfer saved notices here before I/O.
   * @param options Local signer and optional remote attesters, never transport preferences.
   */
  constructor(
    private readonly db: Baser,
    private readonly inquisitor: WitnessInquisitor,
    readonly pre: string,
    private readonly cues: Deck<AgentCue>,
    options: QueryOptions = {},
  ) {
    this.options = copyOptions(options);
  }

  /**
   * Enqueue `ksn`, then pull/match/append one cue per cooperative turn, following
   * KERIpy's noticer model. Unrelated cues and matching notices without local
   * state remain queued. No queue scan, broadcast or request freshness is implied.
   * Once a usable notice selects a target, directly await accepted catch-up.
   * The caller supervises sibling sender/receiver failures and owns cancellation;
   * stopping this operation does not withdraw already enqueued requests.
   */
  *queryDo(): Operation<void> {
    const { db, inquisitor, pre, cues, options } = this;
    inquisitor.enqueue({ pre, route: "ksn", q: { fn: "0", s: "0" }, ...options });
    while (true) {
      const cue = cues.pull();
      if (cue) {
        const local = db.getKever(pre);
        if (cue.kin !== "keyStateSaved" || cue.ksn.i !== pre || !local) {
          cues.append(cue);
        } else {
          const ordinal = cue.ksn.s;
          const targetSn = typeof ordinal === "string" && ordinal.length ? parseInt(ordinal, 16) : NaN;
          if (!Number.isNaN(targetSn)) {
            if (local.sn < targetSn) yield* new LogQuerier(db, inquisitor, pre, targetSn, options).queryDo();
            return;
          }
        }
      }
      yield* runtimeTurn();
    }
  }
}

/**
 * Recover a KEL through the target sequence learned from a remote key-state notice.
 * Like KERIpy LogQuerier, request logs from the beginning (`fn=0`, `s=0`) and
 * finish when the local Kever reaches the target. This is a minimum sequence
 * condition, not a promise that the remote peer has no newer events.
 */
export class LogQuerier {
  private readonly options: QueryOptions;

  /**
   * @param db Borrowed accepted-state store, kept open for the operation's lifetime.
   * @param inquisitor Concurrently running sender; this workflow does not drive it.
   * @param pre Subject whose KEL should catch up.
   * @param targetSn Minimum accepted sequence, as a number rather than wire hex text.
   * @param options Local signing AID and optional remote attester overrides.
   */
  constructor(
    private readonly db: Baser,
    private readonly inquisitor: WitnessInquisitor,
    readonly pre: string,
    readonly targetSn: number,
    options: QueryOptions = {},
  ) {
    this.options = copyOptions(options);
  }

  /** Send the initial request once and remain active until accepted state reaches the target. */
  *queryDo(): Operation<void> {
    this.inquisitor.enqueue({ pre: this.pre, route: "logs", q: { fn: "0", s: "0" }, ...this.options });
    yield* awaitSequence(this.db, this.pre, this.targetSn);
  }
}

/**
 * Request logs starting at selected KEL and first-seen ordinals.
 *
 * `s` selects the event sequence and `fn` selects first-seen replay position;
 * they are different coordinates. As in KERIpy SeqNoQuerier, completion depends
 * on accepted KEL sequence reaching targetSn, not on a first-seen cursor or a
 * transport outcome. Even an already satisfied target still enqueues the request.
 */
export class SeqNoQuerier {
  private readonly options: QueryOptions;
  private readonly fn: number;

  /**
   * @param db Borrowed accepted-state store updated by independent protocol intake.
   * @param inquisitor Concurrent sender borrowing the same accepted state.
   * @param pre Subject AID whose KEL is requested.
   * @param targetSn Numeric sequence used both in the query and the completion predicate.
   * @param options Numeric first-seen start (default zero), local signer and remote attesters.
   * Wire ordinals use lowercase hex; the existing encoder clamps negatives to zero.
   */
  constructor(
    private readonly db: Baser,
    private readonly inquisitor: WitnessInquisitor,
    readonly pre: string,
    readonly targetSn: number,
    { fn = 0, ...options }: QueryOptions & { fn?: number } = {},
  ) {
    this.fn = fn;
    this.options = copyOptions(options);
  }

  /** Complete only from an accepted KEL at or beyond the requested sequence. */
  *queryDo(): Operation<void> {
    this.inquisitor.enqueue({
      pre: this.pre,
      route: "logs",
      q: { fn: hexOrdinal(this.fn), s: hexOrdinal(this.targetSn) },
      ...this.options,
    });
    yield* awaitSequence(this.db, this.pre, this.targetSn);
  }
}

/**
 * Find an accepted KEL event containing the exact supplied event seal.
 *
 * `pre` identifies the sealing KEL; anchor.i/s/d identify the event sealed in it.
 * Mere knowledge of the subject's latest sequence does not satisfy this wait.
 * Existing accepted sealing evidence completes without sending. Otherwise one
 * request is enqueued per current eligible attester, preserving the bounded
 * candidate pass needed when a retired witness never learned the anchor. This
 * differs deliberately from KERIpy's single randomly selected attester.
 */
export class AnchorQuerier {
  readonly anchor: ReturnType<typeof SealEvent.toSad>;
  private readonly options: QueryOptions;

  /**
   * @param db Borrowed store containing accepted sealing events and their indexes.
   * @param inquisitor Concurrent sender; candidates are selected when queryDo starts.
   * @param pre AID whose KEL must contain the seal.
   * @param anchor Exact event-seal fields, copied so later caller mutation cannot change the query.
   * @param options Local signing AID and optional remote attesters.
   */
  constructor(
    private readonly db: Baser,
    private readonly inquisitor: WitnessInquisitor,
    readonly pre: string,
    anchor: ReturnType<typeof SealEvent.toSad>,
    options: QueryOptions = {},
  ) {
    this.anchor = { i: anchor.i, s: anchor.s, d: anchor.d };
    this.options = copyOptions(options);
  }

  /**
   * Ask the finite candidate set once, then observe accepted sealing evidence.
   * No available candidate leaves unresolved work with the sender; it is not
   * success. The caller supplies a deadline or cancels this otherwise open wait.
   */
  *queryDo(): Operation<void> {
    if (this.db.fetchLastSealingEventByEventSeal(this.pre, this.anchor)) return;
    // Deliberate difference from KERIpy's single random choice: a retired witness
    // may never learn the seal. Preserve the tested, finite current-candidate pass.
    const attesters = this.inquisitor.attestersFor(this.pre, this.options);
    for (const src of attesters.length ? attesters : [undefined]) {
      this.inquisitor.enqueue({
        pre: this.pre,
        route: "logs",
        q: { fn: "0", s: "0", a: { ...this.anchor } },
        src,
        ...this.options,
      });
    }
    while (!this.db.fetchLastSealingEventByEventSeal(this.pre, this.anchor)) yield* runtimeTurn();
  }
}
