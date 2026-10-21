/** Credential revocation and delivery; callers own host workers, deadlines and store lifetime. */
import { type SerderACDC } from "cesr-ts";
import type { Operation } from "effection";
import { ValidationError } from "../core/errors.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../core/mailbox-topics.ts";
import type { Reger } from "../db/reger.ts";
import type { Regery, Registry } from "../vdr/credentialing.ts";
import type { Poster } from "./forwarding.ts";
import type { Hab, Habery } from "./habbing.ts";
import { Organizer } from "./organizing.ts";

export interface CredentialRevokeOptions {
  registryName: string;
  credentialSaid: string;
  sendRecipients?: readonly string[];
  senderHab?: Hab;
}

export interface CredentialRevokeResult {
  creder: SerderACDC;
  said: string;
  tel: string | null;
  status: string;
  deliveries: string[];
}

/**
 * Revoke one credential and optionally deliver revocation stream bytes.
 *
 * @param rgy Borrowed registry/TEL owner.
 * @param postman Borrowed Poster; its delivery worker must run while this operation awaits outcomes.
 * @param options Credential/registry selection and optional recipient/export choices.
 * @returns Revocation state and requested publication results.
 */
export function* revokeCredential(
  rgy: Regery,
  postman: Poster,
  options: CredentialRevokeOptions,
): Operation<CredentialRevokeResult> {
  const { hby, reger } = rgy;
  const registry = requireRegistry(rgy, options.registryName);
  const result = registry.revoke(options.credentialSaid);
  const [creder] = reger.cloneCred(options.credentialSaid);
  const deliveries: string[] = [];

  if ((options.sendRecipients?.length ?? 0) > 0) {
    if (!options.senderHab) {
      throw new ValidationError("Revocation sender habitat is required when sending revocation events.");
    }
    const messages = revocationStreamMessages(hby, reger, creder);
    for (const recipient of options.sendRecipients ?? []) {
      const dest = new Organizer(hby.db, hby.signator).resolveRecipient(recipient);
      for (const message of messages) {
        const evt = postman.send({
          src: options.senderHab.pre,
          dest,
          msg: message,
          topic: CREDENTIAL_MAILBOX_TOPIC,
        }, { notify: true });
        const outcome = yield* postman.wait(evt);
        if (outcome.kin === "failed") throw outcome.error;
        deliveries.push(...outcome.deliveries);
      }
    }
  }

  return {
    creder,
    said: options.credentialSaid,
    tel: result.serder.said,
    status: result.decision.kind,
    deliveries,
  };
}

/** Resolve revoke delivery recipients from explicit recipients and issuee policy. */
export function revocationRecipients(
  creder: SerderACDC,
  explicit: readonly string[],
  includeIssuee: boolean,
): string[] {
  const recipients = includeIssuee && creder.issuee ? [creder.issuee, ...explicit] : [...explicit];
  return [...new Set(recipients.filter((recipient) => recipient.length > 0))];
}

function revocationStreamMessages(
  hby: Habery,
  reger: Reger,
  creder: SerderACDC,
): Uint8Array[] {
  const issuer = creder.issuer;
  if (!issuer) {
    throw new ValidationError("Credential is missing issuer AID.");
  }
  return [
    ...hby.db.clonePreIter(issuer),
    ...reger.clonePreIter(creder.said!),
  ];
}

/** Resolve the selected local registry before any authoring operation. */
function requireRegistry(rgy: Regery, name: string): Registry {
  const registry = rgy.registryByName(name);
  if (!registry) throw new ValidationError(`Registry ${name} not found.`);
  return registry;
}
