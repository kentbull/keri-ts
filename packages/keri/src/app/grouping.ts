/**
 * KERIpy-shaped multisig exchange coordination.
 *
 * This module owns the `/multisig/*` EXN family used to coordinate group
 * registry, credential, reply, and wrapped business EXN proposals. It does not
 * own group key-event counseling; local group habitat state still lives under
 * `Habery.makeGroupHab(...)`, `Baser.habs`, and the keeper member stores.
 */
import {
  type CesrFrame,
  collectPayload,
  concatBytes,
  Counter,
  discardFrame,
  type Kind,
  nestedPayload,
  parseBytes,
  parsePather,
  Prefixer,
  ResourceLimitError,
  Saider,
  SerderKERI,
  type Versionage,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { toEffectionFrames } from "cesr-ts/effection";
import { call, each, type Operation } from "effection";
import { Kevery } from "../core/eventing.ts";
import { exchange, nestedMultisigIlks } from "../core/protocol-exchanging.ts";
import { BasicReplyRouteHandler, Revery, Router } from "../core/routing.ts";
import { abortable } from "./abortable.ts";
import { Exchanger, type ExchangeRouteHandler } from "./exchanging.ts";
import type { Hab, Habery } from "./habbing.ts";
import type { Notifier } from "./notifying.ts";
import { dispatchEnvelope, envelopeFromFrame } from "./parsering.ts";

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
  /** Explicit attachment genus for a v1 child carried under a v2 wrapper. */
  childGvrsn?: Versionage;
  stamp?: string;
  date?: string;
  version?: Versionage;
  pvrsn?: Versionage;
  gvrsn?: Versionage | null;
  kind?: Kind;
}

/** Unsigned wrapper plus supplemental path/child bytes; enclose these with parent signatures when sending v2. */
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
export function* multisigInceptExn(
  member: Hab,
  smids: readonly string[],
  rmids: readonly string[] | null,
  icp: Uint8Array | RawMessage,
  delegator?: string | null,
  options: MultisigBuilderOptions = {},
): Operation<MultisigMessage> {
  const attrs: Record<string, unknown> = {
    smids: [...smids],
    rmids: [...(rmids ?? smids)],
  };
  if (delegator) {
    attrs.delegator = delegator;
  }

  return yield* prepareMultisigEventExn(member.pre, MULTISIG_ICP_ROUTE, attrs, rawMessage(icp), options);
}

/** Coordinate one proposed group rotation event. */
export function* multisigRotateExn(
  group: string | Hab,
  member: Hab,
  smids: readonly string[],
  rmids: readonly string[],
  rot: Uint8Array | RawMessage,
  options: MultisigBuilderOptions = {},
): Operation<MultisigMessage> {
  return yield* prepareMultisigEventExn(
    member.pre,
    MULTISIG_ROT_ROUTE,
    {
      gid: groupPrefix(group),
      smids: [...smids],
      rmids: [...rmids],
    },
    rawMessage(rot),
    options,
  );
}

/** Coordinate one proposed group interaction event. */
export function* multisigInteractExn(
  group: string | Hab,
  member: Hab,
  aids: readonly string[],
  ixn: Uint8Array | RawMessage,
  options: MultisigBuilderOptions = {},
): Operation<MultisigMessage> {
  return yield* prepareMultisigEventExn(
    member.pre,
    MULTISIG_IXN_ROUTE,
    {
      gid: groupPrefix(group),
      smids: [...aids],
    },
    rawMessage(ixn),
    options,
  );
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
export function* multisigRpyExn(
  group: string | Hab,
  member: Hab,
  rpy: Uint8Array | RawMessage,
  options: MultisigBuilderOptions = {},
): Operation<MultisigMessage> {
  return yield* prepareMultisigEventExn(
    member.pre,
    MULTISIG_RPY_ROUTE,
    {
      gid: groupPrefix(group),
    },
    rawMessage(rpy),
    options,
  );
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

/**
 * Construct only the v2 parent body from an already parsed KERI child.
 * This synchronous boundary checks the route/ilk and commits the child's SAID;
 * it neither authenticates child proofs nor reads, adopts, or disposes any payload.
 * Callers with a CesrFrame borrow its wire through nestedPayload(frame, Vrsn_2_0).
 */
export function multisigExnBody(
  sender: string,
  route: MultisigRoute,
  child: SerderKERI,
  attrs: Record<string, unknown>,
  options: Omit<MultisigBuilderOptions, "childGvrsn"> = {},
): SerderKERI {
  const pvrsn = options.pvrsn ?? options.version ?? Vrsn_2_0;
  if (pvrsn.major !== 2) throw new Error("Nested multisig bodies require protocol v2.");
  if (!child.said || !nestedMultisigIlks(route)?.includes(child.ilk ?? "")) {
    throw new Error("Multisig proposal requires a supported route and child kind.");
  }
  const field = route.slice(route.lastIndexOf("/") + 1);
  const payload = route === MULTISIG_ICP_ROUTE
    ? { gid: requireString(child.pre, "group inception prefix"), ...attrs, [field]: child.said }
    : { ...attrs, [field]: child.said };
  return exchange(route, payload, { ...options, sender, pvrsn })[0];
}

/**
 * Own finite byte-input preparation: parse once, construct the body, consume wire, dispose.
 * The v1 pathed path retains its established encoding; v2 delegates parsing to parseBytes
 * and borrows the resulting child only until nestedPayload has been fully consumed.
 * No lazy owner escapes. Effection cancellation aborts reads and joins finally cleanup.
 * Sending v2 requires enclosing these bytes and the parent's signatures together.
 */
export function* prepareMultisigEventExn(
  sender: string,
  route: MultisigRoute,
  attrs: Record<string, unknown>,
  wire: Uint8Array,
  options: MultisigBuilderOptions = {},
): Operation<MultisigMessage> {
  const version = options.pvrsn ?? options.version ?? Vrsn_1_0;
  const field = route.slice(route.lastIndexOf("/") + 1);
  if (version.major === 1) {
    const payload = route === MULTISIG_ICP_ROUTE
      ? { gid: requireString(new SerderKERI({ raw: wire }).pre, "group inception prefix"), ...attrs }
      : attrs;
    return exchange(route, payload, { ...options, sender, embeds: { [field]: wire } });
  }
  return yield* abortable(async (signal) => {
    // Let the parser infer body genus; only an explicit counter override adds a selector.
    const selector = options.childGvrsn ? Counter.makeGVC(options.childGvrsn) : new Uint8Array();
    if (wire.length > 8 * 1024 ** 2 - selector.length) {
      throw new ResourceLimitError("Multisig input exceeds collection limit");
    }
    const input = selector.length ? concatBytes(selector, wire) : wire;
    const frames = await parseBytes(input, { signal });
    const errors: unknown[] = [];
    try {
      const child = frames[0];
      if (frames.length !== 1 || !(child.body instanceof SerderKERI) || child.nests?.length) {
        throw new Error("Multisig proposal requires one supported direct child.");
      }
      const serder = multisigExnBody(sender, route, child.body, attrs, options);
      return [serder, await collectPayload(nestedPayload(child, Vrsn_2_0), 8 * 1024 ** 2, signal)] as const;
    } catch (error) {
      errors.push(error);
      throw error;
    } finally {
      // Even rejected multi-frame input must join every owner's cleanup if one discard fails.
      const results = await Promise.allSettled(frames.map(discardFrame));
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length) {
        // deno-lint-ignore no-unsafe-finally -- Retain construction failure alongside every joined cleanup failure.
        throw new AggregateError([...errors, ...failures.map((result) => result.reason)], "Multisig cleanup failed");
      }
    }
  });
}

/** Route handler that forwards accepted multisig EXNs to the `Multiplexor`. */
export class MultisigNotificationHandler implements ExchangeRouteHandler {
  readonly resource: MultisigRoute;
  private readonly mux: Multiplexor;

  /** Bind one registered route to its shared approval coordinator. */
  constructor(resource: MultisigRoute, mux: Multiplexor) {
    this.resource = resource;
    this.mux = mux;
  }

  /** Only the four frozen-reference v2 routes have child consumers. */
  get acceptsNests(): boolean {
    return nestedMultisigIlks(this.resource) !== null;
  }

  /** Authenticate the signed child relationship before exchange evidence is published. */
  verify(args: { serder: SerderKERI; nests?: readonly CesrFrame[] }): boolean {
    return args.serder.route === this.resource && this.mux.verify(args.serder, args.nests);
  }

  /** Borrow persisted children until approval replay and coordination indexing finish. */
  *handle(args: { serder: SerderKERI; nests?: readonly CesrFrame[] }): Operation<void> {
    yield* this.mux.add(args.serder, args.nests);
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
  /** Approval replay owns separate processors, as in frozen KERIpy Multiplexor. */
  readonly kvy: Kevery;
  readonly rvy: Revery;
  private readonly replay: Exchanger;

  /** Reuse durable group membership and separate child processors without sharing parent proof state. */
  constructor(
    hby: Habery,
    { notifier }: { notifier?: Notifier | null } = {},
  ) {
    this.hby = hby;
    this.notifier = notifier ?? null;
    const router = new Router();
    this.rvy = new Revery(hby.db, { rtr: router });
    new BasicReplyRouteHandler(hby.db, this.rvy).registerReplyRoutes(router);
    this.kvy = new Kevery(hby.db, { lax: false, local: false, rvy: this.rvy });
    this.kvy.registerReplyRoutes(router);
    this.replay = new Exchanger(hby);
  }

  /** Index an authenticated proposal; child acceptance still requires local approval and its own proofs. */
  *add(serder: SerderKERI, nests: readonly CesrFrame[] = []): Operation<MultisigDecision> {
    const inspection = this.inspect(serder, nests);
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
    const submitters = this.hby.db.maids.get([embeddedSaid]);
    if (!this.isLocalHab(sender)) {
      if (serder.pvrsn.major === 2 && submitters.some((submitter) => this.isLocalHab(submitter.qb64))) {
        // The parent is durable, but approval never lends its signatures to the child.
        yield* this.processApproved(nests);
      } else if (serder.pvrsn.major === 2 || firstSubmission) {
        // Legacy approval polling consumes its first notice; repeated v1 notices would re-propose it.
        this.notifier?.add(firstSubmission ? { r: route, d: said } : { r: route, d: said, e: embeddedSaid });
      }
    } else if (serder.pvrsn.major === 2 && submitters.some((submitter) => !this.isLocalHab(submitter.qb64))) {
      // Remote evidence can precede approval. Replay one durable wrapper at a time after reopen.
      for (const prior of existing) yield* call(() => this.replayApproved(prior.qb64));
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
  verify(serder: SerderKERI, nests: readonly CesrFrame[] = []): boolean {
    return this.inspect(serder, nests).ok;
  }

  /** Process only the approved direct child; arbitrary descendants remain guarded. */
  private *processApproved(nests: readonly CesrFrame[]): Operation<void> {
    for (const child of nests) {
      yield* dispatchEnvelope(envelopeFromFrame(child, true), this.rvy, this.kvy);
    }
  }

  /** Reopen original evidence through the exchange replay owner; cancellation joins all temporary files. */
  private *replayApproved(said: string): Operation<void> {
    const channel = yield* toEffectionFrames((signal) => this.replay.replay(said, signal), {
      payloadSink: async (limit, signal) => (await this.hby.db.openPayloads(signal)).files.stage(limit, signal),
    });
    for (const frame of yield* each(channel.frames)) {
      try {
        const serder = frame.body as SerderKERI;
        if (!this.verify(serder, frame.nests)) throw new Error("Stored multisig proposal failed revalidation.");
        yield* this.processApproved(frame.nests ?? []);
      } finally {
        yield* call(() => discardFrame(frame));
      }
      yield* each.next();
    }
  }

  /** Check route, child body commitment, and membership without mutating durable state. */
  private inspect(serder: SerderKERI, nests: readonly CesrFrame[]): MultisigInspection {
    const said = serder.said ?? "<unknown>";
    const ked = serder.ked;
    if (!ked) {
      return { ok: false, said, reason: "Missing decoded exchange body." };
    }

    const sender = serder.pre ?? "";
    const route = serder.route ?? "";
    const payload = payloadSection(ked);
    let embeddedSaid: string;
    if (serder.pvrsn.major === 1) {
      const embed = embeddedSection(ked);
      if (!embed || typeof embed.d !== "string" || !embed.d || nests.length) {
        return { ok: false, said, reason: "Missing multisig embedded SAID or unexpected v1 nesting." };
      }
      embeddedSaid = embed.d;
    } else {
      const allowed = nestedMultisigIlks(route);
      if (!allowed || nests.length !== 1) {
        return { ok: false, said, reason: "Unsupported nested multisig route or child count." };
      }
      const child = nests[0];
      const signed = payload[route.slice(route.lastIndexOf("/") + 1)];
      if (
        typeof signed !== "string" || !child.body.said || !allowed.includes(child.body.ilk ?? "")
        || !(child.body instanceof SerderKERI) || child.nests?.length
      ) {
        return { ok: false, said, reason: "Invalid multisig child kind, descendants, or signed SAID." };
      }
      try {
        if (!child.body.verify() || !child.body.compare(signed)) {
          return { ok: false, said, reason: "Invalid multisig child digest." };
        }
      } catch {
        return { ok: false, said, reason: "Invalid multisig child commitment." };
      }
      embeddedSaid = signed;
    }

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
