/**
 * Delegation request handling and delegated-event approval workflow support.
 *
 * KERIpy correspondence:
 * - `DelegateRequestHandler` mirrors the notification-facing exchange handler
 *   in `keri.app.delegating`
 * - `Anchorer` mirrors the approval workflow role of KERIpy's `Anchorer`
 *
 * `keri-ts` difference:
 * - workflow progress is explicit turn-based escrow processing instead of a
 *   long-lived HIO doer
 * - proxy communication is a selected local habitat, not an implicit runtime
 *   side effect
 */
import { Diger, type SerderKERI } from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";
import type { QueryRequest } from "../../core/cues.ts";
import { ValidationError } from "../../core/errors.ts";
import { DELEGATE_MAILBOX_TOPIC, REPLAY_MAILBOX_TOPIC } from "../../core/mailbox/mailbox-topics.ts";
import { Schemes } from "../../core/schemes.ts";
import { dgKey } from "../../db/core/keys.ts";
import { type Poster } from "../delivery/forwarding.ts";
import { createExchangeMessage } from "../exchanges/exchange-messaging.ts";
import type { ExchangeAttachment, Exchanger, ExchangeRouteHandler } from "../exchanges/exchanging.ts";
import type { Notifier } from "../notifications/notifying.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import type { HttpClient } from "../transport/http-client.ts";
import { sendWitnessMessage } from "../witness/witnessing.ts";
import { eventPayloadMessage, eventReplayMessage, type Hab, type Habery } from "./habbing.ts";

export const DELEGATE_REQUEST_ROUTE = "/delegate/request";

/** Runtime passes to wait between repeated delegator-witness anchor queries. */
const DELEGATION_ANCHOR_QUERY_RETRY_PASSES = 8;

/** Durable phase for one delegated event as it moves through approval. */
export type DelegationPhase =
  | "waitingWitnessReceipts"
  | "waitingDelegatorAnchor"
  | "waitingWitnessPublication";

/** One turn-level workflow outcome emitted by `Anchorer.processAllOnce()`. */
export type DelegationWorkflowResult =
  | {
    kind: "keep";
    phase: DelegationPhase;
    pre: string;
    said: string;
    reason: string;
  }
  | {
    kind: "advance";
    pre: string;
    said: string;
    from: DelegationPhase;
    to: DelegationPhase;
    reason: string;
  }
  | {
    kind: "complete";
    pre: string;
    said: string;
    phase: DelegationPhase;
    reason: string;
  }
  | {
    kind: "fail";
    pre: string;
    said: string;
    phase: DelegationPhase;
    reason: string;
  };

export interface DelegationWorkflowStatus {
  phase: DelegationPhase | null;
  proxyDependent: boolean;
  complete: boolean;
}

/** Internal escrow tuple with the durable key and required event fields split out. */
type DelegationEscrowContext = [
  keys: [string, string],
  serder: SerderKERI,
  pre: string,
  said: string,
  snh: string,
];

function eventKey(serder: SerderKERI): [string, string] {
  const pre = serder.pre;
  const snh = serder.snh;
  if (!pre || !snh) {
    throw new ValidationError("Delegated workflow entries require pre and sn.");
  }
  return [pre, snh];
}

function workflowPre(serder: SerderKERI): string {
  if (!serder.pre) {
    throw new ValidationError("Delegated workflow event is missing a prefix.");
  }
  return serder.pre;
}

/** Build the anchor seal shape a delegator must embed in its approving event. */
function eventAnchor(serder: SerderKERI): { i: string; s: string; d: string } {
  if (!serder.pre || !serder.snh || !serder.said) {
    throw new ValidationError(
      "Delegated approval anchor requires pre, sn, and said.",
    );
  }
  return { i: serder.pre, s: serder.snh, d: serder.said };
}

/** Resolve the local habitat that owns the delegated event being processed. */
function workflowHab(hby: Habery, serder: SerderKERI): Hab {
  const pre = serder.pre;
  if (!pre) {
    throw new ValidationError("Delegated workflow event is missing a prefix.");
  }
  const hab = hby.habs.get(pre) ?? null;
  if (!hab) {
    throw new ValidationError(
      `Missing local habitat for delegated workflow ${pre}.`,
    );
  }
  return hab;
}

function localHabByPre(hby: Habery, pre: string, context: string): Hab {
  const hab = hby.habs.get(pre) ?? null;
  if (!hab) {
    throw new ValidationError(`${context}: missing local habitat ${pre}.`);
  }
  return hab;
}

function localGroupMember(hby: Habery, groupPre: string): Hab | null {
  const record = hby.db.getHab(groupPre);
  return record?.mid ? hby.habs.get(record.mid) ?? null : null;
}

function workflowSaid(serder: SerderKERI): string {
  if (!serder.said) {
    throw new ValidationError("Delegated workflow event is missing a SAID.");
  }
  return serder.said;
}

function workflowId(serder: SerderKERI): string {
  const [pre, snh] = eventKey(serder);
  return `${pre}:${snh}`;
}

function firstSorted(values: readonly string[]): string | null {
  return [...values].sort()[0] ?? null;
}

function escrowContext(
  keys: [string, string],
  serder: SerderKERI,
): DelegationEscrowContext {
  const pre = serder.pre;
  const said = serder.said;
  const snh = serder.snh;
  if (!pre || !said || !snh) {
    throw new ValidationError(
      "Delegated workflow escrow entry requires pre, said, and sn.",
    );
  }
  return [keys, serder, pre, said, snh];
}

/** Persist the delegator event seal that authorizes one delegated event. */
function pinAuthorizingSeal(
  hby: Habery,
  delegated: SerderKERI,
  delegating: SerderKERI,
): void {
  const pre = delegated.pre;
  const said = delegated.said;
  const sner = delegating.sner;
  const dig = delegating.said;
  if (!pre || !said || !sner || !dig) {
    throw new ValidationError(
      "Cannot pin delegated authorizing seal without complete event material.",
    );
  }
  hby.db.aess.pin(dgKey(pre, said), [sner, new Diger({ qb64: dig })]);
}

function completionDiger(serder: SerderKERI): Diger {
  const said = workflowSaid(serder);
  return new Diger({ qb64: said });
}

function witnessReceiptsComplete(hby: Habery, serder: SerderKERI): boolean {
  const pre = serder.pre;
  const said = serder.said;
  const kever = pre ? hby.db.getKever(pre) : null;
  if (!pre || !said || !kever) {
    return false;
  }
  return hby.db.wigs.get(dgKey(pre, said)).length >= kever.wits.length;
}

/** Resolve the delegator prefix from event material or accepted delegated state. */
function delegatedWorkflowDelpre(
  hby: Habery,
  serder: SerderKERI,
  hab?: Hab,
): string | null {
  if (serder.delpre) {
    return serder.delpre;
  }
  return (hab ?? workflowHab(hby, serder)).kever?.delpre ?? null;
}

/** Return the local delegator event that contains the delegated event seal. */
function approvingEvent(
  hby: Habery,
  serder: SerderKERI,
  hab?: Hab,
): SerderKERI | null {
  const delpre = delegatedWorkflowDelpre(hby, serder, hab);
  return delpre ? hby.db.fetchLastSealingEventByEventSeal(delpre, eventAnchor(serder)) : null;
}

function preferredWitnessQueryUrl(hab: Hab, witness: string): string | null {
  const urls = hab.fetchUrls(witness);
  return urls[Schemes.https] ?? urls[Schemes.http] ?? urls[Schemes.tcp] ?? null;
}

export function resolveDelegationCommunicationHab(
  hby: Habery,
  alias?: string,
): Hab | undefined {
  if (!alias) {
    return undefined;
  }
  const hab = hby.habByName(alias);
  if (!hab) {
    throw new ValidationError(`Delegation proxy alias ${alias} is invalid.`);
  }
  if (!hab.kever) {
    throw new ValidationError(
      `Delegation proxy ${alias} is missing accepted key state.`,
    );
  }
  return hab;
}

/** Install delegation-specific EXN handlers into one exchange router. */
export function loadDelegationHandlers(
  hby: Habery,
  exchanger: Exchanger,
  notifier: Notifier | null = null,
): void {
  exchanger.addHandler(new DelegateRequestHandler(hby, notifier));
}

/**
 * Peer-to-peer delegation request handler for `/delegate/request` exchange messages.
 *
 * KERIpy correspondence:
 * - this is the local analogue of `keri.app.delegating.DelegateRequestHandler`
 * - the Python handler exists to translate an incoming delegation request EXN
 *   into controller-facing notification data for the local delegator
 * - it does not approve the delegated event itself; approval still happens
 *   later when the local controller anchors the embedded event in its own KEL
 *
 * Local `keri-ts` adaptation:
 * - the handler accepts an EXN that carries `delpre` in the payload and the
 *   delegated event bytes in the `evt` embed
 * - if `delpre` does not belong to a local habitat, the message is ignored
 *   because there is no local delegator controller for the request
 * - on success, the handler only emits notifier state; durable delegation
 *   workflow progression remains the responsibility of `Anchorer` and the
 *   normal event-parsing/approval path
 */
export class DelegateRequestHandler implements ExchangeRouteHandler {
  static readonly resource = DELEGATE_REQUEST_ROUTE;
  readonly resource = DelegateRequestHandler.resource;
  readonly hby: Habery;
  readonly notifier: Notifier | null;

  constructor(
    hby: Habery,
    notifier: Notifier | null = null,
  ) {
    this.hby = hby;
    this.notifier = notifier;
  }

  verify(args: {
    serder: SerderKERI;
    attachments: ExchangeAttachment[];
  }): boolean {
    const payload = args.serder.ked?.a as Record<string, unknown> | undefined;
    const embeds = args.serder.ked?.e as Record<string, unknown> | undefined;
    return typeof payload?.["delpre"] === "string"
      && typeof embeds?.["evt"] === "object"
      && embeds?.["evt"] !== null;
  }

  /** Store a signed controller notification when this request targets a local delegator. */
  handle(args: {
    serder: SerderKERI;
    attachments: ExchangeAttachment[];
  }): void {
    if (!this.notifier) {
      return;
    }

    const src = args.serder.pre;
    const payload = args.serder.ked?.a as Record<string, unknown> | undefined;
    const embeds = args.serder.ked?.e as Record<string, unknown> | undefined;
    const delpre = typeof payload?.["delpre"] === "string" ? payload.delpre : null;
    const evt = embeds?.["evt"];
    if (!src || !delpre || !evt || !this.hby.habs.has(delpre)) {
      return;
    }

    const attrs: Record<string, unknown> = {
      src,
      r: DELEGATE_REQUEST_ROUTE,
      delpre,
      ked: evt,
    };
    if (Array.isArray(payload?.["aids"])) {
      attrs["aids"] = payload.aids;
    }
    this.notifier.add(attrs);
  }
}

/**
 * Delegation workflow coordinator for delegated inception and rotation events.
 *
 * KERIpy correspondence:
 * - this class ports the protocol role of `keri.app.delegating.Anchorer`
 * - the Python `Anchorer` is a `DoDoer` that drives three escrow phases:
 *   waiting for delegate witness receipts, waiting for the delegator's anchor,
 *   and, when needed, waiting for post-approval witness publication
 * - it is the component that turns "delegated event exists locally" into
 *   "delegated event has been presented to the delegator, approved, and
 *   finalized for local completion"
 *
 * Local `keri-ts` adaptation:
 * - this class is not a long-lived DoDoer; it is a deterministic workflow
 *   component run by the shared `AgentRuntime` turn
 * - protocol state still lives in the same durable escrow families used by the
 *   rest of the runtime:
 *   - `dpwe.` for waiting on delegate witness receipts
 *   - `dune.` for waiting on the delegator's authorizing anchor
 *   - `dpub.` for waiting on witness republication after approval
 *   - `cdel.` for completed delegation workflows
 * - outbound correspondence is delegated to `Poster`
 * - delegation-specific anchor discovery stays explicit here and uses
 *   a concrete query producer port; composition owns its consuming worker
 * - witness republication sends the resolved delegator chain directly to the
 *   delegate's witnesses so the flow stays readable against KERIpy
 *
 * Maintainer mental model:
 * - `Anchorer` owns workflow progression, not generic cue delivery and not
 *   low-level event parsing
 * - each call to `processAllOnce()` advances the durable escrows at most one
 *   phase per workflow based on currently known local state
 * - approval becomes authoritative only when the delegator's sealing event is
 *   learned locally and pinned into `aess.`
 */
export class Anchorer {
  /** Borrowed identities and durable delegation escrow stores. */
  readonly hby: Habery;
  /** Queued delivery owner; phase transitions wait for the matching successful outcome. */
  readonly postman: Poster;
  /** Query producer port; composition owns the consuming coordinator and its lifetime. */
  readonly querying: { enqueue(request: QueryRequest): void };
  /** Borrowed HTTP and clock services for witness publication. */
  readonly http: HttpClient;
  /** Borrowed clock for this owner's actual network deadlines. */
  readonly clock: RuntimeClock;
  /** Borrowed receive processing for witness sends; absent explicitly permits transmit-only delivery. */
  readonly protocol: ProtocolProcessor | null;
  /** Process-local proxy selection per delegated event; cleared when the workflow ends. */
  readonly communicationHabPins = new Map<string, string>();
  /** Existing query retry-pass bookkeeping; independent of Poster delivery retry. */
  readonly anchorQueryRetryPasses = new Map<string, number>();

  /**
   * Bind delivery/query/protocol collaborators from the same accepted-state domain; acquire no stores.
   *
   * @param hby Borrowed local identities and accepted-state stores.
   * @param postman Borrowed Poster; its delivery worker must run while this operation awaits outcomes.
   * @param querying Borrowed query-admission owner for anchor discovery.
   * @param protocol Same-database reply processor, or null when receive support is absent.
   * @param http Borrowed HTTP implementation selected by composition.
   * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
   */
  constructor(
    hby: Habery,
    postman: Poster,
    querying: Anchorer["querying"],
    protocol: ProtocolProcessor | null,
    http: HttpClient,
    clock: RuntimeClock,
  ) {
    if (protocol && protocol.kvy.db !== hby.db) {
      throw new RangeError("Anchorer protocol processor must use the same database");
    }
    this.hby = hby;
    this.protocol = protocol;
    this.postman = postman;
    this.querying = querying;
    this.http = http;
    this.clock = clock;
  }

  /**
   * Start one delegated event in witness-receipt escrow and replace any previous local proxy pin.
   *
   * @param serder Delegated event whose witness/approval workflow is started or reset.
   * @param options Optional communicationHab pins a local proxy signer for this process.
   */
  begin(
    serder: SerderKERI,
    options: { communicationHab?: Hab } = {},
  ): void {
    const key = eventKey(serder);
    const id = workflowId(serder);
    // Reset durable phase membership before pinning this process's communication signer.
    this.hby.db.dpwe.pin(key, serder);
    this.hby.db.dune.rem(key);
    this.hby.db.dpub.rem(key);
    this.anchorQueryRetryPasses.delete(id);
    if (options.communicationHab) {
      this.communicationHabPins.set(id, options.communicationHab.pre);
    } else {
      this.communicationHabPins.delete(id);
    }
  }

  /** Begin workflow processing from the currently accepted event for an AID. */
  beginLatest(
    pre: string,
    sn?: number,
    options: { communicationHab?: Hab } = {},
  ): SerderKERI {
    const kever = this.hby.db.getKever(pre);
    if (!kever) {
      throw new ValidationError(`No accepted key state for ${pre}.`);
    }
    const targetSn = sn ?? kever.sn;
    const said = this.hby.db.kels.getLast(pre, targetSn);
    if (!said) {
      throw new ValidationError(
        `Missing accepted event at ${pre}:${targetSn.toString(16)}.`,
      );
    }
    const serder = this.hby.db.getEvtSerder(pre, said);
    if (!serder) {
      throw new ValidationError(
        `Missing event body for delegated workflow ${pre}:${said}.`,
      );
    }
    this.begin(serder, options);
    return serder;
  }

  /** Return the current durable workflow phase without mutating escrow state. */
  workflowStatus(
    pre: string,
    snh: string,
  ): DelegationWorkflowStatus {
    const key: [string, string] = [pre, snh];
    const serder = this.hby.db.dpwe.get(key)
      ?? this.hby.db.dune.get(key)
      ?? this.hby.db.dpub.get(key)
      ?? null;
    const completed = this.complete(pre, snh);
    if (!serder) {
      return { phase: null, proxyDependent: false, complete: completed };
    }

    const phase = this.hby.db.dpwe.get(key)
      ? "waitingWitnessReceipts"
      : this.hby.db.dune.get(key)
      ? "waitingDelegatorAnchor"
      : this.hby.db.dpub.get(key)
      ? "waitingWitnessPublication"
      : null;
    const pinned = this.communicationHabPins.get(workflowId(serder));
    return {
      phase,
      proxyDependent: typeof pinned === "string" && pinned.length > 0,
      complete: completed,
    };
  }

  /** Return true after the delegated event has been durably completed. */
  complete(pre: string, sn: number | string): boolean {
    const snNum = typeof sn === "number" ? sn : parseInt(sn, 16);
    if (!Number.isInteger(snNum) || snNum < 0) {
      return false;
    }
    const said = this.hby.db.kels.getLast(pre, snNum);
    if (!said) {
      return false;
    }
    for (const entry of this.hby.db.cdel.getTopItemIter(pre)) {
      const diger = entry[entry.length - 1] as Diger;
      if (diger.qb64 === said) {
        return true;
      }
    }
    return false;
  }

  /** Advance delegation escrows using the protocol receiver selected at construction. */
  *processAllOnce(): Operation<DelegationWorkflowResult[]> {
    // A pass advances the existing phases in dependency order, using finite escrow snapshots.
    const results: DelegationWorkflowResult[] = [];
    for (
      const [keys, serder] of [...this.hby.db.dpwe.getTopItemIter()] as Array<
        [[string, string], SerderKERI]
      >
    ) {
      results.push(
        yield* this.processPartialWitnessEscrow(escrowContext(keys, serder)),
      );
    }
    for (
      const [keys, serder] of [...this.hby.db.dune.getTopItemIter()] as Array<
        [[string, string], SerderKERI]
      >
    ) {
      results.push(
        yield* this.processUnanchoredEscrow(escrowContext(keys, serder)),
      );
    }
    for (
      const [keys, serder] of [...this.hby.db.dpub.getTopItemIter()] as Array<
        [[string, string], SerderKERI]
      >
    ) {
      results.push(
        yield* this.processWitnessPublication(escrowContext(keys, serder)),
      );
    }
    return results;
  }

  /**
   * Require delegate receipts, deliver the approval request/event, then move to anchor discovery. Failed delivery leaves this phase retained.
   *
   * @param context Escrow key, event, prefix and SAID resolved from durable workflow state.
   * @returns Current delegation phase result; failed transmission does not advance to anchor discovery.
   */
  private *processPartialWitnessEscrow(
    context: DelegationEscrowContext,
  ): Operation<DelegationWorkflowResult> {
    const [keys, serder, pre, said] = context;

    let hab: Hab;
    try {
      hab = workflowHab(this.hby, serder);
    } catch (error) {
      this.hby.db.dpwe.rem(keys);
      this.communicationHabPins.delete(workflowId(serder));
      return {
        kind: "fail",
        pre,
        said,
        phase: "waitingWitnessReceipts",
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    const delpre = delegatedWorkflowDelpre(this.hby, serder, hab);
    if (!delpre) {
      this.hby.db.dpwe.rem(keys);
      this.clearWorkflowPins(serder);
      return {
        kind: "fail",
        pre,
        said,
        phase: "waitingWitnessReceipts",
        reason: "Delegated workflow event does not carry a delegator prefix.",
      };
    }

    let communicationHab: Hab;
    try {
      communicationHab = this.communicationHab(serder, hab);
    } catch (error) {
      return {
        kind: "fail",
        pre,
        said,
        phase: "waitingWitnessReceipts",
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    if (
      hab.kever && hab.kever.wits.length > 0
      && !witnessReceiptsComplete(this.hby, serder)
    ) {
      return {
        kind: "keep",
        pre,
        said,
        phase: "waitingWitnessReceipts",
        reason: "Delegate witness receipts are not converged yet.",
      };
    }

    // Do not ask the delegator to approve until the delegate's own witnesses
    // have receipted the event. That preserves the KERIpy approval ordering
    // and avoids anchoring an event the delegate cannot yet complete.
    const message = eventPayloadMessage(this.hby, serder);
    const { msg } = createExchangeMessage(communicationHab, {
      dest: delpre,
      exchangeRecipient: null,
      route: DELEGATE_REQUEST_ROUTE,
      payload: {
        delpre,
      },
      embeds: { evt: message },
    });
    const postman = this.postman;
    const request = postman.send({
      src: communicationHab.pre,
      dest: delpre,
      msg,
      topic: DELEGATE_MAILBOX_TOPIC,
    }, { notify: true });
    // Admission alone cannot release the next send or the delegation phase transition.
    const requested = yield* postman.wait(request);
    if (requested.kin === "failed") throw requested.error;
    const replay = postman.send({
      src: communicationHab.pre,
      dest: delpre,
      msg: message,
      topic: DELEGATE_MAILBOX_TOPIC,
    }, { notify: true });
    const replayed = yield* postman.wait(replay);
    if (replayed.kin === "failed") throw replayed.error;
    // KERIpy issues the first delegator-witness anchor query in the same
    // publish phase that forwards the delegation request and raw event bytes.
    // Keep that ordering here so delegate-side approval discovery does not
    // depend on a later escrow pass happening "soon enough" by accident.
    this.queueDelegatorWitnessQueryNow(serder, communicationHab);
    this.hby.db.dpwe.rem(keys);
    this.hby.db.dune.pin(keys, serder);
    return {
      kind: "advance",
      pre,
      said,
      from: "waitingWitnessReceipts",
      to: "waitingDelegatorAnchor",
      reason: `Forwarded delegated event ${said} to delegator ${delpre} through ${communicationHab.pre}.`,
    };
  }

  /** Wait for locally accepted delegator evidence; pin its seal before completing or publishing to witnesses. */
  private *processUnanchoredEscrow(
    context: DelegationEscrowContext,
  ): Operation<DelegationWorkflowResult> {
    const [keys, serder, pre, said] = context;

    let hab: Hab;
    try {
      hab = workflowHab(this.hby, serder);
    } catch (error) {
      return {
        kind: "fail",
        pre,
        said,
        phase: "waitingDelegatorAnchor",
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    const delegating = approvingEvent(this.hby, serder, hab);
    if (!delegating) {
      let communicationHab: Hab;
      try {
        communicationHab = this.communicationHab(serder, hab);
      } catch (error) {
        return {
          kind: "fail",
          pre,
          said,
          phase: "waitingDelegatorAnchor",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      return {
        kind: "keep",
        pre,
        said,
        phase: "waitingDelegatorAnchor",
        reason: this.retryDelegatorWitnessQuery(serder, communicationHab),
      };
    }

    // The approving event is authoritative only after the delegator's sealing
    // event is learned locally; pinning `aess.` is what lets delegated unescrow
    // and later reopen paths prove the authorization.
    pinAuthorizingSeal(this.hby, serder, delegating);
    this.hby.db.dune.rem(keys);

    if ((hab.kever?.wits.length ?? 0) === 0) {
      this.hby.db.cdel.appendOn(pre, completionDiger(serder));
      this.clearWorkflowPins(serder);
      return {
        kind: "complete",
        pre,
        said,
        phase: "waitingDelegatorAnchor",
        reason: "Delegator approval is anchored and no witness republication is required.",
      };
    }

    yield* this.publishDelegator(serder);
    this.hby.db.dpub.pin(keys, serder);
    return {
      kind: "advance",
      pre,
      said,
      from: "waitingDelegatorAnchor",
      to: "waitingWitnessPublication",
      reason: "Delegator approval is anchored; published the delegation chain to delegate witnesses.",
    };
  }

  /** Record durable completion only after the preceding publication operation has succeeded. */
  private *processWitnessPublication(
    context: DelegationEscrowContext,
  ): Operation<DelegationWorkflowResult> {
    const [keys, serder, pre, said] = context;

    this.hby.db.dpub.rem(keys);
    this.hby.db.cdel.appendOn(pre, completionDiger(serder));
    this.clearWorkflowPins(serder);
    return {
      kind: "complete",
      pre,
      said,
      phase: "waitingWitnessPublication",
      reason: "Witness publication completed after delegator approval.",
    };
  }

  /** Use the pinned proxy for inception or the existing delegate for rotation; never guess an inception signer. */
  private communicationHab(
    serder: SerderKERI,
    hab = workflowHab(this.hby, serder),
  ): Hab {
    const pinned = this.communicationHabPins.get(workflowId(serder));
    if (pinned) {
      return localHabByPre(
        this.hby,
        pinned,
        `Delegation workflow ${workflowId(serder)}`,
      );
    }
    if ((serder.sn ?? 0) > 0) {
      return hab;
    }
    throw new ValidationError(
      `Delegated inception for ${hab.pre} requires --proxy <alias> to send delegation requests.`,
    );
  }

  /** Publish the initial anchor query after successful sending and seed the existing retry-pass bookkeeping. */
  private queueDelegatorWitnessQueryNow(
    serder: SerderKERI,
    communicationHab: Hab,
  ): void {
    const id = workflowId(serder);
    const delpre = delegatedWorkflowDelpre(this.hby, serder);
    if (!delpre) {
      throw new ValidationError(
        `Delegation workflow ${id} is missing a delegator prefix.`,
      );
    }
    const delegator = this.hby.db.getKever(delpre);
    if (!delegator) {
      return;
    }

    const witness = firstSorted(delegator.wits);
    if (!witness || !preferredWitnessQueryUrl(communicationHab, witness)) {
      return;
    }

    this.querying.enqueue({
      pre: delpre,
      route: "logs",
      q: { fn: "0", s: "0", a: eventAnchor(serder) },
      signer: communicationHab.pre,
      wits: [witness],
    });
    // Mark that an immediate publication-time query was already sent so the
    // first unanchored escrow retry pass starts the backoff window instead of
    // immediately enqueueing the same query again.
    this.anchorQueryRetryPasses.set(id, -1);
  }

  /** Retry bounded delegator-witness queries while waiting for the anchor. */
  private retryDelegatorWitnessQuery(
    serder: SerderKERI,
    communicationHab: Hab,
  ): string {
    const id = workflowId(serder);
    const delpre = delegatedWorkflowDelpre(this.hby, serder);
    if (!delpre) {
      throw new ValidationError(
        `Delegation workflow ${id} is missing a delegator prefix.`,
      );
    }
    const delegator = this.hby.db.getKever(delpre);
    if (!delegator) {
      return "Delegator anchor has not been learned locally yet and the delegator KEL is not known locally.";
    }

    const witness = firstSorted(delegator.wits);
    if (!witness) {
      return "Delegator anchor has not been learned locally yet and no delegator witness is known locally.";
    }
    if (!preferredWitnessQueryUrl(communicationHab, witness)) {
      return `Delegator anchor has not been learned locally yet and witness ${witness} has no HTTP endpoint known locally.`;
    }

    const pass = this.anchorQueryRetryPasses.get(id);
    if (pass === undefined) {
      this.querying.enqueue({
        pre: delpre,
        route: "logs",
        q: { fn: "0", s: "0", a: eventAnchor(serder) },
        signer: communicationHab.pre,
        wits: [witness],
      });
      this.anchorQueryRetryPasses.set(id, 0);
      return `Delegator anchor has not been learned locally yet; queried delegator witness ${witness}.`;
    }

    const nextPass = pass + 1;
    if (nextPass < DELEGATION_ANCHOR_QUERY_RETRY_PASSES) {
      this.anchorQueryRetryPasses.set(id, nextPass);
      const remaining = DELEGATION_ANCHOR_QUERY_RETRY_PASSES
        - nextPass;
      return `Delegator anchor has not been learned locally yet; next delegator witness query retry in ${remaining} pass(es).`;
    }

    this.querying.enqueue({
      pre: delpre,
      route: "logs",
      q: { fn: "0", s: "0", a: eventAnchor(serder) },
      signer: communicationHab.pre,
      wits: [witness],
    });
    this.anchorQueryRetryPasses.set(id, 0);
    return `Delegator anchor has not been learned locally yet; queried delegator witness ${witness}.`;
  }

  /** Retire only this event's process-local signer and query bookkeeping. */
  private clearWorkflowPins(serder: SerderKERI): void {
    const id = workflowId(serder);
    this.communicationHabPins.delete(id);
    this.anchorQueryRetryPasses.delete(id);
  }

  /** Choose the pinned proxy, local group member or existing communication habitat for publication. */
  private publicationTransportHab(serder: SerderKERI, hab: Hab): Hab {
    const pinned = this.communicationHabPins.get(workflowId(serder));
    if (pinned) {
      return localHabByPre(
        this.hby,
        pinned,
        `Delegation workflow ${workflowId(serder)}`,
      );
    }
    return localGroupMember(this.hby, hab.pre) ?? this.communicationHab(serder, hab);
  }

  /**
   * Send the delegation chain before the approving event, awaiting actual Poster or witness transmission outcomes.
   *
   * @param serder Accepted delegator event to publish after its required delegation chain.
   */
  private *publishDelegator(serder: SerderKERI): Operation<void> {
    const pre = workflowPre(serder);
    const hab = localHabByPre(this.hby, pre, "Delegation witness publication");
    const transportHab = this.publicationTransportHab(serder, hab);
    const kever = hab.kever;
    if (!kever) {
      throw new ValidationError(
        `Delegation witness publication: missing accepted key state for ${pre}.`,
      );
    }

    // Publish the delegator chain first, then replay the approving event. This
    // matches the witness-visible material KERIpy sends for delegated approval.
    for (const msg of this.hby.db.cloneDelegation(kever)) {
      for (const witness of kever.wits) {
        yield* sendWitnessMessage(transportHab, witness, msg, this.http, this.clock, this.protocol);
      }
    }

    // Publish the approving event only after the complete delegation chain has been sent.
    const approvedEvent = eventReplayMessage(this.hby, kever.serder);
    if (kever.delpre) {
      const postman = this.postman;
      const evt = postman.send({
        src: transportHab.pre,
        dest: kever.delpre,
        topic: REPLAY_MAILBOX_TOPIC,
        msg: approvedEvent,
      }, { notify: true });
      const outcome = yield* postman.wait(evt);
      if (outcome.kin === "failed") throw outcome.error;
    }
    for (const witness of kever.wits) {
      yield* sendWitnessMessage(transportHab, witness, approvedEvent, this.http, this.clock, this.protocol);
    }
  }
}
