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
 * - Delegated `dip`/`drt` events are parked in `gdee` and reported as blocked;
 *   the delegation stage is a later change.
 *
 * Witness authorization codes and retry timers are process memory only, as in
 * KERIpy. Collaborators are narrow (ADR-0013); nothing here reaches a runtime.
 */
import { Diger, Ilks, NumberPrimitive, NumDex, type SerderKERI, Verfer } from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { Kever } from "../../core/kel/kever.ts";
import type { Baser } from "../../db/basing.ts";
import { dgKey } from "../../db/core/keys.ts";
import type { Habery } from "../identity/habbing.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { type ChangeSink, observeUntil, type WaitResult } from "../runtime/workflow-contract.ts";
import type { WitnessAuthMap } from "../witness/receipting.ts";
import { groupWitnesser, isLocalGroupHab } from "./group-members.ts";

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
}

/** Receipting collaborator; `Receiptor` fits. */
export interface GroupReceipting {
  receipt(pre: string, options: { sn: number; auths: WitnessAuthMap }): Operation<unknown>;
  get(pre: string, options: { sn: number; said: string }): Operation<boolean>;
}

/** Grace before a non-elected member submits receipts itself. */
export const DEFAULT_FALLBACK_AFTER_MS = 60_000;
/** First and longest wait between receipt attempts for one event. */
export const RECEIPT_BACKOFF_MS = { first: 1_000, max: 30_000 } as const;

/** In-memory retry and input state for one event. */
interface Run {
  auths: WitnessAuthMap;
  fallbackAfterMs: number;
  /** When this process first pursued receipts for the event. */
  since: number | null;
  nextAt: number;
  delay: number;
  failure: string | null;
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

  /**
   * @param hby Borrowed identities and stores; the Counselor opens nothing.
   * @param receipting Submits or fetches witness receipts for accepted events.
   * @param clock Time source for fallback and retry; only `now` is used.
   * @param changes Optional sink told `{kind:"group", id:"<pre>:<sn>"}` after commits.
   */
  constructor(
    private readonly hby: Habery,
    private readonly receipting: GroupReceipting,
    private readonly clock: Pick<RuntimeClock, "now">,
    private readonly changes?: ChangeSink,
  ) {}

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
    this.retain(event, inputs);
    const db = this.hby.db;
    const accepted = db.kels.getLast(pre, sn);
    if ((accepted && accepted !== said) || this.completed(pre, sn) !== null || this.stageOf(event)) return false;
    return db.gpse.add([pre], [NumberPrimitive.fromNum(BigInt(sn)), new Diger({ qb64: said })]);
  }

  /** Pure read of one event's state. */
  status(event: GroupEventRef): GroupEventStatus {
    const { pre, sn, said } = event;
    const done = this.completed(pre, sn);
    if (done !== null) return done === said ? { state: "complete" } : { state: "superseded", accepted: done };
    const accepted = this.hby.db.kels.getLast(pre, sn);
    if (accepted && accepted !== said) return { state: "superseded", accepted };
    const stage = this.stageOf(event);
    const serder = stage ? this.hby.db.getEvtSerder(pre, said) : null;
    if (!stage || !serder) return { state: "unknown" };
    const { have, need, missing } = receiptProgress(this.hby.db, serder);
    const elected = accepted ? groupWitnesser(this.hby, pre, { sn, said }) : null;
    const status: GroupEventStatus = { state: "pending", stage, elected, receipts: { have, need } };
    if (stage === "delegation") status.blocked = { kind: "notSupported", feature: "delegation" };
    const run = this.runs.get(this.runKey(event));
    if (stage === "witnesses" && run?.failure) {
      const unauthorized = missing.filter(witness => !(witness in run.auths));
      status.blocked = unauthorized.length
        ? { kind: "witnessAuth", witnesses: unauthorized }
        : { kind: "witness", reason: run.failure };
    }
    return status;
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
    db.transaction(() => {
      for (const [, table] of STAGES) db[table].rem([pre]);
      for (const [keys] of [...db.cgms.getTopItemIter([pre], { topive: true })]) db.cgms.rem(keys);
    });
    for (const key of [...this.runs.keys()]) if (key.startsWith(`${pre}:`)) this.runs.delete(key);
    this.changes?.push({ kind: "group", id: pre });
  }

  /** One pass over all stages, as KERIpy `processEscrows`. */
  *processOnce(): Operation<void> {
    this.processSignatures();
    this.processParkedDelegation();
    yield* this.processWitnesses();
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

  /** Delegated events wait for the delegation stage; only supersession is handled. */
  private processParkedDelegation(): void {
    for (const [[pre], [number, diger]] of [...this.hby.db.gdee.getTopItemIter()]) {
      this.dropIfSuperseded(this.hby.db.gdee, this.refOf(pre, number, diger), number, diger);
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
      db.transaction(() => {
        db.gpwe.rem([pre], [number, diger]);
        db.cgms.pin([pre, number.qb64], diger);
      });
      this.runs.delete(this.runKey(event));
      this.changes?.push({ kind: "group", id: `${pre}:${event.sn}` });
    }
  }

  /** One backed-off receipt attempt: submit when elected or past the grace, else fetch. */
  private *pursueReceipts(event: GroupEventRef, serder: SerderKERI): Operation<void> {
    const run = this.retain(event, {});
    const now = this.clock.now();
    run.since ??= now;
    if (now < run.nextAt) return;
    const submit = groupWitnesser(this.hby, event.pre, event) || now - run.since >= run.fallbackAfterMs;
    try {
      if (submit) yield* this.receipting.receipt(event.pre, { sn: event.sn, auths: run.auths });
      else yield* this.receipting.get(event.pre, { sn: event.sn, said: event.said });
      run.failure = null;
      run.delay = RECEIPT_BACKOFF_MS.first;
    } catch (error) {
      // A witness refusing or being unreachable is a remote outcome: report it in status and retry later.
      run.failure = error instanceof Error ? error.message : String(error);
      run.delay = Math.min(run.delay * 2, RECEIPT_BACKOFF_MS.max);
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
  private retain(event: GroupEventRef, { auths, fallbackAfterMs }: CounselInputs): Run {
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
        delay: RECEIPT_BACKOFF_MS.first,
        failure: null,
      };
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
