/**
 * Legacy (v1) IPEX credential grant and admit for a single-signature
 * controller, plus the step that saves a granted credential. Owned by the
 * library so that every host (CLI, wallet, service) runs one implementation.
 * Conversation verbs and the status/wait reads live in `ipex-conversation.ts`.
 *
 * Operations follow the workflow contract. `sendIpexGrant` and `sendIpexAdmit`
 * are explicit: each validates, signs one exchange, accepts it locally, hands
 * it to the Poster and returns once that delivery attempt has an outcome.
 * `sendIpexAdmit` is the holder's consent to a grant. `settleGrantCredential`
 * imports a stored grant's artifacts so the wallet can save the credential; it
 * is idempotent and signs nothing. Waiting for the credential is
 * `waitForIpexExchange(..., { until: "credential-saved" })`: the host's own
 * workers make escrowed evidence resolve.
 *
 * Boundaries:
 * - Collaborators are narrow (ADR-0013); the host owns their lifetimes and runs
 *   the Poster worker while a send awaits its outcome.
 * - `deliver: false` authors and accepts locally but leaves delivery to the
 *   caller, who then holds the bytes (for export to a file).
 * - Grant files, mailbox intake and group controllers are host concerns: the
 *   library starts from a grant already stored as accepted.
 */
import type { SerderKERI, Versionage } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import type { Reger } from "../../db/reger.ts";
import type { Hab } from "../identity/habbing.ts";
import type { Habery } from "../identity/habbing.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import {
  acceptIpexExchange,
  type IpexExchangeStatus,
  ipexExchangeStatus,
  type IpexSendDeps,
  requireIpexPrior,
  requireIpexSender,
} from "./ipex-conversation.ts";
import {
  ipexCredentialAdmit,
  ipexCredentialGrant,
  processCredentialPresentationArtifacts,
  storedGrantArtifacts,
  validateAdmitGrant,
} from "./ipex-credentialing.ts";
import { requireStoredExchange, sendCredentialStream } from "./ipex-grouping.ts";

/** Collaborators grant and admit need: the send set plus the credential store. */
export interface IpexGrantDeps extends IpexSendDeps {
  /** Borrowed credential store holding the credential, its TEL and the saved index. */
  readonly reger: Reger;
}

/** Choices for {@link sendIpexGrant}. */
export interface IpexGrantSendOptions {
  /** Resolved recipient AID. */
  recipient: string;
  /** SAID of the stored credential to grant. */
  credential: string;
  /** Free-text `m` field; defaults to empty. */
  message?: string;
  /** Said of the accepted agree this grant answers; omit for an unsolicited grant. */
  agree?: string;
  /** Attachment genus; defaults to the exchange's own. */
  gvrsn?: Versionage;
  /** False leaves delivery to the caller. Defaults to true. */
  deliver?: boolean;
}

/** The grant a send signed and accepted. */
export interface IpexGrantSent {
  readonly grant: SerderKERI;
  /** SAID of the granted credential. */
  readonly credential: string;
  /** Support messages (issuer KEL, TEL and the like) that precede the grant, in order. */
  readonly support: Uint8Array[];
  /** Signed grant followed by its attachments. */
  readonly wire: Uint8Array;
  /** Successful destination URLs; empty when delivery was left to the caller. */
  readonly deliveries: string[];
}

/**
 * Grant a stored single-signature credential: validate the optional agree,
 * assemble the embedded artifacts and support messages, sign, accept locally
 * and deliver support then grant as one stream. Granting a credential again
 * without an agree authors another grant; an agree answers once.
 *
 * @throws ValidationError for a non-local sender, a refused prior, missing local
 * credential evidence or a grant local state does not accept.
 */
export function* sendIpexGrant(
  deps: IpexGrantDeps,
  sender: Hab,
  { recipient, credential, message = "", agree, gvrsn, deliver = true }: IpexGrantSendOptions,
): Operation<IpexGrantSent> {
  requireIpexSender(deps.hby, sender);
  if (agree) requireIpexPrior(deps.hby, sender.pre, recipient, agree, "grant");
  const built = ipexCredentialGrant({
    hby: deps.hby,
    hab: sender,
    reger: deps.reger,
    recipient,
    credentialSaid: credential,
    message,
    options: { agree: agree ? deps.hby.db.exns.get([agree]) : null, gvrsn },
  });
  const genus = built.grant.gvrsn ?? gvrsn ?? built.grant.pvrsn;
  yield* acceptIpexExchange(deps, built.grant, built.wire, genus, "Local IPEX grant was not accepted.", agree);
  const deliveries = deliver
    ? yield* sendCredentialStream(deps.postman, sender, recipient, [...built.support, built.wire])
    : [];
  return { grant: built.grant, credential, support: built.support, wire: built.wire, deliveries };
}

/** An accepted grant the holder may admit. */
export interface AdmittableGrant {
  readonly grant: SerderKERI;
  /** The grant's sender, who receives the admit. */
  readonly recipient: string;
  /** SAID of the granted credential. */
  readonly credential: string;
}

/**
 * Validate a stored grant for admission by `holder` without signing: it is
 * accepted, addressed to the holder, carries a credential and has no accepted
 * response yet. Saving is not required here.
 *
 * @throws ValidationError when the grant is not stored, was already answered or is not addressed to `holder`.
 */
export function requireAdmittableGrant(
  deps: Pick<IpexGrantDeps, "hby" | "reger">,
  holder: Hab,
  grantSaid: string,
): AdmittableGrant {
  const grant = requireStoredExchange(deps.hby, grantSaid);
  const sender = grant.ked?.i;
  if (typeof sender !== "string" || sender.length === 0) {
    throw new ValidationError("Grant is missing sender AID.");
  }
  requireIpexPrior(deps.hby, holder.pre, sender, grant.said!, "admit");
  const credential = validateAdmitGrant(grant, holder.pre, deps.reger, false);
  return { grant, recipient: sender, credential };
}

/** Choices for {@link sendIpexAdmit}. */
export interface IpexAdmitOptions {
  /** Free-text `m` field; defaults to empty. */
  message?: string;
  /** Attachment genus; defaults to the exchange's own. */
  gvrsn?: Versionage;
  /** Refuse unless the granted credential is saved. Defaults to true; false authors the admit without that wallet fact. */
  requireSaved?: boolean;
  /** False leaves delivery to the caller. Defaults to true. */
  deliver?: boolean;
}

/** The admit a send signed and accepted. */
export interface IpexAdmitSent {
  readonly admit: SerderKERI;
  readonly grant: SerderKERI;
  /** SAID of the granted credential. */
  readonly credential: string;
  /** Whether the wallet had saved the credential when the admit was signed. */
  readonly saved: boolean;
  /** Signed admit followed by its attachments. */
  readonly wire: Uint8Array;
  /** Successful destination URLs; empty when delivery was left to the caller. */
  readonly deliveries: string[];
}

/**
 * The holder's consent to a grant: validate the stored grant, sign an admit,
 * accept it locally and deliver it to the grant's sender. A grant that already
 * has an accepted response is refused, so a second admit never re-signs.
 *
 * @throws ValidationError as for {@link requireAdmittableGrant}, for a credential
 * that is not saved when `requireSaved` holds, or for an admit local state does not accept.
 */
export function* sendIpexAdmit(
  deps: IpexGrantDeps,
  holder: Hab,
  grantSaid: string,
  { message = "", gvrsn, requireSaved = true, deliver = true }: IpexAdmitOptions = {},
): Operation<IpexAdmitSent> {
  requireIpexSender(deps.hby, holder);
  const { grant, recipient, credential } = requireAdmittableGrant(deps, holder, grantSaid);
  const saved = !!deps.reger.saved.get([credential]);
  const prepared = ipexCredentialAdmit({
    hab: holder,
    reger: deps.reger,
    grant,
    message,
    options: { requireSaved, gvrsn },
  });
  const genus = prepared.admit.gvrsn ?? gvrsn ?? prepared.admit.pvrsn;
  yield* acceptIpexExchange(
    deps,
    prepared.admit,
    prepared.wire,
    genus,
    "Local IPEX admit was not accepted.",
    grant.said!,
  );
  const deliveries = deliver ? yield* sendCredentialStream(deps.postman, holder, recipient, [prepared.wire]) : [];
  return { admit: prepared.admit, grant, credential, saved, wire: prepared.wire, deliveries };
}

/** Collaborators for saving a granted credential. */
export interface IpexSettleDeps {
  /** Borrowed identities, accepted exchanges and the escrow paths stored artifacts are rebuilt from. */
  readonly hby: Habery;
  /** Credential store. */
  readonly reger: Reger;
  /** Receive processor that accepts the replayed grant artifacts. */
  readonly protocol: ProtocolProcessor;
}

/**
 * Import a stored grant's authenticated artifacts once, so the wallet can save
 * its credential as evidence resolves. Idempotent: a credential that is already
 * saved is not replayed. Signs nothing and does not wait; observe the outcome
 * with `waitForIpexExchange(..., { until: "credential-saved" })` while the
 * host's workers run.
 *
 * @param holder AID the grant must be addressed to.
 * @returns The grant's status after the import.
 * @throws ValidationError when the grant is not stored or not addressed to `holder`.
 */
export function* settleGrantCredential(
  deps: IpexSettleDeps,
  holder: string,
  grantSaid: string,
  { gvrsn }: { gvrsn?: Versionage } = {},
): Operation<IpexExchangeStatus> {
  const grant = requireStoredExchange(deps.hby, grantSaid);
  const credential = validateAdmitGrant(grant, holder, deps.reger, false);
  if (!deps.reger.saved.get([credential])) {
    yield* processCredentialPresentationArtifacts(deps.protocol, storedGrantArtifacts(deps.hby, grant, gvrsn));
  }
  return ipexExchangeStatus(deps, grantSaid);
}
