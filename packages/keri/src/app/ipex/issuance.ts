/**
 * Runtime-owned operations for single-signature v2 DH issuance.
 *
 * One `IssuanceOperations` owner holds an operations table. The user begins an
 * operation with `beginIssuance`, which signs the Grant, approves the DH
 * exchange, starts the query and records that authorisation in memory. The
 * host's runtime loop (or, in a one-shot CLI, a driver under
 * `withRuntimeWorkers`) then calls `processOnce`, which performs exactly the
 * steps `tufa ipex --issue` performed itself: send the proof support and Grant,
 * deliver DH traffic, resend the unchanged query each second, and once DH
 * completes stage and anchor the registry update (BUP), `finish` the Grant and
 * send the final proof support. Nothing starts an operation or signs except
 * inside an operation the user began while its in-memory authorisation lives.
 *
 * Workflow-contract shape (`app/runtime/workflow-contract.ts`): `beginIssuance`
 * returns after local commit and never waits for the peer; `issuanceStatus` is a
 * pure read of the durable record plus the live table; `waitForIssuance` only
 * observes and returns a `WaitResult`; `abandonIssuance` is local.
 *
 * Durable (the {@link IssuanceOperationStore} record and protocol tables): the
 * non-secret record, the pending Grant and its deadline, the retained registry
 * root in the Keeper, staged and accepted registry events and their derivation
 * coordinates. Memory only: ephemeral DH keys and peer keys (inside `Dhke`), the
 * witness authorisation codes, the anchor authorisation itself, resend timers.
 * A process that loses memory therefore reads `interrupted` and never signs.
 * The Grant's exchange deadline bounds everything; passing it reads `expired`.
 *
 * The runtime never writes wallet inventory. Completion is pushed to the
 * `ChangeSink` as `{kind: "issuance", id: <grant>}` and the embedder records it.
 *
 * Group steps are a later change: they add records and phases and run inside
 * the same `processOnce`; the table, store port and status union are unchanged.
 * Collaborators are narrow concrete owners (ADR-0013); no `AgentRuntime`.
 */
import { collectPayload, concatBytes, Counter, framePayload, parseBytes, SerderACDC, Vrsn_2_0 } from "cesr-ts";
import { action, call, type Operation, race } from "npm:effection@^3.6.0";
import { RegistryAuthor } from "../../acdc/authoring.ts";
import { type DerivedUpdateStore, RegistryCustody } from "../../acdc/custody.ts";
import type { Dhke } from "../../acdc/dhking.ts";
import type { Regery } from "../../acdc/registraring.ts";
import { ValidationError } from "../../core/errors.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../../core/mailbox/mailbox-topics.ts";
import { messagize } from "../../core/protocol-serialization.ts";
import { timestampMicros } from "../../time/mod.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { isLocalGroupHab } from "../multisig/group-members.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { Reactor } from "../protocol/reactor.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { type ChangeSink, observeUntil, type WaitResult } from "../runtime/workflow-contract.ts";
import type { Receiptor, WitnessAuthMap } from "../witness/receipting.ts";
import { exchangeWire, IpexDiscloser, type IssuanceGrantOptions } from "./ipex-discloser.ts";

/** Milliseconds between resends of the unchanged issuer query, as `tufa ipex --issue` and KERIpy do. */
export const ISSUANCE_QUERY_RESEND_MS = 1000;

/** Which side of the exchange the local identifier is. */
export type IssuanceRole = "issuer" | "holder";

/** Terminal states that are not completion; each carries a reason. */
export type IssuanceEndState = "abandoned" | "interrupted" | "expired" | "refused" | "failed";

/** Where an active issuance is. Group and holder phases extend this union. */
export type IssuancePhase = "exchangingKeys" | "awaitingAnchor" | "proving";

/** A user step an active issuance waits for. Single-signature issuers never wait: `beginIssuance` authorises the anchor. */
export type IssuanceNeed = "exchange" | "admit";

/** Durable, non-secret operation facts. Never holds keys, roots or authorisation codes. */
export interface IssuanceRecord {
  /** SAID of the Grant exchange. */
  readonly grant: string;
  /** DH transaction id; differs from the Grant SAID for a Grant that continues an earlier exchange. */
  readonly xid: string;
  /** Prefix of the local identifier. */
  readonly hab: string;
  readonly role: IssuanceRole;
  /** The Grant's original exchange deadline (ISO 8601). */
  readonly deadline: string;
  /** When the user gave each consent (ISO 8601). */
  readonly consents: { readonly exchange?: string; readonly anchor?: string; readonly admit?: string };
  /** When the operation completed. */
  readonly done?: string;
  readonly ended?: { readonly state: IssuanceEndState; readonly reason: string; readonly at: string };
}

/** The embedder's durable table of {@link IssuanceRecord}s, keyed by Grant SAID. */
export interface IssuanceOperationStore {
  get(grant: string): IssuanceRecord | null;
  /** Insert or replace the record for `record.grant`. */
  put(record: IssuanceRecord): void;
  list(): IssuanceRecord[];
}

/** Process-local store for the CLI and tests; a wallet backs the port with its own table. */
export class MemoryIssuanceOperationStore implements IssuanceOperationStore {
  private readonly records = new Map<string, IssuanceRecord>();
  get(grant: string): IssuanceRecord | null {
    return this.records.get(grant) ?? null;
  }
  put(record: IssuanceRecord): void {
    this.records.set(record.grant, structuredClone(record));
  }
  list(): IssuanceRecord[] {
    return [...this.records.values()].map((record) => structuredClone(record));
  }
}

/** Status of one issuance, discriminated on `state`. A pure read. */
export type IssuanceStatus =
  | {
    state: "active";
    role: IssuanceRole;
    phase: IssuancePhase;
    needs?: IssuanceNeed;
    /** The Grant's exchange deadline (ISO 8601). */
    deadline: string;
  }
  | { state: "done"; role: IssuanceRole; phase: "issued" }
  | { state: IssuanceEndState; role: IssuanceRole; reason: string };

/** Delivery of signed bytes; resolves once the transport reports an outcome and throws when it failed. */
export interface IssuanceDelivery {
  deliver(message: { src: string; dest: string; msg: Uint8Array }): Operation<void>;
}

/** Adapt a `Poster`; its delivery worker must be running (a one-shot CLI runs it under `withRuntimeWorkers`). */
export function posterDelivery(postman: Pick<Poster, "send" | "wait">): IssuanceDelivery {
  return {
    *deliver({ src, dest, msg }) {
      const outcome = yield* postman.wait(postman.send({ src, dest, topic: CREDENTIAL_MAILBOX_TOPIC, msg }, {
        notify: true,
      }));
      if (outcome.kin === "failed") throw outcome.error;
    },
  };
}

/** Narrow collaborators of the issuance owner. Hosts adapt their runtime to this once. */
export interface IssuanceDeps {
  readonly hby: Habery;
  /** Registry environment; `rgy.store` is the public registry store. */
  readonly rgy: Regery;
  readonly exc: Exchanger;
  /** Receipt collector; its genus selects the witness protocol version. */
  readonly receiptor: Receiptor;
  /** Per-identifier DH owners (`runtime.ipex`), so several identifiers can issue on one runtime. */
  readonly dhkes: { dhke(hab: Hab): Dhke };
  /** Local intake of the Grant this identifier signs. */
  readonly reactor: Pick<Reactor, "processBytes">;
  readonly protocol: Pick<ProtocolProcessor, "processEscrowsOnce">;
  readonly delivery: IssuanceDelivery;
  readonly store: IssuanceOperationStore;
  /** Non-secret derivation coordinates of blinded registry updates. */
  readonly derived: DerivedUpdateStore;
  /** Same clock the exchanger and DH owners were composed with. */
  readonly clock: RuntimeClock;
  readonly changes?: ChangeSink;
}

/** One operation the user began; exists only while its authorisation is live in memory. */
interface LiveIssuance {
  record: IssuanceRecord;
  readonly hab: Hab;
  readonly dh: Dhke;
  readonly peer: string;
  readonly credential: SerderACDC;
  readonly registry: string;
  /** Grant body and nested disclosure, the input of proof support. */
  readonly raw: Uint8Array;
  readonly grantWire: Uint8Array;
  readonly query: Uint8Array;
  readonly expires: bigint;
  /** Transient witness codes for the anchor. */
  readonly auths?: WitnessAuthMap;
  phase: IssuancePhase;
  sent: boolean;
  nextQuery: number;
  /** A step is running; overlapping `processOnce` calls skip it. */
  busy: boolean;
}

/** What `beginIssuance` selected. */
export interface IssuanceBegun {
  grant: string;
  xid: string;
}

/** Issuer input: a Grant prepared by `prepareIssuanceGrant`, or a fresh credential to prepare and select. */
export type BeginIssuanceInput =
  | { hab: Hab; grant: string; auths?: WitnessAuthMap }
  | { hab: Hab; credential: SerderACDC; options: IssuanceGrantOptions; auths?: WitnessAuthMap };

const EXPIRED = "The selected Grant reached its original exchange deadline";

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

/**
 * The operations table and its driver. One per host runtime; every identifier
 * of that runtime may issue through it. Only `processOnce` performs work, and
 * only for operations in {@link IssuanceOperations.live}.
 */
export class IssuanceOperations {
  /** Operations whose authorisation is live in this process. Internal to this module's functions. */
  readonly live = new Map<string, LiveIssuance>();
  readonly discloser: IpexDiscloser;
  private swept = false;

  constructor(readonly deps: IssuanceDeps) {
    this.discloser = new IpexDiscloser(deps.hby, deps.rgy.store, deps.exc, deps.receiptor);
  }

  /**
   * Advance every live operation by one pass. Each pass is bounded by the
   * operation's Grant deadline. The first pass also settles records left active
   * by an earlier process as `interrupted`; that signs and sends nothing.
   */
  *processOnce(): Operation<void> {
    if (!this.swept) {
      this.swept = true;
      for (const record of this.deps.store.list()) {
        if (!record.ended && !record.done && !this.live.has(record.grant)) this.orphan(record);
      }
    }
    for (const op of [...this.live.values()]) {
      if (op.busy || !this.live.has(op.record.grant)) continue;
      op.busy = true;
      try {
        const left = op.expires - BigInt(this.deps.clock.now()) * 1000n;
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

  /** End a live operation: release its DH approval, record why, tell the sink. */
  end(op: LiveIssuance, state: IssuanceEndState, reason: string): void {
    this.release(op);
    this.deps.store.put({ ...op.record, ended: { state, reason, at: iso(this.deps.clock.now()) } });
    this.deps.changes?.push({ kind: "issuance", id: op.record.grant });
  }

  /** Drop the live entry and the DH approval; a missing approval means the owner already closed. */
  private release(op: LiveIssuance): void {
    this.live.delete(op.record.grant);
    try {
      op.dh.abandon(op.record.xid);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
    }
  }

  private orphan(record: IssuanceRecord): void {
    const lapsed = BigInt(this.deps.clock.now()) * 1000n >= (timestampMicros(record.deadline) ?? 0n);
    const [state, reason] = orphaned(lapsed);
    this.deps.store.put({ ...record, ended: { state, reason, at: iso(this.deps.clock.now()) } });
    this.deps.changes?.push({ kind: "issuance", id: record.grant });
  }

  private *timer(milliseconds: number): Operation<"expired"> {
    yield* wait(this.deps.clock, milliseconds);
    return "expired";
  }

  private *send(op: LiveIssuance, dest: string, msg: Uint8Array): Operation<void> {
    yield* this.deps.delivery.deliver({ src: op.hab.pre!, dest, msg });
  }

  private setPhase(op: LiveIssuance, phase: IssuancePhase): void {
    op.phase = phase;
    this.deps.changes?.push({ kind: "issuance", id: op.record.grant });
  }

  /** One pass of the issuer loop, in the order of the CLI loop it replaces. */
  private *step(op: LiveIssuance): Operation<"stepped"> {
    if (!op.sent) {
      yield* this.send(op, op.peer, concatBytes(this.discloser.proofSupport(op.raw, op.hab), op.grantWire));
      op.sent = true;
    }
    while (op.dh.outgoing.length) {
      const queued = op.dh.outgoing.pull()!;
      if (queued.kin === "sign") throw new ValidationError("Individual issuance cannot process group contributions");
      yield* this.send(op, queued.dest, queued.msg);
    }
    if (op.dh.complete(op.record.xid)) yield* this.finish(op);
    else if (this.deps.clock.now() >= op.nextQuery) {
      yield* this.send(op, op.peer, op.query);
      op.nextQuery = this.deps.clock.now() + ISSUANCE_QUERY_RESEND_MS;
    }
    return "stepped";
  }

  /** DH is complete: stage and anchor the BUP under the live authorisation, finish the Grant, send proof support. */
  private *finish(op: LiveIssuance): Operation<void> {
    const { rgy, receiptor, derived } = this.deps;
    this.setPhase(op, "awaitingAnchor");
    const reg = rgy.regs.get(op.registry)!;
    const custody = new RegistryCustody({ hby: this.deps.hby, hab: op.hab, registry: rgy.store, store: derived });
    const author = new RegistryAuthor(rgy, receiptor, custody);
    const { event } = author.stage(reg, op.credential, "issued", { auths: op.auths });
    yield* author.anchor(reg, event, op.auths);
    this.setPhase(op, "proving");
    yield* op.dh.finish(op.record.xid);
    if (!this.deps.exc.complete(op.record.grant)) throw new ValidationError("Issued Grant remains unaccepted");
    yield* this.send(op, op.peer, this.discloser.proofSupport(op.raw, op.hab));
    this.release(op);
    this.deps.store.put({ ...op.record, done: iso(this.deps.clock.now()) });
    this.deps.changes?.push({ kind: "issuance", id: op.record.grant });
  }
}

function orphaned(lapsed: boolean): ["expired" | "interrupted", string] {
  return lapsed
    ? ["expired", EXPIRED]
    : ["interrupted", "The process that began this issuance ended; nothing was signed since. Begin a new Grant"];
}

/**
 * Sign a fresh Grant for `credential` and take it into local pending issuance
 * without approving DH or generating a root. A host may deliver or file the
 * returned wire itself and begin later with the Grant SAID.
 */
export function* prepareIssuanceGrant(
  ops: IssuanceOperations,
  { hab, credential, options }: { hab: Hab; credential: SerderACDC; options: IssuanceGrantOptions },
): Operation<{ grant: string; wire: Uint8Array }> {
  const { deps, discloser } = ops;
  requireIndividual(deps, hab);
  if (!credential.regid || deps.rgy.regs.get(credential.regid)?.hab !== hab) {
    throw new ValidationError("Fresh issuance requires the selected issuer's managed local registry");
  }
  hab.mgr.requireRegistryRootAccess();
  const prepared = yield* discloser.prepareIssuanceGrantBody(hab.pre!, credential, options);
  const wire = concatBytes(discloser.proofSupport(prepared.raw, hab), exchangeWire(hab, prepared.exn, prepared.nests));
  yield* deps.reactor.processBytes(wire, { local: true });
  yield* deps.protocol.processEscrowsOnce();
  const xid = prepared.exn.ilk === "xip" ? prepared.exn.said! : prepared.exn.sad!.x as string;
  if (!deps.exc.pendingGrant(prepared.exn.said!, { xid, sender: hab.pre!, recipient: options.recipient })) {
    throw new ValidationError("Fresh Grant did not reach authenticated pending issuance");
  }
  return { grant: prepared.exn.said!, wire };
}

function requireIndividual(deps: IssuanceDeps, hab: Hab): void {
  if (isLocalGroupHab(deps.hby, hab)) {
    throw new ValidationError(
      "This finite issuance workflow requires an individual habitat; group issuance needs explicit member coordination",
    );
  }
}

/**
 * The issuer's one "issue this credential" consent. Signs the Grant when given
 * a credential, approves the DH exchange, signs the query and records the
 * authorisation, including the later KEL signature that anchors the registry
 * update, in memory. Returns after local commit; `processOnce` does the rest.
 *
 * @throws ValidationError for a Grant that is not this identifier's exact
 * unanchored pending issuance, an unmanaged registry, a group identifier, or
 * an issuance already begun or completed.
 */
export function* beginIssuance(ops: IssuanceOperations, input: BeginIssuanceInput): Operation<IssuanceBegun> {
  const { deps } = ops, { hab, auths } = input;
  const grant = "grant" in input ? input.grant : (yield* prepareIssuanceGrant(ops, input)).grant;
  requireIndividual(deps, hab);
  const old = deps.store.get(grant);
  if (ops.live.has(grant) || old?.done) {
    throw new ValidationError("Issuance was already begun for this Grant");
  }
  const retained = deps.exc.retainedInput(grant, { pending: true });
  const credential = retained?.nests?.[0]?.body;
  if (
    !retained || !(credential instanceof SerderACDC) || !credential.regid || retained.serder.pre !== hab.pre
    || retained.sourceSeals?.length || retained.ptds?.length || retained.essrs?.length
  ) {
    throw new ValidationError("Select the exact unanchored pending issuance Grant for this local party");
  }
  const reg = deps.rgy.regs.get(credential.regid);
  if (!reg || reg.hab !== hab) {
    throw new ValidationError("Issuance requires the selected issuer's managed local registry");
  }
  const deadline = deps.exc.exchangeDeadline(retained.serder), expires = timestampMicros(deadline);
  if (!deadline || expires === null) throw new Error("Authenticated pending Grant has a missing or corrupt deadline");
  const raw = concatBytes(
    Counter.makeGVC(Vrsn_2_0),
    ...yield* call(() => Promise.all((retained.nests ?? []).map((nest) => collectPayload(framePayload(nest))))),
  );
  const frame =
    parseBytes(messagize(retained.serder, { tsgs: retained.tsgs, cigars: retained.cigars, gvrsn: Vrsn_2_0 }))[0];
  frame.nests = [...retained.nests ?? []];
  const grantWire = yield* call(() => collectPayload(framePayload(frame)));
  const dh = deps.dhkes.dhke(hab), xid = dh.approve(grant), query = dh.start(grant), now = iso(deps.clock.now());
  const record: IssuanceRecord = {
    grant,
    xid,
    hab: hab.pre!,
    role: "issuer",
    deadline,
    consents: { exchange: now, anchor: now },
  };
  deps.store.put(record);
  ops.live.set(grant, {
    record,
    hab,
    dh,
    peer: retained.serder.sad!.ri as string,
    credential,
    registry: credential.regid,
    raw,
    grantWire,
    query,
    expires,
    auths,
    phase: "exchangingKeys",
    sent: false,
    nextQuery: 0,
    busy: false,
  });
  deps.changes?.push({ kind: "issuance", id: grant });
  return { grant, xid };
}

/**
 * Pure read of one issuance: its durable record and the live table. A record
 * left active by a process that is gone reads `interrupted` (or `expired` once
 * the Grant deadline has passed); that is a statement, not a write.
 *
 * @throws ValidationError when no issuance was begun for `grant`.
 */
export function issuanceStatus(ops: Pick<IssuanceOperations, "deps" | "live">, grant: string): IssuanceStatus {
  const record = ops.deps.store.get(grant);
  if (!record) throw new ValidationError("No issuance was begun for this Grant");
  const { role } = record;
  if (record.ended) return { state: record.ended.state, role, reason: record.ended.reason };
  if (record.done) return { state: "done", role, phase: "issued" };
  const live = ops.live.get(grant);
  const lapsed = BigInt(ops.deps.clock.now()) * 1000n >= (timestampMicros(record.deadline) ?? 0n);
  if (live && !lapsed) return { state: "active", role, phase: live.phase, deadline: record.deadline };
  const [state, reason] = orphaned(lapsed);
  return { state, role, reason };
}

/** Options for {@link waitForIssuance}. */
export interface IssuanceWaitOptions {
  /** Wall-clock budget. */
  timeoutMs: number;
  clock?: Pick<RuntimeClock, "now">;
}

/**
 * Observe until the issuance is done or ended, or the budget expires. Starts no
 * worker and drives nothing: someone else must call `processOnce`.
 */
export function* waitForIssuance(
  ops: Pick<IssuanceOperations, "deps" | "live">,
  grant: string,
  { timeoutMs, clock = ops.deps.clock }: IssuanceWaitOptions,
): Operation<WaitResult<IssuanceStatus>> {
  const settled = yield* observeUntil(() => issuanceStatus(ops, grant).state !== "active", { timeoutMs, clock });
  const status = issuanceStatus(ops, grant);
  return settled ? { outcome: "settled", status } : { outcome: "timed-out", status, timeoutMs };
}

/**
 * Local abandon: release the DH approval (ephemeral keys, permanent refusal of
 * this operation) and record `abandoned`. Does not message the peer and does
 * not undo a retained root or a registry update that was already anchored.
 * Does nothing to an issuance that is already done or ended.
 *
 * @throws ValidationError when no issuance was begun for `grant`.
 */
export function abandonIssuance(ops: IssuanceOperations, grant: string, reason = "Abandoned by the user"): void {
  const record = ops.deps.store.get(grant);
  if (!record) throw new ValidationError("No issuance was begun for this Grant");
  if (record.ended || record.done) return;
  const live = ops.live.get(grant);
  if (live) ops.end(live, "abandoned", reason);
  else {
    ops.deps.store.put({ ...record, ended: { state: "abandoned", reason, at: iso(ops.deps.clock.now()) } });
    ops.deps.changes?.push({ kind: "issuance", id: grant });
  }
}
