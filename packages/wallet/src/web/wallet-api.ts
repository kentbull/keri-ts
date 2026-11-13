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
import type { SerderACDC, ThresholdSith, Versionage } from "cesr-ts";
import { action, call, type Operation, race, run } from "effection";
import {
  type AcdcMapOptions,
  addMailbox,
  admitIssuance,
  type AgentRuntime,
  AppError,
  approveIssuanceExchange,
  beginIssuance,
  beginOobi,
  type ChangeSink,
  completeEvent,
  deliverIssuanceAdmit,
  type EventCompletion,
  type EventCompletionDeps,
  type EventStatus,
  eventStatus,
  type Hab,
  type Habery,
  isLocalGroupHab,
  type IssuanceEndState,
  type IssuanceOperations,
  type IssuanceStatus,
  issuanceStatus,
  type MailboxStatus,
  mailboxStatus,
  type OobiRecord,
  type PendingGrant,
  pendingIssuanceGrants,
  type PendingPresentation,
  pendingPresentations,
  present,
  type PresentationInput,
  type PresentationStatus,
  presentationStatus,
  rebuildIssuanceAdmit,
  Receiptor,
  removeMailbox,
  requestUnblind,
  requireMailboxEndpointUrl,
  type RuntimeClock,
  type UnblindingEndState,
  type UnblindingStatus,
  unblindingStatus,
  ValidationError,
  waitForIssuance,
  waitForOobi,
  waitForPresentation,
  waitForUnblinding,
  type WorkflowChange,
} from "keri-ts/runtime";
import { WalletAuthor } from "../authoring.ts";
import { RegistryCustody } from "../custody.ts";
import type { AdmittedCredential, IssuedCredential, WalletBaser } from "../storing.ts";
import type { Wallet } from "../wallet.ts";

/** Thrown by a call made on a wallet that was closed, or whose runtime stopped. */
export class WalletStoppedError extends AppError {}

/** Default wall-clock budgets, in milliseconds, of the calls that wait. */
export const WALLET_TIMEOUTS = Object.freeze({
  oobi: 30_000,
  mailbox: 15_000,
  delegation: 120_000,
  registry: 60_000,
  receive: 90_000,
  issue: 120_000,
  delivery: 30_000,
  present: 30_000,
  unblind: 60_000,
});

/** What the surface reads and drives; built by `openWebWallet`. */
export interface WalletApiParts {
  readonly hby: Habery;
  readonly runtime: AgentRuntime;
  readonly wallet: Wallet;
  readonly inventory: WalletBaser;
  /** The sink the runtime's owners publish to; the surface publishes event and OOBI changes to it too. */
  readonly changes: ChangeSink;
  /** Issuances this wallet will record when they finish, by Grant SAID; see {@link walletChangeSink}. */
  readonly tracked: TrackedIssuances;
  /** Throws {@link WalletStoppedError} unless the wallet is open and its runtime is running. */
  assertRunning(): void;
}

/** Recorders of issuances in flight: a recorder returns true once the issuance is over and recorded. */
export type TrackedIssuances = Map<string, () => boolean>;

/**
 * The sink the runtime's owners publish to. It forwards every change to `forward` (the host's sink, or the
 * runtime's Signaler) and reacts to the finish of an issuance this wallet is tracking by recording it in the
 * inventory, so a credential whose `issue` call timed out is still in the inventory once it completes. A
 * failing reaction is dropped here (a sink must not throw into a workflow); the next `issue` call for it
 * records again and reports the failure.
 */
export function walletChangeSink(tracked: TrackedIssuances, forward: () => ChangeSink | undefined): ChangeSink {
  return {
    push(change: WorkflowChange) {
      forward()?.push(change);
      if (change.kind !== "issuance") return;
      try {
        if (tracked.get(change.id)?.()) tracked.delete(change.id);
      } catch {
        // Recorded by the issuing call or the next one; see above.
      }
    },
  };
}

/** The result of racing `op` against `ms` on the host clock; the loser is cancelled. */
function* within<T>(clock: RuntimeClock, ms: number, op: () => Operation<T>): Operation<
  { done: true; value: T } | { done: false }
> {
  const timer = function*() {
    yield* action<void>((resolve) => {
      const handle = clock.setTimeout(resolve, ms);
      return () => clock.clearTimeout(handle);
    });
    return { done: false as const };
  };
  const work = function*() {
    return { done: true as const, value: yield* op() };
  };
  return yield* race([work(), timer()]);
}

/** Run a delivery within `ms`; a failure or an expired budget reads `undelivered` with its reason. */
function* delivered(clock: RuntimeClock, ms: number, send: () => Operation<string[]>): Operation<AdmitDelivery> {
  try {
    const sent = yield* within(clock, ms, send);
    return sent.done
      ? { state: "delivered", to: sent.value }
      : { state: "undelivered", reason: `Delivery did not finish within ${ms} ms.` };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { state: "undelivered", reason: error.message };
  }
}

/** Shared by the four namespaces: the parts, and the one place an app's promise meets the runtime's scope. */
abstract class Surface {
  constructor(protected readonly parts: WalletApiParts) {}

  /** Run one workflow to its result in its own Effection root. */
  protected go<T>(op: () => Operation<T>): Promise<T> {
    this.parts.assertRunning();
    return run(op);
  }

  /** The local single-signature identifier `pre`, or a caller-contract failure. */
  protected hab(pre: string): Hab {
    const hab = this.parts.hby.habs.get(pre);
    if (!hab) throw new ValidationError(`${pre} is not a local identifier of this wallet.`);
    return hab;
  }

  protected individual(pre: string): Hab {
    const hab = this.hab(pre);
    if (isLocalGroupHab(this.parts.hby, hab)) {
      throw new ValidationError("Group identifiers are not covered by this call.");
    }
    return hab;
  }
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

/** Single-signature identifiers: inception and rotation, each through witness receipts and delegation. */
export class Identifiers extends Surface {
  /**
   * Create an identifier and complete its inception event.
   *
   * @throws ValidationError for a used alias, witnesses without `toad`, or a delegator without a usable `proxy`.
   */
  async incept(options: InceptOptions): Promise<IdentifierEvent> {
    const { hby } = this.parts;
    const { alias, witnesses = [], delegator, proxy } = options;
    if (witnesses.length && options.toad === undefined) {
      throw new ValidationError("Inception with witnesses needs an explicit toad.");
    }
    if (delegator && !proxy) throw new ValidationError("A delegated inception needs a proxy identifier.");
    if (proxy) this.proxy(proxy);
    return await this.go(() => {
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
    const hab = this.individual(pre);
    if (options.proxy) this.proxy(options.proxy);
    return await this.go(() => {
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
  async complete(pre: string, { sn, proxy, timeoutMs }: { sn?: number; proxy?: string; timeoutMs?: number } = {}) {
    const hab = this.individual(pre);
    if (proxy) this.proxy(proxy);
    return await this.go(() => this.finish(hab, sn ?? hab.kever!.sn, { proxy, timeoutMs }));
  }

  /** The proxy identifier: local, with accepted key state. */
  private proxy(alias: string): Hab {
    const hab = this.parts.hby.habByName(alias);
    if (!hab?.kever) throw new ValidationError(`Delegation proxy ${alias} is not a local identifier with key state.`);
    return hab;
  }

  /** Receipts, then delegation when the event is delegated, as one typed result. */
  private *finish(hab: Hab, sn: number, { proxy, timeoutMs }: { proxy?: string; timeoutMs?: number }) {
    const { hby, runtime, changes } = this.parts;
    const deps: EventCompletionDeps = {
      hby,
      protocol: runtime.protocol,
      http: runtime.http,
      clock: runtime.clock,
      changes,
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
    return eventStatus(this.parts.hby, pre, sn);
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

/** Out-of-band introductions. */
export class Oobis extends Surface {
  /**
   * Queue `url` with the running Oobiery and wait for it to resolve. The learned key state, endpoints and
   * contact alias are then in the wallet's stores.
   */
  async resolve(url: string, { alias, timeoutMs = WALLET_TIMEOUTS.oobi }: { alias?: string; timeoutMs?: number } = {}) {
    const { hby, runtime, changes } = this.parts;
    return await this.go(function*(): Operation<OobiOutcome> {
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

/** Mailbox providers an identifier receives through. The runtime polls an authorized mailbox by itself. */
export class Mailboxes extends Surface {
  /**
   * Authorize `mailbox` for `pre`: sign the end role, post it to the provider and accept it locally.
   * Repeating it for an authorized mailbox posts the same reply again.
   *
   * @throws ValidationError when `pre` is not a local identifier or the mailbox's endpoint is unknown
   * (resolve its OOBI first).
   */
  async add(
    pre: string,
    mailbox: string,
    { timeoutMs = WALLET_TIMEOUTS.mailbox }: { timeoutMs?: number } = {},
  ): Promise<MailboxOutcome<"authorized">> {
    return await this.change(pre, mailbox, timeoutMs, "authorized", addMailbox);
  }

  /**
   * Revoke `mailbox` for `pre`: sign an end-role cut, post it to the provider and accept it locally. The
   * runtime stops polling that mailbox for `pre`.
   *
   * @throws ValidationError as for {@link Mailboxes.add}.
   */
  async remove(
    pre: string,
    mailbox: string,
    { timeoutMs = WALLET_TIMEOUTS.mailbox }: { timeoutMs?: number } = {},
  ): Promise<MailboxOutcome<"revoked">> {
    return await this.change(pre, mailbox, timeoutMs, "revoked", removeMailbox);
  }

  /** Pure read of the accepted end-role state. */
  status(pre: string, mailbox: string): MailboxStatus {
    return mailboxStatus(this.parts.hby, pre, mailbox);
  }

  private change<Done extends "authorized" | "revoked">(
    pre: string,
    mailbox: string,
    timeoutMs: number,
    done: Done,
    admin: typeof addMailbox,
  ): Promise<MailboxOutcome<Done>> {
    const { hby, runtime } = this.parts;
    const hab = this.individual(pre);
    requireMailboxEndpointUrl(hby, mailbox);
    return this.go(function*(): Operation<MailboxOutcome<Done>> {
      const deps = { hby, http: runtime.http, reactor: runtime.reactor, protocol: runtime.protocol };
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
}

// --- credentials -----------------------------------------------------------------------------------------

/** A terminal state of an issuance other than completion. */
export type EndedStatus = Extract<IssuanceStatus, { state: IssuanceEndState }>;

/** Whether the Admit reached the issuer. The Admit is accepted and recorded locally either way. */
export type AdmitDelivery = { state: "delivered"; to: string[] } | { state: "undelivered"; reason: string };

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

/** Credentials this wallet holds and issues, over the runtime's IPEX issuance owner. */
export class Credentials extends Surface {
  /** The Grants waiting for consent, newest state of the stores; a pure read. */
  pending(pre?: string): PendingGrant[] {
    const ops = this.owner();
    return pendingIssuanceGrants(ops, pre ? { hab: this.hab(pre) } : {});
  }

  /** The credentials held and issued, as the inventory records them. */
  list(): { issued: IssuedCredential[]; held: AdmittedCredential[] } {
    return this.parts.wallet.inventory();
  }

  /**
   * Consent to one Grant addressed to a local identifier and take the credential: approve the key exchange,
   * wait for the issuer to finish it, admit, record the admission in the inventory, then deliver the Admit.
   * Calling it again for a Grant that timed out resumes at the step it reached.
   *
   * @throws ValidationError when `grant` is not a Grant addressed to a local identifier, or was issued here.
   */
  async receive(
    grant: string,
    { timeoutMs = WALLET_TIMEOUTS.receive, message = "", deliveryTimeoutMs = WALLET_TIMEOUTS.delivery }: {
      timeoutMs?: number;
      message?: string;
      deliveryTimeoutMs?: number;
    } = {},
  ): Promise<ReceiveOutcome> {
    const { hby, wallet, runtime } = this.parts;
    const ops = this.owner();
    const hab = this.holder(grant);
    return await this.go(function*(): Operation<ReceiveOutcome> {
      let status = issuanceStatus(ops, grant);
      if (status.role === "issuer") throw new ValidationError("This Grant was issued by this wallet.");
      if (status.state === "active" && status.needs === "exchange") approveIssuanceExchange(ops, { hab, grant });
      const waited = yield* waitForIssuance(ops, grant, {
        timeoutMs,
        until: (s) => s.state !== "active" || s.needs === "admit",
      });
      status = waited.status;
      if (waited.outcome === "timed-out") return { outcome: "timed-out", grant, timeoutMs, status };
      if (status.state !== "active" && status.state !== "done") return { outcome: "ended", grant, status };
      if (status.state === "done") {
        // Admitted by an earlier call; the inventory holds it.
        const held = wallet.db.admitted.get([grant]);
        const admit = hby.db.erpy.get([grant])!.qb64;
        const record = held ?? (yield* call(() => wallet.recordAdmission(grant, admit, { consent: true })));
        return {
          outcome: "admitted",
          grant,
          admit,
          held: record,
          delivery: {
            state: "undelivered",
            reason: "Admitted by an earlier call; use resendAdmit to deliver it again.",
          },
        };
      }
      const admitted = yield* admitIssuance(ops.deps, { hab, grant, message });
      // The inventory record precedes delivery: whatever happens to the network, consent is on record.
      const held = yield* call(() => wallet.recordAdmission(grant, admitted.admit.said!, { consent: true }));
      const delivery = yield* delivered(
        runtime.clock,
        deliveryTimeoutMs,
        () => deliverIssuanceAdmit(ops.deps, hab, admitted),
      );
      return { outcome: "admitted", grant, admit: admitted.admit.said!, held, delivery };
    });
  }

  /**
   * Issue a credential to a recipient: incept the registry if it does not exist, create the credential, give
   * the one issuing consent, wait for the holder and the registry update, and record the issuance.
   *
   * @throws ValidationError for an unknown or group identifier, or a credential the registry refuses.
   */
  async issue(options: IssueOptions): Promise<IssueOutcome> {
    const { hby, runtime, wallet, inventory } = this.parts;
    const { pre, registry: name = `credential-${crypto.randomUUID()}`, timeoutMs = WALLET_TIMEOUTS.issue } = options;
    const hab = this.individual(pre), ops = this.owner();
    const recipient = options.recipient ?? options.credential.issuee;
    if (!recipient) throw new ValidationError("A recipient or an issuee is required.");
    const { tracked } = this.parts;
    return await this.go(function*(): Operation<IssueOutcome> {
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
      const begun = yield* beginIssuance(ops, {
        hab,
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
  async resendAdmit(
    grant: string,
    { timeoutMs = WALLET_TIMEOUTS.delivery }: { timeoutMs?: number } = {},
  ): Promise<AdmitDelivery> {
    const { hby, runtime } = this.parts;
    const ops = this.owner();
    const admit = hby.db.erpy.get([grant])?.qb64;
    if (!admit) throw new ValidationError("This wallet has not admitted that Grant.");
    return await this.go(function*(): Operation<AdmitDelivery> {
      const rebuilt = yield* rebuildIssuanceAdmit(ops.deps, admit);
      const hab = hby.habs.get(rebuilt.admit.pre!)!;
      return yield* delivered(runtime.clock, timeoutMs, () => deliverIssuanceAdmit(ops.deps, hab, rebuilt));
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
  async present(
    input: PresentInput,
    { timeoutMs = WALLET_TIMEOUTS.present, maxAttempts }: { timeoutMs?: number; maxAttempts?: number } = {},
  ): Promise<PresentOutcome> {
    const { pre, ...rest } = input;
    const hab = this.individual(pre), ops = this.presenter();
    return await this.go(function*(): Operation<PresentOutcome> {
      const begun = yield* present(ops, { ...rest, hab } as PresentationInput, { maxAttempts });
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
  requestProof(
    pre: string,
    options: Extract<PresentInput, { verb: "apply" }>["options"],
    wait?: { timeoutMs?: number; maxAttempts?: number },
  ): Promise<PresentOutcome> {
    return this.present({ verb: "apply", pre, options }, wait);
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
    return pendingPresentations(this.unblinder(), pre ? { hab: this.hab(pre) } : {}).filter((item) =>
      !issuance.has(item.grant)
    );
  }

  /**
   * Consent to fetch the missing registry proofs for a presentation Grant addressed to this wallet and wait
   * for them. Calling it again for a Grant that timed out waits on the running request. It authorizes
   * nothing else: admitting a presented credential is a separate consent.
   *
   * @throws ValidationError when `grant` is not a Grant addressed to a local identifier.
   */
  async unblind(
    grant: string,
    { states = DEFAULT_UNBLIND_STATES, timeoutMs = WALLET_TIMEOUTS.unblind }: {
      states?: readonly string[];
      timeoutMs?: number;
    } = {},
  ): Promise<UnblindOutcome> {
    const { runtime } = this.parts;
    const ops = this.unblinder();
    const holder = runtime.exc.retainedInput(grant)?.serder.sad?.ri;
    const hab = typeof holder === "string" ? this.parts.hby.habs.get(holder) : undefined;
    if (!hab) throw new ValidationError("The Grant is not addressed to a local identifier of this wallet.");
    return await this.go(function*(): Operation<UnblindOutcome> {
      const before = unblindingStatus(ops, grant);
      if (before.state !== "active" && before.state !== "done" && before.state !== "expired") {
        requestUnblind(ops, { hab, grant, states });
      }
      const waited = yield* waitForUnblinding(ops, grant, { timeoutMs });
      const { status } = waited;
      if (waited.outcome === "timed-out") return { outcome: "timed-out", grant, timeoutMs, status };
      if (status.state === "done") return { outcome: "unblinded", grant, status };
      return { outcome: "ended", grant, status: status as EndedUnblinding };
    });
  }

  private presenter() {
    const ops = this.parts.runtime.operations?.presentation;
    if (!ops) throw new ValidationError("This wallet's runtime has no presentation owner.");
    return ops;
  }

  private unblinder() {
    const ops = this.parts.runtime.operations?.unblinding;
    if (!ops) throw new ValidationError("This wallet's runtime has no Unblind owner.");
    return ops;
  }

  /** The runtime's issuance owner. */
  private owner(): IssuanceOperations {
    const ops = this.parts.runtime.operations?.issuance;
    if (!ops) throw new ValidationError("This wallet's runtime has no issuance owner.");
    return ops;
  }

  /** The local identifier a Grant is addressed to. */
  private holder(grant: string): Hab {
    const { db } = this.parts.hby;
    const serder = db.exns.get([grant]) ?? db.epse.get([grant]);
    const holder = serder?.route === "/ipex/grant" ? serder.sad?.ri : undefined;
    const hab = typeof holder === "string" ? this.parts.hby.habs.get(holder) : undefined;
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
}

/** Build the four namespaces over one wallet's parts. */
export function createWalletApi(parts: WalletApiParts): WalletApi {
  return {
    identifiers: new Identifiers(parts),
    oobis: new Oobis(parts),
    mailboxes: new Mailboxes(parts),
    credentials: new Credentials(parts),
  };
}
