/** Legacy NoBackers revocation, member fanout and explicit delivery of completed evidence. */
import { Diger, Ilks, type SerderACDC, SerderKERI, TraitDex, type Verfer } from "cesr-ts";
import type { Operation } from "effection";
import { DatabaseOperationError, ValidationError } from "../core/errors.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../core/mailbox-topics.ts";
import { messagize } from "../core/protocol-serialization.ts";
import { dgKey } from "../db/core/keys.ts";
import type { Regery } from "../vdr/credentialing.ts";
import type { TelProcessDecision } from "../vdr/eventing.ts";
import { telAnchorMatches } from "../vdr/tel-anchor.ts";
import { anchorGroupCredentialEvent, publishGroupVcProposal } from "./credential-workflows.ts";
import type { Poster } from "./forwarding.ts";
import { groupMemberHasKey, isLocalGroupHab, localGroupMember } from "./group-members.ts";
import { MULTISIG_REV_ROUTE } from "./grouping.ts";
import type { Hab, Habery } from "./habbing.ts";
import type { GroupSendResult } from "./multisig-messaging.ts";
import { Organizer } from "./organizing.ts";
import type { Reactor } from "./reactor.ts";

export interface CredentialRevokeOptions {
  registryName: string;
  credentialSaid: string;
}

/** Local TEL and publication facts; member transmission does not establish either. */
export interface CredentialRevokeResult {
  creder: SerderACDC;
  said: string;
  tel: string;
  status: TelProcessDecision["kind"];
  accepted: boolean;
  publicationComplete: boolean;
  /** Actual external transport destinations, populated by a completed delivery operation. */
  deliveries: string[];
  group?: GroupSendResult & { route: typeof MULTISIG_REV_ROUTE };
}

/**
 * Revoke once or resume the original event. Group issuers author a partial anchor,
 * retain ordinary protocol evidence, then admit/fan out the exact coordination
 * wrapper. This operation neither waits for peer approval nor delivers pending
 * evidence to business recipients. The caller runs the host and owns its deadline.
 */
export function* revokeCredential(
  rgy: Regery,
  input: Reactor,
  postman: Poster,
  options: CredentialRevokeOptions,
): Operation<CredentialRevokeResult> {
  const { hby, reger } = rgy;
  const registry = rgy.registryByName(options.registryName);
  if (!registry) throw new ValidationError(`Registry ${options.registryName} not found.`);
  const [creder] = reger.cloneCred(options.credentialSaid);
  let event: SerderKERI;
  let decision: TelProcessDecision;
  let group: CredentialRevokeResult["group"];
  if (isLocalGroupHab(hby, registry.hab)) {
    event = registry.prepareRevocation(options.credentialSaid);
    const retained = retainedAnchor(rgy, registry.hab.pre, event);
    let anchor: { serder: SerderKERI; message: Uint8Array };
    if (retained) {
      anchor = {
        serder: retained,
        message: messagize(retained, { sigers: hby.db.sigs.get(dgKey(retained.pre!, retained.said!)) }),
      };
    } else {
      const estOnly = registry.estOnly || (reger.states.get(registry.regk!)?.c ?? []).includes(TraitDex.EstOnly);
      anchor = anchorGroupCredentialEvent(hby, registry.hab, event, estOnly);
    }
    decision = rgy.tvy.processEvent({
      serder: event,
      seqner: anchor.serder.sner!,
      saider: new Diger({ qb64: anchor.serder.said! }),
    });
    rgy.processEscrows();
    rgy.publication.track(event, anchor.serder);
    group = {
      route: MULTISIG_REV_ROUTE,
      ...(yield* publishGroupVcProposal(hby, input, postman, registry.hab, {
        route: MULTISIG_REV_ROUTE,
        attrs: { gid: registry.hab.pre, said: options.credentialSaid },
        embeds: { rev: event.raw, anc: anchor.message },
      })),
    };
  } else {
    const revoked = registry.revoke(options.credentialSaid);
    event = revoked.serder;
    decision = revoked.decision;
  }
  const accepted = reger.tels.getOn(options.credentialSaid, 1)?.qb64 === event.said;
  return {
    creder,
    said: options.credentialSaid,
    tel: event.said!,
    status: accepted ? "accept" : decision.kind,
    accepted,
    publicationComplete: rgy.publication.complete(options.credentialSaid, 1),
    deliveries: [],
    ...(group ? { group } : {}),
  };
}

/**
 * Send only accepted, publication-complete REV evidence. Elect the lowest verified
 * historical anchor signer for a group; another member returns no deliveries.
 * Poster completion means local transport, not remote protocol acknowledgement.
 * An explicit repeat may resend; there is no durable delivery ledger or retry worker.
 */
export function* deliverCredentialRevocation(
  rgy: Regery,
  postman: Poster,
  credentialSaid: string,
  recipients: readonly string[],
): Operation<string[]> {
  const { hby, reger } = rgy;
  const [creder] = reger.cloneCred(credentialSaid);
  const accepted = reger.tels.getOn(credentialSaid, 1);
  if (!accepted || !rgy.publication.complete(credentialSaid, 1)) return [];
  const raw = reger.tvts.get(dgKey(credentialSaid, accepted.qb64));
  if (!raw) throw new DatabaseOperationError("Accepted revocation body is missing.");
  // retainedAnchor checks the complete original TEL/issuer source relationship.
  const event = new SerderKERI({ raw });
  if (event.pre !== credentialSaid || event.said !== accepted.qb64 || event.ilk !== Ilks.rev || !event.verify()) {
    throw new DatabaseOperationError("Accepted revocation identity is inconsistent.");
  }
  const issuer = creder.issuer!;
  const hab = hby.habs.get(issuer);
  if (!hab) throw new ValidationError("Revocation issuer is not a local habitat.");
  let sender = hab;
  if (isLocalGroupHab(hby, hab)) {
    const anchor = retainedAnchor(rgy, issuer, event);
    if (!anchor) throw new DatabaseOperationError("Accepted revocation issuer source seal is missing.");
    if (!groupAnchorLead(hby, hab, anchor)) return [];
    sender = localGroupMember(hby, issuer);
  }
  const deliveries: string[] = [];
  const messages = [
    ...hby.db.clonePreIter(issuer),
    ...reger.clonePreIter(creder.regid!),
    ...reger.clonePreIter(credentialSaid),
  ];
  for (const recipient of recipients) {
    const dest = new Organizer(hby.db, hby.signator).resolveRecipient(recipient);
    for (const msg of messages) {
      const evt = postman.send({ src: sender.pre, dest, msg, topic: CREDENTIAL_MAILBOX_TOPIC }, { notify: true });
      const outcome = yield* postman.wait(evt);
      if (outcome.kin === "failed") throw outcome.error;
      deliveries.push(...outcome.deliveries);
    }
  }
  return deliveries;
}

/** Resolve explicit destinations and the caller's choice to notify a disclosed issuee. */
export function revocationRecipients(
  creder: SerderACDC,
  explicit: readonly string[],
  includeIssuee: boolean,
): string[] {
  const recipients = includeIssuee && creder.issuee ? [creder.issuee, ...explicit] : [...explicit];
  return [...new Set(recipients.filter(recipient => recipient.length > 0))];
}

/** Recover the original source coordinate without replacing a lost or contradictory anchor. */
function retainedAnchor(rgy: Regery, issuer: string, event: SerderKERI): SerderKERI | null {
  const couple = rgy.reger.ancs.get(dgKey(event.pre!, event.said!));
  if (!couple) return null;
  const anchor = rgy.hby.db.getEvtSerder(issuer, couple[1].qb64);
  if (!anchor || anchor.sner?.num !== couple[0].num || !telAnchorMatches(issuer, event, anchor)) {
    throw new DatabaseOperationError("Stored revocation issuer anchor is missing or inconsistent.");
  }
  return anchor;
}

/** Use accepted historical establishment keys, not the group's current keys after a later rotation. */
function groupAnchorLead(hby: Habery, group: Hab, anchor: SerderKERI): boolean {
  const { db } = hby;
  if (db.kels.getLast(group.pre, anchor.sn!) !== anchor.said) return false;
  let keys: readonly Verfer[] = [];
  for (const [sn, said] of db.getKelItemIter(group.pre)) {
    if (sn > anchor.sn!) break;
    const event = db.getEvtSerder(group.pre, said);
    if (!event) throw new DatabaseOperationError("Accepted issuer event body is missing.");
    if (event.estive) keys = event.verfers;
  }
  let index = Infinity;
  for (const signature of db.sigs.get(dgKey(group.pre, anchor.said!))) {
    if (keys[signature.index]?.verify(signature.raw, anchor.raw)) index = Math.min(index, signature.index);
  }
  const key = keys[index];
  if (!key) throw new DatabaseOperationError("Accepted revocation anchor has no verified signer.");
  return groupMemberHasKey(db, localGroupMember(hby, group.pre).pre, key.qb64);
}
