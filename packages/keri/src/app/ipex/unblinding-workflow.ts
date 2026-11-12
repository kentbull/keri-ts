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
 * There is no operation store; status is the live table plus what the stores prove. Durable: the Grant and
 * its deadline, and the finished proof view. A requester whose Grant's proofs are current reads `done`; one
 * whose Grant is still live with proofs missing and no live operation reads `interrupted` (request it
 * again), and past the deadline `expired`. A responder is driven entirely by a peer's query, so a
 * responder's operation exists only while live: its `done`, `failed` and `expired` readings, like every
 * requester `abandoned` and `failed` reading, are remembered only until the process ends, and a responder
 * Grant with no live operation throws. Memory only: the owner's approval and frozen query/reply, resend
 * timers, the consent time. Per-identifier {@link Unblind} owners come through a narrow interface (`runtime.ipex`). Group identifiers
 * are refused; group Unblind belongs to the group proposal API.
 */
import { action, type Operation, race } from "npm:effection@^3.6.0";
import { Unblind } from "../../acdc/unblinding.ts";
import { ValidationError } from "../../core/errors.ts";
import { singleKeyQueryWindow } from "../../core/mailbox/kram-policy.ts";
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
  /** Same clock the exchanger and Unblind owners were composed with. */
  readonly clock: RuntimeClock;
  readonly changes?: ChangeSink;
  /** Called when an operation becomes live, so the owner loop leaves its idle cadence at once. */
  readonly wake?: () => void;
}

/** One operation the user consented to or the discloser owes; exists only while its approval is live in memory. */
interface LiveUnblinding {
  /** SAID of the live Grant. */
  readonly grant: string;
  /** Presentation transaction id. */
  readonly xid: string;
  readonly role: UnblindingRole;
  /** The Grant's original exchange deadline (ISO 8601). */
  readonly deadline: string;
  readonly hab: Hab;
  readonly owner: Unblind;
  /** The discloser of the Grant: where the query goes. */
  readonly peer: string;
  readonly expires: bigint;
  /** Requester: the frozen signed query, resent unchanged. */
  query?: Uint8Array;
  /** When {@link query} was signed (host clock, ms); it is re-dated once older than the single-key window. */
  queryAt: number;
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
function lapsed(deps: Pick<UnblindingDeps, "clock">, deadline: string | null): boolean {
  const expiry = timestampMicros(deadline);
  return expiry !== null && BigInt(deps.clock.now()) * 1000n >= expiry;
}

const INTERRUPTED =
  "No live Unblind holds this Grant: the process that began it ended (or it was never begun); nothing was signed since. Request it again";

/** What an operation that finished or ended in this process reports until the process ends. */
type SettledUnblinding =
  | { role: UnblindingRole; state: "done" }
  | { role: UnblindingRole; state: UnblindingEndState; reason: string };

/** The live operations table and its driver. One per host runtime; every identifier may unblind through it. */
export class UnblindingOperations {
  /** Operations whose approval is live in this process. Internal to this module's functions. */
  readonly live = new Map<string, LiveUnblinding>();
  /** Operations that finished or ended in this process; not durable, see the module doc. */
  readonly settled = new Map<string, SettledUnblinding>();

  constructor(readonly deps: UnblindingDeps) {}

  /**
   * Whether a pass has work: a live operation, or an owner holds an authenticated peer query whose reply is
   * owed (an in-memory walk of the owners, no store read).
   */
  active(): boolean {
    if (this.live.size > 0) return true;
    for (const owner of this.deps.unblinds.unblindOwners()) if (owner.awaitingReply().length) return true;
    return false;
  }

  /** Advance every live operation by one pass, each bounded by its Grant deadline. */
  *processOnce(): Operation<void> {
    const { deps } = this;
    this.adopt();
    for (const op of [...this.live.values()]) {
      if (op.busy || !this.live.has(op.grant)) continue;
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
        let input, deadline, expires;
        try {
          input = deps.exc.retainedInput(grant);
          deadline = input && deps.exc.exchangeDeadline(input.serder);
          expires = timestampMicros(deadline);
        } catch (error) {
          // Unreadable stored state fails this reply alone; release the owner's approval so it is not retried.
          owner.abandon(xid);
          this.settled.set(grant, { role: "responder", state: "failed", reason: message(error) });
          deps.changes?.push({ kind: "unblinding", id: grant });
          continue;
        }
        if (!input || !deadline || expires === null || BigInt(deps.clock.now()) * 1000n >= expires) continue;
        this.settled.delete(grant);
        this.live.set(grant, {
          grant,
          xid,
          role: "responder",
          deadline,
          hab: owner.hab,
          owner,
          peer: String(input.serder.sad!.ri),
          expires,
          queryAt: 0,
          nextQuery: 0,
          phase: "proving",
          busy: false,
        });
        deps.changes?.push({ kind: "unblinding", id: grant });
      }
    }
  }

  /** End a live operation: release the approval, remember why until the process ends, tell the sink. */
  end(op: LiveUnblinding, state: UnblindingEndState, reason: string): void {
    this.release(op);
    this.settled.set(op.grant, { role: op.role, state, reason });
    this.deps.changes?.push({ kind: "unblinding", id: op.grant });
  }

  /** Drop the live entry and the owner's approval and frozen messages; delivered bytes stay the peer's. */
  private release(op: LiveUnblinding): void {
    this.live.delete(op.grant);
    try {
      op.owner.abandon(op.xid);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
    }
  }

  private finished(op: LiveUnblinding): void {
    this.release(op);
    this.settled.set(op.grant, { role: op.role, state: "done" });
    this.deps.changes?.push({ kind: "unblinding", id: op.grant });
  }

  private *timer(milliseconds: number): Operation<"expired"> {
    yield* wait(this.deps.clock, milliseconds);
    return "expired";
  }

  private setPhase(op: LiveUnblinding, phase: UnblindingPhase): void {
    if (op.phase === phase) return;
    op.phase = phase;
    this.deps.changes?.push({ kind: "unblinding", id: op.grant });
  }

  /** One pass, in the order of the CLI loop it replaces. */
  private *step(op: LiveUnblinding): Operation<"stepped"> {
    const { deps } = this, { owner, xid, grant } = op;
    const send = (dest: string, msg: Uint8Array) => deps.delivery.deliver({ src: op.hab.pre!, dest, msg });
    const input = deps.exc.retainedInput(grant);
    if (!input || deps.exc.exchangeDeadline(input.serder) !== op.deadline) throw new ValidationError(CHANGED);
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
    if (op.role === "requester" && owner.complete(xid)) {
      this.setPhase(op, "proving");
      const decision = yield* owner.finish(xid);
      if (decision.kind !== "accept") throw new ValidationError("Updated presentation proofs did not verify");
      return this.finishedStep(op);
    }
    if (op.query && deps.clock.now() >= op.nextQuery) {
      yield* send(op.peer, this.current(op));
      op.nextQuery = deps.clock.now() + UNBLIND_QUERY_RESEND_MS;
    }
    return "stepped";
  }

  /**
   * The query to send now: the signed bytes unchanged while they are timely, and a re-dated one
   * (`Unblind.requery`: same frozen request, new `dt`, SAID and signatures) once they are older than the
   * single-key window, which the discloser's KRAM would drop as stale. Re-signing happens only here, inside
   * the consent that began the operation; a registry head that moved since fails the operation instead. A
   * group threshold query cannot be re-dated by one member; group Unblind is not run here.
   */
  private current(op: LiveUnblinding): Uint8Array {
    const now = this.deps.clock.now(), window = singleKeyQueryWindow(this.deps.hby.db, Unblind.Route);
    if (window !== null && now - op.queryAt >= window) {
      op.query = op.owner.requery(op.xid);
      op.queryAt = now;
    }
    return op.query!;
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
  if (ops.live.has(grant)) throw new ValidationError("Unblind was already begun for this Grant");
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
  const begun = { grant, xid, role: "requester" as const };
  // A current authenticated view needs no empty auxiliary query or new proof writes.
  if (deps.exc.complete(grant)) {
    const current = deps.exc.verifyGrantProofs(grant, selected.input.nests ?? []);
    if (current === true || typeof current === "object" && current.kind === "accept") {
      owner.abandon(xid);
      ops.settled.set(grant, { role: "requester", state: "done" });
      deps.changes?.push({ kind: "unblinding", id: grant });
      return { op: null, begun };
    }
  }
  return {
    begun,
    op: {
      grant,
      xid,
      role: "requester",
      deadline: selected.deadline,
      hab,
      owner,
      peer: selected.peer,
      expires: selected.expires,
      queryAt: deps.clock.now(),
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
    ops.settled.delete(request.grant);
    ops.live.set(request.grant, op);
    ops.deps.changes?.push({ kind: "unblinding", id: request.grant });
    ops.deps.wake?.();
  }
  return begun;
}

/**
 * Pure read of one Unblind: what finished or ended in this process, the live table, and otherwise what the
 * stores prove for the requester (see the module doc for what a reload loses). A requester's Grant whose
 * proofs are not current and that no live operation holds reads `interrupted`, or `expired` past the Grant
 * deadline; that is a statement, not a write.
 *
 * @throws ValidationError when `grant` is not a Grant a local identifier is the disclosee of, and no
 * operation for it is live or remembered.
 */
export function unblindingStatus(
  ops: Pick<UnblindingOperations, "deps" | "live" | "settled">,
  grant: string,
): UnblindingStatus {
  const { deps } = ops, settled = ops.settled.get(grant), live = ops.live.get(grant);
  if (settled) {
    return settled.state === "done"
      ? { state: "done", role: settled.role }
      : { state: settled.state, role: settled.role, reason: settled.reason };
  }
  if (live && !lapsed(deps, live.deadline)) {
    return { state: "active", role: live.role, phase: live.phase, deadline: live.deadline };
  }
  const input = deps.exc.retainedInput(grant), recipient = input?.serder.sad?.ri;
  if (!input || typeof recipient !== "string" || !deps.hby.habs.has(recipient)) {
    throw new ValidationError("No Unblind was begun for this Grant");
  }
  if (deps.exc.complete(grant)) {
    const current = deps.exc.verifyGrantProofs(grant, input.nests ?? []);
    if (current === true || typeof current === "object" && current.kind === "accept") {
      return { state: "done", role: "requester" };
    }
  }
  const deadline = deps.exc.exchangeDeadline(input.serder);
  if (!deadline) throw new ValidationError("No Unblind was begun for this Grant");
  if (lapsed(deps, deadline)) return { state: "expired", role: "requester", reason: EXPIRED };
  return { state: "interrupted", role: "requester", reason: INTERRUPTED };
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
  ops: Pick<UnblindingOperations, "deps" | "live" | "settled">,
  grant: string,
  { timeoutMs, clock = ops.deps.clock }: UnblindingWaitOptions,
): Operation<WaitResult<UnblindingStatus>> {
  const settled = yield* observeUntil(() => unblindingStatus(ops, grant).state !== "active", { timeoutMs, clock });
  const status = unblindingStatus(ops, grant);
  return settled ? { outcome: "settled", status } : { outcome: "timed-out", status, timeoutMs };
}

/**
 * Local abandon: release the approval and frozen messages and read `abandoned` until the process ends. Does
 * not message the peer and does not undo proofs already finished. Does nothing to an Unblind that is already
 * done or ended.
 *
 * @throws ValidationError when no Unblind was begun for `grant`.
 */
export function abandonUnblinding(ops: UnblindingOperations, grant: string, reason = "Abandoned by the user"): void {
  const status = unblindingStatus(ops, grant);
  if (status.state !== "active" && status.state !== "interrupted") return;
  const live = ops.live.get(grant);
  if (live) ops.end(live, "abandoned", reason);
  else {
    ops.settled.set(grant, { role: status.role, state: "abandoned", reason });
    ops.deps.changes?.push({ kind: "unblinding", id: grant });
  }
}
