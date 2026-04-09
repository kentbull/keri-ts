import { type Operation } from "npm:effection@^3.6.0";
import { Diger, type SerderKERI } from "../../../cesr/mod.ts";
import { ValidationError } from "../core/errors.ts";
import { DELEGATE_MAILBOX_TOPIC } from "../core/mailbox-topics.ts";
import { dgKey } from "../db/core/keys.ts";
import type { ExchangeAttachment, Exchanger, ExchangeRouteHandler } from "./exchanging.ts";
import { type Poster } from "./forwarding.ts";
import type { Hab, Habery } from "./habbing.ts";
import type { Notifier } from "./notifying.ts";
import { WitnessReceiptor } from "./witnessing.ts";

export const DELEGATE_REQUEST_ROUTE = "/delegate/request";

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

function approvingEvent(
  hby: Habery,
  serder: SerderKERI,
): SerderKERI | null {
  const delpre = serder.delpre;
  return delpre
    ? hby.db.fetchAllSealingEventByEventSeal(delpre, eventAnchor(serder))
    : null;
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

export class SingleSigDelegationCoordinator {
  readonly hby: Habery;
  readonly poster: Poster;
  readonly communicationHabPins = new Map<string, string>();

  constructor(
    hby: Habery,
    { poster }: { poster: Poster },
  ) {
    this.hby = hby;
    this.poster = poster;
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
  ): {
    phase: DelegationPhase | null;
    proxyDependent: boolean;
  } {
    const key: [string, string] = [pre, snh];
    const serder = this.hby.db.dpwe.get(key)
      ?? this.hby.db.dune.get(key)
      ?? this.hby.db.dpub.get(key)
      ?? null;
    if (!serder) {
      return { phase: null, proxyDependent: false };
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
      proxyDependent: phase === "waitingWitnessReceipts"
        && ((serder.sn ?? 0) === 0 || (typeof pinned === "string" && pinned.length > 0)),
    };
  }

  *processAllOnce(): Operation<DelegationWorkflowResult[]> {
    const results: DelegationWorkflowResult[] = [];
    for (const [, serder] of [...this.hby.db.dpwe.getTopItemIter()]) {
      results.push(yield* this.processPartialWitnessEscrow(serder));
    }
    for (const [, serder] of [...this.hby.db.dune.getTopItemIter()]) {
      results.push(yield* this.processUnanchoredEscrow(serder));
    }
    for (const [, serder] of [...this.hby.db.dpub.getTopItemIter()]) {
      results.push(yield* this.processWitnessPublication(serder));
    }
    return results;
  }

  private *processPartialWitnessEscrow(
    serder: SerderKERI,
  ): Operation<DelegationWorkflowResult> {
    const pre = serder.pre ?? "<unknown>";
    const said = serder.said ?? "<unknown>";
    const key = eventKey(serder);
    const delpre = serder.delpre;
    if (!delpre) {
      this.hby.db.dpwe.rem(key);
      return {
        kind: "fail",
        pre,
        said,
        phase: "waitingWitnessReceipts",
        reason: "Delegated workflow event does not carry a delegator prefix.",
      };
    }

    let hab: Hab;
    try {
      hab = workflowHab(this.hby, serder);
    } catch (error) {
      this.hby.db.dpwe.rem(key);
      this.communicationHabPins.delete(workflowId(serder));
      return {
        kind: "fail",
        pre,
        said,
        phase: "waitingWitnessReceipts",
        reason: error instanceof Error ? error.message : String(error),
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
    this.hby.db.dpwe.rem(key);
    this.hby.db.dune.pin(key, serder);
    this.communicationHabPins.delete(workflowId(serder));
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
    serder: SerderKERI,
  ): Operation<DelegationWorkflowResult> {
    const pre = serder.pre ?? "<unknown>";
    const said = serder.said ?? "<unknown>";
    const key = eventKey(serder);

    const delegating = approvingEvent(this.hby, serder);
    if (!delegating) {
      return {
        kind: "keep",
        pre,
        said,
        phase: "waitingDelegatorAnchor",
        reason: "Delegator anchor has not been learned locally yet.",
      };
    }

    pinAuthorizingSeal(this.hby, serder, delegating);
    this.hby.db.dune.rem(key);

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

    if ((hab.kever?.wits.length ?? 0) === 0) {
      this.hby.db.cdel.appendOn(pre, completionDiger(serder));
      this.communicationHabPins.delete(workflowId(serder));
      return {
        kind: "complete",
        pre,
        said,
        phase: "waitingDelegatorAnchor",
        reason: "Delegator approval is anchored and no witness republication is required.",
      };
    }

    this.hby.db.dpub.pin(key, serder);
    return {
      kind: "advance",
      pre,
      said,
      from: "waitingDelegatorAnchor",
      to: "waitingWitnessPublication",
      reason: "Delegator approval is anchored; republishing the witnessed delegated event.",
    };
  }

  private *processWitnessPublication(
    serder: SerderKERI,
  ): Operation<DelegationWorkflowResult> {
    const pre = serder.pre ?? "<unknown>";
    const said = serder.said ?? "<unknown>";
    const key = eventKey(serder);

    const receiptor = new WitnessReceiptor(this.hby, { force: true });
    yield* receiptor.submit(pre, { sn: serder.sn ?? undefined });
    this.hby.db.dpub.rem(key);
    this.hby.db.cdel.appendOn(pre, completionDiger(serder));
    this.communicationHabPins.delete(workflowId(serder));
    return {
      kind: "complete",
      pre,
      said,
      phase: "waitingWitnessPublication",
      reason: "Witness republication completed after delegator approval.",
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
}
