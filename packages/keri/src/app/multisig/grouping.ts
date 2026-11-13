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
  SerderACDC,
  SerderKERI,
  type Versionage,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, ensure, type Operation } from "effection";
import type { RegistryObserver } from "../../acdc/observing.ts";
import { type RegistryEvent, validateRip, validateUpdate } from "../../acdc/regeventing.ts";
import type { RegistryStore } from "../../acdc/registering.ts";
import { ValidationError } from "../../core/errors.ts";
import {
  exchange,
  isIpexVerb,
  isV2RegistryRoute,
  multisigChildField,
  nestedIpexRoute,
  nestedMultisigIlks,
} from "../../core/exchange/protocol-exchanging.ts";
import { Kevery } from "../../core/kel/eventing.ts";
import { BasicReplyRouteHandler, Revery, Router } from "../../core/routing.ts";
import { Exchanger, type ExchangeRouteHandler, type ExchangeRouteVerification } from "../exchanges/exchanging.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { IpexV2Handler } from "../ipex/ipex-v2.ts";
import type { Notifier } from "../notifications/notifying.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../protocol/parsering.ts";
import { abortable, rethrowCleanupFailure } from "../runtime/abortable.ts";
import { groupSigningMembers, localIpexContribution } from "./group-members.ts";
import { multisigEmbeddedSection, multisigPayloadSaid } from "./multisig-messaging.ts";

/** KERIpy multisig route constants. */
export const MULTISIG_ICP_ROUTE = "/multisig/icp";
export const MULTISIG_ROT_ROUTE = "/multisig/rot";
export const MULTISIG_IXN_ROUTE = "/multisig/ixn";
export const MULTISIG_RIP_ROUTE = "/multisig/rip";
export const MULTISIG_BUP_ROUTE = "/multisig/bup";
export const MULTISIG_VCP_ROUTE = "/multisig/vcp";
export const MULTISIG_ISS_ROUTE = "/multisig/iss";
export const MULTISIG_REV_ROUTE = "/multisig/rev";
export const MULTISIG_EXN_ROUTE = "/multisig/exn";
export const MULTISIG_RPY_ROUTE = "/multisig/rpy";
/** Local v2 coordination profile routes, as in KERIpy core; not upstream KERI or #1740 routes. */
export const MULTISIG_QRY_ROUTE = "/multisig/qry";
export const MULTISIG_IPEX_PROOF_ROUTE = "/multisig/ipex-proof";

/** The routes whose wrapper commits one exact child, as group issuance wraps its Grant, queries, replies and proof. */
export type MultisigChildRoute =
  | typeof MULTISIG_EXN_ROUTE
  | typeof MULTISIG_QRY_ROUTE
  | typeof MULTISIG_RPY_ROUTE
  | typeof MULTISIG_IPEX_PROOF_ROUTE;

/** Ordered route list used for handler registration. */
export const MULTISIG_ROUTES = [
  MULTISIG_RIP_ROUTE,
  MULTISIG_BUP_ROUTE,
  MULTISIG_ICP_ROUTE,
  MULTISIG_ROT_ROUTE,
  MULTISIG_IXN_ROUTE,
  MULTISIG_VCP_ROUTE,
  MULTISIG_ISS_ROUTE,
  MULTISIG_REV_ROUTE,
  MULTISIG_EXN_ROUTE,
  MULTISIG_RPY_ROUTE,
  MULTISIG_QRY_ROUTE,
  MULTISIG_IPEX_PROOF_ROUTE,
] as const;

/** Children whose verification needs caller-owned processors; the Multiplexor indexes and notifies only. */
const UNREPLAYED_ROUTES: readonly string[] = [MULTISIG_QRY_ROUTE, MULTISIG_IPEX_PROOF_ROUTE];

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
  | { route: typeof MULTISIG_RPY_ROUTE; attrs: { gid: string } }
  | { route: typeof MULTISIG_EXN_ROUTE; attrs: { gid: string } }
  | { route: typeof MULTISIG_QRY_ROUTE; attrs: { gid: string } }
  | { route: typeof MULTISIG_IPEX_PROOF_ROUTE; attrs: { gid: string } };

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
  }
  | {
    route: typeof MULTISIG_REV_ROUTE;
    attrs: { gid: string; said: string; cgvrsn?: readonly [number, number] };
    embeds: { rev: Uint8Array; anc: Uint8Array };
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
  registry?: RegistryObserver | null;
  messageKevery?: Kevery;
}

/** Validate public TEL linkage before proposing or signing an anchor; no state is inferred from b. */
export function registryProposalEvent(tel: SerderACDC, gid: string, store: RegistryStore | null): RegistryEvent | null {
  const checked = tel.ilk === "rip" ? validateRip(tel, gid) : validateUpdate(tel, tel.regid ?? "");
  if (checked.kind !== "valid" || tel.pvrsn.major !== 2 || tel.pvrsn.minor !== 0) {
    return null;
  }
  if (tel.ilk === "rip") {
    return checked.event;
  }
  const rip = store?.seqEvent(checked.event.regid, 0);
  const inception = rip && validateRip(rip, gid);
  const head = store?.headEvent(checked.event.regid);
  if (!rip || !head || !inception || inception.kind !== "valid" || rip.pvrsn.major !== 2 || rip.pvrsn.minor !== 0) {
    return null;
  }
  const headSn = BigInt(`0x${head.sad!.n}`);
  const sn = checked.event.sn;
  if (sn > headSn + 1n || sn > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  const accepted = store!.seqEvent(rip.said!, Number(sn));
  if (accepted) {
    return sameBytes(accepted.raw, tel.raw) ? checked.event : null;
  }
  return sn === headSn + 1n && checked.event.prior === head.said ? checked.event : null;
}

/** Exact authenticated consent may share an anchor index with unrelated v2 TEL proposals. */
export function sameRegistryProposal(left: SerderKERI, right: SerderKERI): boolean {
  const a = left.sad?.a;
  const b = right.sad?.a;
  return isV2RegistryRoute(left.route ?? "") && left.route === right.route && isRecord(a) && isRecord(b)
    && ["gid", "tel", "anc"].every(field => a[field] === b[field]);
}

/** Validate both child commitments and every supplied source coordinate without writing evidence. */
export function acdcV2RegistryProposal(wrapper: SerderKERI, nests: readonly CesrFrame[], store: RegistryStore | null) {
  const payload = wrapper.sad?.a;
  const route = wrapper.route ?? "";
  if (
    !isV2RegistryRoute(route) || !isRecord(payload) || typeof payload.gid !== "string" || nests.length !== 2
    || wrapper.pvrsn.major !== 2 || wrapper.pvrsn.minor !== 0
  ) {
    return null;
  }
  const [tel, anchor] = nests.map(child => child.body);
  if (
    !(tel instanceof SerderACDC) || !(anchor instanceof SerderKERI) || route !== `/multisig/${tel.ilk}`
    || nests.some(child => child.nests?.length) || tel.said !== payload.tel || anchor.said !== payload.anc
    || anchor.pvrsn.major !== 2 || anchor.pvrsn.minor !== 0 || !anchor.verify()
    || anchor.pre !== payload.gid || !["ixn", "rot", "drt"].includes(anchor.ilk ?? "")
  ) {
    return null;
  }
  const event = registryProposalEvent(tel, payload.gid, store);
  if (
    !event || !anchor.seals.some(seal =>
      isRecord(seal) && seal.i === event.regid
      && seal.s === tel.sad!.n && seal.d === tel.said
    )
  ) {
    return null;
  }
  const evidence = envelopeFromFrame(nests[0]);
  if (
    evidence.sscs.some(seal => seal.s.num !== BigInt(anchor.sn!) || seal.d.qb64 !== anchor.said)
    || evidence.ssts.some(seal =>
      seal.i.qb64 !== payload.gid
      || seal.s.num !== BigInt(anchor.sn!) || seal.d.qb64 !== anchor.said
    )
  ) {
    return null;
  }
  return { tel, anchor };
}

/** Compare retained event bytes without normalizing their signed representation. */
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Commit one exact ACDC v2 registry/anchor pair using the ordinary nested-wire serializer. */
export function* prepareAcdcV2RegistryExn(
  sender: string,
  tel: Uint8Array,
  anchor: Uint8Array,
  store: RegistryStore | null,
  options: MultisigBuilderOptions = {},
): Operation<MultisigMessage> {
  const children = [tel, anchor].map(wire => parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), wire)));
  if (children.some(frames => frames.length !== 1)) {
    throw new Error("ACDC v2 registry proposal requires one TEL and one KEL event.");
  }
  const nests = children.map(frames => frames[0]);
  if (!(nests[1].body instanceof SerderKERI)) throw new Error("ACDC v2 registry anchor must be KERI.");
  const wrapper = exchange(`/multisig/${nests[0].body.ilk}`, {
    gid: nests[1].body.pre,
    tel: nests[0].body.said,
    anc: nests[1].body.said,
  }, {
    ...options,
    sender,
    version: Vrsn_2_0,
  })[0];
  if (!acdcV2RegistryProposal(wrapper, nests, store)) throw new Error("Invalid ACDC v2 registry proposal.");
  const parts = yield* abortable(signal =>
    Promise.all(nests.map(child => collectPayload(nestedPayload(child, Vrsn_2_0), signal)))
  );
  return [wrapper, concatBytes(...parts)] as const;
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
  return prepareMultisigVdrExn(member.pre, {
    route: MULTISIG_REV_ROUTE,
    attrs: { gid: groupPrefix(group), said },
    embeds: { rev: rawMessage(rev), anc: rawMessage(anc) },
  }, exchangeOptions(member, options));
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

/**
 * Propose one exact signed v2 query authored by the group to its members.
 *
 * KERIpy `multisigQueryExn`: local v2 coordination profile route `/multisig/qry`
 * whose `a` is `{gid, qry}` and whose single nested substream is the query stream.
 */
export function* multisigQueryExn(
  group: string | Hab,
  member: Hab,
  qry: Uint8Array | RawMessage,
  options: Omit<MultisigBuilderOptions, "version" | "pvrsn"> = {},
): Operation<MultisigMessage> {
  return yield* prepareMultisigEventExn(
    member.pre,
    { route: MULTISIG_QRY_ROUTE, attrs: { gid: groupPrefix(group) } },
    rawMessage(qry),
    { ...options, pvrsn: Vrsn_2_0 },
  );
}

/**
 * Share one exact v2 IPEX Grant stream, with its proofs, with group members.
 *
 * KERIpy `multisigIpexProofExn`: local v2 coordination profile route
 * `/multisig/ipex-proof` whose `a` is `{gid, grant}` and whose single nested
 * substream is the complete Grant stream, authored by or addressed to the group.
 */
export function* multisigIpexProofExn(
  group: string | Hab,
  member: Hab,
  grant: Uint8Array | RawMessage,
  options: Omit<MultisigBuilderOptions, "version" | "pvrsn"> = {},
): Operation<MultisigMessage> {
  return yield* prepareMultisigEventExn(
    member.pre,
    { route: MULTISIG_IPEX_PROOF_ROUTE, attrs: { gid: groupPrefix(group) } },
    rawMessage(grant),
    { ...options, pvrsn: Vrsn_2_0 },
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
  if (route === MULTISIG_EXN_ROUTE && !v2IpexChild(child, attrs.gid)) {
    throw new Error("Multisig IPEX requires a v2 child authored by the selected group.");
  }
  const coordination = v2CoordinationChild(route, child, "gid" in attrs ? attrs.gid : undefined);
  if (coordination) throw new Error(coordination);
  const field = multisigChildField(route);
  const payload = route === MULTISIG_ICP_ROUTE
    ? { gid: requireString(child.pre, "group inception prefix"), ...attrs, [field]: child.said }
    : { ...attrs, [field]: child.said };
  return exchange(route, payload, { ...options, sender, pvrsn })[0];
}

/** V2 IPEX proposals carry one exact group-authored child on a supported conversation route. */
function v2IpexChild(child: SerderKERI, group: unknown): boolean {
  return child.pvrsn.major === 2 && child.pvrsn.minor === 0 && child.pre === group
    && ["xip", "exn"].includes(child.ilk ?? "") && child.route?.startsWith("/ipex/") === true
    && isIpexVerb(child.route.slice(6));
}

/**
 * KERIpy core checks for the two local coordination routes: a group-authored v2
 * query, or a v2 Grant authored by or addressed to the group. Returns a reason.
 */
function v2CoordinationChild(route: string, child: SerderKERI, group: unknown): string | null {
  const v2 = child.pvrsn.major === 2 && child.pvrsn.minor === 0;
  if (route === MULTISIG_QRY_ROUTE && (!v2 || child.ilk !== "qry" || child.pre !== group)) {
    return "Multisig query requires a v2 query authored by the selected group.";
  }
  if (
    route === MULTISIG_IPEX_PROOF_ROUTE
    && (!v2 || child.route !== "/ipex/grant" || (child.pre !== group && child.sad?.ri !== group))
  ) {
    return "Multisig IPEX proof requires a v2 Grant for the selected group.";
  }
  return null;
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
 * KEL (icp/rot/ixn) and reply proposals default to KERIpy's form for both v1 and v2
 * groups: a v1 wrapper with a named `e` embed and pathed child attachments in the
 * child's own genus. The group's version is the child KEL/reply version; the wrapper
 * is only the coordination envelope. Other routes default to v2 nested wrappers, and
 * an explicit `version`/`pvrsn` selects either form. The v1 pathed path retains
 * its established encoding; v2 delegates parsing to parseBytes
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
  // KERIpy `kli multisig incept|interact` and `ends add` send these routes as v1 `e`-embed
  // wrappers whatever the group KEL version. `kli multisig rotate --version 2.0` sends a v2
  // nested wrapper, and `kli multisig join` replies in its proposal's form, as approvals here do.
  const keripyEmbedRoute = KERIPY_EMBED_PROPOSAL_ROUTES.includes(route);
  const version = options.pvrsn ?? options.version ?? (keripyEmbedRoute ? Vrsn_1_0 : Vrsn_2_0);
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
    if (
      frames.length !== 1 || !(child.body instanceof SerderKERI)
      || (child.nests?.length && !nestedChildAllowed(route, child.body))
    ) {
      throw new Error("Multisig proposal requires one supported direct child.");
    }
    const serder = multisigExnBody(sender, captured, child.body, options);
    return [serder, await collectPayload(nestedPayload(child, Vrsn_2_0), signal)] as const;
  });
}

/** Coordination and IPEX children may carry their own nests; KEL and reply children may not. */
function nestedChildAllowed(route: string, child: SerderKERI): boolean {
  return UNREPLAYED_ROUTES.includes(route) || (route === MULTISIG_EXN_ROUTE && nestedIpexRoute(child.route ?? ""));
}

/** Proposal routes KERIpy authors as v1 `e`-embed wrappers for both v1 and v2 groups. */
const KERIPY_EMBED_PROPOSAL_ROUTES: readonly string[] = [
  MULTISIG_ICP_ROUTE,
  MULTISIG_ROT_ROUTE,
  MULTISIG_IXN_ROUTE,
  MULTISIG_RPY_ROUTE,
];

/** Route handler that forwards accepted multisig EXNs to the `Multiplexor`. */
export class MultisigNotificationHandler implements ExchangeRouteHandler {
  readonly resource: MultisigRoute;
  private readonly mux: Multiplexor;

  /** Bind one registered route to its shared approval coordinator. */
  constructor(resource: MultisigRoute, mux: Multiplexor) {
    this.resource = resource;
    this.mux = mux;
  }

  /** Only supported nested multisig routes have child consumers. */
  get acceptsNests(): boolean {
    return nestedMultisigIlks(this.resource) !== null;
  }

  /**
   * Authenticate the signed child relationship before exchange evidence is published.
   * A child handler registered with `Multiplexor.addChildHandler` for this route and
   * the nested child's route owns verification instead.
   */
  verify(args: Parameters<NonNullable<ExchangeRouteHandler["verify"]>>[0]): ExchangeRouteVerification {
    const delegate = this.mux.childHandlerFor(args.serder, args.nests);
    if (delegate) return delegate.verify ? delegate.verify(args) : false;
    return args.serder.route === this.resource && this.mux.verify(args.serder, args.nests);
  }

  /** Borrow persisted children until approval replay and coordination indexing finish. */
  *handle(args: Parameters<ExchangeRouteHandler["handle"]>[0]): Operation<void> {
    const delegate = this.mux.childHandlerFor(args.serder, args.nests);
    if (delegate) {
      const handled = delegate.handle(args);
      if (handled) yield* handled;
      return;
    }
    yield* this.mux.add(args.serder, args.nests);
  }
}

/** Register the KERIpy multisig route family with one exchanger. */
export function loadMultisigHandlers(
  hby: Habery,
  exchanger: Exchanger,
  options: MultisigHandlerOptions = {},
): Multiplexor {
  const mux = options.mux
    ?? new Multiplexor(hby, {
      notifier: options.notifier ?? null,
      exchanger,
      registry: options.registry ?? undefined,
      messageKevery: options.messageKevery,
    });
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
  private readonly exchanger?: Exchanger;
  private readonly registry?: RegistryObserver;
  private readonly messageKevery: Kevery;
  /** Owners sharing one registered wrapper route, keyed by wrapper and nested child route. */
  private readonly childHandlers = new Map<string, ExchangeRouteHandler>();

  /** Reuse durable group membership and separate child processors without sharing parent proof state. */
  constructor(
    hby: Habery,
    { notifier, exchanger, registry, messageKevery }: {
      notifier?: Notifier | null;
      exchanger?: Exchanger;
      registry?: RegistryObserver;
      messageKevery?: Kevery;
    } = {},
  ) {
    this.hby = hby;
    this.notifier = notifier ?? null;
    this.exchanger = exchanger;
    this.registry = registry;
    const router = new Router();
    this.rvy = new Revery(hby.db, { rtr: router });
    new BasicReplyRouteHandler(this.rvy).registerReplyRoutes(router);
    this.kvy = new Kevery(hby.db, { lax: false, local: false, rvy: this.rvy });
    this.messageKevery = messageKevery ?? this.kvy;
    if (this.messageKevery.db !== hby.db) {
      throw new TypeError("Multisig message intake must share the group evidence store.");
    }
    this.kvy.registerReplyRoutes(router);
    this.replay = new Exchanger(hby);
  }
  /**
   * Delegate one wrapper route's v2 children with route `child` to `handler`.
   *
   * KERIpy `Multiplexor.addChildHandler`: several owners share one registered
   * `/multisig/*` Exchanger route without replacing `Exchanger.routes` entries.
   * The delegate's `verify` and `handle` own all validation, indexing and
   * notification for those children; the Multiplexor performs none of them.
   * Registering a key twice is refused.
   */
  addChildHandler(route: string, child: string, handler: ExchangeRouteHandler): void {
    const key = childHandlerKey(route, child);
    if (this.childHandlers.has(key)) {
      throw new ValidationError(`child handler for ${route} ${child} already registered`);
    }
    this.childHandlers.set(key, handler);
  }

  /**
   * Release a finite owner's delegation. A TypeScript runtime can outlive one
   * command phase, unlike KERIpy's per-process CLI owners; the shared route stays.
   */
  removeChildHandler(route: string, child: string, handler: ExchangeRouteHandler): void {
    const key = childHandlerKey(route, child);
    if (this.childHandlers.get(key) === handler) this.childHandlers.delete(key);
  }

  /** Return the delegate for this v2 wrapper's single child route, if any. */
  childHandlerFor(serder: SerderKERI, nests: readonly CesrFrame[] = []): ExchangeRouteHandler | null {
    if (!this.childHandlers.size || serder.pvrsn.major !== 2 || nests.length !== 1) return null;
    const child = nests[0].body;
    const route = child instanceof SerderKERI ? child.route : undefined;
    return route ? this.childHandlers.get(childHandlerKey(serder.route ?? "", route)) ?? null : null;
  }

  /** V2 child replay borrows the caller's configured IPEX, registry, reply and KRAM owners. */
  private v2IpexOwners(child: SerderKERI): boolean {
    const kvy = this.messageKevery, rvy = kvy.rvy, exc = this.exchanger;
    const handler = exc?.handlerFor(child);
    return !!this.registry && this.registry.db === this.hby.db && exc?.hby === this.hby
      && rvy?.db === this.hby.db && kvy.kramer?.db === this.hby.db
      && exc.cues === kvy.cues && rvy.cues === kvy.cues
      && handler instanceof IpexV2Handler && handler.hby === this.hby
      && handler.registry === this.registry.store;
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
    const v2Ipex = serder.pvrsn.major === 2 && route === MULTISIG_EXN_ROUTE;
    if (v2Ipex) {
      if (!this.exchanger?.verifyAccepted(said, route)) {
        return { kind: "reject", said, reason: "V2 IPEX approval requires an authenticated wrapper." };
      }
      // The authenticated local wrapper carries this member's actual verified child contribution.
      if (this.isLocalHab(sender)) yield* this.processApproved(nests);
    }
    const { existing, submitters } = this.hby.db.transaction(() => {
      const indexed = this.hby.db.meids.get([embeddedSaid]);
      const existing = isV2RegistryRoute(route) || v2Ipex
        ? indexed.filter(diger => {
          const retained = this.hby.db.exns.get([diger.qb64]);
          return retained && (v2Ipex
            ? retained.pvrsn.major === 2 && retained.route === route
              && isRecord(retained.sad?.a) && isRecord(serder.sad?.a)
              && retained.sad.a.gid === serder.sad.a.gid && retained.sad.a.exn === embeddedSaid
            : sameRegistryProposal(retained, serder))
            && this.exchanger?.verifyAccepted(diger.qb64, route);
        })
        : indexed;
      const submitters = isV2RegistryRoute(route) || v2Ipex
        ? existing.map(diger => new Prefixer({ qb64: this.hby.db.exns.get([diger.qb64])!.pre! }))
        : this.hby.db.maids.get([embeddedSaid]);
      // Approval is the authenticated wrapper, not completion of its asynchronous child replay.
      this.hby.db.meids.add([embeddedSaid], new Saider({ qb64: said }));
      this.hby.db.maids.add([embeddedSaid], new Prefixer({ qb64: sender }));
      return { existing, submitters };
    });
    const firstSubmission = existing.length === 0;
    const unreplayed = UNREPLAYED_ROUTES.includes(route);
    if (!this.isLocalHab(sender)) {
      if (!unreplayed && submitters.some((submitter) => this.isLocalHab(submitter.qb64))) {
        // The parent is durable, but approval never lends its signatures to the child.
        if (serder.pvrsn.major === 1) yield* this.processLegacyApproved(serder);
        else yield* this.processApproved(nests);
      } else if (serder.pvrsn.major === 2 || firstSubmission) {
        // Legacy approval polling consumes its first notice; repeated v1 notices would re-propose it.
        this.notifier?.add(firstSubmission ? { r: route, d: said } : { r: route, d: said, e: embeddedSaid });
      }
    } else if (!unreplayed && submitters.some((submitter) => !this.isLocalHab(submitter.qb64))) {
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
      const v2Ipex = child.body instanceof SerderKERI && child.body.pvrsn.major === 2
        && child.body.route?.startsWith("/ipex/");
      if (v2Ipex && !this.v2IpexOwners(child.body as SerderKERI)) {
        throw new Error("V2 IPEX replay owners are unavailable.");
      }
      yield* dispatchEnvelope(
        envelopeFromFrame(child, true),
        v2Ipex ? this.messageKevery.rvy! : this.rvy,
        v2Ipex ? this.messageKevery : this.kvy,
        this.exchanger,
        undefined,
        undefined,
        undefined,
        this.messageKevery,
        this.registry,
      );
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
        yield* dispatchEnvelope(
          envelopeFromFrame(frame, true),
          this.rvy,
          this.kvy,
          this.exchanger,
          undefined,
          undefined,
          undefined,
          this.messageKevery,
          this.registry,
        );
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
    } else if (isV2RegistryRoute(route)) {
      const children = acdcV2RegistryProposal(serder, nests, this.registry?.store ?? null);
      if (!children) return { ok: false, said, reason: "Invalid ACDC v2 registry/anchor proposal." };
      if (!groupSigningMembers(this.hby, children.anchor.pre!).includes(sender)) {
        return { ok: false, said, reason: "Registry proposal sender is not a current group signing member." };
      }
      embeddedSaid = children.anchor.said!;
    } else {
      const allowed = nestedMultisigIlks(route);
      if (!allowed || nests.length !== 1) {
        return { ok: false, said, reason: "Unsupported nested multisig route or child count." };
      }
      const child = nests[0];
      const signed = multisigPayloadSaid(serder);
      if (
        typeof signed !== "string" || !child.body.said || !allowed.includes(child.body.ilk ?? "")
        || !(child.body instanceof SerderKERI)
        || (route !== MULTISIG_EXN_ROUTE && !UNREPLAYED_ROUTES.includes(route) && child.nests?.length)
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
      if (route === MULTISIG_EXN_ROUTE) {
        const attrs = serder.sad?.a;
        if (
          serder.ilk !== "exn" || serder.pvrsn.minor !== 0
          || !isRecord(attrs) || Object.keys(attrs).sort().join(",") !== "exn,gid"
          || (child.nests?.length && !nestedIpexRoute(child.body.route ?? ""))
          || !v2IpexChild(child.body, attrs.gid) || !this.v2IpexOwners(child.body)
          || !groupSigningMembers(this.hby, child.body.pre!).includes(sender)
        ) {
          return { ok: false, said, reason: "Invalid v2 IPEX group, member, route or replay owners." };
        }
        if (
          this.isLocalHab(sender)
          && !localIpexContribution(this.hby.db, sender, child.body, envelopeFromFrame(child).tsgs)
        ) {
          return { ok: false, said, reason: "Local IPEX approval has no verified member contribution." };
        }
      }
      if (UNREPLAYED_ROUTES.includes(route)) {
        const attrs = isRecord(serder.sad?.a) ? serder.sad.a : {};
        const coordination = v2CoordinationChild(route, child.body, attrs.gid);
        if (coordination) return { ok: false, said, reason: coordination };
        if (
          typeof attrs.gid !== "string" || !this.isLocalHab(attrs.gid)
          || !groupSigningMembers(this.hby, attrs.gid).includes(sender)
        ) {
          return { ok: false, said, reason: "Proposal sender is not a group signing member." };
        }
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
export function multisigChildEvidence(
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

function childHandlerKey(route: string, child: string): string {
  return `${route}\u0000${child}`;
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
