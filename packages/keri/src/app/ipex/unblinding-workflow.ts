/**
 * Runtime-owned operations for single-signature IPEX Unblind (proof release for one live presentation).
 *
 * One explicit consent step, the disclosee's. The disclosee calls `requestUnblind`: it approves the exact live
 * Grant, signs the query for the missing public suffix and returns after local commit. The discloser has no
 * approval step: it consented by signing the Grant, so an owner that authenticated a peer query for a live
 * Grant its identifier sent replies on its own, and `processOnce` adopts and delivers that reply under the
 * Grant's deadline (KERIpy keeps a local approve gate; the wire is unchanged).
 * `UnblindingOperations.processOnce` also sends and resends the unchanged query each second, finishes the
 * Grant once the authenticated reply is complete, and ends the operation at the Grant's original exchange
 * deadline. The only signing outside the Grant's own scope is the requester's query. A record that is active
 * with no live operation reads `interrupted` (or `expired` past the deadline) and nothing is sent for it
 * after a restart; a repeated peer query is answered again from stored state.
 *
 * Workflow-contract shape (`app/runtime/workflow-contract.ts`): `requestUnblind` returns after local
 * commit and never wait for the peer, `unblindingStatus` is a pure read, `waitForUnblinding` only observes
 * and returns a `WaitResult`, `abandonUnblinding` is local. Completion creates no Admit.
 *
 * Durable: the non-secret {@link UnblindingRecord} in the embedder's store, the Grant and its deadline, and
 * the finished proof view. Memory only: the owner's approval and frozen query/reply, resend timers.
 * Per-identifier {@link Unblind} owners come through a narrow interface (`runtime.ipex`). Group identifiers
 * are refused; group Unblind belongs to the group proposal API.
 */
import { action, type Operation, race } from "npm:effection@^3.6.0";
import type { Unblind } from "../../acdc/unblinding.ts";
import { ValidationError } from "../../core/errors.ts";
import { timestampMicros } from "../../time/mod.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { isLocalGroupHab } from "../multisig/group-members.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { type ChangeSink, observeUntil, type WaitResult } from "../runtime/workflow-contract.ts";
import type { IssuanceDelivery } from "./issuance.ts";

/** Milliseconds between resends of the unchanged disclosee query, as `tufa ipex unblind` does. */
export const UNBLIND_QUERY_RESEND_MS = 1000;

/** Which side of the presentation the local identifier is. */
export type UnblindingRole = "requester" | "responder";

/** Terminal states that are not completion; each carries a reason. */
export type UnblindingEndState = "abandoned" | "interrupted" | "expired" | "failed";

/** Where an active Unblind is. */
export type UnblindingPhase = "awaitingReply" | "proving";

/** Durable, non-secret operation facts. Never holds keys, frozen messages or proofs. */
export interface UnblindingRecord {
  /** SAID of the live Grant. */
  readonly grant: string;
  /** Presentation transaction id. */
  readonly xid: string;
  /** Prefix of the local identifier. */
  readonly hab: string;
  readonly role: UnblindingRole;
  /** The Grant's original exchange deadline (ISO 8601). */
  readonly deadline: string;
  /** When the user gave the consent (ISO 8601). */
  readonly consented: string;
  /** When the operation completed: the proofs verified (requester) or the reply was delivered (responder). */
  readonly done?: string;
  readonly ended?: { readonly state: UnblindingEndState; readonly reason: string; readonly at: string };
}

/** The embedder's durable table of {@link UnblindingRecord}s, keyed by Grant SAID. */
export interface UnblindingOperationStore {
  get(grant: string): UnblindingRecord | null;
  /** Insert or replace the record for `record.grant`. */
  put(record: UnblindingRecord): void;
  list(): UnblindingRecord[];
}

/** Process-local store for the CLI and tests; a wallet backs the port with its own table. */
export class MemoryUnblindingOperationStore implements UnblindingOperationStore {
  private readonly records = new Map<string, UnblindingRecord>();
  get(grant: string): UnblindingRecord | null {
    return this.records.get(grant) ?? null;
  }
  put(record: UnblindingRecord): void {
    this.records.set(record.grant, structuredClone(record));
  }
  list(): UnblindingRecord[] {
    return [...this.records.values()].map((record) => structuredClone(record));
  }
}

/** Status of one Unblind, discriminated on `state`. A pure read. */
export type UnblindingStatus =
  | { state: "active"; role: UnblindingRole; phase: UnblindingPhase; deadline: string }
  | { state: "done"; role: UnblindingRole }
  | { state: UnblindingEndState; role: UnblindingRole; reason: string };

/** Narrow collaborators of the Unblind owner. Hosts adapt their runtime to this once. */
export interface UnblindingDeps {
  readonly hby: Habery;
  readonly exc: Pick<Exchanger, "retainedInput" | "exchangeDeadline" | "complete" | "verifyGrantProofs">;
  /** Per-identifier Unblind owners (`runtime.ipex`), so several identifiers can unblind on one runtime. */
  readonly unblinds: { unblind(hab: Hab): Unblind; unblindOwners(): Iterable<Unblind> };
  readonly delivery: IssuanceDelivery;
  readonly store: UnblindingOperationStore;
  /** Same clock the exchanger and Unblind owners were composed with. */
  readonly clock: RuntimeClock;
  readonly changes?: ChangeSink;
}

/** One operation the user consented to; exists only while its approval is live in memory. */
interface LiveUnblinding {
  record: UnblindingRecord;
  readonly hab: Hab;
  readonly owner: Unblind;
  /** The discloser of the Grant: where the query goes. */
  readonly peer: string;
  readonly expires: bigint;
  /** Requester: the frozen signed query, resent unchanged. */
  query?: Uint8Array;
  nextQuery: number;
  phase: UnblindingPhase;
  /** A step is running; overlapping `processOnce` calls skip it. */
  busy: boolean;
}

/** What a consent step selected. */
export interface UnblindingBegun {
  grant: string;
  xid: string;
  role: UnblindingRole;
}

/** The party and ordinary-state vocabulary a consent step acts for. */
export interface UnblindingRequest {
  hab: Hab;
  /** SAID of the live Grant. */
  grant: string;
  /** Ordinary state labels the owner treats as the credential-state vocabulary. */
  states: readonly string[];
}

const EXPIRED = "The presentation reached its original exchange deadline";
const CHANGED = "Original presentation deadline changed";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Wait on the host's clock so cancellation releases the timer. */
function* wait(clock: RuntimeClock, milliseconds: number): Operation<void> {
  yield* action<void>((resolve) => {
    const timer = clock.setTimeout(resolve, milliseconds);
    return () => clock.clearTimeout(timer);
  });
}

/** Whether the Grant's deadline has passed. */
function lapsed(deps: Pick<UnblindingDeps, "clock">, { deadline }: UnblindingRecord): boolean {
  const expiry = timestampMicros(deadline);
  return expiry !== null && BigInt(deps.clock.now()) * 1000n >= expiry;
}

function orphaned(lapsed: boolean): ["expired" | "interrupted", string] {
  return lapsed
    ? ["expired", EXPIRED]
    : ["interrupted", "The process that began this Unblind ended; nothing was signed since. Begin it again"];
}

/** The operations table and its driver. One per host runtime; every identifier may unblind through it. */
export class UnblindingOperations {
  /** Operations whose approval is live in this process. Internal to this module's functions. */
  readonly live = new Map<string, LiveUnblinding>();
  private swept = false;

  constructor(readonly deps: UnblindingDeps) {}

  /**
   * Advance every live operation by one pass, each bounded by its Grant deadline. The first pass also
   * settles records left active by an earlier process as `interrupted`; that signs and sends nothing.
   */
  *processOnce(): Operation<void> {
    const { deps } = this;
    if (!this.swept) {
      this.swept = true;
      for (const record of deps.store.list()) {
        if (!record.ended && !record.done && !this.live.has(record.grant)) this.orphan(record);
      }
    }
    this.adopt();
    for (const op of [...this.live.values()]) {
      if (op.busy || !this.live.has(op.record.grant)) continue;
      op.busy = true;
      try {
        const left = op.expires - BigInt(deps.clock.now()) * 1000n;
        if (left <= 0n) this.end(op, "expired", EXPIRED);
        else if ((yield* race([this.step(op), this.timer(Number(left) / 1000)])) === "expired") {
          this.end(op, "expired", EXPIRED);
        }
      } catch (error) {
        this.end(op, "failed", message(error));
      } finally {
        op.busy = false;
      }
    }
  }

  /**
   * Take on the replies the owners owe. The discloser has no consent step: an owner that authenticated a
   * peer query for a live Grant its identifier sent holds the operation, and this delivers its reply
   * under the Grant's deadline. Decided from the owners' state, so a restarted process re-answers a
   * repeated query.
   */
  private adopt(): void {
    const { deps } = this;
    for (const owner of deps.unblinds.unblindOwners()) {
      for (const { xid, grant } of owner.awaitingReply()) {
        if (this.live.has(grant)) continue;
        const input = deps.exc.retainedInput(grant);
        const deadline = input && deps.exc.exchangeDeadline(input.serder), expires = timestampMicros(deadline);
        if (!input || !deadline || expires === null || BigInt(deps.clock.now()) * 1000n >= expires) continue;
        const record: UnblindingRecord = {
          grant,
          xid,
          hab: owner.hab.pre!,
          role: "responder",
          deadline,
          consented: iso(deps.clock.now()),
        };
        deps.store.put(record);
        this.live.set(grant, {
          record,
          hab: owner.hab,
          owner,
          peer: String(input.serder.sad!.ri),
          expires,
          nextQuery: 0,
          phase: "proving",
          busy: false,
        });
        deps.changes?.push({ kind: "unblinding", id: grant });
      }
    }
  }

  /** End a live operation: release the approval, record why, tell the sink. */
  end(op: LiveUnblinding, state: UnblindingEndState, reason: string): void {
    this.release(op);
    this.deps.store.put({ ...op.record, ended: { state, reason, at: iso(this.deps.clock.now()) } });
    this.deps.changes?.push({ kind: "unblinding", id: op.record.grant });
  }

  /** Drop the live entry and the owner's approval and frozen messages; delivered bytes stay the peer's. */
  private release(op: LiveUnblinding): void {
    this.live.delete(op.record.grant);
    try {
      op.owner.abandon(op.record.xid);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
    }
  }

  private finished(op: LiveUnblinding): void {
    this.release(op);
    this.deps.store.put({ ...op.record, done: iso(this.deps.clock.now()) });
    this.deps.changes?.push({ kind: "unblinding", id: op.record.grant });
  }

  private orphan(record: UnblindingRecord): void {
    const [state, reason] = orphaned(lapsed(this.deps, record));
    this.deps.store.put({ ...record, ended: { state, reason, at: iso(this.deps.clock.now()) } });
    this.deps.changes?.push({ kind: "unblinding", id: record.grant });
  }

  private *timer(milliseconds: number): Operation<"expired"> {
    yield* wait(this.deps.clock, milliseconds);
    return "expired";
  }

  private setPhase(op: LiveUnblinding, phase: UnblindingPhase): void {
    if (op.phase === phase) return;
    op.phase = phase;
    this.deps.changes?.push({ kind: "unblinding", id: op.record.grant });
  }

  /** One pass, in the order of the CLI loop it replaces. */
  private *step(op: LiveUnblinding): Operation<"stepped"> {
    const { deps } = this, { owner, record } = op, { xid, grant } = record;
    const send = (dest: string, msg: Uint8Array) => deps.delivery.deliver({ src: op.hab.pre!, dest, msg });
    const input = deps.exc.retainedInput(grant);
    if (!input || deps.exc.exchangeDeadline(input.serder) !== record.deadline) throw new ValidationError(CHANGED);
    owner.complete(xid); // Rechecks exact live scope and accepted current state; readiness is separate.
    let replied = false;
    while (owner.outgoing.length) {
      const queued = owner.outgoing.pull()!;
      if (queued.kin === "sign") throw new ValidationError("Individual Unblind cannot process group contributions");
      if (queued.kin === "query") op.query = queued.msg;
      else {
        yield* owner.finish(xid); // Validate exact evidence; no issuer-state admission policy here.
        yield* send(queued.dest, queued.msg);
        replied = true;
      }
    }
    if (replied) return this.finishedStep(op);
    if (record.role === "requester" && owner.complete(xid)) {
      this.setPhase(op, "proving");
      const decision = yield* owner.finish(xid);
      if (decision.kind !== "accept") throw new ValidationError("Updated presentation proofs did not verify");
      return this.finishedStep(op);
    }
    if (op.query && deps.clock.now() >= op.nextQuery) {
      yield* send(op.peer, op.query);
      op.nextQuery = deps.clock.now() + UNBLIND_QUERY_RESEND_MS;
    }
    return "stepped";
  }

  private finishedStep(op: LiveUnblinding): "stepped" {
    this.finished(op);
    return "stepped";
  }
}

/** The exact live Grant the local party may consent to, with its deadline and role. */
function selectGrant(ops: UnblindingOperations, { hab, grant }: UnblindingRequest) {
  const { deps } = ops;
  if (isLocalGroupHab(deps.hby, hab)) {
    throw new ValidationError(
      "Individual Unblind requires an individual habitat; group Unblind needs explicit member coordination",
    );
  }
  const old = deps.store.get(grant);
  if (ops.live.has(grant) || old?.done) throw new ValidationError("Unblind was already begun for this Grant");
  const input = deps.exc.retainedInput(grant);
  if (!input) throw new ValidationError("Unblind requires an authenticated retained Grant");
  const sender = input.serder.pre, recipient = input.serder.sad?.ri;
  if (hab.pre !== sender && hab.pre !== recipient) {
    throw new ValidationError("Local habitat is not a presentation party");
  }
  const deadline = deps.exc.exchangeDeadline(input.serder), expires = timestampMicros(deadline);
  if (!deadline || expires === null) throw new ValidationError("Missing or corrupt presentation deadline");
  if (BigInt(deps.clock.now()) * 1000n >= expires) throw new ValidationError("Original presentation deadline expired");
  return {
    input,
    deadline,
    expires,
    role: (recipient === hab.pre ? "requester" : "responder") as UnblindingRole,
    peer: sender!,
  };
}

function consent(
  ops: UnblindingOperations,
  request: UnblindingRequest,
): { op: LiveUnblinding | null; begun: UnblindingBegun } {
  const { deps } = ops, { hab, grant } = request;
  const selected = selectGrant(ops, request);
  if (selected.role !== "requester") throw new ValidationError("Only the disclosee requests Unblind");
  const owner = deps.unblinds.unblind(hab), xid = owner.approve(grant, { states: request.states });
  const record: UnblindingRecord = {
    grant,
    xid,
    hab: hab.pre!,
    role: "requester",
    deadline: selected.deadline,
    consented: iso(deps.clock.now()),
  };
  const begun = { grant, xid, role: "requester" as const };
  // A current authenticated view needs no empty auxiliary query or new proof writes.
  if (deps.exc.complete(grant)) {
    const current = deps.exc.verifyGrantProofs(grant, selected.input.nests ?? []);
    if (current === true || typeof current === "object" && current.kind === "accept") {
      owner.abandon(xid);
      deps.store.put({ ...record, done: record.consented });
      deps.changes?.push({ kind: "unblinding", id: grant });
      return { op: null, begun };
    }
  }
  return {
    begun,
    op: {
      record,
      hab,
      owner,
      peer: selected.peer,
      expires: selected.expires,
      nextQuery: 0,
      phase: "awaitingReply",
      busy: false,
    },
  };
}

/**
 * The disclosee's consent to request the missing proofs for one live Grant: approves the Grant, signs the
 * query over the missing accepted public suffix and records it. Returns after local commit; `processOnce`
 * sends and resends it. A Grant whose proofs are already current reads `done` at once.
 *
 * @throws ValidationError for a group identifier, a Grant that is not live and addressed to `hab`, or an
 * Unblind already begun for it.
 */
export function requestUnblind(ops: UnblindingOperations, request: UnblindingRequest): UnblindingBegun {
  const { op, begun } = consent(ops, request);
  if (op) {
    op.query = op.owner.start(request.grant);
    ops.deps.store.put(op.record);
    ops.live.set(request.grant, op);
    ops.deps.changes?.push({ kind: "unblinding", id: request.grant });
  }
  return begun;
}

/**
 * Pure read of one Unblind: its record and the live table. A record left active by a process that is gone
 * reads `interrupted` (or `expired` past the Grant deadline); that is a statement, not a write.
 *
 * @throws ValidationError when no Unblind was begun for `grant`.
 */
export function unblindingStatus(ops: Pick<UnblindingOperations, "deps" | "live">, grant: string): UnblindingStatus {
  const record = ops.deps.store.get(grant);
  if (!record) throw new ValidationError("No Unblind was begun for this Grant");
  const { role } = record;
  if (record.ended) return { state: record.ended.state, role, reason: record.ended.reason };
  if (record.done) return { state: "done", role };
  const live = ops.live.get(grant), over = lapsed(ops.deps, record);
  if (live && !over) return { state: "active", role, phase: live.phase, deadline: record.deadline };
  const [state, reason] = orphaned(over);
  return { state, role, reason };
}

/** Options for {@link waitForUnblinding}. */
export interface UnblindingWaitOptions {
  /** Wall-clock budget. */
  timeoutMs: number;
  clock?: Pick<RuntimeClock, "now">;
}

/**
 * Observe until the Unblind is done or ended, or the budget expires. Starts no worker and drives nothing:
 * someone else must call `processOnce`.
 */
export function* waitForUnblinding(
  ops: Pick<UnblindingOperations, "deps" | "live">,
  grant: string,
  { timeoutMs, clock = ops.deps.clock }: UnblindingWaitOptions,
): Operation<WaitResult<UnblindingStatus>> {
  const settled = yield* observeUntil(() => unblindingStatus(ops, grant).state !== "active", { timeoutMs, clock });
  const status = unblindingStatus(ops, grant);
  return settled ? { outcome: "settled", status } : { outcome: "timed-out", status, timeoutMs };
}

/**
 * Local abandon: release the approval and frozen messages and record `abandoned`. Does not message the peer
 * and does not undo proofs already finished. Does nothing to an Unblind that is already done or ended.
 *
 * @throws ValidationError when no Unblind was begun for `grant`.
 */
export function abandonUnblinding(ops: UnblindingOperations, grant: string, reason = "Abandoned by the user"): void {
  const record = ops.deps.store.get(grant);
  if (!record) throw new ValidationError("No Unblind was begun for this Grant");
  if (record.ended || record.done) return;
  const live = ops.live.get(grant);
  if (live) ops.end(live, "abandoned", reason);
  else {
    ops.deps.store.put({ ...record, ended: { state: "abandoned", reason, at: iso(ops.deps.clock.now()) } });
    ops.deps.changes?.push({ kind: "unblinding", id: grant });
  }
}
