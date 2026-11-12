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
 * A process that loses memory therefore never signs, and reads `interrupted`
 * unless the exchange already retained its root. That one case is not dead: the
 * Keeper binds each DH root to the Grant whose exchange produced it, so a
 * pending Grant inside its deadline whose registry has no accepted update yet
 * only needs its remaining steps. It reads active with `needs: "anchor"` (issuer:
 * stage, anchor, finish, prove) or `"finish"` (holder: verify the update, finish
 * the Grant), and {@link resumeIssuance} is the user's explicit step that
 * re-establishes the in-memory authorisation without a new key exchange. This is
 * decided from stores only. The Grant's exchange deadline bounds everything;
 * passing it reads `expired`.
 *
 * The runtime never writes wallet inventory. Completion is pushed to the
 * `ChangeSink` as `{kind: "issuance", id: <grant>}` and the embedder records it.
 *
 * Group steps are a later change: they add records and phases and run inside
 * the same `processOnce`; the table, store port and status union are unchanged.
 * Collaborators are narrow concrete owners (ADR-0013); no `AgentRuntime`.
 */
import {
  collectPayload,
  concatBytes,
  Counter,
  framePayload,
  parseBytes,
  SerderACDC,
  type SerderKERI,
  type Versionage,
  Vrsn_2_0,
} from "cesr-ts";
import { action, call, type Operation, race } from "npm:effection@^3.6.0";
import { RegistryAuthor } from "../../acdc/authoring.ts";
import { type DerivedUpdateStore, RegistryCustody } from "../../acdc/custody.ts";
import { type Dhke, resumableExchange } from "../../acdc/dhking.ts";
import type { Regery } from "../../acdc/registraring.ts";
import { ValidationError } from "../../core/errors.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../../core/mailbox/mailbox-topics.ts";
import { messagize } from "../../core/protocol-serialization.ts";
import { timestampMicros } from "../../time/mod.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { ExchangeInput, Exchanger } from "../exchanges/exchanging.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { isLocalGroupHab } from "../multisig/group-members.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { Reactor } from "../protocol/reactor.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { type ChangeSink, observeUntil, type WaitResult } from "../runtime/workflow-contract.ts";
import type { Receiptor, WitnessAuthMap } from "../witness/receipting.ts";
import { IpexAdmitter } from "./ipex-admitting.ts";
import { exchangeWire, IpexDiscloser, type IssuanceGrantOptions } from "./ipex-discloser.ts";

/** Milliseconds between resends of the unchanged issuer query, as `tufa ipex --issue` and KERIpy do. */
export const ISSUANCE_QUERY_RESEND_MS = 1000;

/** Which side of the exchange the local identifier is. */
export type IssuanceRole = "issuer" | "holder";

/** Terminal states that are not completion; each carries a reason. */
export type IssuanceEndState = "abandoned" | "interrupted" | "expired" | "refused" | "failed";

/** Where an active issuance is. Group and holder phases extend this union. */
export type IssuancePhase =
  | "awaitingExchangeConsent"
  | "exchangingKeys"
  | "rootRetained"
  | "awaitingAnchor"
  | "proving"
  | "awaitingAdmitConsent";

/**
 * A user step an active issuance waits for. A fresh single-signature issuer never waits: `beginIssuance`
 * authorises the anchor. After a restart that kept the retained root, `"anchor"` (issuer) and `"finish"`
 * (holder) both mean "call {@link resumeIssuance}"; a UI says "approve to finish". `"exchange"` and
 * `"admit"` are the holder's first consent and its separate Admit.
 */
export type IssuanceNeed = "exchange" | "anchor" | "finish" | "admit";

/** Durable, non-secret operation facts. Never holds keys, roots or authorisation codes. */
export interface IssuanceRecord {
  /** SAID of the Grant exchange. */
  readonly grant: string;
  /** DH transaction id; differs from the Grant SAID for a Grant that continues an earlier exchange. */
  readonly xid: string;
  /** Prefix of the local identifier. */
  readonly hab: string;
  readonly role: IssuanceRole;
  /** The Grant's original exchange deadline (ISO 8601); absent only for an Admit of a Grant that never needed DH. */
  readonly deadline?: string;
  /** When the user gave each consent (ISO 8601). */
  readonly consents: { readonly exchange?: string; readonly anchor?: string; readonly admit?: string };
  /** Holder: when the Grant was accepted locally, leaving only the Admit consent. */
  readonly issued?: string;
  /** When {@link resumeIssuance} re-established the authorisation after a restart (ISO 8601). */
  readonly resumed?: string;
  /** When the operation completed: the issuer's final proof support was sent, or the holder's Admit was accepted. */
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
    /** The Grant's exchange deadline (ISO 8601), while the exchange is still open. */
    deadline?: string;
  }
  | { state: "done"; role: IssuanceRole; phase: "issued" | "admitted" }
  | { state: IssuanceEndState; role: IssuanceRole; reason: string };

/** Delivery of signed bytes; resolves once the transport reports an outcome and throws when it failed. */
export interface IssuanceDelivery {
  deliver(message: { src: string; dest: string; msg: Uint8Array }): Operation<string[]>;
}

/** Adapt a `Poster`; its delivery worker must be running (a one-shot CLI runs it under `withRuntimeWorkers`). */
export function posterDelivery(postman: Pick<Poster, "send" | "wait">): IssuanceDelivery {
  return {
    *deliver({ src, dest, msg }) {
      const outcome = yield* postman.wait(postman.send({ src, dest, topic: CREDENTIAL_MAILBOX_TOPIC, msg }, {
        notify: true,
      }));
      if (outcome.kin === "failed") throw outcome.error;
      return outcome.deliveries;
    },
  };
}

/** Collaborators of an Admit: everything that needs no DH owner, so a host without per-identifier owners can admit. */
export interface AdmitDeps {
  readonly hby: Habery;
  /** Registry environment; only its public `store` is read here. */
  readonly rgy: Pick<Regery, "store">;
  readonly exc: Exchanger;
  /** Receipt collector for an anchored Admit; its genus selects the witness protocol version. */
  readonly receiptor: Receiptor;
  /** Local intake of what this identifier signs. */
  readonly reactor: Pick<Reactor, "processBytes">;
  readonly protocol: Pick<ProtocolProcessor, "processEscrowsOnce">;
  readonly delivery: IssuanceDelivery;
  readonly store: IssuanceOperationStore;
  /** Same clock the exchanger and DH owners were composed with. */
  readonly clock: RuntimeClock;
  readonly changes?: ChangeSink;
}

/** Narrow collaborators of the issuance owner. Hosts adapt their runtime to this once. */
export interface IssuanceDeps extends AdmitDeps {
  /** Registry environment; `rgy.store` is the public registry store. */
  readonly rgy: Regery;
  /** Per-identifier DH owners (`runtime.ipex`), so several identifiers can issue on one runtime. */
  readonly dhkes: { dhke(hab: Hab): Dhke };
  /** Non-secret derivation coordinates of blinded registry updates. */
  readonly derived: DerivedUpdateStore;
}

/** One operation the user began; exists only while its authorisation is live in memory. */
interface LiveIssuance {
  record: IssuanceRecord;
  readonly hab: Hab;
  readonly dh: Dhke;
  readonly peer: string;
  readonly registry: string;
  readonly expires: bigint;
  /** Issuer only: what the loop sends and anchors. Absent for a holder. */
  readonly issuer?: {
    readonly credential: SerderACDC;
    /** Grant body and nested disclosure, the input of proof support. */
    readonly raw: Uint8Array;
    readonly grantWire: Uint8Array;
    /** The unchanged DH query to resend; null for a resumed operation, whose key exchange is already complete. */
    readonly query: Uint8Array | null;
    /** Transient witness codes for the anchor. */
    readonly auths?: WitnessAuthMap;
    sent: boolean;
    nextQuery: number;
  };
  phase: IssuancePhase;
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
        const settled = record.ended || record.issued || record.done || this.live.has(record.grant);
        if (!settled && !resumable(this.deps, record)) this.orphan(record);
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
    const [state, reason] = orphaned(lapsed(this.deps, record));
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
    if (op.phase === phase) return;
    op.phase = phase;
    this.deps.changes?.push({ kind: "issuance", id: op.record.grant });
  }

  /** One pass of the issuer loop, in the order of the CLI loop it replaces. */
  private *step(op: LiveIssuance): Operation<"stepped"> {
    const issuer = op.issuer;
    if (issuer && !issuer.sent) {
      yield* this.send(op, op.peer, concatBytes(this.discloser.proofSupport(issuer.raw, op.hab), issuer.grantWire));
      issuer.sent = true;
    }
    while (op.dh.outgoing.length) {
      const queued = op.dh.outgoing.pull()!;
      if (queued.kin === "sign") throw new ValidationError("Individual issuance cannot process group contributions");
      yield* this.send(op, queued.dest, queued.msg);
    }
    if (!op.dh.complete(op.record.xid)) {
      if (issuer?.query && this.deps.clock.now() >= issuer.nextQuery) {
        yield* this.send(op, op.peer, issuer.query);
        issuer.nextQuery = this.deps.clock.now() + ISSUANCE_QUERY_RESEND_MS;
      }
    } else if (issuer) yield* this.finish(op, issuer);
    else yield* this.receive(op);
    return "stepped";
  }

  /**
   * Holder, DH complete: wait for the issuer's registry update, then verify it and finish the Grant. The
   * issuance is then complete but for the holder's separate Admit consent.
   */
  private *receive(op: LiveIssuance): Operation<void> {
    if (this.deps.rgy.store.headEvent(op.registry)?.ilk === "rip") return this.setPhase(op, "rootRetained");
    this.setPhase(op, "proving");
    yield* op.dh.finish(op.record.xid);
    if (!this.deps.exc.complete(op.record.grant)) throw new ValidationError("Issued Grant remains unaccepted");
    this.release(op);
    this.deps.store.put({ ...op.record, issued: iso(this.deps.clock.now()) });
    this.deps.changes?.push({ kind: "issuance", id: op.record.grant });
  }

  /** DH is complete: stage and anchor the BUP under the live authorisation, finish the Grant, send proof support. */
  private *finish(op: LiveIssuance, issuer: NonNullable<LiveIssuance["issuer"]>): Operation<void> {
    const { rgy, receiptor, derived } = this.deps;
    this.setPhase(op, "awaitingAnchor");
    const reg = rgy.regs.get(op.registry)!;
    const custody = new RegistryCustody({ hby: this.deps.hby, hab: op.hab, registry: rgy.store, store: derived });
    const author = new RegistryAuthor(rgy, receiptor, custody);
    const { event } = author.stage(reg, issuer.credential, "issued", { auths: issuer.auths });
    yield* author.anchor(reg, event, issuer.auths);
    this.setPhase(op, "proving");
    yield* op.dh.finish(op.record.xid);
    if (!this.deps.exc.complete(op.record.grant)) throw new ValidationError("Issued Grant remains unaccepted");
    yield* this.send(op, op.peer, this.discloser.proofSupport(issuer.raw, op.hab));
    this.release(op);
    this.deps.store.put({ ...op.record, done: iso(this.deps.clock.now()) });
    this.deps.changes?.push({ kind: "issuance", id: op.record.grant });
  }
}

/**
 * Whether a restarted process can finish this record without new key exchange: the Grant is inside its
 * deadline, this record's own habitat is the party its role names, and {@link resumableExchange} finds the
 * exchange's root retained with the registry still fresh. A pure read of stores.
 */
function resumable(deps: IssuanceDeps, record: IssuanceRecord): boolean {
  const hab = deps.hby.habs.get(record.hab);
  if (!hab || lapsed(deps, record)) return false;
  const scope = resumableExchange({ hab, exc: deps.exc, registryStore: deps.rgy.store }, record.grant);
  return !!scope && (scope.issuer === hab.pre) === (record.role === "issuer");
}

/** Whether the Grant's exchange deadline has passed; a record without one never lapses. */
function lapsed(deps: Pick<IssuanceDeps, "clock">, { deadline }: IssuanceRecord): boolean {
  const expiry = timestampMicros(deadline);
  return expiry !== null && BigInt(deps.clock.now()) * 1000n >= expiry;
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
 * The exact unanchored pending Grant a local party may consent to, with its deadline. Refuses a group
 * identifier, an issuance already begun, a Grant that is not this party's, and an issuer without its registry.
 */
function selectGrant(ops: IssuanceOperations, hab: Hab, grant: string, role: IssuanceRole) {
  const { deps } = ops;
  requireIndividual(deps, hab);
  const old = deps.store.get(grant);
  if (ops.live.has(grant) || old?.issued || old?.done) {
    throw new ValidationError("Issuance was already begun for this Grant");
  }
  const retained = deps.exc.retainedInput(grant, { pending: true });
  const credential = retained?.nests?.[0]?.body;
  if (
    !retained || !(credential instanceof SerderACDC) || !credential.regid
    || (role === "issuer" ? retained.serder.pre : retained.serder.sad!.ri) !== hab.pre
    || retained.sourceSeals?.length || retained.ptds?.length || retained.essrs?.length
  ) {
    throw new ValidationError("Select the exact unanchored pending issuance Grant for this local party");
  }
  const reg = deps.rgy.regs.get(credential.regid);
  if (role === "issuer" && (!reg || reg.hab !== hab)) {
    throw new ValidationError("Issuance requires the selected issuer's managed local registry");
  }
  const deadline = deps.exc.exchangeDeadline(retained.serder), expires = timestampMicros(deadline);
  if (!deadline || expires === null) throw new Error("Authenticated pending Grant has a missing or corrupt deadline");
  return { retained, credential, deadline, expires };
}

/** The Grant body with its nested disclosure (the input of proof support) and the Grant as sent to the holder. */
function* grantWires(retained: ExchangeInput): Operation<{ raw: Uint8Array; grantWire: Uint8Array }> {
  const raw = concatBytes(
    Counter.makeGVC(Vrsn_2_0),
    ...yield* call(() => Promise.all((retained.nests ?? []).map((nest) => collectPayload(framePayload(nest))))),
  );
  const frame =
    parseBytes(messagize(retained.serder, { tsgs: retained.tsgs, cigars: retained.cigars, gvrsn: Vrsn_2_0 }))[0];
  frame.nests = [...retained.nests ?? []];
  return { raw, grantWire: yield* call(() => collectPayload(framePayload(frame))) };
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
  const { retained, credential, deadline, expires } = selectGrant(ops, hab, grant, "issuer");
  const { raw, grantWire } = yield* grantWires(retained);
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
    registry: credential.regid!,
    expires,
    issuer: { credential, raw, grantWire, query, auths, sent: false, nextQuery: 0 },
    phase: "exchangingKeys",
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
  if (!record) return unconsented(ops.deps, grant);
  const { role } = record;
  if (record.ended) return { state: record.ended.state, role, reason: record.ended.reason };
  if (record.done) return { state: "done", role, phase: role === "holder" ? "admitted" : "issued" };
  if (record.issued) return { state: "active", role, phase: "awaitingAdmitConsent", needs: "admit" };
  const live = ops.live.get(grant), over = lapsed(ops.deps, record);
  if (live && !over) return { state: "active", role, phase: live.phase, deadline: record.deadline };
  if (!live && resumable(ops.deps, record)) {
    return {
      state: "active",
      role,
      phase: "rootRetained",
      needs: role === "issuer" ? "anchor" : "finish",
      deadline: record.deadline,
    };
  }
  const [state, reason] = orphaned(over);
  return { state, role, reason };
}

/** A Grant addressed to a local identifier that has not yet consented to the exchange reads as awaiting that consent. */
function unconsented(deps: IssuanceDeps, grant: string): IssuanceStatus {
  const pending = deps.exc.retainedInput(grant, { pending: true }), holder = pending?.serder.sad?.ri;
  if (typeof holder !== "string" || !deps.hby.habs.has(holder)) {
    throw new ValidationError("No issuance was begun for this Grant");
  }
  const deadline = deps.exc.exchangeDeadline(pending!.serder) ?? undefined;
  return { state: "active", role: "holder", phase: "awaitingExchangeConsent", needs: "exchange", deadline };
}

/** Options for {@link waitForIssuance}. */
export interface IssuanceWaitOptions {
  /** Wall-clock budget. */
  timeoutMs: number;
  clock?: Pick<RuntimeClock, "now">;
  /** Settle on this instead of any non-active state, e.g. a holder stopping where it needs the Admit consent. */
  until?: (status: IssuanceStatus) => boolean;
}

/**
 * Observe until the issuance is done or ended, or the budget expires. Starts no
 * worker and drives nothing: someone else must call `processOnce`.
 */
export function* waitForIssuance(
  ops: Pick<IssuanceOperations, "deps" | "live">,
  grant: string,
  { timeoutMs, clock = ops.deps.clock, until = (status) => status.state !== "active" }: IssuanceWaitOptions,
): Operation<WaitResult<IssuanceStatus>> {
  const settled = yield* observeUntil(() => until(issuanceStatus(ops, grant)), { timeoutMs, clock });
  const status = issuanceStatus(ops, grant);
  return settled ? { outcome: "settled", status } : { outcome: "timed-out", status, timeoutMs };
}

/**
 * The holder's consent to the DH exchange for one pending Grant addressed to `hab`. Approves DH and records the
 * consent; `processOnce` then answers the issuer's query, waits for its registry update and finishes the Grant.
 * Admitting the credential is a separate consent ({@link admitIssuance}).
 */
export function approveIssuanceExchange(
  ops: IssuanceOperations,
  { hab, grant }: { hab: Hab; grant: string },
): IssuanceBegun {
  const { deps } = ops, { retained, credential, deadline, expires } = selectGrant(ops, hab, grant, "holder");
  const dh = deps.dhkes.dhke(hab), xid = dh.approve(grant);
  const record: IssuanceRecord = {
    grant,
    xid,
    hab: hab.pre!,
    role: "holder",
    deadline,
    consents: { exchange: iso(deps.clock.now()) },
  };
  deps.store.put(record);
  ops.live.set(grant, {
    record,
    hab,
    dh,
    peer: retained.serder.pre!,
    registry: credential.regid!,
    expires,
    phase: "exchangingKeys",
    busy: false,
  });
  deps.changes?.push({ kind: "issuance", id: grant });
  return { grant, xid };
}

/**
 * The explicit consent to finish an exchange whose key exchange already completed before a restart: the
 * issuer's "anchor and finish" or the holder's "finish" ({@link IssuanceNeed}). Needs the Grant's existing
 * record and an issuance whose status reads active with that need. Performs no key exchange and signs
 * nothing itself: the Keeper's retained root is rebound to this Grant ({@link Dhke.resume}), the in-memory
 * authorisation, including the later KEL signature that anchors the update, is recorded as `beginIssuance`
 * does, and `processOnce` stages and anchors the registry update (issuer), finishes the Grant and sends
 * proof support. The blinded update derives from the same retained root, so the peer verifies it as it would
 * have without the restart. Returns after local commit.
 *
 * @throws ValidationError when the issuance has no active record of `hab`, or its status is not resumable.
 */
export function* resumeIssuance(
  ops: IssuanceOperations,
  { hab, grant, auths }: { hab: Hab; grant: string; auths?: WitnessAuthMap },
): Operation<IssuanceBegun> {
  const { deps } = ops, old = deps.store.get(grant), status = old && issuanceStatus(ops, grant);
  if (
    !old || old.hab !== hab.pre || status?.state !== "active"
    || (status.needs !== "anchor" && status.needs !== "finish")
  ) {
    throw new ValidationError(
      "Only an issuance of this identifier that reads active and needs to anchor or finish can be resumed",
    );
  }
  const { retained, credential, deadline, expires } = selectGrant(ops, hab, grant, old.role);
  const wires = old.role === "issuer" ? yield* grantWires(retained) : null;
  const dh = deps.dhkes.dhke(hab), xid = dh.resume(grant);
  if (xid !== old.xid || deadline !== old.deadline) {
    throw new ValidationError("Resumed exchange differs from its record");
  }
  const now = iso(deps.clock.now());
  const record: IssuanceRecord = {
    ...old,
    resumed: now,
    consents: wires ? { ...old.consents, anchor: now } : old.consents,
  };
  deps.store.put(record);
  ops.live.set(grant, {
    record,
    hab,
    dh,
    peer: wires ? retained.serder.sad!.ri as string : retained.serder.pre!,
    registry: credential.regid!,
    expires,
    issuer: wires ? { credential, ...wires, query: null, auths, sent: true, nextQuery: 0 } : undefined,
    phase: "rootRetained",
    busy: false,
  });
  deps.changes?.push({ kind: "issuance", id: grant });
  return { grant, xid };
}

/** A signed Admit already accepted locally; delivery is the next, separate step. */
export interface IssuanceAdmit {
  admit: SerderKERI;
  /** Support and Admit bytes, in delivery order. */
  wire: Uint8Array;
  /** The issuer the Admit answers. */
  dest: string;
}

/**
 * The holder's consent to admit one accepted Grant: signs the Admit, accepts it locally and records it. Works for
 * a Grant finished by this module and for any other accepted v2 Grant, for which it creates the record. Returns
 * before delivery so an embedder can record its own inventory first; see {@link deliverIssuanceAdmit}.
 *
 * @throws ValidationError for a Grant that is not accepted and addressed to `hab`, an admitted Grant, or a group identifier.
 */
export function* admitIssuance(
  deps: AdmitDeps,
  { hab, grant, message = "", gvrsn, auths }: {
    hab: Hab;
    grant: string;
    message?: string;
    gvrsn?: Versionage;
    auths?: WitnessAuthMap;
  },
): Operation<IssuanceAdmit> {
  const old = deps.store.get(grant);
  if (old?.done || old?.ended) throw new ValidationError("Issuance cannot be admitted in its state");
  const prepared = yield* new IpexAdmitter(deps.hby, deps.rgy.store, deps.exc).prepareAdmit(grant, hab.pre!, {
    consent: true,
    auths,
    message,
    gvrsn,
    receiptor: deps.receiptor,
  });
  const wire = concatBytes(prepared.support, prepared.wire);
  yield* deps.reactor.processBytes(wire, { local: true });
  yield* deps.protocol.processEscrowsOnce();
  if (!deps.exc.complete(prepared.admit.said!)) throw new ValidationError("Local ACDC v2 Admit was not accepted.");
  const now = iso(deps.clock.now()), body = deps.hby.db.exns.get([grant])!;
  const xid = body.ilk === "xip" ? body.said! : body.sad!.x as string;
  deps.store.put({
    grant,
    xid,
    hab: hab.pre!,
    role: "holder",
    deadline: deps.exc.exchangeDeadline(body) ?? undefined,
    ...old,
    consents: { ...old?.consents, admit: now },
    issued: old?.issued ?? now,
    done: now,
  });
  deps.changes?.push({ kind: "issuance", id: grant });
  return { admit: prepared.admit, wire, dest: prepared.admit.sad!.ri as string };
}

/** Deliver an accepted Admit; needs the host's delivery worker. Returns the destinations reached. */
export function* deliverIssuanceAdmit(
  deps: Pick<AdmitDeps, "delivery">,
  hab: Hab,
  { dest, wire }: IssuanceAdmit,
): Operation<string[]> {
  return yield* deps.delivery.deliver({ src: hab.pre!, dest, msg: wire });
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
