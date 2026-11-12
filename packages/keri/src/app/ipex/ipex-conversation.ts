/**
 * Legacy (v1) IPEX conversation for a single-signature controller: send an
 * apply, offer, agree or spurn, read where a conversation stands and observe it
 * until the peer replies. Owned by the library so that every host (CLI, wallet,
 * service) runs one implementation.
 *
 * Operations follow the workflow contract. `sendIpexApply`, `sendIpexOffer`,
 * `sendIpexAgree` and `sendIpexSpurn` are explicit: each validates the accepted
 * prior message, signs exactly one exchange, accepts it locally, hands it to the
 * Poster and returns once that delivery attempt has an outcome. They never wait
 * for the peer. `ipexExchangeStatus` is a pure synchronous read of durable
 * state. `waitForIpexExchange` only observes: it starts no worker and returns a
 * timed-out value instead of throwing.
 *
 * Boundaries:
 * - Dependencies are narrow collaborators, not an AgentRuntime (ADR-0013). The
 *   host owns their lifetimes and must be running the Poster worker so the
 *   delivery attempt can complete (`withRuntimeWorkers` for a one-shot host).
 * - Recipients arrive as resolved AIDs; contact lookup is a host concern.
 * - Group controllers do not use these operations: their propose/approve split
 *   needs the multisig coordinator, which the group proposal API will own.
 * - Durable state records acceptance, not delivery, so there is no "sent but
 *   unanswered" read distinct from `awaiting-reply`; a send's return value is
 *   the evidence that it was sent.
 */
import { concatBytes, Counter, type SerderKERI, type Versionage } from "cesr-ts";
import { type Operation, sleep } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { exchange } from "../../core/exchange/protocol-exchanging.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../../core/mailbox/mailbox-topics.ts";
import type { Reger } from "../../db/reger.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { isLocalGroupHab } from "../multisig/group-members.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { Reactor } from "../protocol/reactor.ts";
import { type RuntimeClock, systemClock } from "../runtime/runtime-clock.ts";
import type { ChangeSink, WaitResult } from "../runtime/workflow-contract.ts";
import { credentialSaidFromGrant } from "./ipex-credentialing.ts";
import { sendCredentialStream } from "./ipex-grouping.ts";
import {
  IPEX_AGREE_ROUTE,
  IPEX_APPLY_ROUTE,
  IPEX_GRANT_ROUTE,
  IPEX_OFFER_ROUTE,
  IPEX_SPURN_ROUTE,
  type IpexVerb,
  validateIpexReply,
} from "./ipexing.ts";

/** Collaborators sending an exchange needs; nothing else is reachable from here. */
export interface IpexSendDeps {
  /** Borrowed identities and accepted-state stores. */
  readonly hby: Habery;
  /** Parser/dispatcher that accepts the signed exchange into local state. */
  readonly reactor: Reactor;
  /** Escrow processing, and the exchanger that reports acceptance, over the same database as `hby`. */
  readonly protocol: ProtocolProcessor;
  /** Delivery queue; its worker must be running while a send awaits its outcome. */
  readonly postman: Poster;
  /** Optional sink told `{kind:"ipex", id:"<said>"}` for the new exchange and its prior after local acceptance. */
  readonly changes?: ChangeSink;
}

/** The exchange a send signed and accepted, with the destinations that took it. */
export interface IpexSent {
  readonly exn: SerderKERI;
  /** Successful destination URLs. */
  readonly deliveries: string[];
}

/** Choices shared by every conversation send. */
export interface IpexMessageOptions {
  /** Resolved recipient AID. */
  recipient: string;
  /** Free-text `m` field; defaults to empty. */
  message?: string;
}

/** Stores the status read inspects. A `Habery` and a `Reger` fit. */
export interface IpexStatusDeps {
  /** Accepted exchange messages and their reply indexes. */
  readonly hby: Pick<Habery, "db">;
  /** Saved credential index. */
  readonly reger: Pick<Reger, "saved">;
}

/** Wallet fact for a grant: the credential it carries and whether the wallet saved it. */
export interface IpexCredentialFact {
  readonly said: string;
  readonly saved: boolean;
}

/**
 * Where one accepted exchange stands.
 * - `unknown`: no accepted exchange has this SAID.
 * - `awaiting-reply`: accepted and no response is accepted against it yet.
 * - `replied`: a response is accepted; `reply.route` is `null` only if the
 *   indexed response is no longer stored.
 *
 * `credential` is present for grants only.
 */
export type IpexExchangeStatus =
  | { state: "unknown" }
  | { state: "awaiting-reply"; route: string; credential?: IpexCredentialFact }
  | {
    state: "replied";
    route: string;
    reply: { said: string; route: string | null };
    credential?: IpexCredentialFact;
  };

/**
 * Require a local single-signature sender.
 *
 * @throws ValidationError when `sender` is not a local AID of `hby` or is a group AID.
 */
export function requireIpexSender(hby: Habery, sender: Hab): void {
  if (!sender.pre || hby.habs.get(sender.pre) !== sender) {
    throw new ValidationError(`No local AID found for sender ${sender.pre || "<missing>"}.`);
  }
  if (isLocalGroupHab(hby, sender)) {
    throw new ValidationError(`Sender ${sender.pre} is a group AID; single-signature IPEX operations do not apply.`);
  }
}

/**
 * Validate an accepted predecessor and its known parties before any local signing.
 *
 * @throws ValidationError when the prior is not accepted, has the wrong route or
 * parties, or already has an accepted response.
 */
export function requireIpexPrior(
  hby: Pick<Habery, "db">,
  sender: string,
  recipient: string,
  said: string,
  verb: Exclude<IpexVerb, "apply">,
): void {
  const prior = hby.db.exns.get([said]);
  if (!prior) throw new ValidationError("Prior IPEX exchange is not accepted.");
  validateIpexReply(prior, verb, sender, recipient);
  if (hby.db.erpy.get([said])) {
    throw new ValidationError("Prior IPEX exchange already has an accepted response; resume the existing exchange.");
  }
}

/**
 * Accept one signed exchange locally and confirm it was accepted.
 *
 * @param wire Signed exchange followed by its attachments.
 * @param refusal Message for the infrastructure failure of a local exchange that was not accepted.
 * @param prior Said of the message this one answers; its status changes too.
 */
export function* acceptIpexExchange(
  deps: Pick<IpexSendDeps, "reactor" | "protocol" | "changes">,
  exn: SerderKERI,
  wire: Uint8Array,
  genus: Versionage,
  refusal: string,
  prior?: string,
): Operation<void> {
  yield* deps.reactor.processBytes(concatBytes(Counter.makeGVC(genus), wire), { local: true });
  yield* deps.protocol.processEscrowsOnce();
  if (!deps.protocol.exc.complete(exn.said!)) throw new ValidationError(refusal);
  if (prior) deps.changes?.push({ kind: "ipex", id: prior });
  deps.changes?.push({ kind: "ipex", id: exn.said! });
}

/**
 * Sign one prepared exchange, accept it locally and deliver it. A spurn goes out
 * as a one-message stream; every other verb as a queued message with a
 * completion notice. A failed delivery outcome throws its original error; the
 * accepted exchange stays stored.
 */
function* signAcceptAndSend(
  deps: IpexSendDeps,
  sender: Hab,
  recipient: string,
  [exn, attachments]: readonly [SerderKERI, Uint8Array],
  prior?: string,
): Operation<IpexSent> {
  const genus = exn.gvrsn ?? exn.pvrsn;
  const wire = concatBytes(sender.endorse(exn, { pipelined: false, gvrsn: genus }), attachments);
  yield* acceptIpexExchange(deps, exn, wire, genus, "Local IPEX exchange was not accepted.", prior);
  if (exn.route === IPEX_SPURN_ROUTE) {
    return { exn, deliveries: yield* sendCredentialStream(deps.postman, sender, recipient, [wire]) };
  }
  const evt = deps.postman.send(
    { src: sender.pre, dest: recipient, topic: CREDENTIAL_MAILBOX_TOPIC, msg: wire },
    { notify: true },
  );
  const outcome = yield* deps.postman.wait(evt);
  if (outcome.kin === "failed") throw outcome.error;
  return { exn, deliveries: outcome.deliveries };
}

/** Choices for {@link sendIpexApply}. */
export interface IpexApplyOptions extends IpexMessageOptions {
  /** Schema SAID requested. */
  schema: string;
  /** Requested attribute values; defaults to none. */
  attrs?: Record<string, unknown>;
}

/**
 * Send an `/ipex/apply` asking `recipient` for a credential of `schema`.
 * An apply starts a conversation, so there is no prior to validate and sending
 * it twice sends two distinct applies.
 *
 * @throws ValidationError for a sender that is not a local single-signature AID or a refused local exchange.
 */
export function* sendIpexApply(
  deps: IpexSendDeps,
  sender: Hab,
  { recipient, schema, attrs = {}, message = "" }: IpexApplyOptions,
): Operation<IpexSent> {
  requireIpexSender(deps.hby, sender);
  const prepared = exchange(IPEX_APPLY_ROUTE, { m: message, s: schema, a: attrs, i: recipient }, {
    sender: sender.pre,
    recipient,
  });
  return yield* signAcceptAndSend(deps, sender, recipient, prepared);
}

/** Choices for {@link sendIpexOffer}. */
export interface IpexOfferOptions extends IpexMessageOptions {
  /** Raw ACDC message embedded as the offer's `acdc`. */
  acdc: Uint8Array;
  /** Said of the accepted apply this offer answers; omit for an unsolicited offer. */
  apply?: string;
}

/**
 * Send an `/ipex/offer` carrying one embedded ACDC, optionally answering an apply.
 *
 * @throws ValidationError as for {@link requireIpexPrior} when `apply` is given.
 */
export function* sendIpexOffer(
  deps: IpexSendDeps,
  sender: Hab,
  { recipient, acdc, apply, message = "" }: IpexOfferOptions,
): Operation<IpexSent> {
  requireIpexSender(deps.hby, sender);
  if (apply) requireIpexPrior(deps.hby, sender.pre, recipient, apply, "offer");
  const prepared = exchange(IPEX_OFFER_ROUTE, { m: message }, {
    sender: sender.pre,
    recipient,
    dig: apply,
    embeds: { acdc },
  });
  return yield* signAcceptAndSend(deps, sender, recipient, prepared, apply || undefined);
}

/** Choices for {@link sendIpexAgree}. */
export interface IpexAgreeOptions extends IpexMessageOptions {
  /** Said of the accepted offer being agreed to. */
  offer: string;
}

/**
 * Send an `/ipex/agree` answering an accepted offer.
 *
 * @throws ValidationError as for {@link requireIpexPrior}.
 */
export function* sendIpexAgree(
  deps: IpexSendDeps,
  sender: Hab,
  { recipient, offer, message = "" }: IpexAgreeOptions,
): Operation<IpexSent> {
  requireIpexSender(deps.hby, sender);
  requireIpexPrior(deps.hby, sender.pre, recipient, offer, "agree");
  const prepared = exchange(IPEX_AGREE_ROUTE, { m: message }, { sender: sender.pre, recipient, dig: offer });
  return yield* signAcceptAndSend(deps, sender, recipient, prepared, offer);
}

/** Choices for {@link sendIpexSpurn}. */
export interface IpexSpurnOptions extends IpexMessageOptions {
  /** Said of the accepted apply, offer, agree or grant being rejected. */
  prior: string;
}

/**
 * Send an `/ipex/spurn` rejecting an accepted apply, offer, agree or grant.
 *
 * @throws ValidationError as for {@link requireIpexPrior}.
 */
export function* sendIpexSpurn(
  deps: IpexSendDeps,
  sender: Hab,
  { recipient, prior, message = "" }: IpexSpurnOptions,
): Operation<IpexSent> {
  requireIpexSender(deps.hby, sender);
  requireIpexPrior(deps.hby, sender.pre, recipient, prior, "spurn");
  const prepared = exchange(IPEX_SPURN_ROUTE, { m: message }, { sender: sender.pre, recipient, dig: prior });
  return yield* signAcceptAndSend(deps, sender, recipient, prepared, prior);
}

/**
 * Pure synchronous status of the accepted exchange `said`, derived from the
 * exchange store, the reply index and (for grants) the saved-credential index.
 * Mutates nothing.
 */
export function ipexExchangeStatus(deps: IpexStatusDeps, said: string): IpexExchangeStatus {
  const exn = deps.hby.db.exns.get([said]);
  if (!exn) return { state: "unknown" };
  const route = exn.route ?? "";
  const credentialSaid = route === IPEX_GRANT_ROUTE ? credentialSaidFromGrant(exn) : null;
  const credential = credentialSaid
    ? { credential: { said: credentialSaid, saved: !!deps.reger.saved.get([credentialSaid]) } }
    : {};
  const response = deps.hby.db.erpy.get([said]);
  if (!response) return { state: "awaiting-reply", route, ...credential };
  const replySaid = response.qb64;
  const reply = { said: replySaid, route: deps.hby.db.exns.get([replySaid])?.route ?? null };
  return { state: "replied", route, reply, ...credential };
}

/** What a {@link waitForIpexExchange} is waiting for. */
export type IpexWaitFor = "replied" | "credential-saved";

/** Choices for {@link waitForIpexExchange}. */
export interface IpexWaitOptions {
  /** Wall-clock budget. */
  timeoutMs: number;
  /** `replied` (default) waits for an accepted response; `credential-saved` for a grant's credential to be saved. */
  until?: IpexWaitFor;
  /** Elapsed milliseconds between reads. */
  pollMs?: number;
  clock?: RuntimeClock;
}

function reached(status: IpexExchangeStatus, until: IpexWaitFor): boolean {
  if (until === "credential-saved") return status.state !== "unknown" && !!status.credential?.saved;
  return status.state === "replied";
}

/**
 * Observe `said` until the wanted state holds or the budget expires. A wait
 * that is already satisfied returns at once. Starts no worker: the host's own
 * poller and escrow loop make the peer's reply or the credential arrive.
 *
 * @returns `settled`, or `timed-out`; both carry the status read at return.
 */
export function* waitForIpexExchange(
  deps: IpexStatusDeps,
  said: string,
  { timeoutMs, until = "replied", pollMs = 250, clock = systemClock }: IpexWaitOptions,
): Operation<WaitResult<IpexExchangeStatus>> {
  const deadline = clock.now() + timeoutMs;
  while (true) {
    const status = ipexExchangeStatus(deps, said);
    if (reached(status, until)) return { outcome: "settled", status };
    const remaining = deadline - clock.now();
    if (remaining <= 0) return { outcome: "timed-out", status, timeoutMs };
    yield* sleep(Math.min(pollMs, remaining));
  }
}
