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
  type Kind,
  nestedPayload,
  parse,
  parseBytes,
  parsePather,
  Prefixer,
  Saider,
  Serder,
  SerderKERI,
  type Versionage,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, ensure, type Operation } from "effection";
import { Kevery } from "../core/eventing.ts";
import { exchange, nestedMultisigIlks } from "../core/protocol-exchanging.ts";
import { BasicReplyRouteHandler, Revery, Router } from "../core/routing.ts";
import { abortable, rethrowCleanupFailure } from "./abortable.ts";
import { Exchanger, type ExchangeRouteHandler } from "./exchanging.ts";
import type { Hab, Habery } from "./habbing.ts";
import { multisigEmbeddedSection, multisigPayloadSaid } from "./multisig-messaging.ts";
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

/** Event proposal input; each supported route requires its own attributes. Child commitments are derived. */
export type MultisigEventProposal =
  | {
    route: typeof MULTISIG_ICP_ROUTE;
    attrs: { smids: readonly string[]; rmids: readonly string[]; delegator?: string };
  }
  | {
    route: typeof MULTISIG_ROT_ROUTE;
    attrs: { gid: string; smids: readonly string[]; rmids: readonly string[] };
  }
  | {
    route: typeof MULTISIG_IXN_ROUTE;
    attrs: { gid: string; smids: readonly string[] };
  }
  | { route: typeof MULTISIG_RPY_ROUTE; attrs: { gid: string } };

/** Legacy registry proposals require their own named evidence, not arbitrary embed bags. */
export type MultisigVdrProposal =
  | {
    route: typeof MULTISIG_VCP_ROUTE;
    attrs: { gid: string; usage?: string; cgvrsn?: readonly [number, number] };
    embeds: { vcp: Uint8Array; anc: Uint8Array };
  }
  | {
    route: typeof MULTISIG_ISS_ROUTE;
    attrs: { gid: string; cgvrsn?: readonly [number, number] };
    embeds: { acdc: Uint8Array; iss: Uint8Array; anc: Uint8Array };
  };

/** Build an unsigned legacy VDR wrapper with its required named children. */
export function prepareMultisigVdrExn(
  sender: string,
  proposal: MultisigVdrProposal,
  options: MultisigBuilderOptions = {},
): MultisigMessage {
  return exchange(proposal.route, proposal.attrs, { ...options, sender, embeds: proposal.embeds });
}

interface RawMessage {
  readonly raw: Uint8Array;
}

export interface MultisigBuilderOptions {
  /** Destination bound into a recipient-specific proposal wrapper. */
  recipient?: string;
  /** Explicit attachment genus when a legacy child body does not declare it. */
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

/** Membership policy consumes the decoded request, never arbitrary exchange attributes. */
type MultisigMembership =
  | { kind: "join"; members: string[] }
  | { kind: "rotate"; group: string; members: string[] }
  | { kind: "participate"; group: string };

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
  return yield* prepareMultisigEventExn(
    member.pre,
    {
      route: MULTISIG_ICP_ROUTE,
      attrs: {
        smids: [...smids],
        rmids: [...(rmids ?? smids)],
        ...(delegator ? { delegator } : {}),
      },
    },
    rawMessage(icp),
    options,
  );
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
    {
      route: MULTISIG_ROT_ROUTE,
      attrs: {
        gid: groupPrefix(group),
        smids: [...smids],
        rmids: [...rmids],
      },
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
    {
      route: MULTISIG_IXN_ROUTE,
      attrs: {
        gid: groupPrefix(group),
        smids: [...aids],
      },
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
  return prepareMultisigVdrExn(member.pre, {
    route: MULTISIG_VCP_ROUTE,
    attrs: { gid: groupPrefix(group), usage },
    embeds: { vcp: rawMessage(vcp), anc: rawMessage(anc) },
  }, exchangeOptions(member, options));
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
  return prepareMultisigVdrExn(member.pre, {
    route: MULTISIG_ISS_ROUTE,
    attrs: { gid: groupPrefix(group) },
    embeds: { acdc: rawMessage(acdc), iss: rawMessage(iss), anc: rawMessage(anc) },
  }, exchangeOptions(member, options));
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
    {
      route: MULTISIG_RPY_ROUTE,
      attrs: {
        gid: groupPrefix(group),
      },
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
  proposal: MultisigEventProposal,
  child: SerderKERI,
  options: Omit<MultisigBuilderOptions, "childGvrsn"> = {},
): SerderKERI {
  const { route, attrs } = proposal;
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

/** Signed replay hint for a legacy child whose attachments use a different genus. */
export function multisigChildGenusAttrs(
  child: Serder,
  genus: Versionage,
): { cgvrsn?: readonly [number, number] } {
  return !child.gvrsn && (genus.major !== child.pvrsn.major || genus.minor !== child.pvrsn.minor)
    ? { cgvrsn: [genus.major, genus.minor] }
    : {};
}
/**
 * Prepare finite child input, construct the parent and serialize its nested evidence.
 * The v1 pathed path retains its established encoding; v2 delegates parsing to parseBytes
 * once and borrows the resulting child only until nestedPayload has been fully consumed.
 * Parsed child evidence consists of ordinary values; serialization observes cancellation.
 * Sending v2 requires enclosing these bytes and the parent's signatures together.
 */
export function* prepareMultisigEventExn(
  sender: string,
  proposal: MultisigEventProposal,
  wire: Uint8Array,
  options: MultisigBuilderOptions = {},
): Operation<MultisigMessage> {
  // Keep the route selection stable through parser suspension; attribute values remain immutable borrows.
  const captured = { ...proposal };
  const { route, attrs } = captured;
  const version = options.pvrsn ?? options.version ?? Vrsn_1_0;
  const field = route.slice(route.lastIndexOf("/") + 1);
  if (version.major === 1) {
    const child = new SerderKERI({ raw: wire });
    const genus = options.childGvrsn ?? child.gvrsn ?? child.pvrsn;
    // KERIpy replays a legacy embed using this signed hint when body and attachment versions differ.
    const hint = multisigChildGenusAttrs(child, genus);
    const payload = route === MULTISIG_ICP_ROUTE
      ? { gid: requireString(child.pre, "group inception prefix"), ...attrs, ...hint }
      : { ...attrs, ...hint };
    return exchange(route, payload, { ...options, sender, embeds: { [field]: wire } });
  }
  return yield* abortable(async (signal) => {
    // Let the parser infer body genus; only an explicit counter override adds a selector.
    const selector = options.childGvrsn ? Counter.makeGVC(options.childGvrsn) : new Uint8Array();
    const input = selector.length ? concatBytes(selector, wire) : wire;
    const frames = parseBytes(input);
    const child = frames[0];
    if (frames.length !== 1 || !(child.body instanceof SerderKERI) || child.nests?.length) {
      throw new Error("Multisig proposal requires one supported direct child.");
    }
    const serder = multisigExnBody(sender, captured, child.body, options);
    return [serder, await collectPayload(nestedPayload(child, Vrsn_2_0), signal)] as const;
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
    new BasicReplyRouteHandler(this.rvy).registerReplyRoutes(router);
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
    const { existing, submitters } = this.hby.db.env!.transactionSync(() => {
      const existing = this.hby.db.meids.get([embeddedSaid]);
      const submitters = this.hby.db.maids.get([embeddedSaid]);
      // Approval is the authenticated wrapper, not completion of its asynchronous child replay.
      this.hby.db.meids.add([embeddedSaid], new Saider({ qb64: said }));
      this.hby.db.maids.add([embeddedSaid], new Prefixer({ qb64: sender }));
      return { existing, submitters };
    });
    const firstSubmission = existing.length === 0;
    if (!this.isLocalHab(sender)) {
      if (submitters.some((submitter) => this.isLocalHab(submitter.qb64))) {
        // The parent is durable, but approval never lends its signatures to the child.
        if (serder.pvrsn.major === 1) yield* this.processLegacyApproved(serder);
        else yield* this.processApproved(nests);
      } else if (serder.pvrsn.major === 2 || firstSubmission) {
        // Legacy approval polling consumes its first notice; repeated v1 notices would re-propose it.
        this.notifier?.add(firstSubmission ? { r: route, d: said } : { r: route, d: said, e: embeddedSaid });
      }
    } else if (submitters.some((submitter) => !this.isLocalHab(submitter.qb64))) {
      // Remote evidence can precede approval. Replay one durable wrapper at a time after reopen.
      for (const prior of existing) yield* call(() => this.replayApproved(prior.qb64));
    }

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
  /** Replay v1 children with their own stored proofs and signed attachment genus, as KERIpy does. */
  private *processLegacyApproved(wrapper: SerderKERI): Operation<void> {
    const embeds = multisigEmbeddedSection(wrapper.ked!);
    for (const label of Object.keys(embeds ?? {})) {
      const sad = embeds?.[label];
      if (!isRecord(sad)) {
        continue;
      }
      const event = new Serder({ sad });
      const { attachment, genus } = multisigChildEvidence(this.hby, wrapper, label, event);
      for (const frame of parseBytes(concatBytes(Counter.makeGVC(genus), event.raw, attachment))) {
        yield* dispatchEnvelope(envelopeFromFrame(frame, true), this.rvy, this.kvy);
      }
    }
  }
  /** Reopen stored evidence and revalidate it before approved protocol processing. */
  private replayApproved(said: string): Operation<void> {
    // deno-lint-ignore no-this-alias -- Generator callbacks have no lexical this.
    const self = this;
    return call(function*() {
      const controller = new AbortController();
      const signal = controller.signal;
      try {
        signal.throwIfAborted();
        const frames = parse(self.replay.replay(said, signal));
        let pending: ReturnType<typeof frames.next> | undefined;
        // The earlier resource joins the read after processing children stop.
        yield* ensure(function*() {
          try {
            if (pending) {
              try {
                yield* call(() => pending!);
              } catch (error) {
                rethrowCleanupFailure(error, signal);
              }
            }
          } finally {
            yield* call(() => frames.return());
          }
        });
        while (true) {
          signal.throwIfAborted();
          pending = frames.next();
          let result: Awaited<typeof pending>;
          try {
            result = yield* call(() => pending!);
          } catch (error) {
            pending = undefined;
            throw error;
          }
          pending = undefined;
          signal.throwIfAborted();
          if (result.done) break;
          const frame = result.value;
          const serder = frame.body as SerderKERI;
          if (!self.verify(serder, frame.nests)) throw new Error("Stored multisig proposal failed revalidation.");
          if (serder.pvrsn.major === 1) yield* self.processLegacyApproved(serder);
          else yield* self.processApproved(frame.nests ?? []);
        }
      } finally {
        controller.abort();
      }
    });
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
    let embeddedSaid: string;
    if (serder.pvrsn.major === 1) {
      const commitment = multisigPayloadSaid(serder);
      if (!commitment || nests.length) {
        return { ok: false, said, reason: "Missing multisig embedded SAID or unexpected v1 nesting." };
      }
      if (childGenusHint(ked.a) === null) {
        return { ok: false, said, reason: "Invalid multisig child attachment genus." };
      }
      embeddedSaid = commitment;
    } else {
      const allowed = nestedMultisigIlks(route);
      if (!allowed || nests.length !== 1) {
        return { ok: false, said, reason: "Unsupported nested multisig route or child count." };
      }
      const child = nests[0];
      const signed = multisigPayloadSaid(serder);
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

    const request = multisigMembership(route, ked.a);
    const membership = request.kind === "reject" ? request.reason : this.verifyMembership(request);
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

  /** Apply local habitat membership to an already decoded request. */
  private verifyMembership(request: MultisigMembership): string | null {
    if (request.kind === "participate") {
      return this.isLocalHab(request.group)
        ? null
        : `Invalid request to participate in group; not a local member of gid=${request.group}.`;
    }
    if (request.kind === "rotate" && this.isLocalHab(request.group)) {
      return null;
    }
    return request.members.some((member) => this.isLocalHab(member))
      ? null
      : `Invalid request to join group; no local member in mids=${request.members.join(",")}.`;
  }

  private isLocalHab(pre: string): boolean {
    return pre.length > 0 && this.hby.habs.has(pre);
  }
}

/** Extract the embedded business EXN SAD from a `/multisig/exn` wrapper. */
export function embeddedBusinessExnSAD(serder: SerderKERI): Record<string, unknown> | null {
  const embed = serder.ked ? multisigEmbeddedSection(serder.ked) : null;
  const exn = embed && isRecord(embed["exn"]) ? embed["exn"] : null;
  return exn ? { ...exn } : null;
}

/** Decoded v1 child and its own proof bytes; the signed hint cannot override a body's explicit genus. */
export interface MultisigChild {
  event: SerderKERI;
  attachment: Uint8Array;
  genus: Versionage;
}
/** Read one stored v1 child at the wire boundary, without authenticating its independent proof. */
export function multisigChild(hby: Habery, wrapper: SerderKERI, label: string): MultisigChild | null {
  const sad = multisigEmbeddedSection(wrapper.ked ?? {})?.[label];
  if (!isRecord(sad)) {
    return null;
  }
  const event = new SerderKERI({ sad });
  return { event, ...multisigChildEvidence(hby, wrapper, label, event) };
}

/** Resolve the stored proof and signed genus independently of the child protocol. */
function multisigChildEvidence(
  hby: Habery,
  wrapper: SerderKERI,
  label: string,
  child: Serder,
): { attachment: Uint8Array; genus: Versionage } {
  const attachment = multisigPathedAttachment(hby, wrapper.said!, label);
  const hint = attachment.length ? childGenusHint(wrapper.ked?.a) : undefined;
  return { attachment, genus: child.gvrsn ?? hint ?? child.pvrsn };
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

/** Decode the signed legacy child-genus hint before it can select attachment parsing. */
function childGenusHint(attrs: unknown): Versionage | null | undefined {
  if (!isRecord(attrs) || attrs.cgvrsn === undefined) return undefined;
  const hint = attrs.cgvrsn;
  if (
    !Array.isArray(hint) || hint.length !== 2
    || (hint[0] !== 1 && hint[0] !== 2)
    || typeof hint[1] !== "number" || !Number.isInteger(hint[1]) || hint[1] < 0 || hint[1] > 4095
  ) {
    return null;
  }
  return { major: hint[0], minor: hint[1] };
}

function payloadSection(ked: Record<string, unknown>): Record<string, unknown> {
  return isRecord(ked.a) ? ked.a : {};
}

/** Decode only membership fields; handler registration owns supported route selection. */
function multisigMembership(route: string, value: unknown): MultisigMembership | { kind: "reject"; reason: string } {
  const attrs = isRecord(value) ? value : {};
  if (route === MULTISIG_ICP_ROUTE) {
    return { kind: "join", members: memberPrefixes(attrs.smids, attrs.rmids) };
  }
  // KERIpy also applies group membership to the whole /multisig/* family.
  if (!route.startsWith("/multisig/")) {
    return { kind: "reject", reason: `Invalid route ${route} for multisig exchange.` };
  }
  if (typeof attrs.gid !== "string" || !attrs.gid) {
    return { kind: "reject", reason: "Missing multisig group identifier." };
  }
  return route === MULTISIG_ROT_ROUTE
    ? { kind: "rotate", group: attrs.gid, members: memberPrefixes(attrs.smids, attrs.rmids) }
    : { kind: "participate", group: attrs.gid };
}

/** Preserve the existing optional-list and non-string filtering at the wire boundary. */
function memberPrefixes(smids: unknown, rmids: unknown): string[] {
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return [...strings(smids), ...strings(rmids)];
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
