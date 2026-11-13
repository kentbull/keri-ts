/**
 * Runtime-owned operations for single-signature v2 IPEX presentation.
 *
 * `present` is the user's one explicit consent: it selects the credential view, signs the Offer, Grant,
 * Apply, Agree or Spurn (a Grant may also anchor its presentation proof under that same consent), takes
 * the signed exchange into local authenticated intake and queues it. It returns after local commit and
 * never waits for the peer. `PresentationOperations.processOnce` is the only worker: it delivers the
 * already signed bytes, retries a failed delivery with a doubling delay until the exchange's deadline
 * and ends the operation at the Grant's original exchange deadline. It never signs.
 *
 * There is no operation store. The signed exchange is itself durable (the accepted exchange and its
 * signatures), and `resendPresentation` rebuilds its wire from those stored factors, signing nothing, so
 * a process that ended before or during delivery can deliver again on the user's explicit request. Nothing
 * is sent after a restart on its own.
 *
 * Status is the live table plus what the stores prove. Delivery itself leaves no protocol record, so
 * only the peer's stored answer proves it:
 *
 * | stores prove                                              | status                                       |
 * | --------------------------------------------------------- | -------------------------------------------- |
 * | the peer's answer is stored (`erpy`)                      | `done`, with the `response`                  |
 * | signed exchange accepted, deadline passed, no answer      | `expired`                                    |
 * | signed exchange accepted, no answer, not live             | `interrupted`: `resendPresentation` delivers |
 *
 * Lost on reload, by design: the delivery attempts and the last transport failure, the `abandoned` and
 * `failed` end states with their reasons, the delivery destinations, and the fact of a delivery nobody
 * answered (it reads `done` in the process that delivered it and `interrupted` after a reload; sending it
 * again is harmless, the peer deduplicates by SAID).
 *
 * Workflow-contract shape (`app/runtime/workflow-contract.ts`): `present` returns after local commit,
 * `presentationStatus` is a pure read, `waitForPresentation` only observes and returns a `WaitResult`, and
 * `abandonPresentation` is local. A host that wants only the signed bytes (a file, a QR code) uses
 * `preparePresentation`, which commits locally and queues nothing.
 *
 * Group identifiers are refused here: a group presents through {@link proposeGroupPresentation}, which hands the
 * frozen Grant to the group IPEX owner (`group-ipex.ts`) for member approval.
 */
import {
  collectPayload,
  concatBytes,
  Counter,
  framePayload,
  parseBytes,
  type SerderACDC,
  type SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { action, call, type Operation, race } from "npm:effection@^3.6.0";
import { type DerivedUpdateStore, RegistryCustody } from "../../acdc/custody.ts";
import type { Regery } from "../../acdc/registraring.ts";
import { ValidationError } from "../../core/errors.ts";
import { timestampMicros } from "../../time/mod.ts";
import { registryEventRef } from "../credentials/registry-settling.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { type CounselInputs } from "../multisig/counseling.ts";
import { isLocalGroupHab, localGroupMember } from "../multisig/group-members.ts";
import { proposeRegistryEvent } from "../multisig/proposing.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { Reactor } from "../protocol/reactor.ts";
import { DeliveryOutbox } from "../runtime/delivery-outbox.ts";
import type { RetryPolicy } from "../runtime/retry-backoff.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { type ChangeSink, observeUntil, waitOnClock, type WaitResult } from "../runtime/workflow-contract.ts";
import type { Receiptor, WitnessAuthMap } from "../witness/receipting.ts";
import {
  type GroupIpexBegun,
  type GroupIpexOperations,
  proposeGroupIpex,
  proposeGroupIpexAfter as groupIpexAfter,
} from "./group-ipex.ts";
import type { IpexV2BodyOptions } from "./ipex-building.ts";
import {
  type CredentialViews,
  type DisclosureSelection,
  IpexDiscloser,
  type PreparedDisclosure,
  storedExchangeWire,
} from "./ipex-discloser.ts";
import { prepareAcdcV2GroupIpex } from "./ipex-grouping.ts";
import type { IssuanceDelivery } from "./issuance.ts";

/** How long delivery failures may last on an exchange with no deadline (an Apply, an Agree) before it reads `failed`. */
export const PRESENTATION_RETRY_BOUND_MS = 600_000;

/** The signed IPEX message a presentation operation sends. */
export type PresentationVerb = "apply" | "offer" | "agree" | "spurn" | "grant";

/** Terminal states that are not delivery; each carries a reason. */
export type PresentationEndState = "abandoned" | "interrupted" | "expired" | "failed";

/** The peer's stored answer to a delivered exchange, read from the retained response index. */
export interface PresentationResponse {
  said: string;
  route: string | null;
}

/** Status of one presentation, discriminated on `state`. A pure read. */
export type PresentationStatus =
  | {
    state: "active";
    verb: PresentationVerb;
    phase: "delivering";
    deadline?: string;
    /** Consecutive delivery failures; the delivery is retried with a doubling delay. */
    attempts: number;
    /** The last transport failure. */
    blocked?: string;
  }
  | {
    state: "done";
    verb: PresentationVerb;
    phase: "delivered";
    /** Where the transport reached; known only to the process that delivered it. */
    deliveries?: readonly string[];
    response?: PresentationResponse;
  }
  | { state: PresentationEndState; verb: PresentationVerb; reason: string };

/** Narrow collaborators of the presentation owner. Hosts adapt their runtime to this once. */
export interface PresentationDeps {
  readonly hby: Habery;
  /** Registry environment: its public store and the local presentation registries by name. */
  readonly rgy: Pick<Regery, "store" | "registryByName">;
  readonly exc: Exchanger;
  /** Receipt collector for an anchored exchange; its genus selects the witness protocol version. */
  readonly receiptor: Receiptor;
  /** Local intake of what this identifier signs. */
  readonly reactor: Pick<Reactor, "processBytes">;
  readonly protocol: Pick<ProtocolProcessor, "processEscrowsOnce">;
  readonly delivery: IssuanceDelivery;
  /** Delivery retry delays; the production policy when absent. */
  readonly retry?: Readonly<RetryPolicy>;
  /** Same clock the exchanger was composed with. */
  readonly clock: RuntimeClock;
  /** Embedder inventory for selecting an issued credential or a retained Grant. */
  readonly views?: CredentialViews;
  /** Derivation coordinates, needed only for a selection with `derive`. */
  readonly derived?: DerivedUpdateStore;
  readonly changes?: ChangeSink;
}

/** Body options of a selecting message, plus the presentation registry that carries a Grant's proof. */
export interface PresentationOptions extends IpexV2BodyOptions {
  priorSaid?: string;
  auths?: WitnessAuthMap;
  /** Alias of a local registry whose presented-state update this Grant anchors. */
  presentationRegistry?: string;
}

/** What the user presents. Selecting verbs name a credential view; replies name the exchange they answer. */
export type PresentationInput =
  | { verb: "offer"; hab: Hab; selection: DisclosureSelection; options: PresentationOptions }
  | { verb: "grant"; hab: Hab; selection: DisclosureSelection; options: PresentationOptions }
  | { verb: "apply"; hab: Hab; options: IpexV2BodyOptions }
  | {
    verb: "agree" | "spurn";
    hab: Hab;
    /** SAID of the accepted, authenticated exchange being answered. */
    prior: string;
    message?: string;
    recipient?: string;
    auths?: WitnessAuthMap;
  };

/** A signed exchange accepted locally, with the bytes in delivery order. */
export interface PreparedPresentation {
  exn: SerderKERI;
  /** Sender KEL, proof support and the exchange. */
  wire: Uint8Array;
  recipient: string;
}

/** What `present` selected. */
export interface PresentationBegun {
  said: string;
  recipient: string;
  /** The signed bytes, for a host that also wants to file them. */
  wire: Uint8Array;
}

/** A signed exchange to deliver: what the sender, the recipient and the transport need. */
interface QueuedPresentation {
  /** SAID of the signed exchange. */
  readonly said: string;
  readonly verb: PresentationVerb;
  readonly hab: Hab;
  /** The identifier whose endpoint sends it: the sender, or a group's local member. */
  readonly src?: string;
  readonly recipient: string;
  readonly wire: Uint8Array;
  /** The exchange's original deadline (ISO 8601), for an exchange that has one. */
  readonly deadline?: string;
}

/** One delivery in progress; exists only while it is live in this process. */
interface LivePresentation extends QueuedPresentation {
  readonly expires: bigint | null;
  /** The signed bytes, delivered with retry; a failure waits for a later pass instead of ending the delivery. */
  readonly outbox: DeliveryOutbox;
  /** A delivery is running; overlapping `processOnce` calls skip it. */
  busy: boolean;
}

/** What a presentation that ended or delivered in this process reports until the process ends. */
type SettledPresentation =
  | { verb: PresentationVerb; state: PresentationEndState; reason: string }
  | { verb: PresentationVerb; state: "done"; deliveries: readonly string[] };

const EXPIRED = "The presentation reached its original exchange deadline";
const PENDING = "ACDC v2 exchange remains pending authenticated intake.";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether the exchange's deadline has passed; an exchange without one never lapses. */
function lapsed(clock: RuntimeClock, deadline?: string): boolean {
  const expiry = timestampMicros(deadline);
  return expiry !== null && BigInt(clock.now()) * 1000n >= expiry;
}

/** The live deliveries table and its driver. One per host runtime; every identifier may present through it. */
export class PresentationOperations {
  /** Deliveries live in this process. Internal to this module's functions. */
  readonly live = new Map<string, LivePresentation>();
  /** Presentations that delivered or ended in this process; not durable, see the module doc. */
  readonly settled = new Map<string, SettledPresentation>();

  constructor(readonly deps: PresentationDeps) {}

  /** Whether a delivery is live. */
  active(): boolean {
    return this.live.size > 0;
  }

  /** Advance every live delivery by one pass. */
  *processOnce(): Operation<void> {
    const { deps } = this;
    for (const op of [...this.live.values()]) {
      if (op.busy || !this.live.has(op.said)) continue;
      op.busy = true;
      try {
        const left = op.expires === null ? null : op.expires - BigInt(deps.clock.now()) * 1000n;
        if (left !== null && left <= 0n) this.end(op, "expired", EXPIRED);
        else if ((yield* race([this.deliver(op), this.timer(left)])) === "expired") this.end(op, "expired", EXPIRED);
      } finally {
        op.busy = false;
      }
    }
  }

  /** End a live delivery: drop it, remember why until the process ends, tell the sink. */
  end(op: LivePresentation, state: PresentationEndState, reason: string): void {
    this.live.delete(op.said);
    this.settled.set(op.said, { verb: op.verb, state, reason });
    this.deps.changes?.push({ kind: "presentation", id: op.said });
  }

  /** Resolves only when the deadline passes; never resolves for an exchange without one. */
  private *timer(left: bigint | null): Operation<"expired" | "waiting"> {
    if (left === null) return yield* action<never>(() => () => {});
    yield* waitOnClock(this.deps.clock, Number(left) / 1000);
    return "expired";
  }

  /**
   * One attempt: a failure keeps the bytes and is retried after a doubling delay until the exchange's deadline,
   * or, for an exchange with none, until failures have lasted {@link PRESENTATION_RETRY_BOUND_MS}.
   */
  private *deliver(op: LivePresentation): Operation<void> {
    const { deps } = this;
    try {
      const done = yield* op.outbox.drain(
        deps.delivery,
        deps.clock,
        op.expires === null ? PRESENTATION_RETRY_BOUND_MS : undefined,
      );
      if (!done) {
        deps.changes?.push({ kind: "presentation", id: op.said });
        return;
      }
    } catch (error) {
      this.end(op, "failed", message(error));
      return;
    }
    this.live.delete(op.said);
    this.settled.set(op.said, { verb: op.verb, state: "done", deliveries: op.outbox.delivered });
    deps.changes?.push({ kind: "presentation", id: op.said });
  }
}

const RESEND =
  "Delivery is not recorded across a restart and no answer is stored; resendPresentation delivers it again";

/** The discloser for one sender; derivation needs custody over the sender's own Keeper root. */
function discloserFor(deps: PresentationDeps, hab: Hab, derive?: boolean): IpexDiscloser {
  let custody: RegistryCustody | undefined;
  if (derive) {
    if (!deps.derived) throw new ValidationError("Derived disclosure requires the embedder's derivation store.");
    custody = new RegistryCustody({ hby: deps.hby, hab, registry: deps.rgy.store, store: deps.derived });
  }
  return new IpexDiscloser(deps.hby, deps.rgy.store, deps.exc, deps.receiptor, custody, deps.views);
}

/**
 * Sign the selected message and take it into local authenticated intake, without recording an operation or
 * delivering. This is the whole consent: the returned bytes are final.
 *
 * @throws ValidationError for a group identifier, an unknown presentation registry, a selection the discloser
 * refuses, or an exchange that does not reach authenticated intake.
 */
export function* preparePresentation(
  deps: PresentationDeps,
  input: PresentationInput,
): Operation<PreparedPresentation> {
  const { hab } = input;
  let presentation;
  if (input.verb === "grant" && input.options.presentationRegistry) {
    presentation = deps.rgy.registryByName(input.options.presentationRegistry);
    if (!presentation) throw new ValidationError("Unknown presentation registry.");
  }
  const discloser = discloserFor(deps, hab, "selection" in input ? input.selection.derive : undefined);
  const sender = hab.pre!;
  let prepared: PreparedDisclosure;
  switch (input.verb) {
    case "apply":
      prepared = yield* discloser.prepareApply(sender, input.options);
      break;
    case "agree":
    case "spurn":
      prepared = yield* discloser.prepareReply(
        sender,
        input.verb,
        input.prior,
        input.message ?? "",
        input.recipient,
        input.auths,
      );
      break;
    case "offer":
      prepared = yield* discloser.prepareOffer(sender, input.selection, input.options);
      break;
    case "grant":
      prepared = yield* discloser.prepareGrant(sender, input.selection, {
        ...input.options,
        presentation: presentation ?? undefined,
      });
      break;
  }
  const wire = concatBytes(discloser.kel(hab), prepared.support, prepared.wire);
  yield* deps.reactor.processBytes(wire, { local: true });
  yield* deps.protocol.processEscrowsOnce();
  if (!deps.exc.complete(prepared.exn.said!)) throw new ValidationError(PENDING);
  return { exn: prepared.exn, wire, recipient: prepared.exn.sad!.ri as string };
}

/** What a group presents and how: the view, the Grant body options and the registry update's counseling. */
export interface GroupPresentationInput {
  hab: Hab;
  selection: DisclosureSelection;
  options: PresentationOptions;
  /** False when the caller takes the completed Grant itself (a file) and the lead must not send it. */
  deliver?: boolean;
  /** Counseling choices for the registry update's anchor. */
  counsel?: CounselInputs;
}

/**
 * A group's consent to present an accepted Grant or credential view: freezes the Grant body once (selection and
 * authorization) and proposes it as a group-authored message, so the other members list and approve it with
 * `approveGroupIpex` and the elected lead delivers the completed Grant. Returns after local commit.
 *
 * With `options.presentationRegistry` the Grant carries a presented-state proof: this member also proposes the
 * registry update that anchors it (`proposeRegistryEvent`; the other members approve that proposal with
 * `approveGroupProposal`), and the owner signs this member's contribution to the Grant once the group has accepted
 * the update, under this same consent.
 *
 * @throws ValidationError for an identifier that is not a local group, an unknown presentation registry, a
 * selection the discloser refuses, or a message awaiting authenticating dependencies.
 */
export function* proposeGroupPresentation(
  deps: PresentationDeps,
  groupIpex: GroupIpexOperations,
  { hab, selection, options, deliver, counsel }: GroupPresentationInput,
): Operation<GroupIpexBegun> {
  const { presentationRegistry, ...body } = options;
  const gvrsn = body.gvrsn ?? undefined;
  const discloser = discloserFor(deps, hab, selection.derive);
  let prepared = yield* discloser.prepareGrantBody(hab.pre!, selection, body);
  if (!presentationRegistry) {
    return yield* proposeGroupIpex(groupIpex, { hab, exn: prepared.exn, nests: prepared.nests, gvrsn, deliver });
  }
  const reg = deps.rgy.registryByName(presentationRegistry);
  if (!reg) throw new ValidationError("Unknown presentation registry.");
  const node = parseBytes(prepared.raw)[0].body as SerderACDC;
  if (reg.hab.pre !== hab.pre || node.issuee !== hab.pre || (node.sad!.a as { rd?: unknown }).rd !== reg.regk) {
    throw new ValidationError("Presentation registry must match the selected disclosed local Issuee declaration.");
  }
  const proposals = groupIpex.deps.registry;
  if (!proposals) throw new ValidationError("This owner was composed without group registry collaborators");
  // The Grant SAID is frozen before the update is anchored; only its nested proof is extended afterwards.
  const [proof, update] = reg.present(prepared.exn, "presented", { stamp: body.stamp });
  const proposed = yield* proposeRegistryEvent(proposals, hab, update, proof, counsel);
  const exn = prepared.exn;
  return groupIpexAfter(groupIpex, {
    hab,
    exn,
    gvrsn,
    deliver,
    prerequisite: {
      anchor: registryEventRef(update, proposed.event),
      *proceed() {
        const seal = deps.rgy.store.anchor(update.said!);
        if (!seal) throw new ValidationError("The presentation update is accepted but its anchor is unavailable");
        prepared = yield* discloser.attachPresentationProof(prepared, proof, { s: seal[0], d: seal[1] });
        const candidate = concatBytes(
          Counter.makeGVC(gvrsn ?? Vrsn_2_0),
          prepared.exn.raw,
          Counter.enclose({ qb64: prepared.nests, version: gvrsn ?? Vrsn_2_0 }),
        );
        const own = yield* prepareAcdcV2GroupIpex(deps.hby, groupIpex.deps.protocol, hab, candidate);
        if (!own) throw new ValidationError("ACDC v2 group disclosure awaits authenticating dependencies.");
        return own;
      },
    },
  });
}

/** A completed prepared Grant ready for the elected lead to deliver. */
export interface PreparedGrantDelivery {
  hab: Hab;
  said: string;
  /** Proof support and the completed Grant, in delivery order. */
  delivery: Uint8Array;
}

/**
 * Deliver a group's completed prepared Grant ({@link resumePresentationFile}): queues the delivery bytes for
 * `processOnce` when the local member is the elected lead, with the retry and deadline of any presentation. Signs
 * nothing. Returns null for a member that is not the lead.
 */
export function deliverPreparedGrant(
  ops: PresentationOperations,
  { hab, said, delivery }: PreparedGrantDelivery,
): PresentationBegun | null {
  const { deps } = ops, serder = deps.exc.retainedInput(said)?.serder;
  if (!serder || serder.pre !== hab.pre) throw new ValidationError("Delivery selects the group's own prepared Grant");
  if (!deps.exc.lead(hab, said, { pendingPresentation: true })) return null;
  const recipient = String(serder.sad!.ri), deadline = deps.exc.exchangeDeadline(serder) ?? undefined;
  const src = isLocalGroupHab(deps.hby, hab) ? localGroupMember(deps.hby, hab.pre!).pre! : hab.pre!;
  queue(ops, { said, verb: "grant", hab, src, recipient, wire: delivery, deadline });
  deps.changes?.push({ kind: "presentation", id: said });
  return { said, recipient, wire: delivery };
}

/**
 * The user's consent to present: signs and takes the message into local intake ({@link preparePresentation}),
 * records the operation and queues the signed bytes for `processOnce` to deliver. Returns after local commit.
 */
export function* present(
  ops: PresentationOperations,
  input: PresentationInput,
): Operation<PresentationBegun> {
  const { deps } = ops;
  const { exn, wire, recipient } = yield* preparePresentation(deps, input);
  const said = exn.said!, deadline = deps.exc.exchangeDeadline(exn) ?? undefined;
  queue(ops, { said, verb: input.verb, hab: input.hab, recipient, wire, deadline });
  deps.changes?.push({ kind: "presentation", id: said });
  return { said, recipient, wire };
}

function queue(ops: PresentationOperations, op: QueuedPresentation): void {
  const outbox = new DeliveryOutbox(ops.deps.retry);
  outbox.enqueue({ src: op.src ?? op.hab.pre!, dest: op.recipient, msg: op.wire });
  ops.settled.delete(op.said);
  ops.live.set(op.said, { ...op, expires: timestampMicros(op.deadline), outbox, busy: false });
}

/** The signed exchange of a local sender, with the verb its route names. */
function signed(deps: PresentationDeps, said: string) {
  const serder = deps.hby.db.exns.get([said]), hab = serder?.pre ? deps.hby.habs.get(serder.pre) : undefined;
  const verb = serder?.route?.startsWith("/ipex/") ? serder.route.slice("/ipex/".length) : undefined;
  if (!serder || !hab || !["apply", "offer", "agree", "spurn", "grant"].includes(verb ?? "")) {
    throw new ValidationError("No presentation was begun for this exchange");
  }
  return { serder, hab, verb: verb as PresentationVerb };
}

/**
 * Pure read of one presentation: the live table, what ended or delivered in this process, and what the stored
 * exchanges prove (the peer's answer, when one was stored; see the module doc for what a reload loses). A
 * signed exchange no live delivery holds and nobody answered reads `interrupted`, or `expired` past its
 * deadline; that is a statement, not a write.
 *
 * @throws ValidationError when `said` is not a presentation exchange a local identifier signed.
 */
export function presentationStatus(
  ops: PresentationOperations,
  said: string,
): PresentationStatus {
  const { deps } = ops, ended = ops.settled.get(said), live = ops.live.get(said);
  const answered = (verb: PresentationVerb, deliveries?: readonly string[]): PresentationStatus => {
    const answer = deps.hby.db.erpy.get([said])?.qb64;
    const response = answer ? { said: answer, route: deps.hby.db.exns.get([answer])?.route ?? null } : undefined;
    return { state: "done", verb, phase: "delivered", deliveries, response };
  };
  if (ended && ended.state !== "done") return { state: ended.state, verb: ended.verb, reason: ended.reason };
  if (ended) return answered(ended.verb, ended.deliveries);
  if (live && !lapsed(deps.clock, live.deadline)) {
    return {
      state: "active",
      verb: live.verb,
      phase: "delivering",
      deadline: live.deadline,
      attempts: live.outbox.attempts,
      blocked: live.outbox.lastError === null ? undefined : message(live.outbox.lastError),
    };
  }
  const { serder, verb } = signed(deps, said);
  if (deps.hby.db.erpy.get([said])) return answered(verb);
  if (lapsed(deps.clock, deps.exc.exchangeDeadline(serder) ?? undefined)) {
    return { state: "expired", verb, reason: EXPIRED };
  }
  return { state: "interrupted", verb, reason: RESEND };
}

/** Options for {@link waitForPresentation}. */
export interface PresentationWaitOptions {
  /** Wall-clock budget. */
  timeoutMs: number;
  clock?: RuntimeClock;
  /** Settle on this instead of any non-active state. */
  until?: (status: PresentationStatus) => boolean;
}

/**
 * Observe until the presentation is delivered or ended, or the budget expires. Starts no worker and drives
 * nothing: someone else must call `processOnce`.
 */
export function* waitForPresentation(
  ops: PresentationOperations,
  said: string,
  { timeoutMs, clock = ops.deps.clock, until = (status) => status.state !== "active" }: PresentationWaitOptions,
): Operation<WaitResult<PresentationStatus>> {
  const settled = yield* observeUntil(() => until(presentationStatus(ops, said)), { timeoutMs, clock });
  const status = presentationStatus(ops, said);
  return settled ? { outcome: "settled", status } : { outcome: "timed-out", status, timeoutMs };
}

/**
 * Local abandon: stop delivering and read `abandoned` until the process ends. Does not message the peer and
 * does not retract an exchange already delivered. Does nothing to a presentation that is already delivered
 * or ended.
 *
 * @throws ValidationError when `said` is not a presentation exchange a local identifier signed.
 */
export function abandonPresentation(
  ops: PresentationOperations,
  said: string,
  reason = "Abandoned by the user",
): void {
  const status = presentationStatus(ops, said);
  if (status.state === "done" || status.state === "abandoned" || status.state === "failed") return;
  const live = ops.live.get(said);
  if (live) ops.end(live, "abandoned", reason);
  else {
    ops.settled.set(said, { verb: status.verb, state: "abandoned", reason });
    ops.deps.changes?.push({ kind: "presentation", id: said });
  }
}

/**
 * Deliver a presentation again after a restart, or after delivery failed or was abandoned: rebuilds the wire
 * of the stored signed exchange from its retained signatures or source seal and nests, so the bytes are the
 * ones first delivered and nothing is signed. Queues them like `present`, with a fresh outbox; return
 * is after the queueing, not after delivery.
 *
 * @throws ValidationError for an exchange no local identifier signed, one the peer already answered, one past
 * its deadline, one already being delivered, or one whose retained factors no longer authenticate.
 */
export function* resendPresentation(
  ops: PresentationOperations,
  said: string,
): Operation<PresentationBegun> {
  const { deps } = ops, { serder, hab, verb } = signed(deps, said);
  const status = presentationStatus(ops, said);
  if (status.state === "active") throw new ValidationError("This presentation is already being delivered");
  if (deps.hby.db.erpy.get([said])) throw new ValidationError("The peer already answered this presentation");
  const deadline = deps.exc.exchangeDeadline(serder) ?? undefined;
  if (lapsed(deps.clock, deadline)) throw new ValidationError(EXPIRED);
  const retained = deps.exc.retainedInput(said);
  if (!retained) throw new ValidationError("The signed exchange no longer authenticates from stored factors");
  const discloser = discloserFor(deps, hab);
  let support: Uint8Array = new Uint8Array();
  if (verb === "grant") {
    const raw = concatBytes(
      Counter.makeGVC(Vrsn_2_0),
      ...yield* call(() => Promise.all((retained.nests ?? []).map((nest) => collectPayload(framePayload(nest))))),
    );
    support = discloser.proofSupport(raw, hab);
  } else if (verb === "agree" && retained.sourceSeals?.length) support = discloser.kel(hab);
  const wire = concatBytes(discloser.kel(hab), support, yield* storedExchangeWire(retained));
  const recipient = String(serder.sad!.ri);
  queue(ops, { said, verb, hab, recipient, wire, deadline });
  deps.changes?.push({ kind: "presentation", id: said });
  return { said, recipient, wire };
}
