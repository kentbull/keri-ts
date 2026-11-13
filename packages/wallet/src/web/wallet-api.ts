/**
 * The application surface of an open web wallet: identifiers, OOBIs, mailboxes and credentials as
 * promise-returning methods over the library workflows.
 *
 * The wallet owns the Effection bridge, so an app never calls `run(...)`; each method runs one workflow to
 * its result. The surface follows the workflow contract:
 * - a call may sign, and never waits on a remote without a timeout (`timeoutMs`, always with a default);
 * - what a remote or the clock decides comes back as a typed `outcome`, not an exception, and a result
 *   carries the status read at return, so the app does not make a second read to explain it;
 * - only caller-contract failures (an unknown identifier, an unresolved endpoint, a Grant that is not
 *   addressed to a local identifier) and infrastructure failures throw.
 *
 * The runtime keeps working after a call returns `timed-out`: the operation is still live, and the same call
 * made again resumes it where it stands.
 */
import { SerderACDC, type ThresholdSith, type Versionage } from "cesr-ts";
import { action, call, type Operation, race, run } from "effection";
import { loadNests } from "keri-ts/db";
import {
  acceptedRegistryEvidence,
  type AcdcMapOptions,
  addMailbox,
  admitIssuance,
  type AgentRuntime,
  agreeFor,
  AppError,
  approveIssuanceExchange,
  beginOobi,
  type ChangeSink,
  completeEvent,
  type CredentialImportResult,
  deliverIssuanceAdmit,
  type EventCompletion,
  type EventCompletionDeps,
  type EventStatus,
  eventStatus,
  type ExchangeAnswer,
  type Hab,
  type Habery,
  importCredentialStream,
  isLocalGroupHab,
  type IssuanceEndState,
  type IssuanceOperations,
  type IssuanceStatus,
  issuanceStatus,
  type KelPublicationStatus,
  listGroupDisclosures,
  type MailboxStatus,
  mailboxStatus,
  type OobiRecord,
  pendingApplies,
  type PendingApply,
  type PendingGrant,
  pendingIssuanceGrants,
  type PendingPresentation,
  pendingPresentations,
  pinSchemaBytes,
  present,
  type PresentationInput,
  type PresentationStatus,
  presentationStatus,
  proposeIssuance,
  rebuildIssuanceAdmit,
  Receiptor,
  receiveIssuance,
  removeMailbox,
  requestUnblind,
  requireMailboxEndpointUrl,
  type RetiredIdentifier,
  retireIdentifier,
  type RuntimeChange,
  type RuntimeClock,
  type UnblindingEndState,
  type UnblindingStatus,
  unblindingStatus,
  ValidationError,
  vetBlind,
  waitForIssuance,
  waitForOobi,
  waitForPresentation,
  waitForUnblinding,
} from "keri-ts/runtime";
export { type AdmitDelivery, type TrackedIssuances, WALLET_TIMEOUTS, WalletStoppedError } from "./surface.ts";
import { WalletAuthor } from "../authoring.ts";
import { RegistryCustody } from "../custody.ts";
import type { AdmittedCredential, IssuedCredential, WalletBaser } from "../storing.ts";
import type { Wallet } from "../wallet.ts";
import {
  GroupCredentials,
  type GroupIssueOutcome,
  type GroupPresentInput,
  type GroupPresentOutcome,
  type GroupReceiveOutcome,
  Groups,
  Proposals,
} from "./group-api.ts";
import {
  type AdmitDelivery,
  delivered,
  type TimeoutOptions,
  type TrackedIssuances,
  WALLET_TIMEOUTS,
  type WalletApiParts,
  WalletScope,
  within,
} from "./surface.ts";

/** Where the wallet's sink forwards: the host's sink, the runtime's Signaler sink, or nothing yet. */
export type ChangeSinkSource = () => ChangeSink | undefined;

/**
 * The sink the runtime's owners publish to. It forwards every change to `forward` (the host's sink, or the
 * runtime's Signaler) and reacts to the finish of an issuance this wallet is tracking by recording it in the
 * inventory, so a credential whose `issue` call timed out is still in the inventory once it completes. A
 * failing reaction is dropped here (a sink must not throw into a workflow); the next `issue` call for it
 * records again and reports the failure.
 */
export function walletChangeSink(tracked: TrackedIssuances, forward: ChangeSinkSource): ChangeSink {
  return {
    push(change: RuntimeChange) {
      forward()?.push(change);
      // A retained registry root copy may be what a member's recorder was waiting for: try them all.
      const grants = change.kind === "issuance" ? [change.id] : change.kind === "root" ? [...tracked.keys()] : [];
      for (const grant of grants) {
        try {
          if (tracked.get(grant)?.()) tracked.delete(grant);
        } catch {
          // Recorded by the issuing call or the next change; see above.
        }
      }
    },
  };
}

// --- identifiers -----------------------------------------------------------------------------------------

/** Inputs of {@link Identifiers.incept}. */
export interface InceptOptions {
  /** Local name; an alias already in use is refused. */
  alias: string;
  /** Witness AIDs. Their OOBIs must be resolved first, so their endpoints are known for receipting. */
  witnesses?: readonly string[];
  /** Witness threshold; required with witnesses, since no default is a safe guess. */
  toad?: number;
  /** Default true. */
  transferable?: boolean;
  /** Signing keys: count and threshold (defaults: one key, threshold one). */
  keys?: { count?: number; threshold?: ThresholdSith };
  /** Pre-rotated keys: count and threshold (defaults: as the signing keys). */
  next?: { count?: number; threshold?: ThresholdSith };
  estOnly?: boolean;
  data?: unknown[];
  /** Delegator AID, for a delegated inception. Needs `proxy`. */
  delegator?: string;
  /** Alias of a local identifier with accepted key state that carries the delegation request. */
  proxy?: string;
  /** Budget of the delegator's approval wait; the witness receipts have none of their own. Default 120 s. */
  timeoutMs?: number;
}

/** Inputs of {@link Identifiers.rotate}. */
export interface RotateOptions {
  /** Witnesses to remove and to add. */
  witnesses?: { cut?: readonly string[]; add?: readonly string[] };
  toad?: number;
  /** Threshold of the new signing keys, and count and threshold of the keys pre-rotated by this event. */
  keys?: { threshold?: ThresholdSith };
  next?: { count?: number; threshold?: ThresholdSith };
  data?: unknown[];
  version?: Versionage;
  /** Delegated identifiers only: the proxy alias, as for inception. */
  proxy?: string;
  /** Budget of the delegator's approval wait. Default 120 s. */
  timeoutMs?: number;
}

/**
 * An event after local acceptance. `complete` means every witness receipt is in (and, for a delegated event,
 * the delegator's anchor was learned). `incomplete` means the event is accepted locally but a receipt
 * failed or fell short: `reason` says why and `status` how many receipts are held; {@link Identifiers.complete}
 * retries. `timed-out` is a delegated event whose delegator did not approve within `timeoutMs`; the delegation
 * keeps running and `complete` resumes the wait.
 */
export type IdentifierEvent =
  & { hab: Hab; pre: string; sn: number; status: EventStatus; delegationPhase: EventCompletion["delegationPhase"] }
  & (
    | { outcome: "complete" }
    | { outcome: "incomplete"; reason: string }
    | { outcome: "timed-out"; timeoutMs: number }
  );

/** How a completion treats a delegated event. */
export interface EventFinish {
  /** Alias of the local identifier that carries the delegation request. */
  proxy?: string;
  /** Budget of the delegator's approval wait. Default 120 s. */
  timeoutMs?: number;
}

/** Inputs of {@link Identifiers.complete}. */
export interface CompleteOptions extends EventFinish {
  /** The event to complete; default the latest. */
  sn?: number;
}

/** Single-signature identifiers: inception and rotation, each through witness receipts and delegation. */
export class Identifiers {
  readonly #scope: WalletScope;

  constructor(scope: WalletScope) {
    this.#scope = scope;
  }

  /**
   * Create an identifier and complete its inception event.
   *
   * @throws ValidationError for a used alias, witnesses without `toad`, or a delegator without a usable `proxy`.
   */
  async incept(options: InceptOptions): Promise<IdentifierEvent> {
    const { hby } = this.#scope.parts;
    const { alias, witnesses = [], delegator, proxy } = options;
    if (witnesses.length && options.toad === undefined) {
      throw new ValidationError("Inception with witnesses needs an explicit toad.");
    }
    if (delegator && !proxy) throw new ValidationError("A delegated inception needs a proxy identifier.");
    if (proxy) this.proxy(proxy);
    return await this.#scope.go(() => {
      if (hby.habByName(alias)) throw new ValidationError(`Alias ${alias} already exists.`);
      const hab = hby.makeHab(alias, undefined, {
        transferable: options.transferable ?? true,
        wits: [...witnesses],
        toad: options.toad ?? 0,
        icount: options.keys?.count ?? 1,
        isith: options.keys?.threshold,
        ncount: options.next?.count ?? options.keys?.count ?? 1,
        nsith: options.next?.threshold,
        estOnly: options.estOnly,
        data: options.data ?? [],
        delpre: delegator,
      });
      return this.finish(hab, 0, options);
    });
  }

  /**
   * Rotate an identifier and complete the rotation event.
   *
   * @throws ValidationError for an unknown or group identifier.
   */
  async rotate(pre: string, options: RotateOptions = {}): Promise<IdentifierEvent> {
    const hab = this.#scope.individual(pre);
    if (options.proxy) this.proxy(options.proxy);
    return await this.#scope.go(() => {
      hab.rotate({
        isith: options.keys?.threshold,
        nsith: options.next?.threshold,
        ncount: options.next?.count,
        toad: options.toad,
        cuts: options.witnesses?.cut ? [...options.witnesses.cut] : undefined,
        adds: options.witnesses?.add ? [...options.witnesses.add] : undefined,
        data: options.data,
        version: options.version,
      });
      return this.finish(hab, hab.kever!.sn, options);
    });
  }

  /**
   * Complete an accepted event again: collect the witness receipts still missing and, for a delegated event,
   * wait again for the delegator. Use it after an `incomplete` or `timed-out` result. `sn` defaults to the
   * latest event.
   */
  async complete(pre: string, options: CompleteOptions = {}) {
    const { sn, proxy, timeoutMs } = options;
    const hab = this.#scope.individual(pre);
    if (proxy) this.proxy(proxy);
    return await this.#scope.go(() => this.finish(hab, sn ?? hab.kever!.sn, { proxy, timeoutMs }));
  }

  /** The proxy identifier: local, with accepted key state. */
  private proxy(alias: string): Hab {
    const hab = this.#scope.parts.hby.habByName(alias);
    if (!hab?.kever) throw new ValidationError(`Delegation proxy ${alias} is not a local identifier with key state.`);
    return hab;
  }

  /** Receipts, then delegation when the event is delegated, as one typed result. */
  private *finish(hab: Hab, sn: number, options: EventFinish) {
    const { proxy, timeoutMs } = options;
    const { hby, runtime, changes } = this.#scope.parts;
    const deps: EventCompletionDeps = {
      hby,
      protocol: runtime.protocol,
      http: runtime.http,
      clock: runtime.clock,
      changes,
      rotated: runtime.kelPublisher.rotated,
      *withDelegation(_hab, use) {
        return yield* use({ anchorer: runtime.delegating, changes });
      },
    };
    const base = { hab, pre: hab.pre, sn };
    const delegated = hab.kever?.delpre != null;
    try {
      const completion = yield* completeEvent(deps, hab, sn, {
        delegation: delegated
          ? {
            communicationHab: () => proxy ? this.proxy(proxy) : undefined,
            timeoutMs: timeoutMs ?? WALLET_TIMEOUTS.delegation,
          }
          : undefined,
      });
      const { status, delegationPhase } = completion;
      if (completion.outcome === "timed-out") {
        return { ...base, outcome: "timed-out", timeoutMs: completion.timeoutMs, status, delegationPhase } as const;
      }
      if (status.state === "complete") return { ...base, outcome: "complete", status, delegationPhase } as const;
      return {
        ...base,
        outcome: "incomplete",
        reason: "Not every witness receipt was collected.",
        status,
        delegationPhase,
      } as const;
    } catch (error) {
      // A witness that is unreachable or refuses is an outcome; the event itself is accepted and durable.
      if (!(error instanceof Error)) throw error;
      return {
        ...base,
        outcome: "incomplete",
        reason: error.message,
        status: eventStatus(hby, hab.pre, sn),
        delegationPhase: null,
      } as const;
    }
  }

  /** Pure read of an event's completion. */
  status(pre: string, sn: number): EventStatus {
    return eventStatus(this.#scope.parts.hby, pre, sn);
  }

  /**
   * Retire a single-signature identifier: it stops being local, its stored private keys are deleted and its held
   * signers released, and its mailbox polling stops. Its KEL and every accepted reply about it stay. One-way: the
   * name cannot be reused with the same salt and namespace. Creates no event and signs nothing.
   *
   * @throws ValidationError for an unknown or group identifier, or with the runtime's reason when it still needs
   * the identifier (a group member, a delegator, a registry issuer, or live work).
   */
  retire(pre: string): RetiredIdentifier {
    this.#scope.parts.assertRunning();
    this.#scope.individual(pre);
    return retireIdentifier(this.#scope.parts.runtime, pre);
  }
}

// --- OOBIs -----------------------------------------------------------------------------------------------

/** The stored record of a resolved OOBI. */
type ResolvedRecord = OobiRecord;

/** Result of {@link Oobis.resolve}. */
export type OobiOutcome =
  | { outcome: "resolved"; record: ResolvedRecord }
  | { outcome: "failed"; reason: string; record: ResolvedRecord }
  | { outcome: "timed-out"; timeoutMs: number };

/** Inputs of {@link Oobis.resolve}. */
export interface ResolveOobiOptions extends TimeoutOptions {
  /** Contact alias recorded when the OOBI resolves. */
  alias?: string;
}

/** Out-of-band introductions. */
export class Oobis {
  readonly #scope: WalletScope;

  constructor(scope: WalletScope) {
    this.#scope = scope;
  }

  /**
   * Queue `url` with the running Oobiery and wait for it to resolve. The learned key state, endpoints and
   * contact alias are then in the wallet's stores.
   */
  async resolve(url: string, options: ResolveOobiOptions = {}) {
    const { alias, timeoutMs = WALLET_TIMEOUTS.oobi } = options;
    const { hby, runtime, changes } = this.#scope.parts;
    return await this.#scope.go(function*(): Operation<OobiOutcome> {
      beginOobi({ oobiery: runtime.oobiery, changes }, url, { alias });
      const waited = yield* waitForOobi({ db: hby.db, changes }, url, { timeoutMs });
      const { status } = waited;
      if (waited.outcome === "timed-out" || status.state === "pending") return { outcome: "timed-out", timeoutMs };
      if (status.state === "resolved") return { outcome: "resolved", record: status.record };
      return { outcome: "failed", reason: status.reason, record: status.record };
    });
  }
}

// --- mailboxes -------------------------------------------------------------------------------------------

/**
 * Result of {@link Mailboxes.add} (`done` is `authorized`) and {@link Mailboxes.remove} (`revoked`): the accepted
 * end-role state, a refusal with its reason, or the budget.
 */
export type MailboxOutcome<Done extends "authorized" | "revoked" = "authorized"> =
  | { outcome: Done; status: MailboxStatus }
  | { outcome: "rejected"; reason: string; status: MailboxStatus }
  | { outcome: "timed-out"; timeoutMs: number; status: MailboxStatus };

/** Result of {@link Mailboxes.waitForPublication}: every mailbox of the identifier settled, or the budget expired. */
export interface PublicationWait {
  outcome: "settled" | "timed-out";
  entries: readonly KelPublicationStatus[];
}

/** Mailbox providers an identifier receives through. The runtime polls an authorized mailbox by itself. */
export class Mailboxes {
  readonly #scope: WalletScope;

  constructor(scope: WalletScope) {
    this.#scope = scope;
  }

  /**
   * Authorize `mailbox` for `pre`: sign the end role, post it to the provider and accept it locally.
   * Repeating it for an authorized mailbox posts the same reply again.
   *
   * @throws ValidationError when `pre` is not a local identifier or the mailbox's endpoint is unknown
   * (resolve its OOBI first).
   */
  async add(pre: string, mailbox: string, options: TimeoutOptions = {}): Promise<MailboxOutcome<"authorized">> {
    return await this.change(pre, mailbox, options.timeoutMs ?? WALLET_TIMEOUTS.mailbox, "authorized", addMailbox);
  }

  /**
   * Revoke `mailbox` for `pre`: sign an end-role cut, post it to the provider and accept it locally. The
   * runtime stops polling that mailbox for `pre`.
   *
   * @throws ValidationError as for {@link Mailboxes.add}.
   */
  async remove(pre: string, mailbox: string, options: TimeoutOptions = {}): Promise<MailboxOutcome<"revoked">> {
    return await this.change(pre, mailbox, options.timeoutMs ?? WALLET_TIMEOUTS.mailbox, "revoked", removeMailbox);
  }

  /** Pure read of the accepted end-role state. */
  status(pre: string, mailbox: string): MailboxStatus {
    return mailboxStatus(this.#scope.parts.hby, pre, mailbox);
  }

  private change<Done extends "authorized" | "revoked">(
    pre: string,
    mailbox: string,
    timeoutMs: number,
    done: Done,
    admin: typeof addMailbox,
  ): Promise<MailboxOutcome<Done>> {
    const { hby, runtime } = this.#scope.parts;
    const hab = this.#scope.individual(pre);
    requireMailboxEndpointUrl(hby, mailbox);
    return this.#scope.go(function*(): Operation<MailboxOutcome<Done>> {
      const deps = {
        hby,
        http: runtime.http,
        reactor: runtime.reactor,
        protocol: runtime.protocol,
        publisher: runtime.kelPublisher,
      };
      try {
        const result = yield* within(runtime.clock, timeoutMs, () => admin(deps, hab, mailbox));
        const status = mailboxStatus(hby, pre, mailbox);
        return result.done
          ? { outcome: done, status: result.value }
          : { outcome: "timed-out", timeoutMs, status };
      } catch (error) {
        // The provider refused, or its reply was not accepted into local state.
        if (!(error instanceof ValidationError)) throw error;
        return { outcome: "rejected", reason: error.message, status: mailboxStatus(hby, pre, mailbox) };
      }
    });
  }

  /**
   * Where each mailbox of `pre` stands in being told its KEL after a rotation, derived from state: `published`
   * (it holds the latest establishment event), `pending` (being sent or waiting out a retry delay), `waiting`
   * (gated: `unwitnessed`, `unanchored` or `no-url`) or `timed-out` (the runtime gave up after five minutes;
   * a new rotation, a successful poll of that mailbox or reopening the wallet tries again).
   */
  publication(pre: string): readonly KelPublicationStatus[] {
    return this.#scope.parts.runtime.kelPublisher.statusOf(pre);
  }

  /**
   * Wait until every mailbox of `pre` is `published` or `timed-out`, or `timeoutMs` passes (`timed-out` result).
   * Only observes: the runtime's publisher does the posting.
   */
  async waitForPublication(pre: string, options: TimeoutOptions = {}): Promise<PublicationWait> {
    const timeoutMs = options.timeoutMs ?? WALLET_TIMEOUTS.mailbox;
    const publisher = this.#scope.parts.runtime.kelPublisher;
    return await this.#scope.go(function*() {
      const waited = yield* publisher.waitForPublication(pre, { timeoutMs });
      return { outcome: waited.outcome, entries: waited.status.entries.filter((entry) => entry.pre === pre) };
    });
  }
}

// --- credentials -----------------------------------------------------------------------------------------

/** A terminal state of an issuance other than completion. */
export type EndedStatus = Extract<IssuanceStatus, { state: IssuanceEndState }>;

/** A terminal state of a presentation other than delivery. */
export type EndedPresentation = Extract<PresentationStatus, { state: UnblindingEndState }>;

/** Inputs of {@link Credentials.present}: a library presentation input with `pre` in place of the `hab`. */
export type PresentInput = PresentationInput extends infer Input
  ? Input extends { hab: Hab } ? Omit<Input, "hab"> & { pre: string } : never
  : never;

/**
 * Result of {@link Credentials.present}. `delivered`: the transport reached the recipient (`status.deliveries`),
 * which is not their acceptance. `ended`: delivery stopped (`status.reason`). `timed-out`: delivery is still
 * being attempted (`status.blocked` says the last transport failure).
 */
export type PresentOutcome =
  | { outcome: "delivered"; said: string; recipient: string; status: Extract<PresentationStatus, { state: "done" }> }
  | { outcome: "ended"; said: string; recipient: string; status: EndedPresentation }
  | { outcome: "timed-out"; said: string; recipient: string; timeoutMs: number; status: PresentationStatus };

/** A terminal state of an Unblind other than completion. */
export type EndedUnblinding = Extract<UnblindingStatus, { state: UnblindingEndState }>;

/**
 * Result of {@link Credentials.unblind}. `unblinded`: the registry proofs behind the Grant are current.
 * `ended`: the request stopped (`status.reason`). `timed-out`: the presenter has not answered; the request
 * keeps running.
 */
export type UnblindOutcome =
  | { outcome: "unblinded"; grant: string; status: Extract<UnblindingStatus, { state: "done" }> }
  | { outcome: "ended"; grant: string; status: EndedUnblinding }
  | { outcome: "timed-out"; grant: string; timeoutMs: number; status: UnblindingStatus };

/** The credential-state vocabulary an Unblind freezes when the caller names none. */
export const DEFAULT_UNBLIND_STATES: readonly string[] = Object.freeze(["issued", "revoked", ""]);

/**
 * Result of {@link Credentials.receive}. `admitted`: the credential is in the inventory (`held`) and the
 * Admit went to the issuer, or `delivery` says it did not. `ended`: the exchange stopped before an Admit
 * (`status.reason`). `timed-out`: the Grant, the issuer's key exchange or its registry update did not
 * arrive within `timeoutMs`; calling again resumes.
 */
export type ReceiveOutcome =
  | { outcome: "admitted"; grant: string; admit: string; held: AdmittedCredential; delivery: AdmitDelivery }
  | { outcome: "ended"; grant: string; status: EndedStatus }
  | { outcome: "timed-out"; grant: string; timeoutMs: number; status: IssuanceStatus };

/** Inputs of {@link Credentials.issue}. */
export interface IssueOptions {
  /** The issuing identifier. */
  pre: string;
  /**
   * Registry name, incepted on first use. A DH exchange derives the registry's root with the recipient and
   * the registry takes that exchange once, so a registry carries one credential: leave this out and the
   * wallet incepts a fresh registry for each issuance. A DH-issued registry has no custody root.
   */
  registry?: string;
  /** The credential: issuee, attributes, schema, edges and rules. */
  credential: Omit<AcdcMapOptions, "regid">;
  /** Recipient of the Grant; defaults to the credential's issuee. */
  recipient?: string;
  message?: string;
  artifacts?: readonly Uint8Array[];
  /**
   * Called once, after the issuing consent is given and before the wait, with the Grant's SAID: the caller
   * needs it while the exchange is still running (to tell the holder, or to show the pending issuance).
   */
  onBegun?: (begun: { grant: string; credential: string }) => void;
  /** Budget of the wait for the holder's consent and the finished exchange. Default 120 s. */
  timeoutMs?: number;
}

/**
 * Result of {@link Credentials.issue}. `issued`: the exchange finished and the credential is in the inventory
 * (`issued`). `ended`: it stopped (`state`, `reason`), possibly before a Grant existed. `timed-out`: the
 * registry inception or the holder did not finish within `timeoutMs`; with a `grant`, the issuance is still
 * live and the wallet records the credential when it finishes.
 */
export type IssueOutcome =
  | { outcome: "issued"; grant: string; credential: string; registry: string; issued: IssuedCredential }
  | { outcome: "ended"; state: IssuanceEndState; reason: string; grant?: string; credential?: string }
  | {
    outcome: "timed-out";
    stage: "registry" | "issuance";
    timeoutMs: number;
    grant?: string;
    credential?: string;
    status?: IssuanceStatus;
  };

/** The credentials held and issued, as the inventory records them. */
export interface CredentialList {
  issued: IssuedCredential[];
  held: AdmittedCredential[];
}

/** Choices of {@link Credentials.importStream}. */
export interface ImportStreamOptions {
  /** Budget, after the input is read, for escrowed events in it to settle; default the importer's 5 s. */
  timeoutMs?: number;
}

/** Inputs of {@link Credentials.receive}. */
export interface ReceiveOptions extends TimeoutOptions {
  /** Message carried by the Admit. */
  message?: string;
  /** Budget of the Admit's delivery. Default 30 s. */
  deliveryTimeoutMs?: number;
}

/** What {@link Credentials.receive} returns: the individual or the group result. */
export type ReceiveResult = ReceiveOutcome | GroupReceiveOutcome;

/** What {@link Credentials.issue} returns: the individual or the group result. */
export type IssueResult = IssueOutcome | GroupIssueOutcome;

/** What {@link Credentials.present} returns: the individual or the group result. */
export type PresentResult = PresentOutcome | GroupPresentOutcome;

/** How long {@link Credentials.present} waits for delivery; delivery itself retries until the exchange's deadline. */
export type PresentWaitOptions = TimeoutOptions;

/** The body options of an `apply` request. */
export type ApplyOptions = Extract<PresentInput, { verb: "apply" }>["options"];

/** Choices of {@link Credentials.applies}. */
export interface AppliesOptions {
  /** Also list the Applies an exchange has answered. */
  includeAnswered?: boolean;
}

/** Inputs of {@link Credentials.unblind}. */
export interface UnblindOptions extends TimeoutOptions {
  /** The credential-state vocabulary to freeze; default {@link DEFAULT_UNBLIND_STATES}. */
  states?: readonly string[];
  /** Group parties only: the signing member that authors the query or reply; default is the elected one. */
  proposer?: string;
}

/** Credentials this wallet holds and issues, over the runtime's IPEX issuance owner. */
export class Credentials {
  readonly #scope: WalletScope;
  readonly #groups: GroupCredentials;

  constructor(scope: WalletScope, groups: GroupCredentials) {
    this.#scope = scope;
    this.#groups = groups;
  }

  /** The Grants waiting for consent, newest state of the stores; a pure read. */
  pending(pre?: string): PendingGrant[] {
    const ops = this.owner();
    if (pre && isLocalGroupHab(this.#scope.parts.hby, this.#scope.hab(pre))) return this.#groups.pending(pre);
    return [
      ...pendingIssuanceGrants(ops, pre ? { hab: this.#scope.hab(pre) } : {}),
      ...(pre ? [] : this.#groups.pending()),
    ];
  }

  /** The credentials held and issued, as the inventory records them. */
  list(): CredentialList {
    return this.#scope.parts.wallet.inventory();
  }

  /**
   * Import a finite CESR stream of retained history into this wallet's stores: KELs, registry TELs, accepted
   * exchanges, such as a co-member's `exportDisclosureStream` or a `/registry/root` copy. Each message is processed
   * as retained history (`importCredentialStream`): signatures, anchors and route verification apply, KRAM's
   * freshness window does not, and nothing is answered or notified. The inventory is not touched; call
   * {@link Credentials.rebuild} after the streams are in. Importing the same stream again changes nothing.
   *
   * @returns What the importer accepted; `complete` false lists the SAIDs still unaccepted when the budget ran out.
   * @throws ValidationError when this wallet's runtime has no credential store.
   */
  async importStream(bytes: Uint8Array, options: ImportStreamOptions = {}): Promise<CredentialImportResult> {
    const { runtime } = this.#scope.parts;
    const vdr = runtime.vdr;
    if (!vdr) throw new ValidationError("This wallet's runtime has no credential store.");
    return await this.#scope.go(() =>
      importCredentialStream(runtime.protocol, vdr.reger, bytes, runtime.clock, options.timeoutMs)
    );
  }

  /**
   * Rebuild the inventory from what this wallet's stores accept, and return it, as after a refill from a co-member
   * ({@link Credentials.importStream}):
   * - held: every accepted Grant addressed to a local identifier, individual or group, whose accepted Admit answers
   *   it and that has no row yet (`Wallet.reconcileAdmissions`). The Admit is the consent; the row is checked against
   *   the history the pair was accepted under, so a credential revoked since is still listed as held.
   * - issued: every accepted Grant a local identifier sent of a credential it issued, once this wallet holds the
   *   registry root (a group's arrives as a `/registry/root` copy). The issuance opening is derived from the root and
   *   must open the update's own commitment. A bound issuance is not derived here.
   *
   * An explicit call that reads state and writes inventory rows; nothing runs it in the background, so call it again
   * after a later import or root copy. Idempotent: rows already there are kept, and a second call writes nothing.
   *
   * @returns The whole inventory after the rebuild, as {@link Credentials.list} reads it.
   */
  async rebuild(): Promise<CredentialList> {
    const { wallet } = this.#scope.parts;
    this.#scope.parts.assertRunning();
    await wallet.reconcileAdmissions();
    this.reconcileIssued();
    return wallet.inventory();
  }

  /** Record each accepted Grant a local identifier sent of a credential it issued, when the registry root is held. */
  private reconcileIssued(): void {
    const { hby, runtime, wallet, inventory } = this.#scope.parts;
    const store = runtime.acdc!.store;
    for (const [pre, hab] of hby.habs) {
      for (const { role, grant, credential, registry } of listGroupDisclosures(hby, runtime.exc, pre)) {
        if (role !== "issuer" || !registry || inventory.issued.get([credential])) continue;
        if (!hby.mgr.getRegistryRoot(pre, registry)) continue;
        const acdc = loadNests(hby.db, grant).map((node) => node.body)
          .find((body): body is SerderACDC => body instanceof SerderACDC && body.said === credential);
        const updates = acceptedRegistryEvidence(store, registry)?.updates ?? [];
        const custody = new RegistryCustody({ hby, hab, registry: store, db: inventory });
        // The accepted update whose commitment the root opens for this credential's issuance; updates start at 1.
        const index = updates.findIndex((update, at) =>
          update.ilk === "bup"
          && vetBlind(custody.derive(registry, at + 1, credential, "issued"), update.sad!.b as string)
        );
        if (!acdc || index < 0) continue;
        try {
          const update = updates[index];
          wallet.recordIssued(acdc, update.said!, { blinder: custody.issuedOpening(update, credential) });
        } catch (error) {
          // Evidence that does not prove the issuance stays out of the inventory; the next call tries again.
          if (!(error instanceof ValidationError)) throw error;
        }
      }
    }
  }

  /**
   * Consent to one Grant addressed to a local identifier and take the credential: approve the key exchange,
   * wait for the issuer to finish it, admit, record the admission in the inventory, then deliver the Admit.
   * Calling it again for a Grant that timed out resumes at the step it reached.
   *
   * @throws ValidationError when `grant` is not a Grant addressed to a local identifier, or was issued here.
   */
  async receive(grant: string, options: ReceiveOptions = {}): Promise<ReceiveResult> {
    const { timeoutMs = WALLET_TIMEOUTS.receive, message = "", deliveryTimeoutMs = WALLET_TIMEOUTS.delivery } = options;
    const { hby, wallet } = this.#scope.parts;
    const ops = this.owner();
    const hab = this.holder(grant);
    if (isLocalGroupHab(hby, hab)) {
      return await this.#groups.receive(grant, hab, { timeoutMs, message });
    }
    return await this.#scope.go(function*(): Operation<ReceiveOutcome> {
      let held: AdmittedCredential | undefined;
      const received = yield* receiveIssuance(ops, {
        grant,
        message,
        timeoutMs,
        deliveryTimeoutMs,
        // The inventory record precedes delivery: whatever happens to the network, consent is on record.
        *onAdmitted(admitted) {
          held = yield* call(() => wallet.recordAdmission(grant, admitted.admit.said!, { consent: true }));
        },
      });
      if (received.outcome !== "admitted") return received;
      // An earlier call admitted the Grant: the inventory holds it, or records it now.
      held ??= wallet.db.admitted.get([grant])
        ?? (yield* call(() => wallet.recordAdmission(grant, received.admit, { consent: true })));
      return { outcome: "admitted", grant, admit: received.admit, held, delivery: received.delivery };
    });
  }

  /**
   * Issue a credential to a recipient: incept the registry if it does not exist, create the credential, give
   * the one issuing consent, wait for the holder and the registry update, and record the issuance.
   *
   * @throws ValidationError for an unknown or group identifier, or a credential the registry refuses.
   */
  async issue(options: IssueOptions): Promise<IssueResult> {
    const { hby, runtime, wallet, inventory } = this.#scope.parts;
    const { pre, registry: name = `credential-${crypto.randomUUID()}`, timeoutMs = WALLET_TIMEOUTS.issue } = options;
    if (isLocalGroupHab(hby, this.#scope.hab(pre))) {
      if (!options.registry) {
        throw new ValidationError("A group issues into a named registry; incept it with groups.inceptRegistry.");
      }
      return await this.#groups.issue(this.#scope.hab(pre), { ...options, registry: options.registry });
    }
    const hab = this.#scope.individual(pre), ops = this.owner();
    const recipient = options.recipient ?? options.credential.issuee;
    if (!recipient) throw new ValidationError("A recipient or an issuee is required.");
    const { tracked } = this.#scope.parts;
    return await this.#scope.go(function*(): Operation<IssueOutcome> {
      const regery = runtime.acdc!;
      const author = new WalletAuthor(
        wallet,
        regery,
        new Receiptor(hby, runtime.protocol, runtime.http, runtime.clock),
      );
      let registry: string;
      try {
        const inception = yield* within(runtime.clock, WALLET_TIMEOUTS.registry, () => author.incept(name, pre));
        if (!inception.done) return { outcome: "timed-out", stage: "registry", timeoutMs: WALLET_TIMEOUTS.registry };
        registry = inception.value.said!;
      } catch (error) {
        if (!(error instanceof Error) || error instanceof ValidationError) throw error;
        return { outcome: "ended", state: "failed", reason: `Registry inception failed: ${error.message}` };
      }
      const credential: SerderACDC = author.create(author.registry(name, pre), options.credential);
      const begun = yield* proposeIssuance(ops, {
        credential,
        options: { recipient, message: options.message ?? "", artifacts: [...(options.artifacts ?? [])] },
      });
      const { grant } = begun;
      try {
        options.onBegun?.({ grant, credential: credential.said! });
      } catch {
        // A caller's notification must not break the issuance it reports.
      }
      // The credential's derivation opening is read from the registry head the finished exchange leaves. The
      // registry took one DH exchange, so that head is this credential's update.
      const record = (): IssuedCredential => {
        const known = inventory.issued.get([credential.said!]);
        if (known) return known;
        const head = regery.store.headEvent(registry)!;
        const custody = new RegistryCustody({ hby, hab, registry: regery.store, db: inventory });
        return wallet.recordIssued(credential, head.said!, { blinder: custody.derivedOpening(head) });
      };
      tracked.set(grant, () => {
        const status = issuanceStatus(ops, grant);
        if (status.state === "active") return false;
        if (status.state === "done") record();
        return true;
      });
      const waited = yield* waitForIssuance(ops, grant, { timeoutMs });
      const { status } = waited;
      if (waited.outcome === "timed-out") {
        return { outcome: "timed-out", stage: "issuance", timeoutMs, grant, credential: credential.said!, status };
      }
      tracked.delete(grant);
      if (status.state !== "done") {
        const ended = status as EndedStatus;
        return { outcome: "ended", state: ended.state, reason: ended.reason, grant, credential: credential.said! };
      }
      return { outcome: "issued", grant, credential: credential.said!, registry, issued: record() };
    });
  }

  /**
   * Deliver the Admit of a Grant this wallet admitted again, after `receive` reported it `undelivered` or the
   * page restarted. Rebuilds the stored Admit's bytes and signs nothing. An issuer that already took the first
   * Admit may drop the repeat as a replay; the result then still reads `delivered`, since the transport reached it.
   *
   * @throws ValidationError when this wallet signed no Admit for `grant`.
   */
  async resendAdmit(grant: string, options: TimeoutOptions = {}): Promise<AdmitDelivery> {
    const timeoutMs = options.timeoutMs ?? WALLET_TIMEOUTS.delivery;
    const { hby, runtime } = this.#scope.parts;
    const ops = this.owner();
    const admit = hby.db.erpy.get([grant])?.qb64;
    if (!admit) throw new ValidationError("This wallet has not admitted that Grant.");
    return await this.#scope.go(function*(): Operation<AdmitDelivery> {
      const rebuilt = yield* rebuildIssuanceAdmit(ops.deps, admit);
      return yield* delivered(runtime.clock, timeoutMs, () => deliverIssuanceAdmit(ops.deps.delivery, rebuilt));
    });
  }

  /**
   * Present a credential: sign the message (`offer`, `grant`, `apply`, or `agree`/`spurn` answering one),
   * queue it for delivery and wait until the transport reports. `delivered` means the transport reached the
   * recipient, not that the recipient accepted it; read the peer's answer from `status.response` later with
   * {@link Credentials.presentationStatus}. Selecting a credential (`selection`) reads the wallet's inventory.
   *
   * @throws ValidationError for an unknown or group identifier or a selection the discloser refuses.
   */
  async present(input: PresentInput, options: PresentWaitOptions = {}): Promise<PresentResult> {
    const { timeoutMs = WALLET_TIMEOUTS.present } = options;
    const { pre, ...rest } = input;
    if (isLocalGroupHab(this.#scope.parts.hby, this.#scope.hab(pre))) {
      return await this.#groups.present(this.#scope.hab(pre), rest as GroupPresentInput, { timeoutMs });
    }
    const hab = this.#scope.individual(pre), ops = this.presenter();
    return await this.#scope.go(function*(): Operation<PresentOutcome> {
      const begun = yield* present(ops, { ...rest, hab } as PresentationInput);
      const { said, recipient } = begun;
      const waited = yield* waitForPresentation(ops, said, { timeoutMs });
      const { status } = waited;
      if (waited.outcome === "timed-out") return { outcome: "timed-out", said, recipient, timeoutMs, status };
      if (status.state === "done") return { outcome: "delivered", said, recipient, status };
      return { outcome: "ended", said, recipient, status: status as EndedPresentation };
    });
  }

  /**
   * Ask a holder for a presentation (the verifier's `apply`). A thin form of {@link Credentials.present}.
   * The holder's answer arrives as an exchange the runtime stores.
   */
  requestProof(pre: string, options: ApplyOptions, wait?: PresentWaitOptions): Promise<PresentOutcome> {
    return this.present({ verb: "apply", pre, options }, wait) as Promise<PresentOutcome>;
  }

  /** Pure read of a presentation this wallet sent. */
  presentationStatus(said: string): PresentationStatus {
    return presentationStatus(this.presenter(), said);
  }

  /**
   * The presentation Grants this wallet received and holds pending until it fetches their registry proofs
   * ({@link Credentials.unblind}); a pure read. Grants waiting for the issuance consent
   * ({@link Credentials.pending}) are not listed.
   */
  presentations(pre?: string): PendingPresentation[] {
    const issuance = new Set(this.pending(pre).map((pending) => pending.grant));
    return pendingPresentations(this.unblinder(), pre ? { hab: this.#scope.hab(pre) } : {}).filter((item) =>
      !issuance.has(item.grant)
    );
  }

  /**
   * The Applies addressed to this wallet (to `pre` when given) that nothing has answered: accepted, inside their
   * deadline, and without an `erpy` answer pointer. With `includeAnswered` the answered ones are listed too; each
   * entry's `state` says which, and `answer` names the exchange that answered it. A pure read; answer a pending one
   * with `present` and its `priorSaid`.
   */
  applies(pre?: string, options: AppliesOptions = {}): PendingApply[] {
    const { hby, runtime } = this.#scope.parts;
    return pendingApplies({ hby, exc: runtime.exc, clock: runtime.clock }, {
      ...(pre ? { hab: this.#scope.hab(pre) } : {}),
      includeAnswered: options.includeAnswered,
    });
  }

  /**
   * The Agree that answers the Offer `offer` this wallet sent, or null while nothing, or something other than an
   * Agree (a Spurn), has answered it. A pure read of the stores.
   */
  agreeFor(offer: string): ExchangeAnswer | null {
    const { hby, runtime } = this.#scope.parts;
    return agreeFor({ hby, exc: runtime.exc }, offer);
  }

  /**
   * Keep the schema bytes this wallet was handed in its schema table and return their SAID, so credentials of that
   * schema validate. Nothing is fetched or issued; the bytes are the schema's exact document.
   *
   * @throws ValidationError when the bytes are not a schema document.
   */
  pinSchema(raw: Uint8Array): string {
    return pinSchemaBytes(this.#scope.parts.hby, raw);
  }

  /**
   * Consent to fetch the missing registry proofs for a presentation Grant addressed to this wallet and wait
   * for them. Calling it again for a Grant that timed out waits on the running request. It authorizes
   * nothing else: admitting a presented credential is a separate consent.
   *
   * @throws ValidationError when `grant` is not a Grant addressed to a local identifier.
   */
  async unblind(grant: string, options: UnblindOptions = {}): Promise<UnblindOutcome> {
    const { states = DEFAULT_UNBLIND_STATES, timeoutMs = WALLET_TIMEOUTS.unblind, proposer } = options;
    const { runtime } = this.#scope.parts;
    const ops = this.unblinder();
    const serder = runtime.exc.retainedInput(grant)?.serder;
    const holder = serder?.sad?.ri;
    const hab = typeof holder === "string" ? this.#scope.parts.hby.habs.get(holder) : undefined;
    const sender = typeof serder?.pre === "string" ? this.#scope.parts.hby.habs.get(serder.pre) : undefined;
    const groupHab = [hab, sender].find((candidate) => candidate && isLocalGroupHab(this.#scope.parts.hby, candidate));
    if (groupHab) {
      return await this.#groups.unblind(grant, groupHab, { states, timeoutMs, proposer });
    }
    if (!hab) throw new ValidationError("The Grant is not addressed to a local identifier of this wallet.");
    return await this.#scope.go(function*(): Operation<UnblindOutcome> {
      const before = unblindingStatus(ops, grant, { role: "requester" });
      if (before.state !== "active" && before.state !== "done" && before.state !== "expired") {
        requestUnblind(ops, grant, { states });
      }
      const waited = yield* waitForUnblinding(ops, grant, { timeoutMs, role: "requester" });
      const { status } = waited;
      if (waited.outcome === "timed-out") return { outcome: "timed-out", grant, timeoutMs, status };
      if (status.state === "done") return { outcome: "unblinded", grant, status };
      return { outcome: "ended", grant, status: status as EndedUnblinding };
    });
  }

  private presenter() {
    const ops = this.#scope.parts.runtime.operations?.presentation;
    if (!ops) throw new ValidationError("This wallet's runtime has no presentation owner.");
    return ops;
  }

  private unblinder() {
    const ops = this.#scope.parts.runtime.operations?.unblinding;
    if (!ops) throw new ValidationError("This wallet's runtime has no Unblind owner.");
    return ops;
  }

  /** The runtime's issuance owner. */
  private owner(): IssuanceOperations {
    const ops = this.#scope.parts.runtime.operations?.issuance;
    if (!ops) throw new ValidationError("This wallet's runtime has no issuance owner.");
    return ops;
  }

  /** The local identifier a Grant is addressed to. */
  private holder(grant: string): Hab {
    const { db } = this.#scope.parts.hby;
    const serder = db.exns.get([grant]) ?? db.epse.get([grant]);
    const holder = serder?.route === "/ipex/grant" ? serder.sad?.ri : undefined;
    const hab = typeof holder === "string" ? this.#scope.parts.hby.habs.get(holder) : undefined;
    if (!hab) throw new ValidationError("The Grant is not addressed to a local identifier of this wallet.");
    return hab;
  }
}

/** The wallet-level API: what an app calls instead of the library workflows. */
export interface WalletApi {
  readonly identifiers: Identifiers;
  readonly oobis: Oobis;
  readonly mailboxes: Mailboxes;
  readonly credentials: Credentials;
  readonly groups: Groups;
  readonly proposals: Proposals;
}

/** Build the four namespaces over one wallet's parts. */
export function createWalletApi(parts: WalletApiParts): WalletApi {
  const scope = new WalletScope(parts), groups = new GroupCredentials(scope);
  return {
    identifiers: new Identifiers(scope),
    oobis: new Oobis(scope),
    mailboxes: new Mailboxes(scope),
    credentials: new Credentials(scope, groups),
    groups: new Groups(scope),
    proposals: new Proposals(scope),
  };
}
