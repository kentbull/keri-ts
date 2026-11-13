/**
 * The group half of the web wallet API: `groups`, `proposals` and the group forms of the credential calls.
 *
 * A group acts only through its members' separate consents, so this surface is organised the same way:
 * - a member that starts something (`groups.incept`, `rotate`, `interact`, `inceptRegistry`, a group
 *   `credentials.issue`) is the proposer. The library signs its contribution, tells the other members and the
 *   runtime's Counselor completes the event (signatures, delegation, witness receipts);
 * - every other member sees the same item in `proposals.list()` and gives its one consent with
 *   `proposals.approve(id)`. The wallet picks the library call from the proposal's kind, so an app has one
 *   consent surface whatever the proposal carries (a key event, a registry event, a group IPEX message or a
 *   group issuance Grant);
 * - nothing here waits for a remote without a timeout, and a wait that expires is a `timed-out` outcome that
 *   carries the status read at return. The runtime keeps working after it.
 *
 * The same workflow contract as the single-signature surface applies (see `wallet-api.ts`).
 */
import { SerderACDC, type ThresholdSith } from "cesr-ts";
import { call, type Operation } from "effection";
import {
  abandonGroupIpex,
  type AcdcMapOptions,
  type AgentRuntime,
  answerUnblind,
  approveGroupIpex,
  approveGroupIssuance,
  approveGroupIssuanceExchange,
  approveGroupProposal,
  completeGroupMailbox,
  type CounselInputs,
  type DisclosureSelection,
  dismissGroupProposal,
  findGroupProposal,
  type GroupDelivery,
  type GroupEventRef,
  type GroupEventStatus,
  groupIpexProposals,
  type GroupIpexStatus,
  groupIpexStatus,
  groupIssuanceElection,
  groupIssuanceProposals,
  type GroupProposal,
  type GroupProposalNeeds,
  type Hab,
  type Habery,
  isLocalGroupHab,
  type IssuanceStatus,
  issuanceStatus,
  listGroupProposals,
  type MailboxStatus,
  mailboxStatus,
  type PendingGrant,
  pendingGroupGrants,
  type PresentationOptions,
  proposeGroupAdmit,
  proposeGroupInception,
  proposeGroupInteraction,
  proposeGroupIssuance,
  proposeGroupMailbox,
  proposeGroupPresentation,
  proposeGroupRotation,
  proposeRegistryEvent,
  Receiptor,
  requestUnblind,
  settleProposedRotation,
  unblindingStatus,
  ValidationError,
  waitForGroupEvent,
  waitForGroupIpex,
  waitForIssuance,
  waitForUnblinding,
  type WaitResult,
} from "keri-ts/runtime";
import { WalletAuthor } from "../authoring.ts";
import { RegistryCustody } from "../custody.ts";
import type { AdmittedCredential } from "../storing.ts";
import {
  type AdmitDelivery,
  type TimeoutOptions,
  WALLET_TIMEOUTS,
  type WalletApiParts,
  WalletScope,
  within,
} from "./surface.ts";
import type { EndedStatus, EndedUnblinding, UnblindOutcome } from "./wallet-api.ts";

// --- group events -------------------------------------------------------------------------------------------

/**
 * Where a group event stands after a wait. `complete`: signatures, delegation and witness receipts are in.
 * `superseded`: another event took its place (`accepted` names it). `unknown`: the Counselor holds no such event.
 * `timed-out`: the other members have not finished within `timeoutMs`; the Counselor keeps going, and
 * {@link Groups.wait} resumes the wait.
 */
export type GroupEventOutcome =
  & {
    group: string;
    event: GroupEventRef;
    status: GroupEventStatus;
    /** What became of the wrapper sent to each other member when this call proposed or approved; empty on a wait. */
    members: readonly GroupDelivery[];
  }
  & (
    | { outcome: "complete" }
    | { outcome: "superseded"; accepted: string }
    | { outcome: "unknown" }
    | { outcome: "timed-out"; timeoutMs: number }
  );

/** Waits on the Counselor for `event` and reads the outcome. */
function* settleEvent(
  runtime: AgentRuntime,
  event: GroupEventRef,
  timeoutMs: number,
  members: readonly GroupDelivery[] = [],
): Operation<GroupEventOutcome> {
  const waited = yield* waitForGroupEvent(runtime.counselor, event, { timeoutMs, clock: runtime.clock });
  const { status } = waited, base = { group: event.pre, event, status, members };
  if (waited.outcome === "timed-out") return { ...base, outcome: "timed-out", timeoutMs };
  if (status.state === "complete") return { ...base, outcome: "complete" };
  if (status.state === "superseded") return { ...base, outcome: "superseded", accepted: status.accepted };
  return { ...base, outcome: "unknown" };
}

/** Counseling choices a caller may make for one event. */
export interface GroupCounsel {
  /** How long a non-elected member only fetches receipts before it submits too. Zero: every member submits. */
  fallbackAfterMs?: number;
  /** Alias of the local identifier that carries a delegated event's delegation request. */
  proxy?: string;
}

/** Inputs of {@link Groups.incept}. */
export interface GroupInceptOptions extends GroupCounsel {
  /** Local alias of the new group. */
  alias: string;
  /** The local single-signature identifier that proposes (its prefix). */
  member: string;
  /** Signing members, this member included. Their key state must be known to the wallet. */
  smids: readonly string[];
  /** Rotation members; defaults to `smids`. */
  rmids?: readonly string[];
  isith?: ThresholdSith;
  nsith?: ThresholdSith;
  toad?: number;
  wits?: string[];
  /** Delegator AID, for a delegated group. */
  delpre?: string;
  data?: unknown[];
  /** Budget of the wait for the other members; default 120 s. */
  timeoutMs?: number;
}

/** Inputs of {@link Groups.rotate}; omitted members keep the group's current ones. */
export interface GroupRotateOptions extends GroupCounsel {
  smids?: readonly string[];
  rmids?: readonly string[];
  isith?: ThresholdSith;
  nsith?: ThresholdSith;
  toad?: number;
  cuts?: string[];
  adds?: string[];
  data?: unknown[];
  timeoutMs?: number;
}

/** Inputs of {@link Groups.join}. */
export interface GroupJoinOptions extends GroupWaitOptions {
  /** Local alias of the group being joined. */
  alias: string;
}

/** Choices for a call that waits on the Counselor. */
export interface GroupWaitOptions extends GroupCounsel {
  timeoutMs?: number;
}

/** Result of {@link Groups.proposeMailbox}: the proposal is sent; the other members approve it as a proposal. */
export interface GroupMailboxProposal {
  outcome: "proposed";
  group: string;
  mailbox: string;
  /** SAID of the proposed reply; the other members see the proposal in `proposals.list()`. */
  payload: string;
  /** What became of the wrapper sent to each other member; a failed one can be sent again. */
  members: readonly GroupDelivery[];
}

/** Result of {@link Groups.completeMailbox}. */
export type GroupMailboxOutcome =
  | { outcome: "authorized"; status: MailboxStatus }
  /** The members have not all approved yet, the provider refused, or its reply was not accepted. */
  | { outcome: "rejected"; reason: string; status: MailboxStatus }
  | { outcome: "timed-out"; timeoutMs: number; status: MailboxStatus };

/** Group identifiers: propose events, join groups, observe the Counselor and add the group's mailbox. */
export class Groups {
  readonly #scope: WalletScope;

  constructor(scope: WalletScope) {
    this.#scope = scope;
  }

  /**
   * Propose a new group as `member`: create this member's inception, tell the other members and wait on the
   * Counselor for the group to be accepted and receipted. The other members join through
   * {@link Groups.join} or `proposals.approve`.
   *
   * @throws ValidationError for a used alias or a `member` that is not a local single-signature identifier.
   */
  async incept(options: GroupInceptOptions): Promise<GroupEventOutcome> {
    const { hby, runtime } = this.#scope.parts;
    const { alias, smids, rmids, timeoutMs = WALLET_TIMEOUTS.group } = options;
    if (hby.habByName(alias)) throw new ValidationError(`Alias ${alias} already exists.`);
    const member = this.#scope.individual(options.member), inputs = counselInputs(this.#scope.parts.hby, options);
    const { isith, nsith, toad, wits, delpre, data } = options;
    return await this.#scope.go(function*(this: Groups) {
      const proposed = yield* proposeGroupInception(
        this.proposeDeps(),
        member,
        alias,
        { smids, rmids, isith, nsith, toad, wits, delpre, data },
        inputs,
      );
      return yield* settleEvent(this.#scope.parts.runtime, proposed.event, timeoutMs, proposed.members);
    }.bind(this));
  }

  /**
   * Propose a rotation of `group` (member changes included, through `smids` and `rmids`) and wait for it. When the
   * rotation completes, the members it named are committed.
   *
   * @throws ValidationError for an unknown identifier or one that is not a local group.
   */
  async rotate(group: string, options: GroupRotateOptions = {}): Promise<GroupEventOutcome> {
    const hab = this.#scope.group(group),
      inputs = counselInputs(this.#scope.parts.hby, options),
      timeoutMs = options.timeoutMs ?? WALLET_TIMEOUTS.group;
    const { smids, rmids, isith, nsith, toad, cuts, adds, data } = options;
    return await this.#scope.go(function*(this: Groups) {
      const proposed = yield* proposeGroupRotation(
        this.proposeDeps(),
        hab,
        { smids, rmids, isith, nsith, toad, cuts, adds, data },
        inputs,
      );
      const settled = yield* settleEvent(this.#scope.parts.runtime, proposed.event, timeoutMs, proposed.members);
      if (settled.outcome === "complete") settleProposedRotation({ hby: this.#scope.parts.hby }, proposed);
      return settled;
    }.bind(this));
  }

  /** Propose an interaction event of `group` carrying `data` and wait for it. */
  async interact(group: string, data: unknown[], options: GroupWaitOptions = {}): Promise<GroupEventOutcome> {
    const hab = this.#scope.group(group),
      inputs = counselInputs(this.#scope.parts.hby, options),
      timeoutMs = options.timeoutMs ?? WALLET_TIMEOUTS.group;
    return await this.#scope.go(function*(this: Groups) {
      const proposed = yield* proposeGroupInteraction(this.proposeDeps(), hab, data, inputs);
      return yield* settleEvent(this.#scope.parts.runtime, proposed.event, timeoutMs, proposed.members);
    }.bind(this));
  }

  /**
   * Join a group another member proposed, under the local `alias`, and wait for the group event. A thin form of
   * `proposals.approve` for an inception (or the rotation of a group not joined yet).
   *
   * @throws ValidationError when `proposal` is not a stored inception or rotation proposal that needs an alias.
   */
  async join(proposal: string, options: GroupJoinOptions): Promise<GroupEventOutcome> {
    const { runtime } = this.#scope.parts;
    const found = findGroupProposal(groupDeps(runtime), proposal);
    if (!found?.needs.groupAlias) {
      throw new ValidationError(`${proposal} is not a proposal to join a group; use proposals.approve.`);
    }
    const inputs = counselInputs(this.#scope.parts.hby, options),
      timeoutMs = options.timeoutMs ?? WALLET_TIMEOUTS.group;
    return await this.#scope.go(function*(this: Groups) {
      const approved = yield* approveGroupProposal(groupDeps(runtime), proposal, {
        groupAlias: options.alias,
        ...inputs,
      });
      if (!approved.event) throw new ValidationError(`Proposal ${proposal} sets up no group event.`);
      return yield* settleEvent(this.#scope.parts.runtime, approved.event, timeoutMs, approved.members);
    }.bind(this));
  }

  /** Pure read of a group event's progress through the Counselor. */
  status(event: GroupEventRef): GroupEventStatus {
    return this.#scope.parts.runtime.counselor.status(event);
  }

  /** Wait on the Counselor for `event`; call again after `timed-out` to keep waiting. */
  async wait(event: GroupEventRef, options: TimeoutOptions = {}): Promise<GroupEventOutcome> {
    const timeoutMs = options.timeoutMs ?? WALLET_TIMEOUTS.group;
    return await this.#scope.go(() => settleEvent(this.#scope.parts.runtime, event, timeoutMs));
  }

  /**
   * Propose the group's ACDC v2 registry `name` (incepting its alias if needed) and wait for the group anchor.
   * The other members approve the `rip` proposal. A group issues into a registry that exists.
   */
  async inceptRegistry(group: string, name: string, options: GroupWaitOptions = {}): Promise<GroupEventOutcome> {
    const { runtime } = this.#scope.parts;
    const hab = this.#scope.group(group),
      inputs = counselInputs(this.#scope.parts.hby, options),
      timeoutMs = options.timeoutMs ?? WALLET_TIMEOUTS.group;
    const regery = runtime.acdc;
    if (!regery) throw new ValidationError("This wallet's runtime has no ACDC v2 registry store.");
    return await this.#scope.go(function*(this: Groups) {
      const registry = regery.registryByName(name) ?? regery.makeRegistry(name, hab.pre!);
      const event = registry.store.event(registry.regk!);
      if (!event) throw new ValidationError(`Registry ${name} has no stored inception.`);
      const proposed = yield* proposeRegistryEvent(
        { ...this.proposeDeps(), registryStore: regery.store },
        hab,
        event,
        undefined,
        inputs,
      );
      return yield* settleEvent(this.#scope.parts.runtime, proposed.event, timeoutMs, proposed.members);
    }.bind(this));
  }

  /**
   * Propose the group's authorization of `mailbox` (an end-role reply) to the other members, who approve it as a
   * proposal. Then {@link Groups.completeMailbox} posts the accepted reply to the provider.
   */
  async proposeMailbox(group: string, mailbox: string): Promise<GroupMailboxProposal> {
    const { hby, runtime } = this.#scope.parts;
    const hab = this.#scope.group(group);
    return await this.#scope.go(function*() {
      const sent = yield* proposeGroupMailbox(hby, runtime.protocol, runtime.postman, hab, mailbox);
      return {
        outcome: "proposed" as const,
        group: hab.pre!,
        mailbox,
        payload: sent.messages[0]?.payloadSaid ?? sent.members[0]?.payloadSaid ?? "",
        members: sent.members,
      };
    });
  }

  /**
   * Post the group's accepted mailbox reply to the provider and confirm it. `rejected` with the reason while the
   * members have not all approved, or when the provider refuses.
   */
  async completeMailbox(group: string, mailbox: string, options: TimeoutOptions = {}): Promise<GroupMailboxOutcome> {
    const timeoutMs = options.timeoutMs ?? WALLET_TIMEOUTS.mailbox;
    const { hby, runtime } = this.#scope.parts;
    const hab = this.#scope.group(group);
    return await this.#scope.go(function*(): Operation<GroupMailboxOutcome> {
      const deps = {
        hby,
        http: runtime.http,
        reactor: runtime.reactor,
        protocol: runtime.protocol,
        publisher: runtime.kelPublisher,
      };
      try {
        const done = yield* within(runtime.clock, timeoutMs, () => completeGroupMailbox(deps, hab, mailbox));
        const status = mailboxStatus(hby, hab.pre!, mailbox);
        return done.done ? { outcome: "authorized", status: done.value } : { outcome: "timed-out", timeoutMs, status };
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        return { outcome: "rejected", reason: error.message, status: mailboxStatus(hby, hab.pre!, mailbox) };
      }
    });
  }

  /** The collaborators of proposing. */
  private proposeDeps() {
    const { hby, runtime } = this.#scope.parts;
    return { hby, protocol: runtime.protocol, postman: runtime.postman, counselor: runtime.counselor };
  }
}

/** Counseling inputs from the caller's choices. */
function counselInputs(hby: Habery, { fallbackAfterMs, proxy }: GroupCounsel): CounselInputs {
  const proxyHab = proxy ? hby.habByName(proxy) : undefined;
  if (proxy && !proxyHab?.kever) {
    throw new ValidationError(`Delegation proxy ${proxy} is not a local identifier with key state.`);
  }
  return { ...(fallbackAfterMs === undefined ? {} : { fallbackAfterMs }), ...(proxyHab ? { proxy: proxyHab } : {}) };
}

/**
 * Record a group issuance in the wallet inventory when it completes, through the same `ChangeSink` reaction the
 * single-signature issuer path uses. The recorder returns true once the issuance is over (recorded, or ended without
 * issuing) and false while it runs or while the exact derivation opening cannot be read yet (a member that has not
 * received the registry root copy keeps trying on later changes). A failure to record is never thrown into the
 * workflow that published the change.
 */
/** Records one tracked issuance in the inventory; throws while the exact opening cannot be read yet. */
export type IssuanceRecorder = () => void;

function trackGroupIssuance(
  parts: WalletApiParts,
  hab: Hab,
  grant: string,
  credential: SerderACDC,
  registry: string,
): IssuanceRecorder {
  const { hby, runtime, wallet, inventory, tracked } = parts;
  const ops = runtime.operations!.issuance, store = runtime.acdc!.store;
  const record = () => {
    if (inventory.issued.get([credential.said!])) return;
    const head = store.headEvent(registry)!;
    const custody = new RegistryCustody({ hby, hab, registry: store, db: inventory });
    wallet.recordIssued(credential, head.said!, { blinder: custody.issuedOpening(head, credential.said!) });
  };
  tracked.set(grant, () => {
    const status = issuanceStatus(ops, grant);
    if (status.state === "active") return false;
    if (status.state === "done") record();
    return true;
  });
  return record;
}

// --- proposals ---------------------------------------------------------------------------------------------------

/** What a proposal carries. */
export type ProposalFamily = "event" | "registry" | "ipex" | "issuance";

/** The standing of this member for a proposal. */
export type ProposalStanding = "unapproved" | "approved" | "inapplicable";

/** One thing a group is waiting for this wallet to consent to, or has consented to. `id` is the key of `approve`. */
export type WalletProposal =
  & { id: string; group: string; proposer: string; local: ProposalStanding; complete: boolean }
  & (
    | {
      family: "event" | "registry";
      /** `icp`, `rot`, `ixn`, `rpy` for events; `rip`, `bup`, `vcp`, `iss`, `rev` for registries. */
      type: GroupProposal["kind"];
      /** Choices approval will need: a group alias, or a registry name. */
      needs: GroupProposalNeeds;
      event?: GroupEventRef;
    }
    | { family: "ipex"; type: string; prior?: string }
    | { family: "issuance"; type: "grant"; recipient: string }
  );

/** Result of {@link Proposals.approve}: the consent is recorded, and the outcome is where the group stands. */
export type ProposalOutcome = ProposalFacts & ProposalProgress;

/** Where a proposal's work stands, as a library status. */
export type ProposalStatus = GroupEventStatus | GroupIpexStatus | IssuanceStatus;

/** What every {@link ProposalOutcome} says about the proposal it answers. */
export interface ProposalFacts {
  id: string;
  family: ProposalFamily;
  status: ProposalStatus | null;
}

/** How far the group's work got. */
export type ProposalProgress =
  /** Consent recorded and the group's work finished (event complete, message accepted, issuance done). */
  | { outcome: "complete" }
  /** Consent recorded; nothing further is observable here (for example an endpoint-role reply). */
  | { outcome: "approved" }
  /** The work stopped (`reason`). */
  | { outcome: "ended"; reason: string }
  /** The other members have not finished within `timeoutMs`; the runtime keeps going. */
  | { outcome: "timed-out"; timeoutMs: number }
  /** No consent was recorded: the proposal cannot be approved yet or here (`reason`), and may be approved again. */
  | { outcome: "refused"; reason: string };

/** A progress with the status (and group event) it was read from, before the proposal's id is added. */
export type ProposalSummary = ProposalProgress & { status: ProposalStatus; event?: GroupEventRef };

/** Choices for {@link Proposals.approve}. */
export interface ProposalApproveOptions extends GroupCounsel {
  /** Local alias for a group not joined yet (`needs.groupAlias`). */
  groupAlias?: string;
  /** Local name for a registry proposal (`needs.registryName`). */
  registryName?: string;
  timeoutMs?: number;
}

/** Inputs of {@link Proposals.list}. */
export interface ProposalListOptions {
  /** Only this group (prefix or alias). */
  group?: string;
  /** Include proposals already consented to and finished ones. */
  all?: boolean;
}

/** The one consent surface of a group wallet. */
export class Proposals {
  readonly #scope: WalletScope;

  constructor(scope: WalletScope) {
    this.#scope = scope;
  }

  /**
   * Everything the local groups are waiting on, one typed list: key and reply events, registry events, group IPEX
   * messages and group issuance Grants. By default only items this member has not consented to and that are not
   * finished; `all` lists the rest too. A pure read.
   */
  list(options: ProposalListOptions = {}): WalletProposal[] {
    const { group, all = false } = options;
    const { hby, runtime } = this.#scope.parts;
    const wanted = group === undefined ? undefined : this.#scope.group(group);
    const found: WalletProposal[] = [];
    for (const proposal of listGroupProposals(groupDeps(runtime), wanted ? { group: wanted.pre! } : {})) {
      found.push({
        id: proposal.said,
        family: proposal.kind === "icp" || proposal.kind === "rot" || proposal.kind === "ixn" || proposal.kind === "rpy"
          ? "event"
          : "registry",
        type: proposal.kind,
        group: proposal.group,
        proposer: proposal.proposer,
        local: proposal.local,
        complete: proposal.event ? runtime.counselor.status(proposal.event).state === "complete" : false,
        needs: proposal.needs,
        ...(proposal.event ? { event: proposal.event } : {}),
      } as WalletProposal);
    }
    const ipex = runtime.operations?.groupIpex;
    if (ipex) {
      for (const item of groupIpexProposals(ipex, wanted)) {
        found.push({
          id: item.said,
          family: "ipex",
          type: item.route,
          group: item.group,
          proposer: item.proposer,
          local: item.approved ? "approved" : "unapproved",
          complete: item.complete,
          ...(item.prior ? { prior: item.prior } : {}),
        });
      }
    }
    const issuance = runtime.operations?.issuance;
    if (issuance) {
      for (const habGroup of wanted ? [wanted] : this.groupHabs()) {
        for (const item of groupIssuanceProposals(issuance, habGroup)) {
          found.push({
            id: item.grant,
            family: "issuance",
            type: "grant",
            group: item.group,
            proposer: item.proposer,
            recipient: item.recipient,
            local: issuance.live.has(item.grant) ? "approved" : "unapproved",
            complete: item.complete,
          });
        }
      }
    }
    return all ? found : found.filter((item) => item.local === "unapproved" && !item.complete);
  }

  /**
   * Give this member's one consent to a proposal and wait for the group's work to finish. The call made is
   * chosen from the proposal's kind: `approveGroupProposal` for events and registry events (then the Counselor),
   * `approveGroupIpex` for a group IPEX message, `approveGroupIssuance` for a group issuance Grant.
   *
   * A group IPEX message or issuance Grant the library will not approve now (evidence not arrived, authentication
   * pending, an operation already begun) comes back as `{ outcome: "refused", reason }` with nothing signed.
   *
   * @throws ValidationError when `id` names no stored proposal, or the proposal needs a choice (`groupAlias`,
   * `registryName`) the caller did not make.
   */
  async approve(id: string, options: ProposalApproveOptions = {}): Promise<ProposalOutcome> {
    const { runtime } = this.#scope.parts;
    const timeoutMs = options.timeoutMs ?? WALLET_TIMEOUTS.group;
    const inputs = counselInputs(this.#scope.parts.hby, options);
    const event = findGroupProposal(groupDeps(runtime), id);
    if (event) {
      const family = event.kind === "icp" || event.kind === "rot" || event.kind === "ixn" || event.kind === "rpy"
        ? "event"
        : "registry";
      return await this.#scope.go(function*(this: Proposals): Operation<ProposalOutcome> {
        const approved = yield* approveGroupProposal(groupDeps(runtime), id, {
          groupAlias: options.groupAlias,
          registryName: options.registryName,
          ...inputs,
        });
        if (!approved.event) return { id, family, outcome: "approved", status: null };
        const settled = yield* settleEvent(this.#scope.parts.runtime, approved.event, timeoutMs, approved.members);
        return { id, family, ...eventSummary(settled) };
      }.bind(this));
    }
    const ipex = runtime.operations?.groupIpex;
    if (ipex && groupIpexProposals(ipex).some((item) => item.said === id)) {
      return await this.#scope.go(function*(): Operation<ProposalOutcome> {
        try {
          yield* approveGroupIpex(ipex, id);
        } catch (error) {
          if (error instanceof ValidationError) {
            return { id, family: "ipex", outcome: "refused", reason: error.message, status: groupIpexStatus(ipex, id) };
          }
          throw error;
        }
        return { id, family: "ipex", ...ipexSummary(yield* waitForGroupIpex(ipex, id, { timeoutMs })) };
      });
    }
    const issuance = runtime.operations?.issuance;
    const grant = issuance
      && this.groupHabs().flatMap((hab) => groupIssuanceProposals(issuance, hab)).find((item) => item.grant === id);
    if (issuance && grant) {
      const hab = this.#scope.group(grant.group);
      const parts = this.#scope.parts;
      return await this.#scope.go(function*(): Operation<ProposalOutcome> {
        if (!issuance.live.has(id) && !issuance.deps.exc.complete(id)) {
          try {
            yield* approveGroupIssuance(issuance, id);
          } catch (error) {
            if (error instanceof ValidationError) {
              return {
                id,
                family: "issuance",
                outcome: "refused",
                reason: error.message,
                status: issuanceStatus(issuance, id),
              };
            }
            throw error;
          }
        }
        // The member records the credential when the issuance completes, as the custodian does. Tracking lives in
        // memory, so a page that reloaded after its consent (or finished the issuance while closed) tracks it here
        // on the next call instead of never recording it.
        const origin = issuance.deps.exc.retainedInput(id)?.nests?.[0]?.body;
        if (
          origin instanceof SerderACDC && origin.regid && !parts.tracked.has(id)
          && !parts.inventory.issued.get([origin.said!])
        ) trackGroupIssuance(parts, hab, id, origin, origin.regid);
        const waited = yield* waitForIssuance(issuance, id, { timeoutMs });
        // A finished issuance sends no further change, so give the recorder its try now.
        try {
          if (parts.tracked.get(id)?.()) parts.tracked.delete(id);
        } catch {
          // The registry root copy has not arrived; its `root` change gives the recorder another try.
        }
        return { id, family: "issuance", ...issuanceSummary(waited) };
      });
    }
    throw new ValidationError(`No group proposal ${id} is stored.`);
  }

  /**
   * Dismiss an event or registry proposal locally: remove the notices that announce it. KERI has no reject
   * message, so nothing is sent and the other members learn nothing; the proposal can still be found and approved
   * by its id. IPEX and issuance proposals raise no notices, so there is nothing to dismiss and 0 is returned.
   *
   * @returns The number of notices removed.
   */
  dismiss(id: string): number {
    const { runtime } = this.#scope.parts;
    return dismissGroupProposal(runtime, id);
  }

  private groupHabs(): Hab[] {
    return [...this.#scope.parts.hby.habs.values()].filter((hab) => isLocalGroupHab(this.#scope.parts.hby, hab));
  }
}

/** The collaborators the library's proposal reads and approvals take, from the wallet's runtime. */
function groupDeps(runtime: AgentRuntime) {
  return {
    hby: runtime.hby,
    exc: runtime.exc,
    reactor: runtime.reactor,
    protocol: runtime.protocol,
    postman: runtime.postman,
    notifier: runtime.notifier,
    registryStore: runtime.acdc?.store ?? null,
    vdr: runtime.vdr,
    counselor: runtime.counselor,
  };
}

/** Reduce a settled group event to the common proposal outcome. */
function eventSummary(settled: GroupEventOutcome): ProposalSummary {
  const { status, event } = settled;
  if (settled.outcome === "complete") return { outcome: "complete" as const, status, event };
  if (settled.outcome === "timed-out") {
    return { outcome: "timed-out" as const, timeoutMs: settled.timeoutMs, status, event };
  }
  const reason = settled.outcome === "superseded"
    ? `Superseded by ${settled.accepted}.`
    : "The Counselor holds no such event.";
  return { outcome: "ended" as const, reason, status, event };
}

function ipexSummary(waited: WaitResult<GroupIpexStatus>): ProposalSummary {
  const { status } = waited;
  if (waited.outcome === "timed-out") return { outcome: "timed-out" as const, timeoutMs: waited.timeoutMs, status };
  if (status.state === "done") return { outcome: "complete" as const, status };
  if (status.state === "active") return { outcome: "approved" as const, status };
  return { outcome: "ended" as const, reason: status.reason, status };
}

function issuanceSummary(waited: WaitResult<IssuanceStatus>): ProposalSummary {
  const { status } = waited;
  if (waited.outcome === "timed-out") return { outcome: "timed-out" as const, timeoutMs: waited.timeoutMs!, status };
  if (status.state === "done") return { outcome: "complete" as const, status };
  if (status.state === "active") return { outcome: "approved" as const, status };
  return { outcome: "ended" as const, reason: status.reason, status };
}

// --- group forms of the credential calls ---------------------------------------------------------------------------

/** Result of the group form of `credentials.receive`. */
export type GroupReceiveOutcome =
  | {
    outcome: "admitted";
    grant: string;
    admit: string;
    held: AdmittedCredential;
    delivery: AdmitDelivery;
  }
  | {
    outcome: "ended";
    grant: string;
    status: EndedStatus | EndedGroupIpex;
  }
  | {
    outcome: "timed-out";
    grant: string;
    timeoutMs: number;
    stage: "exchange" | "admit";
    status: IssuanceStatus | GroupIpexStatus;
  };

/** A group IPEX message that was accepted. */
export type DoneGroupIpex = Extract<GroupIpexStatus, { state: "done" }>;

/** A group IPEX message that stopped without being accepted. */
export type EndedGroupIpex = Extract<GroupIpexStatus, { state: "abandoned" | "failed" }>;

/** Inputs of the group form of `credentials.receive`. */
export interface GroupReceiveOptions extends TimeoutOptions {
  /** Message carried by the Admit. */
  message?: string;
}

/** What a group presents: the credential view and the Grant's body options. */
export interface GroupPresentInput {
  selection: DisclosureSelection;
  options: Omit<PresentationOptions, "presentationRegistry">;
}

/** Inputs of the group form of `credentials.issue`. */
export interface GroupIssueOptions extends TimeoutOptions {
  /** Name of the group's registry (see `groups.inceptRegistry`). */
  registry: string;
  credential: Omit<AcdcMapOptions, "regid">;
  /** Recipient of the Grant; defaults to the credential's issuee. */
  recipient?: string;
  message?: string;
  artifacts?: readonly Uint8Array[];
  /** Called once, after the issuing consent is given, with the Grant's SAID. */
  onBegun?: (begun: IssuanceBegunNotice) => void;
}

/** What {@link GroupIssueOptions.onBegun} receives. */
export interface IssuanceBegunNotice {
  grant: string;
  credential: string;
}

/** Inputs of the group form of `credentials.unblind`. */
export interface GroupUnblindOptions extends TimeoutOptions {
  states: readonly string[];
  proposer?: string;
}

/** Result of presenting from a group: the lead delivers the completed Grant once every member has approved. */
export type GroupPresentOutcome =
  | { outcome: "accepted"; said: string; status: DoneGroupIpex }
  | { outcome: "ended"; said: string; status: EndedGroupIpex }
  | { outcome: "timed-out"; said: string; timeoutMs: number; status: GroupIpexStatus };

/** The group forms of `credentials.receive`, `issue`, `present` and `unblind`. */
export class GroupCredentials {
  readonly #scope: WalletScope;

  constructor(scope: WalletScope) {
    this.#scope = scope;
  }

  /** Pending Grants addressed to local groups. */
  pending(pre?: string): PendingGrant[] {
    const ops = this.#scope.parts.runtime.operations?.issuance;
    if (!ops) return [];
    return pendingGroupGrants(ops, pre ? { group: this.#scope.group(pre) } : {});
  }

  /**
   * A holder group member's consent to a Grant addressed to its group: approve the DH exchange, wait for the issuer
   * to finish it, then propose the Admit (or approve the Admit another member proposed), wait until the group's
   * Admit is accepted and record the admission. The elected lead member delivers the Admit.
   */
  async receive(grant: string, hab: Hab, options: GroupReceiveOptions): Promise<GroupReceiveOutcome> {
    const { timeoutMs = WALLET_TIMEOUTS.receive, message = "" } = options;
    const { hby, wallet, runtime } = this.#scope.parts;
    const issuance = runtime.operations?.issuance, ipex = runtime.operations?.groupIpex;
    if (!issuance || !ipex) throw new ValidationError("This wallet's runtime has no group issuance owner.");
    return await this.#scope.go(function*(): Operation<GroupReceiveOutcome> {
      let status = issuanceStatus(issuance, grant);
      if (status.state === "active" && status.needs === "exchange") {
        approveGroupIssuanceExchange(issuance, grant);
      }
      const waited = yield* waitForIssuance(issuance, grant, {
        timeoutMs,
        until: (s) => s.state !== "active" || s.needs === "admit",
      });
      status = waited.status;
      if (waited.outcome === "timed-out") return { outcome: "timed-out", grant, timeoutMs, stage: "exchange", status };
      if (status.state !== "active" && status.state !== "done") return { outcome: "ended", grant, status };
      // Admit: another member's stored proposal for this Grant is approved; otherwise this member proposes.
      let admit = hby.db.erpy.get([grant])?.qb64;
      if (!admit) {
        const stored = groupIpexProposals(ipex, hab).find((item) =>
          item.route === "/ipex/admit" && item.prior === grant
        );
        if (stored) {
          yield* approveGroupIpex(ipex, stored.said);
          admit = stored.said;
        } else {
          admit = (yield* proposeGroupAdmit(ipex, { hab, grant, message })).said;
        }
      }
      const done = yield* waitForGroupIpex(ipex, admit, { timeoutMs });
      if (done.outcome === "timed-out") {
        return { outcome: "timed-out", grant, timeoutMs, stage: "admit", status: done.status };
      }
      if (done.status.state !== "done") {
        return {
          outcome: "ended",
          grant,
          status: done.status as Extract<GroupIpexStatus, { state: "abandoned" | "failed" }>,
        };
      }
      const held = wallet.db.admitted.get([grant])
        ?? (yield* call(() => wallet.recordAdmission(grant, admit!, { consent: true })));
      return { outcome: "admitted", grant, admit: admit!, held, delivery: { state: "by-lead" } };
    });
  }

  /**
   * Begin a group issuance as the elected custodian: the group's registry `registry` (see `groups.inceptRegistry`)
   * issues `credential`, and the other issuer members consent through `proposals.approve`. Waits for the exchange.
   * The runtime proposes the registry update; the other members approve it as a `bup` proposal.
   */
  async issue(hab: Hab, options: GroupIssueOptions): Promise<GroupIssueOutcome> {
    const { hby, runtime, wallet } = this.#scope.parts;
    const ops = runtime.operations?.issuance;
    if (!ops) throw new ValidationError("This wallet's runtime has no issuance owner.");
    if (!groupIssuanceElection(ops, hab.pre!).lead) {
      throw new ValidationError(
        "Only the group's elected custodian begins an issuance; the other issuer members consent through proposals.approve.",
      );
    }
    const recipient = options.recipient ?? options.credential.issuee;
    if (!recipient) throw new ValidationError("A recipient or an issuee is required.");
    const registry = runtime.acdc?.registryByName(options.registry);
    if (!registry || registry.hab.pre !== hab.pre) {
      throw new ValidationError(
        `${options.registry} is not a registry of this group; incept it with groups.inceptRegistry.`,
      );
    }
    const timeoutMs = options.timeoutMs ?? WALLET_TIMEOUTS.issue;
    const parts = this.#scope.parts;
    return await this.#scope.go(function*(): Operation<GroupIssueOutcome> {
      const author = new WalletAuthor(
        wallet,
        runtime.acdc!,
        new Receiptor(hby, runtime.protocol, runtime.http, runtime.clock),
      );
      const credential: SerderACDC = author.create(registry, options.credential);
      const begun = yield* proposeGroupIssuance(ops, {
        credential,
        options: { recipient, message: options.message ?? "", artifacts: [...(options.artifacts ?? [])] },
      });
      try {
        options.onBegun?.({ grant: begun.grant, credential: credential.said! });
      } catch {
        // A caller's notification must not break the issuance it reports.
      }
      const record = trackGroupIssuance(parts, hab, begun.grant, credential, registry.regk!);
      const waited = yield* waitForIssuance(ops, begun.grant, { timeoutMs });
      const base = { grant: begun.grant, credential: credential.said!, registry: registry.regk! };
      if (waited.outcome === "timed-out") return { ...base, outcome: "timed-out", timeoutMs, status: waited.status };
      if (waited.status.state === "done") {
        let recorded = false;
        try {
          record();
          recorded = true;
        } catch {
          // The wallet keeps trying on later changes; `recorded` tells the caller it is not in the inventory yet.
        }
        return { ...base, outcome: "issued", recorded };
      }
      const ended = waited.status as Extract<IssuanceStatus, { reason: string }>;
      return { ...base, outcome: "ended", state: ended.state, reason: ended.reason };
    });
  }

  /**
   * Present from a group: freeze the Grant body and propose it as a group message. The other members approve it
   * as a proposal; the elected lead delivers it once every contribution is in. Only `grant`-style selections are
   * supported (the library's group presentation).
   */
  async present(hab: Hab, input: GroupPresentInput, wait: TimeoutOptions = {}): Promise<GroupPresentOutcome> {
    const timeoutMs = wait.timeoutMs ?? WALLET_TIMEOUTS.present;
    const { runtime } = this.#scope.parts;
    const presenter = runtime.operations?.presentation, ipex = runtime.operations?.groupIpex;
    if (!presenter || !ipex) throw new ValidationError("This wallet's runtime has no group presentation owner.");
    return await this.#scope.go(function*(): Operation<GroupPresentOutcome> {
      const begun = yield* proposeGroupPresentation(presenter.deps, ipex, { hab, ...input });
      const waited = yield* waitForGroupIpex(ipex, begun.said, { timeoutMs });
      const { status } = waited;
      if (waited.outcome === "timed-out") return { outcome: "timed-out", said: begun.said, timeoutMs, status };
      if (status.state === "done") return { outcome: "accepted", said: begun.said, status };
      return { outcome: "ended", said: begun.said, status: status as EndedGroupIpex };
    });
  }

  /** Abandon a group IPEX operation this wallet began (local only; nothing is sent). */
  abandon(said: string, reason?: string): void {
    const ipex = this.#scope.parts.runtime.operations?.groupIpex;
    if (ipex) abandonGroupIpex(ipex, said, reason);
  }

  /**
   * A group's Unblind: as the disclosee it requests the missing proofs, as the discloser it answers. `proposer` is
   * the current signing member that authors the query (disclosee) or the reply (discloser); every member must
   * name the same one, and it defaults to the member the group's latest event elects.
   */
  async unblind(grant: string, hab: Hab, options: GroupUnblindOptions): Promise<UnblindOutcome> {
    const { states, timeoutMs = WALLET_TIMEOUTS.unblind, proposer } = options;
    const { runtime } = this.#scope.parts;
    const ops = runtime.operations?.unblinding;
    if (!ops) throw new ValidationError("This wallet's runtime has no Unblind owner.");
    const input = runtime.exc.retainedInput(grant)?.serder;
    const requester = input?.sad?.ri === hab.pre;
    if (!requester && input?.pre !== hab.pre) {
      throw new ValidationError("The group is neither party of that Grant.");
    }
    const issuance = runtime.operations?.issuance;
    if (!proposer && !issuance) throw new ValidationError("This wallet's runtime has no issuance owner.");
    const lead = proposer ?? groupIssuanceElection(issuance!, hab.pre!).custodian;
    return await this.#scope.go(function*() {
      const before = unblindingStatus(ops, grant);
      if (before.state !== "active" && before.state !== "done" && before.state !== "expired") {
        if (requester) requestUnblind(ops, grant, { states, proposer: lead });
        else answerUnblind(ops, grant, { states, proposer: lead });
      }
      const waited = yield* waitForUnblinding(ops, grant, { timeoutMs });
      const { status } = waited;
      if (waited.outcome === "timed-out") return { outcome: "timed-out" as const, grant, timeoutMs, status };
      if (status.state === "done") return { outcome: "unblinded" as const, grant, status };
      return { outcome: "ended" as const, grant, status: status as EndedUnblinding };
    });
  }
}

/** Result of the group form of `credentials.issue`. */
export type GroupIssueOutcome =
  & { grant: string; credential: string; registry: string }
  & (
    | { outcome: "issued"; recorded: boolean }
    | { outcome: "ended"; state: string; reason: string }
    | { outcome: "timed-out"; timeoutMs: number; status: IssuanceStatus }
  );
