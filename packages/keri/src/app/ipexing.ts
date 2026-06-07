/**
 * IPEX exchange route family for registry-backed ACDC workflows.
 *
 * KERIpy correspondence:
 * - mirrors `keri.vc.protocoling` route registration, previous-route
 *   validation, duplicate-response prevention, builders, and notifier payloads
 *
 * Boundary:
 * - this module owns IPEX `exn` shape and route behavior only
 * - credential/TEL artifact ingestion remains VDR/runtime work
 */
import type { Kind, SerderKERI, Versionage } from "../../../cesr/mod.ts";
import { exchange } from "../core/protocol-exchanging.ts";
import type { Exchanger, ExchangeRouteHandler } from "./exchanging.ts";
import type { Hab, Habery } from "./habbing.ts";
import type { Notifier } from "./notifying.ts";

/** KERIpy IPEX route constants. */
export const IPEX_APPLY_ROUTE = "/ipex/apply";
export const IPEX_OFFER_ROUTE = "/ipex/offer";
export const IPEX_AGREE_ROUTE = "/ipex/agree";
export const IPEX_GRANT_ROUTE = "/ipex/grant";
export const IPEX_ADMIT_ROUTE = "/ipex/admit";
export const IPEX_SPURN_ROUTE = "/ipex/spurn";

/** Ordered route list used for registration and tests. */
export const IPEX_ROUTES = [
  IPEX_APPLY_ROUTE,
  IPEX_OFFER_ROUTE,
  IPEX_AGREE_ROUTE,
  IPEX_GRANT_ROUTE,
  IPEX_ADMIT_ROUTE,
  IPEX_SPURN_ROUTE,
] as const;

export type IpexRoute = typeof IPEX_ROUTES[number];
export type IpexVerb = "apply" | "offer" | "agree" | "grant" | "admit" | "spurn";

/** Previous-route policy from KERIpy `PreviousRoutes`. */
export const PREVIOUS_IPEX_ROUTES: ReadonlyMap<IpexVerb, readonly IpexVerb[]> = new Map([
  ["offer", ["apply"]],
  ["agree", ["offer"]],
  ["grant", ["agree"]],
  ["admit", ["grant"]],
  ["spurn", ["apply", "offer", "agree", "grant"]],
]);

const STARTABLE_WITHOUT_PRIOR = new Set<IpexVerb>(["apply", "offer", "grant"]);

interface RawMessage {
  readonly raw: Uint8Array;
}

export interface IpexHandlerOptions {
  notifier?: Notifier | null;
}

export interface IpexBuilderOptions {
  stamp?: string;
  date?: string;
  version?: Versionage;
  pvrsn?: Versionage;
  gvrsn?: Versionage | null;
  kind?: Kind;
}

export type IpexMessage = readonly [serder: SerderKERI, attachments: Uint8Array];

export interface IpexGrantOptions extends IpexBuilderOptions {
  iss?: Uint8Array | RawMessage | null;
  anc?: Uint8Array | RawMessage | null;
  agree?: SerderKERI | null;
}

/**
 * Accepted IPEX route handler.
 *
 * The handler verifies route-local conversation rules before `Exchanger` logs
 * accepted state, so the existing `erpy` prior-response index can enforce
 * KERIpy's one-response-per-prior invariant.
 */
export class IpexHandler implements ExchangeRouteHandler {
  readonly resource: IpexRoute;
  private readonly hby: Habery;
  private readonly notifier: Notifier | null;

  constructor(resource: IpexRoute, hby: Habery, notifier?: Notifier | null) {
    this.resource = resource;
    this.hby = hby;
    this.notifier = notifier ?? null;
  }

  verify(args: { serder: SerderKERI }): boolean {
    const route = args.serder.route ?? "";
    if (route !== this.resource) {
      return false;
    }

    const verb = ipexVerbForRoute(route);
    if (!verb) {
      return false;
    }

    const prior = priorSaid(args.serder);
    if (!prior) {
      return STARTABLE_WITHOUT_PRIOR.has(verb);
    }
    if (verb === "apply") {
      return false;
    }

    const previous = this.hby.db.exns.get([prior]);
    if (!previous) {
      return false;
    }
    const previousVerb = ipexVerbForRoute(previous.route ?? "");
    if (!previousVerb) {
      return false;
    }

    const allowed = PREVIOUS_IPEX_ROUTES.get(verb) ?? [];
    return allowed.includes(previousVerb) && !this.hasPriorResponse(prior);
  }

  handle(args: { serder: SerderKERI }): void {
    if (!this.notifier) {
      return;
    }

    const route = args.serder.route;
    const said = args.serder.said;
    const attrs = args.serder.ked?.a;
    const message = isRecord(attrs) && typeof attrs["m"] === "string" ? attrs["m"] : null;
    if (!route || !said || message === null) {
      return;
    }

    this.notifier.add({
      r: `/exn${route}`,
      d: said,
      m: message,
    });
  }

  private hasPriorResponse(prior: string): boolean {
    return this.hby.db.erpy.get([prior]) !== null;
  }
}

/** Register all KERIpy IPEX routes with one exchanger. */
export function loadIpexHandlers(
  hby: Habery,
  exchanger: Exchanger,
  options: IpexHandlerOptions = {},
): void {
  for (const route of IPEX_ROUTES) {
    exchanger.addHandler(new IpexHandler(route, hby, options.notifier ?? null));
  }
}

/** Apply for an ACDC. */
export function ipexApplyExn(
  hab: Hab,
  recp: string,
  message: string,
  schema: unknown,
  attrs: unknown,
  options: IpexBuilderOptions = {},
): IpexMessage {
  return exchange(
    IPEX_APPLY_ROUTE,
    {
      m: message,
      s: schema,
      a: attrs,
      i: recp,
    },
    exchangeOptions(hab, options),
  );
}

/** Offer a metadata ACDC, optionally as a response to an apply. */
export function ipexOfferExn(
  hab: Hab,
  message: string,
  acdc: Uint8Array | RawMessage,
  apply?: SerderKERI | null,
  options: IpexBuilderOptions = {},
): IpexMessage {
  return exchange(
    IPEX_OFFER_ROUTE,
    { m: message },
    {
      ...exchangeOptions(hab, options),
      dig: apply?.said ?? "",
      embeds: { acdc: rawMessage(acdc) },
    },
  );
}

/** Agree to an offer. */
export function ipexAgreeExn(
  hab: Hab,
  message: string,
  offer: SerderKERI,
  options: IpexBuilderOptions = {},
): IpexMessage {
  return exchange(
    IPEX_AGREE_ROUTE,
    { m: message },
    {
      ...exchangeOptions(hab, options),
      dig: requiredSaid(offer, "offer"),
    },
  );
}

/** Disclose an ACDC, optionally as a response to an agree. */
export function ipexGrantExn(
  hab: Hab,
  recp: string,
  message: string,
  acdc: Uint8Array | RawMessage,
  options: IpexGrantOptions = {},
): IpexMessage {
  const embeds: Record<string, Uint8Array> = {
    acdc: rawMessage(acdc),
  };
  if (options.iss) {
    embeds.iss = rawMessage(options.iss);
  }
  if (options.anc) {
    embeds.anc = rawMessage(options.anc);
  }

  return exchange(
    IPEX_GRANT_ROUTE,
    {
      m: message,
      i: recp,
    },
    {
      ...exchangeOptions(hab, options),
      dig: options.agree?.said ?? "",
      embeds,
    },
  );
}

/** Admit a disclosure. */
export function ipexAdmitExn(
  hab: Hab,
  message: string,
  grant: SerderKERI,
  options: IpexBuilderOptions = {},
): IpexMessage {
  return exchange(
    IPEX_ADMIT_ROUTE,
    { m: message },
    {
      ...exchangeOptions(hab, options),
      dig: requiredSaid(grant, "grant"),
    },
  );
}

/** Reject an application, offer, agreement, or grant. */
export function ipexSpurnExn(
  hab: Hab,
  message: string,
  spurned: SerderKERI,
  options: IpexBuilderOptions = {},
): IpexMessage {
  return exchange(
    IPEX_SPURN_ROUTE,
    { m: message },
    {
      ...exchangeOptions(hab, options),
      dig: requiredSaid(spurned, "spurned"),
    },
  );
}

function exchangeOptions(hab: Hab, options: IpexBuilderOptions) {
  return {
    sender: hab.pre,
    stamp: options.stamp,
    date: options.date,
    version: options.version,
    pvrsn: options.pvrsn,
    gvrsn: options.gvrsn,
    kind: options.kind,
  };
}

function requiredSaid(serder: SerderKERI, label: string): string {
  if (!serder.said) {
    throw new Error(`IPEX ${label} message is missing a SAID.`);
  }
  return serder.said;
}

function rawMessage(message: Uint8Array | RawMessage): Uint8Array {
  return message instanceof Uint8Array ? message : message.raw;
}

function priorSaid(serder: SerderKERI): string {
  const prior = serder.ked?.p;
  return typeof prior === "string" ? prior : "";
}

function ipexVerbForRoute(route: string): IpexVerb | null {
  const parts = route.split("/");
  if (parts.length !== 3 || parts[0] !== "" || parts[1] !== "ipex") {
    return null;
  }
  const verb = parts[2];
  return isIpexVerb(verb) ? verb : null;
}

function isIpexVerb(value: string): value is IpexVerb {
  return value === "apply"
    || value === "offer"
    || value === "agree"
    || value === "grant"
    || value === "admit"
    || value === "spurn";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
