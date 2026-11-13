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
import { bytesEqual, type CesrFrame, collectPayload, framePayload, parseBytes, SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, race } from "npm:effection@^3.6.0";
import { Unblind } from "../../acdc/unblinding.ts";
import { ValidationError } from "../../core/errors.ts";
import { singleKeyQueryWindow } from "../../core/mailbox/kram-policy.ts";
import { timestampMicros } from "../../time/mod.ts";
import type { Exchanger, ExchangeRouteHandler } from "../exchanges/exchanging.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { groupSigningMembers, isLocalGroupHab, localGroupMember } from "../multisig/group-members.ts";
import { type Multiplexor, MULTISIG_QRY_ROUTE, MULTISIG_RPY_ROUTE, multisigExnBody } from "../multisig/grouping.ts";
import { envelopeFromFrame } from "../protocol/parsering.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import { DeliveryOutbox } from "../runtime/delivery-outbox.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { type ChangeSink, observeUntil, waitOnClock, type WaitResult } from "../runtime/workflow-contract.ts";
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

/** Collaborators only a group needs; an owner without them unblinds as an individual alone. */
export interface GroupUnblindDeps {
  /** Where the Unblind child wrappers (`/multisig/qry`, `/multisig/rpy`) are delegated; one owner per runtime registers. */
  readonly mux: Pick<Multiplexor, "addChildHandler" | "removeChildHandler">;
  /** Local intake of this member's own contribution and of the other members'. */
  readonly protocol: Pick<ProtocolProcessor, "dispatch">;
}

/** Narrow collaborators of the Unblind owner. Hosts adapt their runtime to this once. */
export interface UnblindingDeps {
  readonly hby: Habery;
  readonly exc: Pick<Exchanger, "retainedInput" | "exchangeDeadline" | "complete" | "verifyGrantProofs">;
  /** Collaborators of group Unblind; absent, this owner refuses group identifiers. */
  readonly group?: GroupUnblindDeps;
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
  /** Group party state; such an operation never re-dates its threshold query. */
  group?: GroupUnblind;
  phase: UnblindingPhase;
  /** Signed bytes the steps decided to send; a peer briefly offline is retried until the Grant deadline. */
  readonly outbox: DeliveryOutbox;
  /** The steps are done; the operation ends once the outbox is empty. */
  finished: boolean;
  /** A step is running; overlapping `processOnce` calls skip it. */
  busy: boolean;
}

/** Per-operation state of a group party; memory only. */
class GroupUnblind {
  readonly pending = new Map<string, { parent: SerderKERI; child: CesrFrame }>();
  readonly seen = new Set<string>();
  /** The exact DH-style body this member contributes to, once frozen. */
  frozen?: Uint8Array;
  contributed = false;
  finished = false;
  started = false;
  constructor(readonly member: Hab, readonly proposer: string) {}
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
  /** A group requires the current signing member that authors the query (disclosee) or the reply (discloser). */
  proposer?: string;
  /** SAID of the live Grant. */
  grant: string;
  /** Ordinary state labels the owner treats as the credential-state vocabulary; omitted uses the owner's default. */
  states?: readonly string[];
}

const EXPIRED = "The presentation reached its original exchange deadline";
const CHANGED = "Original presentation deadline changed";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  /** The Unblind child handlers registered on the multiplexor, once a group operation began. */
  groupRoutes: Array<[string, ExchangeRouteHandler]> | null = null;

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
        else if ((yield* race([this.advance(op), this.timer(Number(left) / 1000)])) === "expired") {
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
          outbox: new DeliveryOutbox(),
          finished: false,
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
    yield* waitOnClock(this.deps.clock, milliseconds);
    return "expired";
  }

  private setPhase(op: LiveUnblinding, phase: UnblindingPhase): void {
    if (op.phase === phase) return;
    op.phase = phase;
    this.deps.changes?.push({ kind: "unblinding", id: op.grant });
  }

  /**
   * One pass of a group party, in the order of the CLI loop it replaces: take in the members' wrappers, contribute
   * this member's signature once to the frozen body, publish it to the other members, and finish.
   */
  private *stepGroup(op: LiveUnblinding): Operation<"stepped"> {
    const { deps } = this, { owner, xid, grant } = op, g = op.group!, { member, proposer } = g;
    const input = deps.exc.retainedInput(grant);
    if (!input || deps.exc.exchangeDeadline(input.serder) !== op.deadline) throw new ValidationError(CHANGED);
    owner.complete(xid);
    const requester = op.role === "requester", group = deps.group!;
    const send = function*(dest: string, msg: Uint8Array, topic = "credential") {
      op.outbox.enqueue({ src: member.pre!, dest, msg, topic });
    };
    if (!g.started) {
      g.started = true;
      // Accepted wrappers can precede the consent; intake alone never contributed.
      for (const [, parent] of deps.hby.db.exns.getTopItemIter()) {
        const retained = parent.route === groupRoute(op) ? deps.exc.retainedInput(parent.said!) : null;
        if (
          retained?.nests && structural(deps.hby, parent, retained.nests)
          && groupAccepts(deps.hby, op, parent, retained.nests)
        ) {
          g.pending.set(parent.said!, { parent, child: retained.nests[0] });
        }
      }
    }
    if (!requester && member.pre === proposer && !g.contributed && owner.hasPeerQuery(xid)) owner.respond(xid);
    const broadcast = function*(raw: Uint8Array) {
      const child = parseBytes(raw)[0];
      if (!(child?.body instanceof SerderKERI) || child.body.ilk !== (requester ? "qry" : "rpy")) {
        throw new ValidationError("Unexpected local Unblind proposal");
      }
      g.frozen = child.body.raw;
      g.contributed = true;
      yield* group.protocol.dispatch(child, { local: true });
      const route = groupRoute(op);
      const body = multisigExnBody(member.pre!, { route, attrs: { gid: op.hab.pre! } }, child.body, {
        version: Vrsn_2_0,
      });
      const parent = parseBytes(member.endorse(body, { gvrsn: Vrsn_2_0 }))[0];
      parent.nests = [child];
      const proposal = yield* call(() => collectPayload(framePayload(parent)));
      for (const peer of groupSigningMembers(deps.hby, op.hab.pre!)) {
        if (peer !== member.pre) yield* send(peer, proposal, "multisig");
      }
    };
    for (const [said, item] of [...g.pending]) {
      if (g.seen.has(said) || item.parent.pre === member.pre) {
        g.pending.delete(said);
        continue;
      }
      if ((!g.frozen && item.parent.pre !== proposer) || (!requester && !owner.hasPeerQuery(xid))) continue;
      if (!groupAccepts(deps.hby, op, item.parent, [item.child])) {
        g.pending.delete(said);
        g.seen.add(said);
        continue;
      }
      const contribution = owner.contribute(xid, yield* call(() => collectPayload(framePayload(item.child))));
      yield* group.protocol.dispatch(item.child, { local: true });
      if (!g.contributed) yield* broadcast(contribution);
      g.seen.add(said);
      g.pending.delete(said);
    }
    while (owner.outgoing.length) {
      const message = owner.outgoing.pull()!;
      if (message.kin === "sign") {
        if (!g.contributed) yield* broadcast(message.msg);
      } else if (message.kin === "query") op.query = message.msg;
      else if (!g.finished) {
        yield* owner.finish(xid); // Validate exact evidence; no issuer-state admission policy here.
        g.finished = true;
        yield* send(message.dest, message.msg);
      }
    }
    if (requester && owner.complete(xid)) {
      this.setPhase(op, "proving");
      const decision = yield* owner.finish(xid);
      if (decision.kind !== "accept") throw new ValidationError("Updated presentation proofs did not verify");
      return this.finishedStep(op);
    }
    if (!requester && (g.finished || owner.complete(xid))) {
      if (!g.finished) yield* owner.finish(xid);
      return this.finishedStep(op);
    }
    // A threshold query cannot be re-dated by one member: it is resent unchanged.
    if (op.query && deps.clock.now() >= op.nextQuery) {
      yield* send(op.peer, op.query);
      op.nextQuery = deps.clock.now() + UNBLIND_QUERY_RESEND_MS;
    }
    return "stepped";
  }

  /** One pass, in the order of the CLI loop it replaces. */
  private *step(op: LiveUnblinding): Operation<"stepped"> {
    if (op.group) return yield* this.stepGroup(op);
    const { deps } = this, { owner, xid, grant } = op;
    const send = function*(dest: string, msg: Uint8Array | (() => Uint8Array)) {
      op.outbox.enqueue({ src: op.hab.pre!, dest, msg });
    };
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
      yield* send(op.peer, () => this.current(op));
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
    op.finished = true;
    return "stepped";
  }

  /** One pass: send what is queued, step only once the queue is empty, send what the step queued. */
  private *advance(op: LiveUnblinding): Operation<"stepped"> {
    const drain = () => op.outbox.drain(this.deps.delivery, this.deps.clock);
    if (!(yield* drain())) return "stepped";
    if (!op.finished) yield* this.step(op);
    if ((yield* drain()) && op.finished) this.finished(op);
    return "stepped";
  }
}

/** The exact live Grant the local party may consent to, with its deadline and role. */
function selectGrant(ops: UnblindingOperations, { hab, grant, proposer }: UnblindingRequest) {
  const { deps } = ops;
  if (isLocalGroupHab(deps.hby, hab)) {
    if (!deps.group) throw new ValidationError("This Unblind owner was composed without group collaborators");
    if (!proposer || !groupSigningMembers(deps.hby, hab.pre!).includes(proposer)) {
      throw new ValidationError("Group Unblind requires a current signing member proposer");
    }
  } else if (proposer !== undefined) {
    throw new ValidationError("Individual Unblind has no proposer");
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
  role: UnblindingRole = "requester",
): { op: LiveUnblinding | null; begun: UnblindingBegun } {
  const { deps } = ops, { hab, grant } = request;
  const selected = selectGrant(ops, request);
  if (selected.role !== role) {
    throw new ValidationError(
      role === "requester" ? "Only the disclosee requests Unblind" : "Only the discloser answers",
    );
  }
  const owner = deps.unblinds.unblind(hab), xid = owner.approve(grant, { states: request.states });
  const begun = { grant, xid, role };
  // A current authenticated view needs no empty auxiliary query or new proof writes.
  if (role === "requester" && deps.exc.complete(grant)) {
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
      role,
      deadline: selected.deadline,
      hab,
      owner,
      peer: selected.peer,
      expires: selected.expires,
      queryAt: deps.clock.now(),
      nextQuery: 0,
      group: request.proposer ? new GroupUnblind(localGroupMember(deps.hby, hab.pre!), request.proposer) : undefined,
      phase: role === "requester" ? "awaitingReply" : "proving",
      outbox: new DeliveryOutbox(),
      finished: false,
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
    if (op.group) {
      registerUnblindRoutes(ops);
      // Only the proposer authors the threshold query; the other members contribute to it when it arrives.
      if (op.group.member.pre === request.proposer) op.owner.start(request.grant);
    } else op.query = op.owner.start(request.grant);
    ops.settled.delete(request.grant);
    ops.live.set(request.grant, op);
    ops.deps.changes?.push({ kind: "unblinding", id: request.grant });
    ops.deps.wake?.();
  }
  return begun;
}

/**
 * A group discloser member's consent to answer a live presentation: approves the Grant, so that this member
 * contributes its signature to the one threshold reply (the proposer authors the reply once the disclosee's
 * authenticated query arrives; the others contribute to it). Returns after local commit; `processOnce` does
 * the rest. An individual discloser needs no consent: its owner answers an authenticated query by itself.
 *
 * @throws ValidationError for an individual identifier, a Grant the group did not send, a proposer that is not a
 * current signing member, or an Unblind already begun.
 */
export function answerUnblind(ops: UnblindingOperations, request: UnblindingRequest): UnblindingBegun {
  const { deps } = ops;
  if (!isLocalGroupHab(deps.hby, request.hab)) {
    throw new ValidationError("An individual discloser answers an authenticated query without consent");
  }
  const { op, begun } = consent(ops, request, "responder");
  registerUnblindRoutes(ops);
  ops.settled.delete(request.grant);
  ops.live.set(request.grant, op!);
  deps.changes?.push({ kind: "unblinding", id: request.grant });
  deps.wake?.();
  return begun;
}

/** The wrapper route an operation's party uses: the disclosee's query, the discloser's reply. */
function groupRoute(op: LiveUnblinding): typeof MULTISIG_QRY_ROUTE | typeof MULTISIG_RPY_ROUTE {
  return op.role === "requester" ? MULTISIG_QRY_ROUTE : MULTISIG_RPY_ROUTE;
}

/** The structure every Unblind child wrapper has, whichever operation it is for. */
function structural(hby: Habery, parent: SerderKERI, children: readonly CesrFrame[]): boolean {
  const child = children[0], body = child?.body, route = parent.route;
  if (
    children.length !== 1 || !(body instanceof SerderKERI) || parent.pvrsn.major !== 2 || parent.pvrsn.minor !== 0
    || (route !== MULTISIG_QRY_ROUTE && route !== MULTISIG_RPY_ROUTE)
  ) return false;
  const requester = route === MULTISIG_QRY_ROUTE, field = requester ? "qry" : "rpy", gid = body.pre;
  const attrs = parent.sad!.a as Record<string, unknown>;
  if (
    !gid || !hby.habs.has(gid) || !groupSigningMembers(hby, gid).includes(parent.pre!) || !attrs
    || Object.keys(attrs).length !== 2 || attrs.gid !== gid || attrs[field] !== body.said
  ) return false;
  const data = body.sad![requester ? "q" : "a"] as { x?: unknown };
  if (
    body.ilk !== field || body.route !== Unblind.Route || body.pvrsn.major !== 2 || body.pvrsn.minor !== 0
    || typeof data?.x !== "string" || (requester && body.sad!.rr !== Unblind.Route)
  ) return false;
  const allowed = requester
    ? ["TransIdxSigGroups", "TransLastIdxSigGroups"]
    : ["TransIdxSigGroups", "BlindedStateQuadruples", "BoundStateSextuples"];
  return (requester || !child.nests?.length)
    && envelopeFromFrame(child).attachmentGroups.every((group) => allowed.includes(group.name.replace(/^Big/, "")));
}

/** Operation-specific acceptance: the group's own transaction, in the direction this party consumes. */
function groupAccepts(hby: Habery, op: LiveUnblinding, parent: SerderKERI, children: readonly CesrFrame[]): boolean {
  if (parent.route !== groupRoute(op) || !structural(hby, parent, children)) return false;
  const body = children[0].body as SerderKERI, requester = op.role === "requester";
  const data = body.sad![requester ? "q" : "a"] as { x?: string };
  return body.pre === op.hab.pre && data?.x === op.xid && (!op.group?.frozen || bytesEqual(op.group.frozen, body.raw));
}

/**
 * Delegate the Unblind child wrappers of `/multisig/qry` and `/multisig/rpy` to this owner, once. The delegation
 * is structural; operation-specific checks run at intake, and stored wrappers are found when an operation starts.
 */
function registerUnblindRoutes(ops: UnblindingOperations): void {
  if (ops.groupRoutes) return;
  const { deps } = ops, mux = deps.group!.mux;
  ops.groupRoutes = [MULTISIG_QRY_ROUTE, MULTISIG_RPY_ROUTE].map((route): [string, ExchangeRouteHandler] => [route, {
    resource: route,
    acceptsNests: true,
    verify: (args) =>
      structural(deps.hby, args.serder, args.nests ?? []) && !args.attachments.length && !args.essrs?.length,
    handle: (args) => {
      for (const op of ops.live.values()) {
        if (op.group && groupAccepts(deps.hby, op, args.serder, args.nests!)) {
          op.group.pending.set(args.serder.said!, { parent: args.serder, child: args.nests![0] });
        }
      }
    },
  }]);
  for (const [route, handler] of ops.groupRoutes) mux.addChildHandler(route, Unblind.Route, handler);
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
