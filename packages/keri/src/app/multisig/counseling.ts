/**
 * Group-event Counselor: drives an accepted-or-pending group KEL event through
 * member signatures and witness receipts, as KERIpy `app.grouping.Counselor`.
 *
 * Durable state is KERIpy's, row for row: `gpse` and `gpwe` hold `(pre) ->
 * IoSet[(Number, Diger)]`, `gdee` holds delegated events awaiting the delegator
 * and `cgms` holds `(pre, number.qb64) -> Diger` for completed events. The
 * Counselor never signs; it only observes accepted state and, for witness
 * receipts, asks the injected receipting collaborator to submit or fetch.
 *
 * Divergences from KERIpy, each deliberate:
 * - An escrow row is removed by exact `(Number, Diger)` tuple. KERIpy removes
 *   every row of the prefix and never compares digests; here a different SAID
 *   accepted at the same sn drops only the stale tuple and reads `superseded`.
 * - Receipts are judged against the event's own governing establishment, not
 *   the prefix's current key state.
 * - "Must submit" derives from stored receipts and the election, not from an
 *   in-memory cue, so a restarted process resumes. Non-elected members fetch
 *   receipts and, after `fallbackAfterMs`, submit as the elected one would;
 *   KERIpy stalls when the elected member is offline.
 * - A newer completion at the same `(pre, sn)` replaces the `cgms` digest.
 * - A delegated `dip`/`drt` is accepted by its own delegate before the delegator's
 *   anchor and before witnesses receipt it (KERIpy `validateDelegation`: the
 *   delegatee accepts its own event to trigger receipting and approval). It
 *   waits in `gdee`. The publishing member (elected, or any member once the
 *   fallback grace passes) hands it to the Anchorer, which requests approval,
 *   awaits the anchor and publishes; the Counselor gates and observes, and
 *   writes `cgms` when the Anchorer completes. Any other member queries the
 *   delegator's witness for the anchor, pins `aess`, and continues in `gpwe`.
 *   Without an Anchorer such events stay in `gdee`, reported `notSupported`.
 *
 * Witness authorization codes, the delegation proxy and retry timers are process
 * memory only, as in KERIpy and the Anchorer. Without a proxy the local group
 * member sends delegation traffic, as KERIpy does for every group event, so a
 * restart never leaves a delegated event waiting for one. Collaborators are
 * narrow (ADR-0013); nothing here reaches a runtime.
 */
import { Diger, Ilks, NumberPrimitive, NumDex, ParserError, type SerderKERI, Verfer } from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";
import type { RotatedCue } from "../../core/cues.ts";
import { ValidationError } from "../../core/errors.ts";
import { Kever } from "../../core/kel/kever.ts";
import type { Baser } from "../../db/basing.ts";
import { dgKey } from "../../db/core/keys.ts";
import {
  type Anchorer,
  type AnchorQueryDeps,
  pinAuthorizingSeal,
  retryDelegatorWitnessQuery,
} from "../identity/delegating.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import type { RetryPolicy } from "../runtime/retry-backoff.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { type ChangeSink, observeUntil, type WaitResult } from "../runtime/workflow-contract.ts";
import type { WitnessAuthMap } from "../witness/receipting.ts";
import { groupSigningMembers, groupWitnesser, isLocalGroupHab, localGroupMember } from "./group-members.ts";
import { type GroupDelivery, remoteGroupMembers } from "./multisig-messaging.ts";

/** Exact group event a Counselor tracks. */
export interface GroupEventRef {
  pre: string;
  sn: number;
  said: string;
}

/** Counseling stage, in processing order. */
export type CounselStage = "signatures" | "delegation" | "witnesses";

/** Why a pending event cannot progress without outside help. */
export type CounselBlock =
  | { kind: "witnessAuth"; witnesses: string[] }
  | { kind: "witness"; reason: string }
  | { kind: "delegatorUnknown"; delpre: string }
  /** No Anchorer was supplied, so delegated events cannot progress. */
  | { kind: "notSupported"; feature: "delegation" };

/** Status of one group event; a pure read of durable rows plus retry state. */
export type GroupEventStatus =
  | {
    state: "pending";
    stage: CounselStage;
    /** Whether this member is the event's witnesser; null before the event is accepted locally. */
    elected: boolean | null;
    /** Verified witness receipts held versus the event's own witness threshold. */
    receipts: { have: number; need: number };
    blocked?: CounselBlock;
  }
  | { state: "complete" }
  | { state: "superseded"; accepted: string }
  | { state: "unknown" };

/** Per-event inputs; kept in memory only. */
export interface CounselInputs {
  /** Witness Authorization values for this event; a map replaces any earlier one. */
  auths?: WitnessAuthMap;
  /**
   * How long a non-elected member only fetches receipts before it submits too.
   * Zero makes every member submit. Default {@link DEFAULT_FALLBACK_AFTER_MS}.
   */
  fallbackAfterMs?: number;
  /**
   * Local hab that sends the delegation request and queries the delegator's
   * witness. Optional: the local group member sends when none is supplied, as
   * in KERIpy. An explicit proxy wins. Memory only.
   */
  proxy?: Hab;
}

/** Delegation collaborators; both are borrowed and run by the host. */
export interface GroupDelegation {
  /** Existing delegation workflow owner; the Counselor only begins and observes it. */
  anchorer: Pick<Anchorer, "begin" | "complete">;
  /** Query producer for delegator-anchor discovery by members that do not publish. */
  querying: AnchorQueryDeps["querying"];
}

/** Receipting collaborator; `Receiptor` fits. */
export interface GroupReceipting {
  receipt(pre: string, options: { sn: number; auths: WitnessAuthMap }): Operation<unknown>;
  get(pre: string, options: { sn: number; said: string }): Operation<boolean>;
}

/** Told when a group rotation completes, so its mailboxes are told; the runtime's `kelPublisher.rotated` fits. */
export interface GroupMailboxes {
  rotated(cue: RotatedCue): void;
}

/**
 * Sends a completed event to members that may never have seen the signatures that completed it (a member that signed
 * nothing, or one whose own signature was not needed). One outcome per member; a transport failure is the member's
 * `failed` outcome and not an error.
 */
export interface GroupForwarding {
  forward(event: GroupEventRef, members: readonly string[]): Operation<GroupDelivery[]>;
}

/** Forwarding attempts of one completed event before the Counselor stops retrying its failed members. */
export const FORWARD_ATTEMPTS = 8;

/** A completed event still owed to some members. */
interface Forward {
  event: GroupEventRef;
  members: string[];
  attempts: number;
  nextAt: number;
}

/** Grace before a non-elected member submits receipts itself. */
export const DEFAULT_FALLBACK_AFTER_MS = 60_000;
/** First and longest wait between receipt attempts for one event. */
export const RECEIPT_BACKOFF_MS = { first: 1_000, max: 30_000 } as const;
/** The production receipt retry delays as a policy; only `baseMs` and `maxMs` apply, the Counselor never gives up. */
export const DEFAULT_RECEIPT_RETRY: Readonly<RetryPolicy> = Object.freeze({
  baseMs: RECEIPT_BACKOFF_MS.first,
  maxMs: RECEIPT_BACKOFF_MS.max,
  boundMs: 0,
});

/** In-memory retry and input state for one event. */
interface Run {
  auths: WitnessAuthMap;
  fallbackAfterMs: number;
  /** When this process first pursued receipts for the event. */
  since: number | null;
  nextAt: number;
  delay: number;
  failure: string | null;
  proxy: Hab | null;
  /** Whether this process handed the event to the Anchorer with the current proxy. */
  begun: boolean;
}

/** Escrow tables in stage order. */
const STAGES = [["signatures", "gpse"], ["delegation", "gdee"], ["witnesses", "gpwe"]] as const;

/** Receipt progress of one event against its own governing establishment. */
function receiptProgress(db: Baser, serder: SerderKERI): { have: number; need: number; missing: string[] } {
  let est: SerderKERI | null = serder;
  while (est && !est.estive) est = est.prior ? db.getEvtSerder(est.pre!, est.prior) : null;
  if (!est) return { have: 0, need: 0, missing: [] };
  const witnesses = db.wits.get(dgKey(est.pre!, est.said!)).map(wit => wit.qb64);
  const { indices } = Kever.verifyIndexedSignatures(
    serder.raw,
    db.wigs.get(dgKey(serder.pre!, serder.said!)),
    witnesses.map(qb64 => new Verfer({ qb64 })),
  );
  return {
    have: indices.length,
    need: Number(est.bner!.num),
    missing: witnesses.filter((_, index) => !indices.includes(index)),
  };
}

/** Counsels group events through signature and witness stages. */
export class Counselor {
  private readonly runs = new Map<string, Run>();
  /** Completed events this member, as the elected one, still owes to other members; memory only. */
  private readonly forwards = new Map<string, Forward>();
  private readonly forwarded = new Map<string, GroupDelivery[]>();

  /**
   * @param hby Borrowed identities and stores; the Counselor opens nothing.
   * @param receipting Submits or fetches witness receipts for accepted events.
   * @param clock Time source for fallback and retry; only `now` is used.
   * @param changes Optional sink told `{kind:"group", id:"<pre>:<sn>"}` after commits.
   * @param delegation Anchorer and query port for delegated events; omit for non-delegated hosts.
   * @param mailboxes Told when one of the group's rotations completes; the member runtime's publisher then tells
   *   the group's mailboxes the new key state, and several members doing so is harmless.
   */
  constructor(
    private readonly hby: Habery,
    private readonly receipting: GroupReceipting,
    private readonly clock: Pick<RuntimeClock, "now">,
    private readonly changes?: ChangeSink,
    private readonly delegation?: GroupDelegation,
    private readonly mailboxes?: GroupMailboxes,
    private readonly receiptRetry: Readonly<RetryPolicy> = DEFAULT_RECEIPT_RETRY,
    private readonly forwarding?: GroupForwarding,
  ) {
    this.anchorQuery = delegation && { hby, querying: delegation.querying, retryPasses: new Map() };
  }

  private readonly anchorQuery: AnchorQueryDeps | undefined;

  /**
   * Begin counseling an event. Idempotent and safe before local acceptance.
   *
   * @returns True when a new `gpse` row was added; false when the event is
   *   already counseled or complete, or another SAID holds that sn.
   * @throws ValidationError when `pre` is not a local group or the ref is malformed.
   */
  start(event: GroupEventRef, inputs: CounselInputs = {}): boolean {
    const { pre, sn, said } = event;
    if (!Number.isSafeInteger(sn) || sn < 0 || !said) throw new ValidationError("Invalid group event reference.");
    const hab = this.hby.habs.get(pre);
    if (!hab || !isLocalGroupHab(this.hby, hab)) throw new ValidationError(`${pre} is not a local group.`);
    const db = this.hby.db;
    if (this.settled(event)) return false; // nothing to counsel, so nothing to retain
    this.retain(event, inputs);
    if (this.stageOf(event)) return false;
    return db.gpse.add([pre], [NumberPrimitive.fromNum(BigInt(sn)), new Diger({ qb64: said })]);
  }

  /**
   * Replace in-memory inputs of a counseled event, for example witness auths or
   * a proxy after a restart, and re-arm any attempt waiting out its backoff.
   * Ignored for an event that is already complete or superseded.
   */
  supply(event: GroupEventRef, inputs: CounselInputs): void {
    if (!this.settled(event)) this.retain(event, inputs);
  }

  /** Pure read of one event's state. */
  status(event: GroupEventRef): GroupEventStatus {
    const { pre, sn, said } = event;
    const done = this.completed(pre, sn);
    if (done !== null) return done === said ? { state: "complete" } : { state: "superseded", accepted: done };
    const accepted = this.hby.db.kels.getLast(pre, sn);
    if (accepted && accepted !== said) return { state: "superseded", accepted };
    const stage = this.stageOf(event);
    if (!stage) return { state: "unknown" };
    // A counseled event may not be stored locally yet; it is still pending, not unknown.
    const serder = this.hby.db.getEvtSerder(pre, said);
    if (!serder) return { state: "pending", stage, elected: null, receipts: { have: 0, need: 0 } };
    const { have, need, missing } = receiptProgress(this.hby.db, serder);
    const elected = accepted ? groupWitnesser(this.hby, pre, { sn, said }) : null;
    const status: GroupEventStatus = { state: "pending", stage, elected, receipts: { have, need } };
    const run = this.runs.get(this.runKey(event));
    const failure = run?.failure ? this.receiptBlock(run, missing) : undefined;
    if (stage === "delegation") status.blocked = this.delegationBlock(event) ?? failure;
    else if (stage === "witnesses") status.blocked = failure;
    if (!status.blocked) delete status.blocked;
    return status;
  }

  /** Why a receipt attempt failed: missing auths for unreceipted witnesses, else the witness's own reason. */
  private receiptBlock(run: Run, missing: string[]): CounselBlock {
    const unauthorized = missing.filter(witness => !(witness in run.auths));
    return unauthorized.length
      ? { kind: "witnessAuth", witnesses: unauthorized }
      : { kind: "witness", reason: run.failure! };
  }

  /** What keeps a delegated event in `gdee`, if anything the caller can fix. */
  private delegationBlock(event: GroupEventRef): CounselBlock | undefined {
    if (!this.delegation) return { kind: "notSupported", feature: "delegation" };
    const delpre = this.hby.db.getKever(event.pre)?.delpre;
    if (delpre && !this.hby.db.getKever(delpre)) return { kind: "delegatorUnknown", delpre };
    return undefined;
  }

  private fallbackElapsed(run: Run | undefined): boolean {
    return !!run && run.since !== null && this.clock.now() - run.since >= run.fallbackAfterMs;
  }

  /** True when the event is complete, or another SAID holds its sn. */
  private settled({ pre, sn, said }: GroupEventRef): boolean {
    const accepted = this.hby.db.kels.getLast(pre, sn);
    return (!!accepted && accepted !== said) || this.completed(pre, sn) !== null;
  }

  /** Events still counseled for `pre`, or for every prefix, in stage order. */
  pending(pre?: string): Array<GroupEventRef & { stage: CounselStage }> {
    const found: Array<GroupEventRef & { stage: CounselStage }> = [];
    for (const [stage, table] of STAGES) {
      for (const [[key], [number, diger]] of this.hby.db[table].getTopItemIter(pre ?? "", { topive: !!pre })) {
        found.push({ pre: key, sn: Number(number.num), said: diger.qb64, stage });
      }
    }
    return found;
  }

  /** True once the exact event completed; drops its in-memory inputs. */
  complete(event: GroupEventRef): boolean {
    const done = this.completed(event.pre, event.sn) === event.said;
    if (done) this.runs.delete(this.runKey(event));
    return done;
  }

  /**
   * Stop counseling `pre`: remove its escrow rows, completion markers and
   * in-memory inputs. Accepted KEL state is untouched.
   */
  abandon(pre: string): void {
    const db = this.hby.db;
    const removed = new Set(this.pending(pre).map(event => event.sn));
    for (const [[, number]] of db.cgms.getTopItemIter([pre], { topive: true })) {
      removed.add(Number(new NumberPrimitive({ qb64: number }).num));
    }
    db.transaction(() => {
      for (const [, table] of STAGES) db[table].rem([pre]);
      for (const [keys] of [...db.cgms.getTopItemIter([pre], { topive: true })]) db.cgms.rem(keys);
    });
    for (const key of [...this.runs.keys()]) if (key.startsWith(`${pre}:`)) this.runs.delete(key);
    for (const sn of removed) this.changes?.push({ kind: "group", id: `${pre}:${sn}` });
  }

  /** Whether completed events are held in memory for forwarding, which a pass retries without any store write. */
  get holdsForwards(): boolean {
    return this.forwards.size > 0;
  }

  /** One pass over all stages, as KERIpy `processEscrows`. */
  *processOnce(): Operation<void> {
    // A runtime calls this every turn; with nothing counseled, three row counts are the whole cost.
    const db = this.hby.db;
    if (db.gpse.cnt() === 0 && db.gdee.cnt() === 0 && db.gpwe.cnt() === 0 && this.forwards.size === 0) return;
    this.processSignatures();
    yield* this.processDelegation();
    yield* this.processWitnesses();
    yield* this.forwardCompleted();
  }

  /** What became of the completed `event` this member forwarded to the others, per member; empty before it did. */
  forwardOutcomes(event: GroupEventRef): readonly GroupDelivery[] {
    return this.forwarded.get(this.runKey(event)) ?? [];
  }

  /** Send each completed event to the members that may not have it; failed members are retried with a doubling delay. */
  private *forwardCompleted(): Operation<void> {
    if (!this.forwarding) return;
    for (const [key, owed] of [...this.forwards]) {
      const now = this.clock.now();
      // The local member signs the forward; a group whose member cannot sign yet keeps it without spending an attempt.
      if (now < owed.nextAt || !this.hby.habs.get(owed.event.pre)?.canSign()) continue;
      let outcomes: GroupDelivery[];
      try {
        outcomes = yield* this.forwarding.forward(owed.event, owed.members);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        outcomes = owed.members.map((recipient) => ({
          recipient,
          exnSaid: owed.event.said,
          payloadSaid: owed.event.said,
          outcome: "failed" as const,
          deliveries: [],
          reason,
        }));
      }
      const failed = outcomes.filter((outcome) => outcome.outcome === "failed");
      this.forwarded.set(key, [
        ...(this.forwarded.get(key)?.filter((prior) => !outcomes.some((o) => o.recipient === prior.recipient)) ?? []),
        ...outcomes,
      ]);
      owed.attempts++;
      if (!failed.length || owed.attempts >= FORWARD_ATTEMPTS) {
        this.forwards.delete(key);
        continue;
      }
      owed.members = failed.map((outcome) => outcome.recipient);
      owed.nextAt = now + Math.min(this.receiptRetry.baseMs * 2 ** owed.attempts, this.receiptRetry.maxMs);
    }
  }

  /** Move events accepted with their escrowed SAID on to delegation or witnesses. */
  private processSignatures(): void {
    for (const [[pre], [number, diger]] of [...this.hby.db.gpse.getTopItemIter()]) {
      const event = this.refOf(pre, number, diger);
      if (this.dropIfSuperseded(this.hby.db.gpse, event, number, diger)) continue;
      if (this.hby.db.kels.getLast(pre, event.sn) !== event.said) continue;
      const ilk = this.hby.db.getEvtSerder(pre, event.said)?.ilk;
      const next = ilk === Ilks.dip || ilk === Ilks.drt ? this.hby.db.gdee : this.hby.db.gpwe;
      this.hby.db.transaction(() => {
        this.hby.db.gpse.rem([pre], [number, diger]);
        next.add([pre], [number, diger]);
      });
      this.changes?.push({ kind: "group", id: `${pre}:${event.sn}` });
    }
  }

  /**
   * Delegated events: the publishing member drives the Anchorer, any other member
   * watches for the delegator's anchor. Both wait for the delegator's KEL.
   */
  private *processDelegation(): Operation<void> {
    const db = this.hby.db;
    for (const [[pre], [number, diger]] of [...db.gdee.getTopItemIter()]) {
      const event = this.refOf(pre, number, diger);
      if (this.dropIfSuperseded(db.gdee, event, number, diger)) continue;
      const serder = db.getEvtSerder(pre, event.said);
      const delpre = db.getKever(pre)?.delpre;
      if (!this.delegation || !serder || !delpre || !db.getKever(delpre)) continue;
      const run = this.retain(event, {});
      run.since ??= this.clock.now();
      const member = localGroupMember(this.hby, pre);
      if (groupWitnesser(this.hby, pre, event) || this.fallbackElapsed(run)) {
        yield* this.publishDelegation(event, serder, run, member, [number, diger]);
      } else {
        this.watchAnchor(event, serder, run, member, delpre, [number, diger]);
      }
    }
  }

  /** Publishing duty: begin the Anchorer, keep receipts coming, and record completion. */
  private *publishDelegation(
    event: GroupEventRef,
    serder: SerderKERI,
    run: Run,
    member: Hab,
    row: [NumberPrimitive, Diger],
  ): Operation<void> {
    const { anchorer } = this.delegation!;
    if (anchorer.complete(event.pre, event.sn)) {
      this.finish(this.hby.db.gdee, event, row);
      return;
    }
    // The Anchorer asks the delegator only once the event's witnesses have receipted it.
    if (!this.hby.db.fullyWitnessed(serder)) yield* this.pursueReceipts(event, serder, true);
    if (!run.begun) {
      anchorer.begin(serder, { communicationHab: run.proxy ?? member });
      run.begun = true;
      this.changes?.push({ kind: "group", id: `${event.pre}:${event.sn}` });
    }
  }

  /** Non-publishing duty: find the delegator's sealing event, pin it, and move on to receipts. */
  private watchAnchor(
    event: GroupEventRef,
    serder: SerderKERI,
    run: Run,
    member: Hab,
    delpre: string,
    row: [NumberPrimitive, Diger],
  ): void {
    const db = this.hby.db;
    retryDelegatorWitnessQuery(this.anchorQuery!, serder, run.proxy ?? member);
    const delegating = db.fetchLastSealingEventByEventSeal(delpre, { i: event.pre, s: serder.snh!, d: event.said });
    if (!delegating) return;
    pinAuthorizingSeal(this.hby, serder, delegating);
    db.transaction(() => {
      db.gdee.rem([event.pre], row);
      db.gpwe.add([event.pre], row);
    });
    this.changes?.push({ kind: "group", id: `${event.pre}:${event.sn}` });
  }

  /** The elected member owes the completed event to the members that did not sign it into existence. */
  private owe(event: GroupEventRef): void {
    if (!this.forwarding || !groupWitnesser(this.hby, event.pre, event)) return;
    const members = remoteGroupMembers(
      this.hby,
      localGroupMember(this.hby, event.pre),
      groupSigningMembers(this.hby, event.pre),
    );
    if (members.length) this.forwards.set(this.runKey(event), { event, members, attempts: 0, nextAt: 0 });
  }

  /** Record completion of a counseled event and drop its row from `table`. */
  private finish(table: Baser["gpse"], event: GroupEventRef, row: [NumberPrimitive, Diger]): void {
    const db = this.hby.db;
    db.transaction(() => {
      table.rem([event.pre], row);
      db.cgms.pin([event.pre, row[0].qb64], row[1]);
    });
    this.runs.delete(this.runKey(event));
    this.changes?.push({ kind: "group", id: `${event.pre}:${event.sn}` });
    this.owe(event);
    const ilk = db.getEvtSerder(event.pre, event.said)?.ilk;
    if (ilk === Ilks.rot || ilk === Ilks.drt) {
      this.mailboxes?.rotated({ kin: "rotated", pre: event.pre, sn: event.sn, said: event.said });
    }
  }

  /** Complete events whose own witness threshold is met; otherwise submit or fetch receipts. */
  private *processWitnesses(): Operation<void> {
    const db = this.hby.db;
    for (const [[pre], [number, diger]] of [...db.gpwe.getTopItemIter()]) {
      const event = this.refOf(pre, number, diger);
      if (this.dropIfSuperseded(db.gpwe, event, number, diger)) continue;
      const serder = db.getEvtSerder(pre, event.said);
      if (!serder) continue;
      if (!db.fullyWitnessed(serder)) {
        yield* this.pursueReceipts(event, serder);
        if (!db.fullyWitnessed(serder)) continue;
      }
      this.finish(db.gpwe, event, [number, diger]);
    }
  }

  /** One backed-off receipt attempt: submit when forced, elected or past the grace, else fetch. */
  private *pursueReceipts(event: GroupEventRef, serder: SerderKERI, forceSubmit = false): Operation<void> {
    const run = this.retain(event, {});
    const now = this.clock.now();
    run.since ??= now;
    if (now < run.nextAt) return;
    const submit = forceSubmit || groupWitnesser(this.hby, event.pre, event) || now - run.since >= run.fallbackAfterMs;
    try {
      if (submit) yield* this.receipting.receipt(event.pre, { sn: event.sn, auths: run.auths });
      else yield* this.receipting.get(event.pre, { sn: event.sn, said: event.said });
      run.failure = null;
      run.delay = this.receiptRetry.baseMs;
    } catch (error) {
      // A witness refusing or being unreachable is a remote outcome: report it in status and retry later.
      run.failure = error instanceof Error ? error.message : String(error);
      run.delay = Math.min(run.delay * 2, this.receiptRetry.maxMs);
      // A witness that answered with a reply this member cannot read (a receipt the elected member already
      // obtained) will not answer better later: submit on the next attempt instead of waiting out the grace.
      if (!submit && error instanceof ParserError) {
        run.fallbackAfterMs = 0;
        run.delay = this.receiptRetry.baseMs;
      }
    }
    run.nextAt = now + run.delay;
    if (!this.hby.db.fullyWitnessed(serder)) this.changes?.push({ kind: "group", id: `${event.pre}:${event.sn}` });
  }

  /** Remove a stale tuple when another SAID holds its sn; true when removed. */
  private dropIfSuperseded(
    table: Baser["gpse"],
    event: GroupEventRef,
    number: NumberPrimitive,
    diger: Diger,
  ): boolean {
    const accepted = this.hby.db.kels.getLast(event.pre, event.sn);
    if (!accepted || accepted === event.said) return false;
    table.rem([event.pre], [number, diger]);
    this.runs.delete(this.runKey(event));
    this.changes?.push({ kind: "group", id: `${event.pre}:${event.sn}` });
    return true;
  }

  /** Digest of the completed event at `(pre, sn)`, under either number width KERIpy writes. */
  private completed(pre: string, sn: number): string | null {
    const cgms = this.hby.db.cgms;
    const auto = NumberPrimitive.fromNum(BigInt(sn));
    const huge = new NumberPrimitive({ code: NumDex.Huge, raw: hugeRaw(sn) });
    return (cgms.get([pre, auto.qb64]) ?? cgms.get([pre, huge.qb64]))?.qb64 ?? null;
  }

  /** Stage whose escrow holds exactly this event, if any. */
  private stageOf({ pre, sn, said }: GroupEventRef): CounselStage | null {
    for (const [stage, table] of STAGES) {
      for (const [number, diger] of this.hby.db[table].get([pre])) {
        if (Number(number.num) === sn && diger.qb64 === said) return stage;
      }
    }
    return null;
  }

  private refOf(pre: string, number: NumberPrimitive, diger: Diger): GroupEventRef {
    return { pre, sn: Number(number.num), said: diger.qb64 };
  }

  private runKey({ pre, sn, said }: GroupEventRef): string {
    return `${pre}:${sn}:${said}`;
  }

  /** Get or create the in-memory run for an event, applying supplied inputs. */
  private retain(event: GroupEventRef, { auths, fallbackAfterMs, proxy }: CounselInputs): Run {
    if (fallbackAfterMs !== undefined && !(fallbackAfterMs >= 0 && Number.isFinite(fallbackAfterMs))) {
      throw new ValidationError("fallbackAfterMs must be a finite nonnegative duration.");
    }
    const key = this.runKey(event);
    const run = this.runs.get(key)
      ?? {
        auths: {},
        fallbackAfterMs: DEFAULT_FALLBACK_AFTER_MS,
        since: null,
        nextAt: 0,
        delay: this.receiptRetry.baseMs,
        failure: null,
        proxy: null,
        begun: false,
      };
    if (proxy) {
      run.proxy = proxy;
      run.begun = false; // the Anchorer pins its sender per begin, so re-pin
    }
    if (auths) {
      run.auths = { ...auths };
      run.nextAt = 0; // New credentials re-arm an attempt that was waiting out its backoff.
    }
    if (fallbackAfterMs !== undefined) run.fallbackAfterMs = fallbackAfterMs;
    this.runs.set(key, run);
    return run;
  }
}

/** Big-endian 16-byte raw for the `0A` (Huge) number code. */
function hugeRaw(sn: number): Uint8Array {
  const raw = new Uint8Array(16);
  for (let at = 15, value = BigInt(sn); at >= 0; at--, value >>= 8n) raw[at] = Number(value & 0xffn);
  return raw;
}

/** Outcome of {@link waitForGroupEvent}; the status is the one read at return. */
export type GroupEventWait = WaitResult<GroupEventStatus>;

/**
 * Observe `event` until it is no longer pending or the deadline passes. Starts
 * no worker and makes no receipt call; progress comes from `processOnce`
 * running elsewhere.
 */
export function* waitForGroupEvent(
  counselor: Pick<Counselor, "status">,
  event: GroupEventRef,
  { timeoutMs, clock }: { timeoutMs: number; clock?: Pick<RuntimeClock, "now"> },
): Operation<GroupEventWait> {
  const done = yield* observeUntil(() => counselor.status(event).state !== "pending", { timeoutMs, clock });
  const status = counselor.status(event);
  return done ? { outcome: "settled", status } : { outcome: "timed-out", status, timeoutMs };
}
