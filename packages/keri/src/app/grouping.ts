/**
 * KERIpy-shaped multisig exchange coordination.
 *
 * This module owns the `/multisig/*` EXN family used to coordinate group
 * registry, credential, reply, and wrapped business EXN proposals. It does not
 * own group key-event counseling; local group habitat state still lives under
 * `Habery.makeGroupHab(...)`, `Baser.habs`, and the keeper member stores.
 */
import { Counter, type Kind, parsePather, Prefixer, Saider, SerderKERI, type Versionage } from "../../../cesr/mod.ts";
import { exchange } from "../core/protocol-exchanging.ts";
import type { Exchanger, ExchangeRouteHandler } from "./exchanging.ts";
import type { Hab, Habery } from "./habbing.ts";
import type { Notifier } from "./notifying.ts";

/** KERIpy multisig route constants. */
export const MULTISIG_ICP_ROUTE = "/multisig/icp";
export const MULTISIG_ROT_ROUTE = "/multisig/rot";
export const MULTISIG_IXN_ROUTE = "/multisig/ixn";
export const MULTISIG_VCP_ROUTE = "/multisig/vcp";
export const MULTISIG_ISS_ROUTE = "/multisig/iss";
export const MULTISIG_REV_ROUTE = "/multisig/rev";
export const MULTISIG_EXN_ROUTE = "/multisig/exn";
export const MULTISIG_RPY_ROUTE = "/multisig/rpy";

/** Ordered route list used for handler registration. */
export const MULTISIG_ROUTES = [
  MULTISIG_ICP_ROUTE,
  MULTISIG_ROT_ROUTE,
  MULTISIG_IXN_ROUTE,
  MULTISIG_VCP_ROUTE,
  MULTISIG_ISS_ROUTE,
  MULTISIG_REV_ROUTE,
  MULTISIG_EXN_ROUTE,
  MULTISIG_RPY_ROUTE,
] as const;

export type MultisigRoute = typeof MULTISIG_ROUTES[number];

interface RawMessage {
  readonly raw: Uint8Array;
}

export interface MultisigBuilderOptions {
  stamp?: string;
  date?: string;
  version?: Versionage;
  pvrsn?: Versionage;
  gvrsn?: Versionage | null;
  kind?: Kind;
}

export type MultisigMessage = readonly [serder: SerderKERI, attachments: Uint8Array];

export type MultisigDecision =
  | {
    kind: "accept" | "duplicate";
    said: string;
    embeddedSaid: string;
    route: string;
    sender: string;
  }
  | {
    kind: "reject";
    said: string;
    reason: string;
  };

type MultisigInspection =
  | {
    ok: true;
    said: string;
    embeddedSaid: string;
    route: string;
    sender: string;
  }
  | {
    ok: false;
    said: string;
    reason: string;
  };

export interface MultisigHandlerOptions {
  mux?: Multiplexor;
  notifier?: Notifier | null;
}

/** Coordinate one proposed group inception event. */
export function multisigInceptExn(
  member: Hab,
  smids: readonly string[],
  rmids: readonly string[] | null,
  icp: Uint8Array | RawMessage,
  delegator?: string | null,
  options: MultisigBuilderOptions = {},
): MultisigMessage {
  const icpBytes = rawMessage(icp);
  const serder = new SerderKERI({ raw: icpBytes });
  const attrs: Record<string, unknown> = {
    gid: requireString(serder.pre, "group inception prefix"),
    smids: [...smids],
    rmids: [...(rmids ?? smids)],
  };
  if (delegator) {
    attrs.delegator = delegator;
  }

  return exchange(MULTISIG_ICP_ROUTE, attrs, {
    ...exchangeOptions(member, options),
    embeds: { icp: icpBytes },
  });
}

/** Coordinate one proposed group rotation event. */
export function multisigRotateExn(
  group: string | Hab,
  member: Hab,
  smids: readonly string[],
  rmids: readonly string[],
  rot: Uint8Array | RawMessage,
  options: MultisigBuilderOptions = {},
): MultisigMessage {
  return exchange(MULTISIG_ROT_ROUTE, {
    gid: groupPrefix(group),
    smids: [...smids],
    rmids: [...rmids],
  }, {
    ...exchangeOptions(member, options),
    embeds: { rot: rawMessage(rot) },
  });
}

/** Coordinate one proposed group interaction event. */
export function multisigInteractExn(
  group: string | Hab,
  member: Hab,
  aids: readonly string[],
  ixn: Uint8Array | RawMessage,
  options: MultisigBuilderOptions = {},
): MultisigMessage {
  return exchange(MULTISIG_IXN_ROUTE, {
    gid: groupPrefix(group),
    smids: [...aids],
  }, {
    ...exchangeOptions(member, options),
    embeds: { ixn: rawMessage(ixn) },
  });
}

/** Coordinate one proposed multisig credential-registry inception. */
export function multisigRegistryInceptExn(
  group: string | Hab,
  member: Hab,
  usage: string,
  vcp: Uint8Array | RawMessage,
  anc: Uint8Array | RawMessage,
  options: MultisigBuilderOptions = {},
): MultisigMessage {
  return exchange(MULTISIG_VCP_ROUTE, {
    gid: groupPrefix(group),
    usage,
  }, {
    ...exchangeOptions(member, options),
    embeds: {
      vcp: rawMessage(vcp),
      anc: rawMessage(anc),
    },
  });
}

/** Coordinate one proposed multisig credential issuance. */
export function multisigIssueExn(
  group: string | Hab,
  member: Hab,
  acdc: Uint8Array | RawMessage,
  iss: Uint8Array | RawMessage,
  anc: Uint8Array | RawMessage,
  options: MultisigBuilderOptions = {},
): MultisigMessage {
  return exchange(MULTISIG_ISS_ROUTE, {
    gid: groupPrefix(group),
  }, {
    ...exchangeOptions(member, options),
    embeds: {
      acdc: rawMessage(acdc),
      iss: rawMessage(iss),
      anc: rawMessage(anc),
    },
  });
}

/** Coordinate one proposed multisig credential revocation. */
export function multisigRevokeExn(
  group: string | Hab,
  member: Hab,
  said: string,
  rev: Uint8Array | RawMessage,
  anc: Uint8Array | RawMessage,
  options: MultisigBuilderOptions = {},
): MultisigMessage {
  return exchange(MULTISIG_REV_ROUTE, {
    gid: groupPrefix(group),
    said,
  }, {
    ...exchangeOptions(member, options),
    embeds: {
      rev: rawMessage(rev),
      anc: rawMessage(anc),
    },
  });
}

/** Coordinate one proposed multisig reply event. */
export function multisigRpyExn(
  group: string | Hab,
  member: Hab,
  rpy: Uint8Array | RawMessage,
  options: MultisigBuilderOptions = {},
): MultisigMessage {
  return exchange(MULTISIG_RPY_ROUTE, {
    gid: groupPrefix(group),
  }, {
    ...exchangeOptions(member, options),
    embeds: { rpy: rawMessage(rpy) },
  });
}

/** Wrap one business EXN, such as `/ipex/grant`, for group approval. */
export function multisigExn(
  group: string | Hab,
  member: Hab,
  exn: Uint8Array | RawMessage,
  options: MultisigBuilderOptions = {},
): MultisigMessage {
  return exchange(MULTISIG_EXN_ROUTE, {
    gid: groupPrefix(group),
  }, {
    ...exchangeOptions(member, options),
    embeds: { exn: rawMessage(exn) },
  });
}

/** Route handler that forwards accepted multisig EXNs to the `Multiplexor`. */
export class MultisigNotificationHandler implements ExchangeRouteHandler {
  readonly resource: MultisigRoute;
  private readonly mux: Multiplexor;

  constructor(resource: MultisigRoute, mux: Multiplexor) {
    this.resource = resource;
    this.mux = mux;
  }

  verify(args: { serder: SerderKERI }): boolean {
    return args.serder.route === this.resource && this.mux.verify(args.serder);
  }

  handle(args: { serder: SerderKERI }): void {
    this.mux.add(args.serder);
  }
}

/** Register the KERIpy multisig route family with one exchanger. */
export function loadMultisigHandlers(
  hby: Habery,
  exchanger: Exchanger,
  options: MultisigHandlerOptions = {},
): Multiplexor {
  const mux = options.mux ?? new Multiplexor(hby, { notifier: options.notifier ?? null });
  for (const route of MULTISIG_ROUTES) {
    exchanger.addHandler(new MultisigNotificationHandler(route, mux));
  }
  return mux;
}

/**
 * KERIpy `Multiplexor` analogue.
 *
 * The `meids.` and `maids.` indexes group proposals by embedded payload SAID so
 * later approval/completion logic can find all submitters for the same payload.
 */
export class Multiplexor {
  readonly hby: Habery;
  readonly notifier: Notifier | null;

  constructor(
    hby: Habery,
    { notifier }: { notifier?: Notifier | null } = {},
  ) {
    this.hby = hby;
    this.notifier = notifier ?? null;
  }

  add(serder: SerderKERI): MultisigDecision {
    const inspection = this.inspect(serder);
    if (!inspection.ok) {
      return {
        kind: "reject",
        said: inspection.said,
        reason: inspection.reason,
      };
    }
    const { said, embeddedSaid, route, sender } = inspection;
    const existing = this.hby.db.meids.get([embeddedSaid]);
    const firstSubmission = existing.length === 0;
    if (firstSubmission && !this.isLocalHab(sender)) {
      this.notifier?.add({ r: route, d: said });
    }

    this.hby.db.meids.add([embeddedSaid], new Saider({ qb64: said }));
    this.hby.db.maids.add([embeddedSaid], new Prefixer({ qb64: sender }));

    const duplicate = existing.some((saider) => saider.qb64 === said);
    return {
      kind: duplicate ? "duplicate" : "accept",
      said,
      embeddedSaid,
      route,
      sender,
    };
  }

  /** Return true when this wrapper can be accepted for local group work. */
  verify(serder: SerderKERI): boolean {
    return this.inspect(serder).ok;
  }

  private inspect(serder: SerderKERI): MultisigInspection {
    const said = serder.said ?? "<unknown>";
    const ked = serder.ked;
    if (!ked) {
      return { ok: false, said, reason: "Missing decoded exchange body." };
    }

    const embed = embeddedSection(ked);
    if (!embed) {
      return { ok: false, said, reason: "Missing multisig embedded section." };
    }

    const embeddedSaid = embed["d"];
    if (typeof embeddedSaid !== "string" || embeddedSaid.length === 0) {
      return { ok: false, said, reason: "Missing multisig embedded SAID." };
    }

    const sender = serder.pre ?? "";
    const route = serder.route ?? "";
    const payload = payloadSection(ked);
    const membership = this.verifyMembership(route, payload);
    if (membership) {
      return { ok: false, said, reason: membership };
    }

    return {
      ok: true,
      said,
      embeddedSaid,
      route,
      sender,
    };
  }

  /** Return all stored wrapper EXNs for one embedded payload SAID. */
  get(embeddedSaid: string): Array<{ exn: Record<string, unknown>; paths: Record<string, string> }> {
    const exns: Array<{ exn: Record<string, unknown>; paths: Record<string, string> }> = [];
    for (const saider of this.hby.db.meids.get([embeddedSaid])) {
      const exn = this.hby.db.exns.get([saider.qb64]);
      if (!exn?.ked) {
        continue;
      }
      exns.push({
        exn: exn.ked,
        paths: pathedAttachmentsByLabel(this.hby, saider.qb64),
      });
    }
    return exns;
  }

  private verifyMembership(route: string, payload: Record<string, unknown>): string | null {
    if (route === MULTISIG_ICP_ROUTE) {
      const mids = routeMembers(payload);
      return mids.some((mid) => this.isLocalHab(mid))
        ? null
        : `Invalid request to join group; no local member in mids=${mids.join(",")}.`;
    }

    if (route === MULTISIG_ROT_ROUTE) {
      const gid = stringField(payload, "gid");
      if (!gid) {
        return "Missing multisig group identifier.";
      }
      if (this.isLocalHab(gid)) {
        return null;
      }
      const mids = routeMembers(payload);
      return mids.some((mid) => this.isLocalHab(mid))
        ? null
        : `Invalid request to join group; no local member in mids=${mids.join(",")}.`;
    }

    if (route.startsWith("/multisig/")) {
      const gid = stringField(payload, "gid");
      if (!gid) {
        return "Missing multisig group identifier.";
      }
      return this.isLocalHab(gid) ? null : `Invalid request to participate in group; not a local member of gid=${gid}.`;
    }

    return `Invalid route ${route} for multisig exchange.`;
  }

  private isLocalHab(pre: string): boolean {
    return pre.length > 0 && this.hby.habs.has(pre);
  }
}

/** Extract the embedded business EXN SAD from a `/multisig/exn` wrapper. */
export function embeddedBusinessExnSAD(serder: SerderKERI): Record<string, unknown> | null {
  const embed = serder.ked ? embeddedSection(serder.ked) : null;
  const exn = embed && isRecord(embed["exn"]) ? embed["exn"] : null;
  return exn ? { ...exn } : null;
}

/** Extract raw attachment bytes for one label from a stored multisig wrapper. */
export function multisigPathedAttachment(
  hby: Habery,
  wrapperSaid: string,
  label: string,
): Uint8Array {
  const path = `/e/${label}`;
  for (const text of hby.db.epath.get([wrapperSaid])) {
    const atc = pathedAttachmentForPath(textEncoder.encode(text), path);
    if (atc) {
      return atc;
    }
  }
  return new Uint8Array();
}

function pathedAttachmentsByLabel(hby: Habery, wrapperSaid: string): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const text of hby.db.epath.get([wrapperSaid])) {
    const raw = textEncoder.encode(text);
    const counter = new Counter({ qb64b: raw });
    const pather = parsePather(raw.slice(counter.fullSize), "txt");
    const label = pather.path.split("/").at(-1);
    if (label) {
      paths[label] = textDecoder.decode(raw.slice(counter.fullSize + pather.fullSize));
    }
  }
  return paths;
}

function pathedAttachmentForPath(raw: Uint8Array, path: string): Uint8Array | null {
  if (raw.length === 0) {
    return null;
  }
  const counter = new Counter({ qb64b: raw });
  const offset = counter.fullSize;
  const pather = parsePather(raw.slice(offset), "txt");
  if (pather.path !== path) {
    return null;
  }
  return raw.slice(offset + pather.fullSize);
}

function exchangeOptions(member: Hab, options: MultisigBuilderOptions) {
  return {
    sender: member.pre,
    stamp: options.stamp,
    date: options.date,
    version: options.version,
    pvrsn: options.pvrsn,
    gvrsn: options.gvrsn,
    kind: options.kind,
  };
}

function embeddedSection(ked: Record<string, unknown>): Record<string, unknown> | null {
  if (isRecord(ked.e) && typeof ked.e.d === "string") {
    return ked.e;
  }
  const attrs = payloadSection(ked);
  return isRecord(attrs.e) && typeof attrs.e.d === "string" ? attrs.e : null;
}

function payloadSection(ked: Record<string, unknown>): Record<string, unknown> {
  return isRecord(ked.a) ? ked.a : {};
}

function routeMembers(payload: Record<string, unknown>): string[] {
  return [
    ...stringArrayField(payload, "smids"),
    ...stringArrayField(payload, "rmids"),
  ];
}

function stringArrayField(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

function groupPrefix(group: string | Hab): string {
  return typeof group === "string" ? group : group.pre;
}

function requireString(value: string | null, label: string): string {
  if (!value) {
    throw new Error(`Missing ${label}.`);
  }
  return value;
}

function rawMessage(message: Uint8Array | RawMessage): Uint8Array {
  return message instanceof Uint8Array ? message : message.raw;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
