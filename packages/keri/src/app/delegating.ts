import { type Operation } from "npm:effection@^3.6.0";
import { Diger, type SerderKERI } from "../../../cesr/mod.ts";
import { ValidationError } from "../core/errors.ts";
import { DELEGATE_MAILBOX_TOPIC } from "../core/mailbox-topics.ts";
import { Schemes } from "../core/schemes.ts";
import { dgKey } from "../db/core/keys.ts";
import type { ExchangeAttachment, Exchanger, ExchangeRouteHandler } from "./exchanging.ts";
import { type Poster } from "./forwarding.ts";
import type { Hab, Habery } from "./habbing.ts";
import type { Notifier } from "./notifying.ts";
import type { QueryCoordinator } from "./querying.ts";
import { sendWitnessMessage } from "./witnessing.ts";

export const DELEGATE_REQUEST_ROUTE = "/delegate/request";
const DELEGATION_ANCHOR_QUERY_RETRY_PASSES = 8;

export type DelegationPhase =
  | "waitingWitnessReceipts"
  | "waitingDelegatorAnchor"
  | "waitingWitnessPublication";

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

function eventAnchor(serder: SerderKERI): { i: string; s: string; d: string } {
  if (!serder.pre || !serder.snh || !serder.said) {
    throw new ValidationError(
      "Delegated approval anchor requires pre, sn, and said.",
    );
  }
  return { i: serder.pre, s: serder.snh, d: serder.said };
}

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

function eventMessage(hby: Habery, serder: SerderKERI): Uint8Array {
  const pre = serder.pre;
  const said = serder.said;
  if (!pre || !said) {
    throw new ValidationError(
      "Delegated workflow event is missing pre or said.",
    );
  }
  const fn = hby.db.getFelFn(pre, said);
  if (fn === null) {
    throw new ValidationError(
      `Missing first-seen ordinal for delegated event ${pre}:${said}.`,
    );
  }
  return hby.db.cloneEvtMsg(pre, fn, said);
}

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

function approvingEvent(
  hby: Habery,
  serder: SerderKERI,
  hab?: Hab,
): SerderKERI | null {
  const delpre = delegatedWorkflowDelpre(hby, serder, hab);
  return delpre
    ? hby.db.fetchLastSealingEventByEventSeal(delpre, eventAnchor(serder))
    : null;
}

function preferredWitnessQueryUrl(hab: Hab, witness: string): string | null {
  const urls = hab.fetchUrls(witness);
  return urls[Schemes.https] ?? urls[Schemes.http] ?? null;
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
    const delpre = typeof payload?.["delpre"] === "string"
      ? payload.delpre
      : null;
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
 *   `QueryCoordinator` only as the queued query-delivery seam
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
  readonly hby: Habery;
  readonly poster: Poster;
  readonly querying: QueryCoordinator;
  readonly communicationHabPins = new Map<string, string>();
  readonly anchorQueryRetryPasses = new Map<string, number>();

  constructor(
    hby: Habery,
    { poster, querying }: { poster: Poster; querying: QueryCoordinator },
  ) {
    this.hby = hby;
    this.poster = poster;
    this.querying = querying;
  }

  begin(
    serder: SerderKERI,
    options: { communicationHab?: Hab } = {},
  ): void {
    const key = eventKey(serder);
    const id = workflowId(serder);
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

  *processAllOnce(): Operation<DelegationWorkflowResult[]> {
    const results: DelegationWorkflowResult[] = [];
    for (const [keys, serder] of [...this.hby.db.dpwe.getTopItemIter()] as Array<[[string, string], SerderKERI]>) {
      results.push(yield* this.processPartialWitnessEscrow(escrowContext(keys, serder)));
    }
    for (const [keys, serder] of [...this.hby.db.dune.getTopItemIter()] as Array<[[string, string], SerderKERI]>) {
      results.push(yield* this.processUnanchoredEscrow(escrowContext(keys, serder)));
    }
    for (const [keys, serder] of [...this.hby.db.dpub.getTopItemIter()] as Array<[[string, string], SerderKERI]>) {
      results.push(yield* this.processWitnessPublication(escrowContext(keys, serder)));
    }
    return results;
  }

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

    const message = eventMessage(this.hby, serder);
    yield* this.poster.sendExchange(communicationHab, {
      recipient: delpre,
      exchangeRecipient: null,
      route: DELEGATE_REQUEST_ROUTE,
      payload: {
        delpre,
      },
      topic: DELEGATE_MAILBOX_TOPIC,
      embeds: { evt: message },
    });
    yield* this.poster.sendBytes(communicationHab, {
      recipient: delpre,
      message,
      topic: DELEGATE_MAILBOX_TOPIC,
    });
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

    yield* this.publishDelegator(pre);
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
      query: { fn: "0", s: "0", a: eventAnchor(serder) },
      hab: communicationHab,
      wits: [witness],
    });
    // Mark that an immediate publication-time query was already sent so the
    // first unanchored escrow retry pass starts the backoff window instead of
    // immediately enqueueing the same query again.
    this.anchorQueryRetryPasses.set(id, -1);
  }

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
        query: { fn: "0", s: "0", a: eventAnchor(serder) },
        hab: communicationHab,
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
      query: { fn: "0", s: "0", a: eventAnchor(serder) },
      hab: communicationHab,
      wits: [witness],
    });
    this.anchorQueryRetryPasses.set(id, 0);
    return `Delegator anchor has not been learned locally yet; queried delegator witness ${witness}.`;
  }

  private clearWorkflowPins(serder: SerderKERI): void {
    const id = workflowId(serder);
    this.communicationHabPins.delete(id);
    this.anchorQueryRetryPasses.delete(id);
  }

  private *publishDelegator(pre: string): Operation<void> {
    const hab = localHabByPre(this.hby, pre, "Delegation witness publication");
    const kever = hab.kever;
    if (!kever) {
      throw new ValidationError(
        `Delegation witness publication: missing accepted key state for ${pre}.`,
      );
    }

    for (const msg of this.hby.db.cloneDelegation(kever)) {
      for (const witness of kever.wits) {
        yield* sendWitnessMessage(hab, witness, msg);
      }
    }
  }
}
