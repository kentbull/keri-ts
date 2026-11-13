/**
 * Group proposal reads, owned by the library so that a CLI, a browser wallet and
 * a service all see and dismiss the same proposals. Operations follow the
 * workflow contract (`app/runtime/workflow-contract.ts`):
 * - `listGroupProposals` and `findGroupProposal` are pure reads of stored
 *   exchange messages, the multisig embed index (`meids.`) and the notifier.
 * - `dismissGroupProposal` removes local notices only.
 *
 * A proposal is identified by the SAID of the outer exchange wrapper that
 * announced it. Approval, which is the only step that signs, names that SAID
 * explicitly; nothing here or in the notice store selects a proposal to approve.
 *
 * Boundaries:
 * - Dependencies are declared collaborators, not an AgentRuntime (ADR-0013).
 * - Notices discover candidates only. Their attributes never authorize a route
 *   or a group; every field below is read from the stored, indexed wrapper.
 */
import { type SerderKERI, Vrsn_2_0 } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import type { RegistryStore } from "../../acdc/registering.ts";
import { ValidationError } from "../../core/errors.ts";
import { isV2RegistryRoute } from "../../core/exchange/protocol-exchanging.ts";
import { loadNests } from "../../db/exchange/exchange-nests.ts";
import type { Regery } from "../../vdr/credentialing.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import type { Habery } from "../identity/habbing.ts";
import type { Notifier } from "../notifications/notifying.ts";
import { abortable } from "../runtime/abortable.ts";
import { collectBytes } from "../transport/byte-source.ts";
import type { CounselInputs, Counselor, GroupEventRef } from "./counseling.ts";
import { findLocalGroupMember, groupSigningMembers, uniqueMembers } from "./group-members.ts";
import { acdcV2RegistryProposal, MULTISIG_RPY_ROUTE, type MultisigChild, multisigChild } from "./grouping.ts";
import { multisigEmbeddedSection, multisigPayloadSaid, storedGroupMessage } from "./multisig-messaging.ts";
import {
  type ApprovalChannels,
  type ApprovalResult,
  approveKelProposal,
  approveRegistryV2Proposal,
  approveRpyProposal,
  approveVdrProposal,
  eventAccepted,
  isKelRoute,
  isVdrRoute,
  kelApproval,
  payloadSection,
} from "./multisig-workflows.ts";

/** Page size when reading the notice store; no proposal is hidden behind the first page. */
const NOTICE_PAGE = 100;

/** Proposal kinds, named by the last segment of their `/multisig/<kind>` route. */
export type GroupProposalKind = "icp" | "rot" | "ixn" | "rpy" | "rip" | "bup" | "vcp" | "iss" | "rev";

/** Choices a host must collect from the user before approving. */
export interface GroupProposalNeeds {
  /** Local alias for a group this member has not joined yet (`icp`, or `rot` of an unjoined group). */
  readonly groupAlias: boolean;
  /** Local name for a registry (`vcp`) this member has not approved yet. */
  readonly registryName: boolean;
}

/** One group proposal as stored locally. */
export interface GroupProposal {
  /** SAID of the stored outer wrapper; the key for approval, lookup and dismissal. */
  readonly said: string;
  readonly kind: GroupProposalKind;
  /** Group prefix. */
  readonly group: string;
  /** SAID of the embedded business event: the KEL event, reply, or TEL event. */
  readonly embedded: string;
  /** Sender of the wrapper. */
  readonly proposer: string;
  /** Signing members named by the proposal, or the group's current signing members where it names none. */
  readonly smids: readonly string[];
  /** Rotation members named by the proposal; empty where it names none. */
  readonly rmids: readonly string[];
  /**
   * Standing of this host's member:
   * - `approved`: its own contribution to this payload is stored.
   * - `inapplicable`: the event is already accepted in the local KEL (for example a rotation that only adds this member
   *   as a next member, or an event the other members completed and this one received another way), so there is
   *   nothing to sign; hosts should not offer it.
   * - `unapproved`: otherwise.
   *
   * A group with several local members is judged by its recorded joining member, or for a group not joined yet by the first
   * local member the proposal names. Approval signs for every local member, so the answer holds for all of them.
   */
  readonly local: "unapproved" | "approved" | "inapplicable";
  /** Choices approval will need; both false once the proposal is locally approved. */
  readonly needs: GroupProposalNeeds;
  /** The group KEL event this proposal sets up, or the anchor that seals its TEL event; absent for replies. */
  readonly event?: GroupEventRef;
}

/** Filter for {@link listGroupProposals}. */
export interface GroupProposalFilter {
  /** Only proposals for this group prefix or local alias. */
  group?: string;
}

/** Collaborators for the pure reads. */
export interface GroupProposalReadDeps {
  readonly hby: Habery;
  /** Authenticates v2 nested children; an `Exchanger` fits. */
  readonly exc: Pick<Exchanger, "verifyAccepted">;
  /** Notice store, or null for a host without one (then nothing is listed). */
  readonly notifier: Pick<Notifier, "list"> | null;
  /** ACDC v2 registry store, or null; without it `rip` and `bup` proposals are not recognised. */
  readonly registryStore: RegistryStore | null;
}

/** Collaborators for {@link approveGroupProposal}. */
export interface GroupApprovalDeps extends ApprovalChannels, Omit<GroupProposalReadDeps, "exc"> {
  /** Legacy credential registry owner; needed to approve `vcp`, `iss` and `rev`. */
  readonly vdr: Regery | null;
  /** Told of the approved group event; only its `start` is used. */
  readonly counselor: Pick<Counselor, "start">;
}

/** Choices a user makes when approving; see {@link GroupProposal.needs}. */
export interface GroupApprovalChoices extends CounselInputs {
  /** Local alias for a group not joined yet. */
  groupAlias?: string;
  /** Local name for a registry proposal. */
  registryName?: string;
}

/** Result of {@link approveGroupProposal}. */
export interface GroupApprovalResult extends ApprovalResult {
  /** The group event now counseled, where the proposal sets one up; read its progress with `counselor.status`. */
  readonly event?: GroupEventRef;
}

/** Collaborators for {@link dismissGroupProposal}. */
export interface GroupProposalDismissDeps {
  readonly hby: Pick<Habery, "db">;
  readonly notifier: Pick<Notifier, "list" | "remove"> | null;
}

/** Wrapper route to proposal kind, or null for routes this API does not cover. */
function proposalKind(route: string): GroupProposalKind | null {
  if (!isKelRoute(route) && !isVdrRoute(route) && route !== MULTISIG_RPY_ROUTE && !isV2RegistryRoute(route)) {
    return null;
  }
  return route.slice("/multisig/".length) as GroupProposalKind;
}

/** Page through every notice; `fn` sees each in durable order. */
function eachNotice(
  notifier: Pick<Notifier, "list">,
  fn: (note: { rid: string; attrs: { r?: unknown; d?: unknown; e?: unknown } }) => void,
): void {
  for (let start = 0;; start += NOTICE_PAGE) {
    const page = notifier.list(start, NOTICE_PAGE);
    for (const note of page) fn({ rid: note.pad.i, attrs: note.pad.a });
    if (page.length < NOTICE_PAGE) break;
  }
}

/** Wrapper SAIDs the notice store holds for multisig proposals, oldest first and without repeats. */
function noticedWrappers(notifier: Pick<Notifier, "list">): string[] {
  const saids = new Set<string>();
  eachNotice(notifier, ({ attrs }) => {
    if (typeof attrs.d === "string") saids.add(attrs.d);
  });
  return [...saids];
}

/** The local member that would approve, without throwing for a group not yet joined. */
function approvingMember(hby: Habery, group: string, members: readonly string[]) {
  const mid = hby.db.getHab(group)?.mid;
  return (mid ? hby.habs.get(mid) : null) ?? findLocalGroupMember(hby, members);
}

/**
 * Event body of a wrapper's named child. v1 reads the pathed embed; v2 reads the
 * first nest of a wrapper that authenticates through its own route. Proofs are
 * not read: a listing never signs, so only the body is needed.
 */
function childBody(
  deps: GroupProposalReadDeps,
  wrapper: SerderKERI,
  route: string,
  label: string,
): MultisigChild | null {
  if (wrapper.pvrsn.major === 1) return multisigChild(deps.hby, wrapper, label);
  if (!wrapper.said || !deps.exc.verifyAccepted(wrapper.said, route)) return null;
  const body = loadNests(deps.hby.db, wrapper.said)[0]?.body;
  const event = body as SerderKERI | undefined;
  if (!event || typeof event.pre !== "string") return null;
  return { event, attachment: new Uint8Array(), genus: event.gvrsn ?? event.pvrsn ?? Vrsn_2_0 };
}

function eventRef(event: SerderKERI, pre: string): GroupEventRef | undefined {
  return event.said && event.sn !== null ? { pre, sn: event.sn, said: event.said } : undefined;
}

/** What a proposal says about itself, before the local member's standing is added. */
interface Decoded {
  group: string;
  embedded: string;
  smids: readonly string[];
  rmids: readonly string[];
  event?: GroupEventRef;
  kind: GroupProposalKind;
  /** KEL event already accepted in the local KEL. */
  inapplicable?: boolean;
}

function decode(deps: GroupProposalReadDeps, exn: SerderKERI, route: string, kind: GroupProposalKind): Decoded | null {
  const { hby } = deps;
  const payload = payloadSection(exn.ked ?? {});
  if (isKelRoute(route)) {
    const child = childBody(deps, exn, route, kind);
    const approval = child && kelApproval(exn, route, child);
    if (!approval) return null;
    const { smids, rmids } = approval.proposal.attrs as { smids: string[]; rmids?: string[] };
    return {
      kind,
      group: approval.group,
      embedded: approval.event.said ?? "",
      smids,
      rmids: rmids ?? [],
      event: eventRef(approval.event, approval.group),
      inapplicable: eventAccepted(hby, approval.event) && (kind !== "icp" || !smids.some(mid => hby.habs.has(mid))),
    };
  }
  if (isV2RegistryRoute(route)) {
    const nests = loadNests(hby.db, exn.said!);
    const registry = acdcV2RegistryProposal(exn, nests, deps.registryStore);
    if (!registry?.anchor.pre) return null;
    const group = registry.anchor.pre;
    return {
      kind,
      group,
      embedded: registry.tel.said ?? "",
      smids: groupSigningMembers(hby, group),
      rmids: [],
      event: eventRef(registry.anchor, group),
    };
  }
  const group = typeof payload.gid === "string" ? payload.gid : "";
  if (!group) return null;
  const smids = groupSigningMembers(hby, group);
  if (route === MULTISIG_RPY_ROUTE) {
    const child = childBody(deps, exn, route, "rpy");
    return child?.event.said ? { kind, group, embedded: child.event.said, smids, rmids: [] } : null;
  }
  // vcp, iss and rev: the named TEL event, sealed by the group event in `anc`.
  const anchor = multisigChild(hby, exn, "anc");
  const tel = multisigEmbeddedSection(exn.ked ?? {})?.[kind];
  const embedded = tel && typeof tel === "object" ? (tel as { d?: unknown }).d : undefined;
  if (!anchor || anchor.event.pre !== group || typeof embedded !== "string") return null;
  return { kind, group, embedded, smids, rmids: [], event: eventRef(anchor.event, group) };
}

/** Read one stored wrapper; null when it is not a well-formed proposal of a supported kind. */
function readProposal(deps: GroupProposalReadDeps, said: string): GroupProposal | null {
  const { hby } = deps;
  const exn = hby.db.exns.get([said]);
  if (!exn?.ked || !exn.said || !exn.pre) return null;
  const route = exn.route ?? "";
  const kind = proposalKind(route);
  if (!kind || !multisigPayloadSaid(exn)) return null;
  let decoded: Decoded | null;
  try {
    decoded = decode(deps, exn, route, kind);
  } catch (error) {
    if (error instanceof ValidationError) return null; // one malformed row never hides the others
    throw error;
  }
  if (!decoded) return null;
  const member = approvingMember(hby, decoded.group, uniqueMembers([...decoded.smids, ...decoded.rmids]));
  const approved = !!member && storedGroupMessage(hby.db, member.pre, exn) !== null;
  const inapplicable = !approved && decoded.inapplicable === true;
  return {
    said: exn.said,
    kind,
    group: decoded.group,
    embedded: decoded.embedded,
    proposer: exn.pre,
    smids: decoded.smids,
    rmids: decoded.rmids,
    local: approved ? "approved" : inapplicable ? "inapplicable" : "unapproved",
    needs: {
      groupAlias: !approved && !inapplicable && (kind === "icp" || (kind === "rot" && !hby.habs.has(decoded.group))),
      registryName: !approved && !inapplicable && kind === "vcp",
    },
    ...(decoded.event ? { event: decoded.event } : {}),
  };
}

/** Group prefix for a prefix or local alias. */
function resolveGroup(hby: Habery, group: string): string {
  return hby.habByName(group)?.pre ?? group;
}

/**
 * List the proposals the notice store announces, oldest notice first. Pure. Only
 * wrappers that are stored, indexed in `meids.` and well formed are listed, one
 * entry per wrapper; every notice page is read, so nothing hides behind the
 * first 100. A dismissed proposal has no notice and is not listed; it remains
 * available through {@link findGroupProposal}.
 */
export function listGroupProposals(
  deps: GroupProposalReadDeps,
  { group }: GroupProposalFilter = {},
): GroupProposal[] {
  if (!deps.notifier) return [];
  const wanted = group === undefined ? undefined : resolveGroup(deps.hby, group);
  const proposals: GroupProposal[] = [];
  const seen = new Set<string>();
  for (const said of noticedWrappers(deps.notifier)) {
    const exn = deps.hby.db.exns.get([said]);
    const payloadSaid = exn && multisigPayloadSaid(exn);
    if (!payloadSaid || !deps.hby.db.meids.get([payloadSaid]).some(index => index.qb64 === said)) continue;
    const proposal = readProposal(deps, said);
    if (!proposal || (wanted !== undefined && proposal.group !== wanted) || seen.has(said)) continue;
    seen.add(said);
    proposals.push(proposal);
  }
  return proposals;
}

/**
 * Read one stored proposal by its wrapper SAID, whether or not a notice remains.
 * Pure. Null when no such well-formed proposal is stored.
 */
export function findGroupProposal(deps: GroupProposalReadDeps, said: string): GroupProposal | null {
  return readProposal(deps, said);
}

/**
 * Dismiss a proposal locally: remove the notices that announce it, including
 * those other members' wrappers of the same payload raised. The stored wrapper
 * and the multisig index stay, so the proposal can still be found and approved
 * by SAID. KERI has no reject message: nothing is sent, and the proposer and the
 * other members learn nothing from a dismissal.
 *
 * @returns Number of notices removed.
 */
export function dismissGroupProposal(deps: GroupProposalDismissDeps, said: string): number {
  if (!deps.notifier) return 0;
  const exn = deps.hby.db.exns.get([said]);
  const payloadSaid = exn && multisigPayloadSaid(exn);
  const wrappers = new Set([said]);
  if (payloadSaid) for (const index of deps.hby.db.meids.get([payloadSaid])) wrappers.add(index.qb64);
  const stale: string[] = [];
  eachNotice(deps.notifier, ({ rid, attrs }) => {
    if (typeof attrs.d === "string" && wrappers.has(attrs.d)) stale.push(rid);
  });
  return stale.filter(rid => deps.notifier!.remove(rid)).length;
}

/**
 * Approve one proposal, named by its wrapper SAID: sign this member's
 * contribution to the embedded event, send it to the other members and hand the
 * group event to the Counselor. Returns without waiting for other members; read
 * progress with `counselor.status(result.event)`. This is the only call that
 * signs, and it acts on exactly the SAID given: nothing is selected from the
 * notice store, so a proposal the caller did not name cannot be approved.
 *
 * Calling it is the user's consent, so it never prompts. Repeating it after a
 * crash resumes: this member's recorded signatures and stored wrapper are
 * replayed, never replaced, and the group is not joined twice.
 *
 * Supports every proposal kind: KEL (`icp`, `rot`, `ixn`), reply (`rpy`), legacy registry and credential (`vcp`, `iss`, `rev`) and
 * ACDC v2 registry (`rip`, `bup`). For the registry kinds `event` is the group anchor that seals the TEL event.
 *
 * @throws ValidationError for a SAID that is not a stored supported proposal, a missing `groupAlias` when the proposal {@link GroupProposal.needs} one, or a proposal that cannot be approved.
 */
export function* approveGroupProposal(
  deps: GroupApprovalDeps,
  said: string,
  choices: GroupApprovalChoices = {},
): Operation<GroupApprovalResult> {
  const { hby } = deps;
  const proposal = findGroupProposal(deps, said);
  const exn = hby.db.exns.get([said]);
  if (!proposal || !exn) throw new ValidationError(`No group proposal ${said} is stored.`);
  const route = exn.route ?? "";
  const payloadSaid = multisigPayloadSaid(exn)!;
  if (!hby.db.meids.get([payloadSaid]).some(index => index.qb64 === said)) {
    // Acceptance commits before the asynchronous handler; resume that ordinary intake.
    const message = yield* abortable(signal => collectBytes(deps.exc.replay(said, signal)));
    yield* deps.reactor.processBytes(message, { local: true });
    if (!hby.db.meids.get([payloadSaid]).some(index => index.qb64 === said)) {
      throw new ValidationError(`Group proposal ${said} is not indexed after replay.`);
    }
  }
  const options = { resume: true, groupAlias: choices.groupAlias, registryName: choices.registryName };
  const result = isKelRoute(route)
    ? yield* approveKelProposal(hby, deps, exn, route, options)
    : isVdrRoute(route)
    ? yield* approveVdrProposal(hby, deps.vdr, deps, exn, route, options)
    : isV2RegistryRoute(route)
    ? yield* approveRegistryV2Proposal(hby, deps, exn, route, options)
    : yield* approveRpyProposal(hby, deps, exn, route as typeof MULTISIG_RPY_ROUTE, options);
  if (!result) throw new ValidationError(`Group proposal ${said} cannot be approved.`);
  const { event } = proposal;
  if (event) {
    const { auths, fallbackAfterMs, proxy } = choices;
    deps.counselor.start(event, { auths, fallbackAfterMs, proxy });
  }
  return { ...result, ...(event ? { event } : {}) };
}
