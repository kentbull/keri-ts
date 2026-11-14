/**
 * Runtime-owned operations for a local group's v2 IPEX messages (first user: a group holder's Admit).
 *
 * A group-authored IPEX message completes only when enough members have contributed a signature, and each member's
 * signature is that member's consent. The runtime owns the rest. This module follows the workflow contract
 * (`app/runtime/workflow-contract.ts`):
 *
 * - {@link proposeGroupAdmit} / {@link proposeGroupIpex} (the proposer) and {@link approveGroupIpex} (every other
 *   member) are the explicit consents. Each signs or reuses this member's contribution, accepts it locally, records
 *   a live operation and returns without waiting on anyone. {@link groupIpexProposals} lists the stored proposals a
 *   member may approve.
 * - `processOnce`, driven by the runtime's owner loop, publishes this member's wrapper to the other members (retrying
 *   a member that is briefly offline), collects the other members' stored contributions, and, once the message is
 *   accepted, lets the elected lead send the completed message to its recipient. It signs nothing beyond the
 *   contribution that the consent recorded.
 * - A member that did not sign a message the others' signatures complete (a weight-0 member, say) takes it with no
 *   call: intake on receipt of a wrapper whose copies carry the group's threshold, or else `processOnce`'s periodic
 *   sweep once the exchange the message answers is accepted. That adds no signature, so it is not consent; the
 *   member then holds what the group completed and can accept the counterparty's answer in its thread.
 * - {@link groupIpexStatus} is a pure read and {@link waitForGroupIpex} only observes.
 *
 * Status is derived from the protocol stores: an accepted message reads `done`; a stored proposal without a live
 * operation reads `awaitingConsent` (a member that reloaded consents again with the same call and reuses its
 * recorded signature). Lost on reload, by design: whether the lead had already delivered the completed message,
 * the `failed`, `expired` and `abandoned` reasons, and the publication results. The runtime never writes wallet inventory; the
 * embedder reacts to the pushed `{kind: "ipex", id: <message>}` change.
 */
import { concatBytes, Counter, type SerderKERI, type Versionage, Vrsn_2_0 } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import type { RegistryDisclosure } from "../../acdc/regeventing.ts";
import type { Regery } from "../../acdc/registraring.ts";
import { KramRefusedError, ValidationError } from "../../core/errors.ts";
import { loadNests } from "../../db/exchange/exchange-nests.ts";
import { type RegistryEventRef, registryEventStatus, settleRegistryEvent } from "../credentials/registry-settling.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { isLocalGroupHab } from "../multisig/group-members.ts";
import { groupIpexFollowable, MULTISIG_EXN_ROUTE } from "../multisig/grouping.ts";
import type { GroupSendResult } from "../multisig/multisig-messaging.ts";
import { type RegistryProposeDeps } from "../multisig/proposing.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import { RetryBackoff } from "../runtime/retry-backoff.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import { type ChangeSink, observeUntil, type WaitResult } from "../runtime/workflow-contract.ts";
import { IpexAdmitter } from "./ipex-admitting.ts";
import { attachPresentationProof, type PreparedGrantBody } from "./ipex-discloser.ts";
import {
  acceptGroupIpexCopies,
  approveMultisigIpexLocally,
  approveStoredMultisigIpexWrappers,
  findStoredMultisigIpex,
  groupIpexApproved,
  prepareAcdcV2GroupIpex,
  publishGroupIpexProposal,
  publishInitialGroupIpex,
  requireAcdcV2GroupUse,
  sendCompletedGroupIpex,
  storedMultisigIpexBody,
  unacceptedGroupIpexCopies,
} from "./ipex-grouping.ts";
import { isIssuanceOrigin } from "./ipex-node-authentication.ts";
import { IPEX_GRANT_ROUTE } from "./ipexing.ts";

/** Milliseconds between collections of the other members' stored contributions. */
export const GROUP_IPEX_COLLECT_MS = 250;
/** Milliseconds between sweeps for group messages this member holds completed but has not accepted. */
export const GROUP_IPEX_FOLLOW_MS = 5_000;
/** How long delivery failures may last before an operation ends `failed`; a group IPEX message has no deadline. */
export const GROUP_IPEX_RETRY_BOUND_MS = 600_000;

/**
 * Terminal states that are not completion; each carries a reason. `expired` means this member's own KRAM refused the
 * contribution for its time, thread or exchange lifetime (the reason names the KRAM reason and, when it has one, the
 * deadline); no retry can change that.
 */
export type GroupIpexEndState = "abandoned" | "expired" | "failed";

/** Where an active group IPEX message is. */
export type GroupIpexPhase =
  | "awaitingConsent"
  /** A presentation Grant waits for the group to accept the registry update that carries its proof. */
  | "awaitingRegistryUpdate"
  | "publishing"
  | "awaitingMembers"
  | "delivering";

/** Status of one group IPEX message, discriminated on `state`. A pure read. */
export type GroupIpexStatus =
  | { state: "active"; phase: GroupIpexPhase; needs?: "approve" }
  | { state: "done"; phase: "accepted" }
  | { state: GroupIpexEndState; reason: string };

/** Collaborators; hosts adapt their runtime to this once. No `AgentRuntime`. */
export interface GroupIpexDeps {
  readonly hby: Habery;
  /** Registry environment; only its public `store` is read. */
  readonly rgy: Pick<Regery, "store">;
  readonly exc: Exchanger;
  readonly protocol: ProtocolProcessor;
  /** Delivery of member wrappers and of the completed message; its worker is run by the host. */
  readonly postman: Poster;
  readonly clock: RuntimeClock;
  readonly changes?: ChangeSink;
  /** Collaborators of a group registry update; a Grant that carries a presentation proof needs them. */
  readonly registry?: RegistryProposeDeps;
}

/**
 * A presentation Grant waiting for the group to accept the registry update that anchors its proof. Plain data: the
 * owner reads the stores on each pass and, once the update is accepted, attaches the proof and signs this member's
 * contribution itself.
 */
export interface GroupIpexPrerequisite {
  /** The TEL event and the group anchor that seals it. */
  readonly anchor: RegistryEventRef;
  /** The frozen unsigned Grant and its selected nodes; only its nested proof is extended once the update is accepted. */
  readonly grant: PreparedGrantBody;
  /** The presented-state opening the update commits to. It blinds the Grant's state, so it is never logged or reported. */
  readonly opening: RegistryDisclosure;
}

interface LiveGroupIpex {
  /** SAID of the group-authored IPEX message. */
  readonly said: string;
  readonly group: Hab;
  readonly genus: Versionage;
  phase: GroupIpexPhase;
  /** This member's wire still to publish: the proposer's initial message, or an approver's accepted contribution. */
  outbound: { kind: "initial" | "proposal"; wire: Uint8Array } | null;
  /** A registry update the message waits for; the consent that began the operation covers signing it afterwards. */
  prerequisite: GroupIpexPrerequisite | null;
  publication: GroupSendResult | null;
  /** The completed message has been sent to its recipient (or this member is not the lead). */
  delivered: boolean;
  deliveries: string[];
  readonly retry: RetryBackoff;
  nextCollect: number;
  busy: boolean;
}

/** What an accepted operation of this process sent: the member wrappers it published and the completed message's deliveries. */
export interface GroupIpexOutcome {
  messages: GroupSendResult["messages"];
  /** Destinations that took this member's wrappers. */
  deliveries: string[];
  /** Each other member's outcome; a group IPEX publication retries until every member took it, so all are delivered. */
  members: GroupSendResult["members"];
  /** Destinations that took the completed message; empty unless this member is the elected lead. */
  sent: string[];
}

/** What a consent returned. */
export interface GroupIpexBegun {
  /** SAID of the group-authored IPEX message. */
  said: string;
}

/** A stored proposal a member may approve. */
export interface GroupIpexProposal {
  /** SAID of the group-authored message; the key of every other call. */
  said: string;
  route: string;
  group: string;
  /** SAID of the `/multisig/exn` wrapper that carries it. */
  wrapper: string;
  /** AID of the member that proposed it. */
  proposer: string;
  /** SAID of the exchange the message answers (an Admit's Grant), when it names one. */
  prior?: string;
  /** Whether this member already holds a recorded contribution (approving again reuses it). */
  approved: boolean;
  complete: boolean;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Frame a group-authored body with its nests and sign this member's contribution, accepting it locally; returns the
 * contribution's wire. Both the proposer's consent and the owner's signing after a registry update use it.
 *
 * @throws ValidationError while the message awaits authenticating dependencies; KramRefusedError when this member's
 * own KRAM refuses it.
 */
function* contribute(
  deps: GroupIpexDeps,
  hab: Hab,
  exn: SerderKERI,
  nests: Uint8Array,
  gvrsn: Versionage,
): Operation<Uint8Array> {
  const candidate = concatBytes(
    Counter.makeGVC(gvrsn),
    exn.raw,
    Counter.enclose({ qb64: nests, version: gvrsn }),
  );
  const own = yield* prepareAcdcV2GroupIpex(deps.hby, deps.protocol, hab, candidate);
  if (!own) throw new ValidationError("ACDC v2 group disclosure awaits authenticating dependencies.");
  return own;
}

/** The live table of group IPEX operations and its driver; one per host runtime. */
export class GroupIpexOperations {
  readonly live = new Map<string, LiveGroupIpex>();
  readonly ended = new Map<string, { state: GroupIpexEndState; reason: string }>();
  /** What accepted operations published and delivered in this process; not durable. */
  readonly outcomes = new Map<string, GroupIpexOutcome>();
  /** Messages this member's KRAM refused to take from their copies in this process; a sweep tries them no more. */
  readonly unfollowable = new Set<string>();
  /** When the next sweep for completed group messages is due. */
  private nextFollow = 0;

  constructor(readonly deps: GroupIpexDeps) {}

  /** Whether a pass has work: a live operation, or a sweep for completed group messages is due. */
  active(): boolean {
    return this.live.size > 0 || this.deps.clock.now() >= this.nextFollow;
  }

  /**
   * Advance every live operation by one pass. Every {@link GROUP_IPEX_FOLLOW_MS} a pass also takes the group messages
   * this member did not sign but holds completed ({@link follow}); that signs and sends nothing.
   */
  *processOnce(): Operation<void> {
    if (this.deps.clock.now() >= this.nextFollow) {
      this.nextFollow = this.deps.clock.now() + GROUP_IPEX_FOLLOW_MS;
      yield* this.follow();
    }
    for (const op of [...this.live.values()]) {
      // A group whose local member cannot sign yet waits for its signer.
      if (op.busy || !this.live.has(op.said) || !op.group.canSign()) continue;
      op.busy = true;
      try {
        yield* this.step(op);
      } catch (error) {
        this.end(op, error instanceof KramRefusedError ? "expired" : "failed", message(error));
      } finally {
        op.busy = false;
      }
    }
  }

  /**
   * Accept each stored group IPEX message whose received copies already carry the group's threshold
   * ({@link groupIpexFollowable}), adding no signature, so this member holds what the group completed without it.
   * Intake takes such a message on receipt; this sweep takes what intake could not yet, such as an answer that arrived
   * before the exchange it answers. A message with a live operation is left to that operation's own collection.
   */
  private *follow(): Operation<void> {
    const { hby, exc, protocol } = this.deps;
    for (const copies of unacceptedGroupIpexCopies(hby, exc)) {
      const said = copies[0].body.said!;
      if (this.live.has(said) || this.unfollowable.has(said) || !groupIpexFollowable(hby, copies)) continue;
      try {
        yield* acceptGroupIpexCopies(protocol, copies);
      } catch (error) {
        if (!(error instanceof KramRefusedError)) throw error;
        this.unfollowable.add(said);
        continue;
      }
      if (exc.complete(said)) this.deps.changes?.push({ kind: "ipex", id: said });
    }
  }

  /** End a live operation and tell the sink. */
  end(op: LiveGroupIpex, state: GroupIpexEndState, reason: string): void {
    this.live.delete(op.said);
    this.ended.set(op.said, { state, reason });
    this.deps.changes?.push({ kind: "ipex", id: op.said });
  }

  /** Record an operation the user consented to. */
  begin(
    said: string,
    group: Hab,
    genus: Versionage,
    outbound: LiveGroupIpex["outbound"],
    deliver = true,
    prerequisite: GroupIpexPrerequisite | null = null,
  ): GroupIpexBegun {
    this.ended.delete(said);
    this.live.set(said, {
      said,
      group,
      genus,
      phase: prerequisite ? "awaitingRegistryUpdate" : outbound ? "publishing" : "awaitingMembers",
      outbound,
      prerequisite,
      publication: null,
      delivered: !deliver,
      deliveries: [],
      retry: new RetryBackoff(),
      nextCollect: 0,
      busy: false,
    });
    this.deps.changes?.push({ kind: "ipex", id: said });
    return { said };
  }

  private setPhase(op: LiveGroupIpex, phase: GroupIpexPhase): void {
    if (op.phase === phase) return;
    op.phase = phase;
    this.deps.changes?.push({ kind: "ipex", id: op.said });
  }

  /** Run a delivery; a failure keeps the work for a later pass until failures have lasted the bound. */
  private *attempt(op: LiveGroupIpex, send: () => Operation<void>): Operation<boolean> {
    const now = this.deps.clock.now();
    if (!op.retry.due(now)) return false;
    try {
      yield* send();
      op.retry.succeeded();
      return true;
    } catch (error) {
      op.retry.failed(now, error);
      if (op.retry.exhausted(now, GROUP_IPEX_RETRY_BOUND_MS)) {
        throw new ValidationError(`Delivery kept failing: ${message(error)}`);
      }
      return false;
    }
  }

  /**
   * The event that took the awaited update's place, read from state: a different accepted KEL event at the anchor's
   * sequence number, or a different accepted TEL event at the update's. Null while the update can still be accepted;
   * an update the members never approve stays awaited until the user abandons it.
   */
  private supersededBy(anchor: RegistryEventRef): string | null {
    const kel = this.deps.hby.db.kels.getLast(anchor.anchor.pre, anchor.anchor.sn);
    if (kel && kel !== anchor.anchor.said) return kel;
    const tel = this.deps.rgy.store.seqEvent(anchor.regid, anchor.sn)?.said;
    if (tel && tel !== anchor.said) return tel;
    return null;
  }

  /**
   * Sign this member's contribution to a presentation Grant whose registry update the group has accepted: attach the
   * proof sealed by the accepted anchor, then contribute. The consent that began the operation covers this signature.
   */
  private *signAfterUpdate(op: LiveGroupIpex, awaited: GroupIpexPrerequisite): Operation<Uint8Array> {
    const seal = this.deps.rgy.store.anchor(awaited.anchor.said);
    if (!seal) throw new ValidationError("The presentation update is accepted but its anchor is unavailable");
    const grant = yield* attachPresentationProof(awaited.grant, awaited.opening, { s: seal[0], d: seal[1] });
    return yield* contribute(this.deps, op.group, grant.exn, grant.nests, op.genus);
  }

  private *step(op: LiveGroupIpex): Operation<void> {
    const { hby, protocol, postman, exc, rgy, clock } = this.deps;
    if (op.prerequisite) {
      const awaited = op.prerequisite;
      const superseding = this.supersededBy(awaited.anchor);
      if (superseding) {
        this.end(op, "failed", `The registry update was superseded by ${superseding}`);
        return;
      }
      const read = { db: hby.db, store: rgy.store, protocol };
      if (registryEventStatus(read, awaited.anchor).state !== "accepted") {
        if ((yield* settleRegistryEvent(read, awaited.anchor)).state !== "accepted") return;
      }
      op.outbound = { kind: "initial", wire: yield* this.signAfterUpdate(op, awaited) };
      op.prerequisite = null;
      this.setPhase(op, "publishing");
    }
    if (op.outbound) {
      const { kind, wire } = op.outbound;
      const sent = yield* this.attempt(op, function*() {
        op.publication = kind === "initial"
          ? yield* publishInitialGroupIpex(hby, protocol, postman, op.group, wire, op.genus)
          : yield* publishGroupIpexProposal(hby, protocol, postman, op.group, wire, op.genus);
      });
      if (!sent) return;
      op.outbound = null;
      this.setPhase(op, "awaitingMembers");
    }
    if (!exc.complete(op.said) && clock.now() >= op.nextCollect) {
      op.nextCollect = clock.now() + GROUP_IPEX_COLLECT_MS;
      // This operation exists only because this member consented, so collecting reuses its recorded contribution.
      yield* approveStoredMultisigIpexWrappers(hby, protocol, op.said, null);
    }
    if (!exc.complete(op.said)) return;
    const embedded = hby.db.exns.get([op.said])!;
    requireAcdcV2GroupUse(hby, protocol, embedded);
    if (!op.delivered) {
      if (exc.lead(op.group, op.said)) {
        this.setPhase(op, "delivering");
        const sent = yield* this.attempt(op, function*() {
          op.deliveries = yield* sendCompletedGroupIpex(
            hby,
            postman,
            null,
            op.group,
            embedded,
            op.genus,
            rgy.store,
            exc,
          );
        });
        if (!sent) return;
      }
      op.delivered = true;
    }
    this.live.delete(op.said);
    this.outcomes.set(op.said, {
      messages: op.publication?.messages ?? [],
      deliveries: op.publication?.deliveries ?? [],
      members: op.publication?.members ?? [],
      sent: op.deliveries,
    });
    this.deps.changes?.push({ kind: "ipex", id: op.said });
  }
}

/** A group-authored message to propose. */
export interface GroupIpexProposalInput {
  hab: Hab;
  exn: SerderKERI;
  /** The message's nested evidence, framed as in the candidate wire. */
  nests?: Uint8Array;
  gvrsn?: Versionage;
  /** False when the caller takes the completed message itself (a file) and the lead must not send it. */
  deliver?: boolean;
}

/**
 * The proposer's consent to a group-authored v2 IPEX message: signs this member's contribution to the exact
 * `exn` body, accepts it locally and records the operation. Publishing the wrapper to the other members is
 * `processOnce`.
 *
 * @throws ValidationError for a body the group did not author, a non-group identifier, a message awaiting
 * authenticating dependencies, or one already begun; KramRefusedError (a ValidationError) when this member's own
 * KRAM refuses the message, as an Offer past its exchange lifetime.
 */
export function* proposeGroupIpex(
  ops: GroupIpexOperations,
  { hab, exn, nests = new Uint8Array(), gvrsn = Vrsn_2_0, deliver = true }: GroupIpexProposalInput,
): Operation<GroupIpexBegun> {
  if (!isLocalGroupHab(ops.deps.hby, hab)) throw new ValidationError("Group IPEX requires a local group identifier");
  if (exn.pre !== hab.pre || !exn.said) throw new ValidationError("The IPEX message must be authored by the group");
  if (ops.live.has(exn.said)) throw new ValidationError("A group IPEX message was already begun for this SAID");
  const own = yield* contribute(ops.deps, hab, exn, nests, gvrsn);
  return ops.begin(exn.said, hab, gvrsn, { kind: "initial", wire: own }, deliver);
}

/** A group-authored message and the registry update it waits for. */
export interface GroupIpexAfterInput {
  hab: Hab;
  exn: SerderKERI;
  gvrsn?: Versionage;
  /** False when the caller takes the completed message itself and the lead must not send it. */
  deliver?: boolean;
  prerequisite: GroupIpexPrerequisite;
}

/**
 * The proposer's consent to a presentation Grant that waits for a registry update: the caller has proposed the
 * update (this member's contribution is its approval) and passes the frozen Grant, its opening and the anchor to wait
 * for. On each pass the owner reads whether the group accepted the update; once it has, the owner attaches the proof
 * and signs this member's contribution under this same consent. A superseded update ends the operation `failed`; one
 * the members never approve stays active until {@link abandonGroupIpex}. Returns after local commit.
 */
export function proposeGroupIpexAfter(
  ops: GroupIpexOperations,
  { hab, exn, gvrsn = Vrsn_2_0, deliver = true, prerequisite }: GroupIpexAfterInput,
): GroupIpexBegun {
  if (!isLocalGroupHab(ops.deps.hby, hab)) throw new ValidationError("Group IPEX requires a local group identifier");
  if (exn.pre !== hab.pre || !exn.said) throw new ValidationError("The IPEX message must be authored by the group");
  if (ops.live.has(exn.said)) throw new ValidationError("A group IPEX message was already begun for this SAID");
  return ops.begin(exn.said, hab, gvrsn, null, deliver, prerequisite);
}

/** An Admit of an accepted Grant a group holder proposes. */
export interface GroupAdmitInput {
  hab: Hab;
  /** SAID of the accepted Grant. */
  grant: string;
  message?: string;
  gvrsn?: Versionage;
  deliver?: boolean;
}

/** A proposed Admit and the Grant it answers. */
export interface GroupAdmitBegun extends GroupIpexBegun {
  grant: string;
}

/**
 * A group holder's consent to admit an accepted Grant: freezes the Admit body (explicit consent, exact prior
 * authentication and current root truth), then proposes it as {@link proposeGroupIpex} does. The other members list
 * the proposal and approve it; nothing here records inventory.
 */
export function* proposeGroupAdmit(
  ops: GroupIpexOperations,
  { hab, grant, message = "", gvrsn = Vrsn_2_0, deliver }: GroupAdmitInput,
): Operation<GroupAdmitBegun> {
  const { hby, rgy, exc } = ops.deps;
  if (!isLocalGroupHab(hby, hab)) throw new ValidationError("Group IPEX requires a local group identifier");
  const admit = yield* new IpexAdmitter(hby, rgy.store, exc).prepareAdmitBody(grant, hab.pre!, {
    consent: true,
    message,
    gvrsn,
  });
  return { ...(yield* proposeGroupIpex(ops, { hab, exn: admit, gvrsn, deliver })), grant };
}

/** Stored v2 IPEX proposals of `hab` (or of every local group) that were proposed by a member, newest unordered. */
export function groupIpexProposals(ops: GroupIpexOperations, hab?: Hab): GroupIpexProposal[] {
  const { hby, exc } = ops.deps, found: GroupIpexProposal[] = [];
  for (const [, wrapper] of hby.db.exns.getTopItemIter()) {
    if (wrapper.route !== MULTISIG_EXN_ROUTE || wrapper.pvrsn.major !== 2) continue;
    const embedded = storedMultisigIpexBody(hby.db, wrapper);
    const group = embedded?.pre;
    if (
      !embedded?.route?.startsWith("/ipex/") || !group || (hab && group !== hab.pre)
      || !hby.habs.get(group) || !isLocalGroupHab(hby, hby.habs.get(group)!)
    ) continue;
    if (found.some((item) => item.said === embedded.said)) continue;
    if (
      embedded.route === IPEX_GRANT_ROUTE
      && isIssuanceOrigin(group, loadNests(hby.db, wrapper.said!)[0]?.nests?.[0])
    ) continue;
    found.push({
      said: embedded.said!,
      route: embedded.route,
      group,
      wrapper: wrapper.said!,
      proposer: wrapper.pre!,
      ...(typeof embedded.sad?.p === "string" && embedded.sad.p ? { prior: embedded.sad.p } : {}),
      approved: groupIpexApproved(hby, group, embedded),
      complete: exc.complete(embedded.said!),
    });
  }
  return found;
}

/** Choices of a member's approval. */
export interface GroupIpexApproveOptions {
  /** False when the caller takes the completed message itself and the lead must not send it. */
  deliver?: boolean;
}

/**
 * A member's consent to a stored group IPEX proposal: verifies the exact stored wrapper, signs or reuses this
 * member's contribution and accepts it locally, and records the operation. Publishing it, collecting the other
 * members' contributions and, for the lead, delivering the completed message are `processOnce`.
 *
 * An accepted message may be approved again: the recorded contribution is reused, and the elected lead delivers the
 * completed message, which a lead that learned of the acceptance from another member's wrapper has not yet done.
 *
 * @throws ValidationError when no v2 proposal is stored for `said`, an operation is already live for it, or this
 * member still lacks the evidence to approve it; KramRefusedError (a ValidationError) when this member's own KRAM
 * refuses the contribution.
 */
export function* approveGroupIpex(
  ops: GroupIpexOperations,
  said: string,
  { deliver = true }: GroupIpexApproveOptions = {},
): Operation<GroupIpexBegun> {
  const { hby, protocol } = ops.deps;
  if (ops.live.has(said)) throw new ValidationError("A group IPEX message was already begun for this SAID");
  const wrapper = findStoredMultisigIpex(hby.db, said);
  if (!wrapper || wrapper.pvrsn.major !== 2) throw new ValidationError("No stored group IPEX proposal for this SAID");
  const { groupHab, genus, approved } = yield* approveMultisigIpexLocally(hby, protocol, null, wrapper);
  if (!approved) throw new ValidationError("This member lacks the evidence to approve the proposal yet");
  return ops.begin(said, groupHab, genus, { kind: "proposal", wire: approved }, deliver);
}

/** Local abandon: stop publishing and collecting. Does not undo a recorded contribution or message the peers. */
export function abandonGroupIpex(ops: GroupIpexOperations, said: string, reason = "Abandoned by the user"): void {
  const live = ops.live.get(said);
  if (live) ops.end(live, "abandoned", reason);
}

/**
 * Pure read of one group IPEX message: what ended in this process, the live table, and otherwise what the stores
 * prove (see the module doc).
 *
 * @throws ValidationError when no stored proposal or accepted message of a local group has this SAID.
 */
export function groupIpexStatus(
  ops: GroupIpexOperations,
  said: string,
): GroupIpexStatus {
  const ended = ops.ended.get(said), live = ops.live.get(said);
  if (ended) return { state: ended.state, reason: ended.reason };
  if (live) return { state: "active", phase: live.phase };
  const { hby, exc } = ops.deps;
  if (exc.complete(said)) return { state: "done", phase: "accepted" };
  if (!findStoredMultisigIpex(hby.db, said)) {
    throw new ValidationError("No group IPEX proposal is stored for this SAID");
  }
  return { state: "active", phase: "awaitingConsent", needs: "approve" };
}

/**
 * The member wrappers this process has published for one message: from the live operation once it published, from
 * the outcome after it ended. Empty before publication. A pure read.
 */
export function groupIpexMessages(ops: GroupIpexOperations, said: string): GroupSendResult["messages"] {
  return ops.live.get(said)?.publication?.messages ?? ops.outcomes.get(said)?.messages ?? [];
}

/** Options for {@link waitForGroupIpex}. */
export interface GroupIpexWaitOptions {
  /** Wall-clock budget. */
  timeoutMs: number;
  clock?: RuntimeClock;
  /** Settle on this instead of any non-active state. */
  until?: (status: GroupIpexStatus) => boolean;
}

/** Observe until the message is accepted and delivered, or ended, or the budget expires. Starts no worker. */
export function* waitForGroupIpex(
  ops: GroupIpexOperations,
  said: string,
  { timeoutMs, clock = ops.deps.clock, until = (status) => status.state !== "active" }: GroupIpexWaitOptions,
): Operation<WaitResult<GroupIpexStatus>> {
  const settled = yield* observeUntil(() => until(groupIpexStatus(ops, said)), { timeoutMs, clock });
  const status = groupIpexStatus(ops, said);
  return settled ? { outcome: "settled", status } : { outcome: "timed-out", status, timeoutMs };
}
