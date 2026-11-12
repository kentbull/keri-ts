/**
 * Runtime-owned operations for single-signature v2 DH issuance.
 *
 * One `IssuanceOperations` owner holds an in-memory table of live operations. The user begins an
 * operation with `beginIssuance`, which signs the Grant, approves the DH exchange, starts the query
 * and records that authorisation in memory. The host's runtime loop (or, in a one-shot CLI, a driver
 * under `withRuntimeWorkers`) then calls `processOnce`, which performs exactly the steps
 * `tufa ipex --issue` performed itself: send the proof support and Grant, deliver DH traffic, resend
 * the unchanged query each second, and once DH completes stage and anchor the registry update (BUP),
 * `finish` the Grant and send the final proof support. Nothing starts an operation or signs except
 * inside an operation the user began while its in-memory authorisation lives.
 *
 * Workflow-contract shape (`app/runtime/workflow-contract.ts`): `beginIssuance` returns after local
 * commit and never waits for the peer; `issuanceStatus` is a pure read; `waitForIssuance` only
 * observes and returns a `WaitResult`; `abandonIssuance` is local.
 *
 * There is no operation store. Status is derived from the protocol stores plus the live table, so a
 * reopened store reads what the stores prove, whatever the process was doing:
 *
 * | stores prove                                                              | status                                   |
 * | ------------------------------------------------------------------------- | ---------------------------------------- |
 * | holder: pending Grant, no root held                                       | `awaitingExchangeConsent`                |
 * | pending Grant past its deadline                                           | `expired`                                |
 * | holder: root held, not committed otherwise; issuer: update accepted       | `active`, `rootRetained` (adopted)       |
 * | issuer: pending Grant, update not accepted                                | `interrupted`                            |
 * | root held and the registry committed to another exchange                  | `interrupted`                            |
 * | holder: Grant accepted, no accepted Admit                                 | `active`, `awaitingAdmitConsent`         |
 * | holder: accepted Admit                                                    | `done`, `admitted`                       |
 * | issuer: Grant accepted                                                    | `done`, `issued`                         |
 *
 * Lost on reload, by design: the phases that live only in memory (`exchangingKeys`, `awaitingAnchor`,
 * `proving` read `rootRetained` or `interrupted` afterwards), the `abandoned` and `failed` end states
 * with their reasons (an abandoned holder reads `awaitingExchangeConsent` again, an abandoned issuer
 * `interrupted`, and an abandoned operation whose root and accepted update remain is adopted and
 * completed on the next start; it signs nothing and Admit stays a separate consent), the consent
 * timestamps, and whether the issuer's final proof support was delivered (an issuer whose Grant is
 * accepted reads `done` even if the process ended before that message went out). A Grant the issuer
 * prepared but never began reads `interrupted`, the same as one whose process ended; so does an issuer
 * that ended between staging its registry update and anchoring it (an explicit recovery action for that
 * case is a planned follow-up; until then it needs a new Grant, and a held root nothing committed to is
 * replaced). A wallet that wants any of these keeps them itself from the `ChangeSink`.
 *
 * After a restart the first `processOnce` finds the pending Grants this runtime's identifiers are party
 * to that hold a root and can finish without new key exchange ({@link resumableExchange}) and adopts
 * them: the holder waits for or verifies the issuer's update, an issuer whose update is already
 * accepted finishes. Neither signs: the issuer's update was anchored before the restart, and
 * `Dhke.finish` only proves the held root against the accepted update before the Grant is accepted. A
 * new Grant on a registry that holds an unused root (no update staged or accepted) replaces that root
 * when its exchange retains its own; otherwise the refusal stands. A KERIpy peer keeps the old rule and
 * refuses a second exchange on a registry it holds a root for. The Grant's exchange deadline bounds
 * everything, even a late completion; passing it reads `expired`.
 *
 * The runtime never writes wallet inventory. Completion is pushed to the `ChangeSink` as
 * `{kind: "issuance", id: <grant>}` and the embedder records it.
 *
 * Group steps are a later change: they add phases and run inside the same `processOnce`.
 * Collaborators are narrow concrete owners (ADR-0013); no `AgentRuntime`.
 */
import {
  collectPayload,
  concatBytes,
  Counter,
  framePayload,
  SerderACDC,
  type SerderKERI,
  type Versionage,
  Vrsn_2_0,
} from "cesr-ts";
import { action, call, type Operation, race } from "npm:effection@^3.6.0";
import { RegistryAuthor } from "../../acdc/authoring.ts";
import { type DerivedUpdateStore, RegistryCustody } from "../../acdc/custody.ts";
import { Dhke, registryUncommitted, resumableExchange } from "../../acdc/dhking.ts";
import type { Regery } from "../../acdc/registraring.ts";
import { ValidationError } from "../../core/errors.ts";
import { singleKeyQueryWindow } from "../../core/mailbox/kram-policy.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../../core/mailbox/mailbox-topics.ts";
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
import { exchangeWire, IpexDiscloser, type IssuanceGrantOptions, storedExchangeWire } from "./ipex-discloser.ts";

/** Milliseconds between resends of the unchanged issuer query, as `tufa ipex --issue` and KERIpy do. */
export const ISSUANCE_QUERY_RESEND_MS = 1000;

/** Which side of the exchange the local identifier is. */
export type IssuanceRole = "issuer" | "holder";

/** Terminal states that are not completion; each carries a reason. */
export type IssuanceEndState = "abandoned" | "interrupted" | "expired" | "failed";

/** Where an active issuance is. Group and holder phases extend this union. */
export type IssuancePhase =
  | "awaitingExchangeConsent"
  | "exchangingKeys"
  | "rootRetained"
  | "awaitingAnchor"
  | "proving"
  | "awaitingAdmitConsent";

/** A user step an active issuance waits for. Single-signature issuers never wait: `beginIssuance` authorises the anchor. */
export type IssuanceNeed = "exchange" | "admit";

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
export function posterDelivery(postman: Pick<Poster, "sendStream" | "wait">): IssuanceDelivery {
  return {
    *deliver({ src, dest, msg }) {
      const outcome = yield* postman.wait(
        postman.sendStream({ src, dest, topic: CREDENTIAL_MAILBOX_TOPIC, msgs: [msg] }, {
          notify: true,
        }),
      );
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
  /** Called when an operation becomes live, so the owner loop leaves its idle cadence at once. */
  readonly wake?: () => void;
}

/** One operation the user began or adopted; exists only while it is live in this process. */
interface LiveIssuance {
  /** SAID of the Grant exchange. */
  readonly grant: string;
  /** DH transaction id; differs from the Grant SAID for a Grant that continues an earlier exchange. */
  readonly xid: string;
  readonly role: IssuanceRole;
  /** The Grant's original exchange deadline (ISO 8601). */
  readonly deadline: string;
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
    /** The DH query to resend; null once DH is complete (a completed issuer after a restart). */
    query: Uint8Array | null;
    /** When {@link query} was signed (host clock, ms); it is re-dated once older than the single-key window. */
    queryAt: number;
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
const EXPIRED_LATE =
  "The selected Grant reached its original exchange deadline after the issuer's registry update arrived; a Grant is completed only while live, so ask the issuer for a new Grant";
const RESTARTED =
  "No live issuance holds this Grant: the process that began it ended before the registry update was anchored (or it was never begun); nothing was signed since. Begin the Grant, or a new one: its key exchange replaces any unused root";
const COMMITTED =
  "The process that ended a key exchange left a staged or accepted registry update that this Grant can no longer complete, and the registry cannot take another key exchange";

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

/** A Grant a restarted process can finish without a new key exchange. */
interface Resumable {
  hab: Hab;
  grant: string;
  role: IssuanceRole;
}

/** What an operation that ended in this process reports until the process ends. */
interface EndedIssuance {
  role: IssuanceRole;
  state: IssuanceEndState;
  reason: string;
}

/**
 * The live operations table and its driver. One per host runtime; every identifier of that runtime may
 * issue through it. Only `processOnce` performs work, and only for operations in
 * {@link IssuanceOperations.live}.
 */
export class IssuanceOperations {
  /** Operations live in this process. Internal to this module's functions. */
  readonly live = new Map<string, LiveIssuance>();
  /** Operations that ended in this process with their reasons; not durable, see the module doc. */
  readonly ended = new Map<string, EndedIssuance>();
  readonly discloser: IpexDiscloser;
  private swept = false;
  /** Grants an earlier process left resumable: each is adopted once, or dropped. */
  private stale: Resumable[] = [];

  constructor(readonly deps: IssuanceDeps) {
    this.discloser = new IpexDiscloser(deps.hby, deps.rgy.store, deps.exc, deps.receiptor);
  }

  /** Whether a pass has work: a live operation, or the one-time scan for resumable Grants has not run. */
  active(): boolean {
    return this.live.size > 0 || !this.swept || this.stale.length > 0;
  }

  /**
   * Advance every live operation by one pass. Each pass is bounded by the operation's Grant deadline.
   * The first pass also adopts the pending Grants the stores prove resumable ({@link resumableGrants});
   * that signs and sends nothing.
   */
  *processOnce(): Operation<void> {
    if (!this.swept) {
      this.swept = true;
      this.stale = resumableGrants(this.deps).filter(({ grant }) => !this.live.has(grant));
    }
    for (const found of [...this.stale]) {
      if (yield* this.settle(found)) this.stale.splice(this.stale.indexOf(found), 1);
    }
    for (const op of [...this.live.values()]) {
      if (op.busy || !this.live.has(op.grant)) continue;
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

  /** End a live operation: release its DH approval, remember why until the process ends, tell the sink. */
  end(op: LiveIssuance, state: IssuanceEndState, reason: string): void {
    this.release(op);
    this.ended.set(op.grant, { role: op.role, state, reason });
    this.deps.changes?.push({ kind: "issuance", id: op.grant });
  }

  /** Drop the live entry and the DH approval; a missing approval means the owner already closed. */
  private release(op: LiveIssuance): void {
    this.live.delete(op.grant);
    try {
      op.dh.abandon(op.xid);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
    }
  }

  /**
   * Adopt one Grant an earlier process left resumable, without signing: the holder waits for or verifies the
   * update, an issuer whose update is already accepted finishes. A Grant the exchange can no longer resume is
   * dropped and reads from the stores. False means the Keeper is locked and the Grant is retried.
   */
  private *settle(found: Resumable): Operation<boolean> {
    if (this.live.has(found.grant)) return true;
    try {
      found.hab.mgr.requireRegistryRootAccess();
    } catch (error) {
      if (error instanceof ValidationError) return false;
      throw error;
    }
    try {
      yield* this.adopt(found);
    } catch (error) {
      // A refusal means the stores no longer prove it resumable and status reads from them; anything else is
      // this Grant's failure alone and must not stop the other operations.
      if (!(error instanceof ValidationError)) {
        this.ended.set(found.grant, { role: found.role, state: "failed", reason: message(error) });
        this.deps.changes?.push({ kind: "issuance", id: found.grant });
      }
    }
    return true;
  }

  /** Rebuild the live entry of a resumable Grant from the stored Grant and the held roots. */
  private *adopt({ hab, grant, role }: Resumable): Operation<void> {
    const { retained, credential, deadline, expires } = selectGrant(this, hab, grant, role);
    const wires = role === "issuer" ? yield* grantWires(retained) : null;
    const dh = this.deps.dhkes.dhke(hab), xid = dh.resume(grant);
    this.ended.delete(grant);
    this.live.set(grant, {
      grant,
      xid,
      role,
      deadline,
      hab,
      dh,
      peer: wires ? retained.serder.sad!.ri as string : retained.serder.pre!,
      registry: credential.regid!,
      expires,
      issuer: wires ? { credential, ...wires, query: null, queryAt: 0, sent: true, nextQuery: 0 } : undefined,
      phase: "rootRetained",
      busy: false,
    });
    this.deps.changes?.push({ kind: "issuance", id: grant });
    this.deps.wake?.();
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
    this.deps.changes?.push({ kind: "issuance", id: op.grant });
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
    if (!op.dh.complete(op.xid)) {
      if (issuer?.query && this.deps.clock.now() >= issuer.nextQuery) {
        yield* this.send(op, op.peer, this.current(op, issuer));
        issuer.nextQuery = this.deps.clock.now() + ISSUANCE_QUERY_RESEND_MS;
      }
    } else if (issuer) yield* this.finish(op, issuer);
    else yield* this.receive(op);
    return "stepped";
  }

  /**
   * The query to send now: the signed bytes unchanged while they are timely, so a resend stays a replay the
   * peer's KRAM ignores, and a re-dated one (`Dhke.requery`: same keys and scope, new `dt`, SAID and
   * signatures) once they are older than the single-key window, which KRAM would drop as stale. Re-signing
   * happens only here, inside the live authorisation that began the operation. A group threshold query cannot
   * be re-dated by one member; group issuance is not run here.
   */
  private current(op: LiveIssuance, issuer: NonNullable<LiveIssuance["issuer"]>): Uint8Array {
    const now = this.deps.clock.now(), window = singleKeyQueryWindow(this.deps.hby.db, Dhke.Route);
    if (window !== null && now - issuer.queryAt >= window) {
      issuer.query = op.dh.requery(op.xid);
      issuer.queryAt = now;
    }
    return issuer.query!;
  }

  /**
   * Holder, DH complete: wait for the issuer's registry update, then verify it and finish the Grant. The
   * issuance is then complete but for the holder's separate Admit consent.
   */
  private *receive(op: LiveIssuance): Operation<void> {
    if (this.deps.rgy.store.headEvent(op.registry)?.ilk === "rip") return this.setPhase(op, "rootRetained");
    this.setPhase(op, "proving");
    yield* op.dh.finish(op.xid);
    if (!this.deps.exc.complete(op.grant)) throw new ValidationError("Issued Grant remains unaccepted");
    this.release(op);
    this.deps.changes?.push({ kind: "issuance", id: op.grant });
  }

  /** DH is complete: stage and anchor the BUP under the live authorisation, finish the Grant, send proof support. */
  private *finish(op: LiveIssuance, issuer: NonNullable<LiveIssuance["issuer"]>): Operation<void> {
    const { rgy, receiptor, derived } = this.deps;
    // An accepted update means a restart came after the anchor: never stage a second one. `Dhke.finish` below
    // proves the head opens this credential as issued against the held root, or the issuance fails.
    if (rgy.store.headEvent(op.registry)?.ilk === "rip") {
      this.setPhase(op, "awaitingAnchor");
      const reg = rgy.regs.get(op.registry)!;
      const custody = new RegistryCustody({ hby: this.deps.hby, hab: op.hab, registry: rgy.store, store: derived });
      const author = new RegistryAuthor(rgy, receiptor, custody);
      const { event } = author.stage(reg, issuer.credential, "issued", { auths: issuer.auths });
      yield* author.anchor(reg, event, issuer.auths);
    }
    this.setPhase(op, "proving");
    yield* op.dh.finish(op.xid);
    if (!this.deps.exc.complete(op.grant)) throw new ValidationError("Issued Grant remains unaccepted");
    yield* this.send(op, op.peer, this.discloser.proofSupport(issuer.raw, op.hab));
    this.release(op);
    this.deps.changes?.push({ kind: "issuance", id: op.grant });
  }
}

/** Whether the clock has reached a Grant deadline in microseconds since the epoch. */
function reached(deps: Pick<IssuanceDeps, "clock">, expires: bigint | null): boolean {
  return expires !== null && BigInt(deps.clock.now()) * 1000n >= expires;
}

/**
 * Whether a restarted process can complete this Grant without a new key exchange: it is pending inside its
 * deadline, `hab` is the party `role` names, and {@link resumableExchange} finds the roots. An issuer
 * additionally needs its update already accepted; one that is not anchored cannot be resumed, since the
 * anchor would be signed after the restart. A pure read of stores.
 */
function resumable(deps: IssuanceDeps, hab: Hab, grant: string, role: IssuanceRole): boolean {
  const scope = resumableExchange({ hab, exc: deps.exc }, grant);
  if (!scope || (scope.issuer === hab.pre) !== (role === "issuer")) return false;
  return role === "holder" || scope.registries.every((r) => deps.rgy.store.headEvent(r)?.ilk === "bup");
}

/** The v2 Grant behind `grant` and the local parties to it, or null when it is not a Grant this runtime is party to. */
function grantParties(deps: IssuanceDeps, grant: string) {
  const db = deps.hby.db, serder = db.exns.get([grant]) ?? db.epse.get([grant]);
  if (!serder || serder.said !== grant || serder.route !== "/ipex/grant" || serder.pvrsn.major < 2) return null;
  const sender = serder.pre, recipient = serder.sad?.ri;
  const issuer = typeof sender === "string" ? deps.hby.habs.get(sender) : undefined;
  const holder = typeof recipient === "string" ? deps.hby.habs.get(recipient) : undefined;
  return issuer || holder ? { serder, issuer, holder } : null;
}

/**
 * Every pending Grant the stores prove a restarted process can finish: one scan of the pending exchange
 * escrow, made once when the owner first runs. A pure read.
 */
function resumableGrants(deps: IssuanceDeps): Resumable[] {
  const found: Resumable[] = [];
  for (const [[grant]] of [...deps.hby.db.epse.getTopItemIter()]) {
    const parties = grantParties(deps, grant);
    if (!parties) continue;
    if (parties.issuer && resumable(deps, parties.issuer, grant, "issuer")) {
      found.push({ hab: parties.issuer, grant, role: "issuer" });
    } else if (parties.holder && resumable(deps, parties.holder, grant, "holder")) {
      found.push({ hab: parties.holder, grant, role: "holder" });
    }
  }
  return found;
}

/** The terminal reading of a pending Grant no process can complete: ended by a restart, or by another exchange. */
function orphaned(deps: IssuanceDeps, hab: Hab, grant: string): ["interrupted", string] {
  const credential = deps.exc.retainedInput(grant)?.nests?.[0]?.body;
  const registry = credential instanceof SerderACDC ? credential.regid : undefined;
  if (registry && hab.mgr.hasRegistryRoot(hab.pre!, registry) && !registryUncommitted(deps.rgy.store, registry)) {
    return ["interrupted", COMMITTED];
  }
  return ["interrupted", RESTARTED];
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
  if (ops.live.has(grant) || deps.exc.complete(grant)) {
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
  return { raw, grantWire: yield* storedExchangeWire(retained) };
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
  const dh = deps.dhkes.dhke(hab), xid = dh.approve(grant), query = dh.start(grant);
  ops.ended.delete(grant);
  ops.live.set(grant, {
    grant,
    xid,
    role: "issuer",
    deadline,
    hab,
    dh,
    peer: retained.serder.sad!.ri as string,
    registry: credential.regid!,
    expires,
    issuer: { credential, raw, grantWire, query, queryAt: deps.clock.now(), auths, sent: false, nextQuery: 0 },
    phase: "exchangingKeys",
    busy: false,
  });
  deps.changes?.push({ kind: "issuance", id: grant });
  deps.wake?.();
  return { grant, xid };
}

/**
 * Pure read of one issuance: what ended in this process, the live table, and otherwise what the protocol
 * stores prove (see the module doc for the table and what a reload loses). A pending Grant no live
 * operation holds reads `interrupted` (or `expired` once the Grant deadline has passed); that is a
 * statement, not a write.
 *
 * @throws ValidationError when `grant` is not a v2 Grant this runtime's identifiers are party to.
 */
export function issuanceStatus(
  ops: Pick<IssuanceOperations, "deps" | "live" | "ended">,
  grant: string,
): IssuanceStatus {
  const { deps } = ops, ended = ops.ended.get(grant), live = ops.live.get(grant);
  if (ended) return { state: ended.state, role: ended.role, reason: ended.reason };
  if (live && !reached(deps, live.expires)) {
    return { state: "active", role: live.role, phase: live.phase, deadline: live.deadline };
  }
  const parties = grantParties(deps, grant);
  if (!parties) throw new ValidationError("No issuance was begun for this Grant");
  const { serder, issuer, holder } = parties, db = deps.hby.db;
  if (deps.exc.complete(grant)) {
    const admitted = !!db.erpy.get([grant]);
    if (!holder || (issuer && !admitted)) return { state: "done", role: "issuer", phase: "issued" };
    if (admitted) return { state: "done", role: "holder", phase: "admitted" };
    return { state: "active", role: "holder", phase: "awaitingAdmitConsent", needs: "admit" };
  }
  const deadline = deps.exc.exchangeDeadline(serder), expires = timestampMicros(deadline);
  if (!deadline || expires === null) throw new ValidationError("No issuance was begun for this Grant");
  const role: IssuanceRole = issuer ? "issuer" : "holder", hab = (issuer ?? holder)!;
  if (reached(deps, expires)) {
    const credential = deps.exc.retainedInput(grant)?.nests?.[0]?.body;
    const registry = credential instanceof SerderACDC ? credential.regid : undefined;
    const late = role === "holder" && registry && deps.rgy.store.headEvent(registry)?.ilk === "bup";
    return { state: "expired", role, reason: late ? EXPIRED_LATE : EXPIRED };
  }
  if (resumable(deps, hab, grant, role)) return { state: "active", role, phase: "rootRetained", deadline };
  if (role === "holder" && !heldRoot(deps, hab, grant)) {
    if (!deps.exc.retainedInput(grant, { pending: true })) {
      throw new ValidationError("No issuance was begun for this Grant");
    }
    return { state: "active", role, phase: "awaitingExchangeConsent", needs: "exchange", deadline };
  }
  const [state, reason] = orphaned(deps, hab, grant);
  return { state, role, reason };
}

/** Whether `hab` holds a registry root for the credential registry this Grant discloses. */
function heldRoot(deps: IssuanceDeps, hab: Hab, grant: string): boolean {
  const credential = deps.exc.retainedInput(grant)?.nests?.[0]?.body;
  const registry = credential instanceof SerderACDC ? credential.regid : undefined;
  return !!registry && hab.mgr.hasRegistryRoot(hab.pre!, registry);
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
  ops: Pick<IssuanceOperations, "deps" | "live" | "ended">,
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
  ops.ended.delete(grant);
  ops.live.set(grant, {
    grant,
    xid,
    role: "holder",
    deadline,
    hab,
    dh,
    peer: retained.serder.pre!,
    registry: credential.regid!,
    expires,
    phase: "exchangingKeys",
    busy: false,
  });
  deps.changes?.push({ kind: "issuance", id: grant });
  deps.wake?.();
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
 * a Grant finished by this module and for any other accepted v2 Grant. Returns
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
  if (deps.hby.db.erpy.get([grant])) throw new ValidationError("Issuance cannot be admitted in its state");
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
 * this operation) and read `abandoned` until the process ends. Does not message the peer and does
 * not undo a retained root or a registry update that was already anchored.
 * Does nothing to an issuance that is already done or ended.
 *
 * @throws ValidationError when no issuance was begun for `grant`.
 */
export function abandonIssuance(ops: IssuanceOperations, grant: string, reason = "Abandoned by the user"): void {
  const status = issuanceStatus(ops, grant);
  if (status.state !== "active") return;
  const live = ops.live.get(grant);
  if (live) ops.end(live, "abandoned", reason);
  else {
    ops.ended.set(grant, { role: status.role, state: "abandoned", reason });
    ops.deps.changes?.push({ kind: "issuance", id: grant });
  }
}
