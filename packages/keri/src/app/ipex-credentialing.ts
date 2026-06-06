/**
 * IPEX credential artifact assembly for registry-backed ACDC workflows.
 *
 * KERIpy correspondence:
 * - mirrors the byte material gathered by `vdr.credentialing.sendArtifacts`
 *   and the grant/admit command helpers
 * - keeps EXN route construction in `ipexing.ts`
 * - keeps registry, wallet, and verifier persistence in VDR modules
 */
import { concatBytes, SerderACDC, SerderKERI } from "../../../cesr/mod.ts";
import { dgKey } from "../db/core/keys.ts";
import type { Reger } from "../db/reger.ts";
import { CredentialWallet, serializeCredential } from "../vdr/credentialing.ts";
import type { Reactor } from "./reactor.ts";
import { acceptedEventReplayMessage, type Hab, type Habery } from "./habbing.ts";
import { IPEX_GRANT_ROUTE, ipexAdmitExn, type IpexBuilderOptions, ipexGrantExn } from "./ipexing.ts";
import { ValidationError } from "../core/errors.ts";

export interface CredentialPresentationArtifacts {
  /** ACDC body plus its SealSourceTriples proof attachment. */
  acdc: Uint8Array;
  /** Credential TEL issue/revoke stream message for the presented ACDC. */
  iss: Uint8Array;
  /** Issuer KEL event that anchors `iss`. */
  anc: Uint8Array;
}

export interface CredentialGrantMessage {
  grant: SerderKERI;
  attachments: Uint8Array;
  wire: Uint8Array;
  artifacts: CredentialPresentationArtifacts;
  support: Uint8Array[];
}

export interface CredentialAdmitMessage {
  admit: SerderKERI;
  attachments: Uint8Array;
  wire: Uint8Array;
}

export interface IpexCredentialGrantOptions extends IpexBuilderOptions {
  agree?: SerderKERI | null;
}

export interface IpexCredentialAdmitOptions extends IpexBuilderOptions {
  /** Require the credential embedded in the grant to already be saved locally. */
  requireSaved?: boolean;
}

/** Build KERIpy-shaped support artifacts for one credential presentation. */
export function credentialSupportMessages(
  hby: Habery,
  reger: Reger,
  creder: SerderACDC,
  recipient: string,
): Uint8Array[] {
  const messages: Uint8Array[] = [];
  const issuer = creder.issuer;
  if (!issuer) {
    throw new ValidationError("Credential is missing issuer AID.");
  }

  const issuerKever = hby.db.getKever(issuer);
  if (!issuerKever) {
    throw new ValidationError(`Missing issuer KEL state for ${issuer}.`);
  }
  messages.push(...hby.db.cloneDelegation(issuerKever));
  messages.push(...hby.db.clonePreIter(issuer));

  const issuee = credentialIssuee(creder);
  if (issuee && issuee !== recipient) {
    const issueeKever = hby.db.getKever(issuee);
    if (!issueeKever) {
      throw new ValidationError(`Missing issuee KEL state for ${issuee}.`);
    }
    messages.push(...hby.db.cloneDelegation(issueeKever));
    messages.push(...hby.db.clonePreIter(issuee));
  }

  const registry = creder.regid;
  if (registry) {
    messages.push(...reger.clonePreIter(registry));
  }

  const said = credentialSaid(creder);
  messages.push(...reger.clonePreIter(said));
  return messages;
}

/**
 * Build the full raw credential stream equivalent of KERIpy `sendCredential`.
 *
 * IPEX grant sends the support artifacts and recursively chained source
 * credentials separately, then embeds the top-level credential in the grant
 * EXN. Raw import/export paths can append the top-level credential message too.
 */
export function credentialStreamMessages(
  hby: Habery,
  reger: Reger,
  creder: SerderACDC,
  recipient: string,
): Uint8Array[] {
  return [
    ...credentialPresentationSupportMessages(hby, reger, creder, recipient),
    credentialExportMessage(reger, credentialSaid(creder)),
  ];
}

/** Build the support stream used before sending a credential grant EXN. */
export function credentialPresentationSupportMessages(
  hby: Habery,
  reger: Reger,
  creder: SerderACDC,
  recipient: string,
): Uint8Array[] {
  const messages = credentialSupportMessages(hby, reger, creder, recipient);
  for (const [source, atc] of reger.sources(hby.db, creder)) {
    messages.push(...credentialSupportMessages(hby, reger, source, recipient));
    messages.push(concatBytes(source.raw, atc));
  }
  return messages;
}

/** Build grant-embedded `acdc`, `iss`, and `anc` artifacts for one credential. */
export function credentialPresentationArtifacts(
  hby: Habery,
  reger: Reger,
  credentialSaidValue: string,
): CredentialPresentationArtifacts {
  const [creder, prefixer, number, diger] = reger.cloneCred(credentialSaidValue);
  const acdc = serializeCredential(creder, prefixer, number, diger);
  const iss = reger.cloneTvtAt(credentialSaidValue, 0);
  const iserder = new SerderKERI({ raw: iss });
  if (!iserder.said) {
    throw new ValidationError(`Credential TEL message ${credentialSaidValue} is missing SAID.`);
  }

  const telAnchor = reger.ancs.get(dgKey(credentialSaidValue, iserder.said));
  if (telAnchor) {
    const [anchorNumber, anchorDiger] = telAnchor;
    if (anchorNumber.qb64 !== number.qb64 || anchorDiger.qb64 !== diger.qb64) {
      throw new ValidationError(`Credential anchor mismatch for ${credentialSaidValue}.`);
    }
  }

  const sn = Number(number.num);
  if (!Number.isSafeInteger(sn)) {
    throw new ValidationError(`Credential anchor sequence is too large for replay: ${number.qb64}.`);
  }
  const replay = acceptedEventReplayMessage(hby, prefixer.qb64, sn);
  if (replay.serder.said !== diger.qb64) {
    throw new ValidationError(
      `Credential anchor event ${replay.serder.said ?? "<missing>"} did not match ${diger.qb64}.`,
    );
  }

  return { acdc, iss, anc: replay.message };
}

/** Build a signed `/ipex/grant` message with embedded credential artifacts. */
export function ipexCredentialGrant(args: {
  hby: Habery;
  hab: Hab;
  reger: Reger;
  recipient: string;
  credentialSaid: string;
  message?: string;
  options?: IpexCredentialGrantOptions;
}): CredentialGrantMessage {
  const [creder] = args.reger.cloneCred(args.credentialSaid);
  const artifacts = credentialPresentationArtifacts(args.hby, args.reger, args.credentialSaid);
  const support = credentialPresentationSupportMessages(args.hby, args.reger, creder, args.recipient);
  const [grant, attachments] = ipexGrantExn(
    args.hab,
    args.recipient,
    args.message ?? "",
    artifacts.acdc,
    {
      ...(args.options ?? {}),
      iss: artifacts.iss,
      anc: artifacts.anc,
      agree: args.options?.agree ?? null,
    },
  );
  return {
    grant,
    attachments,
    wire: concatBytes(args.hab.endorse(grant, { pipelined: false }), attachments),
    artifacts,
    support,
  };
}

/** Build a signed `/ipex/admit` response for an accepted grant. */
export function ipexCredentialAdmit(args: {
  hab: Hab;
  reger: Reger;
  grant: SerderKERI;
  message?: string;
  options?: IpexCredentialAdmitOptions;
}): CredentialAdmitMessage {
  if (args.grant.route !== IPEX_GRANT_ROUTE) {
    throw new ValidationError(`Expected ${IPEX_GRANT_ROUTE} grant, got ${args.grant.route ?? "<none>"}.`);
  }
  const credentialSaidValue = credentialSaidFromGrant(args.grant);
  if (!credentialSaidValue) {
    throw new ValidationError("Grant is missing embedded ACDC SAID.");
  }
  if ((args.options?.requireSaved ?? true) && !args.reger.saved.get([credentialSaidValue])) {
    throw new ValidationError(`Credential ${credentialSaidValue} is not saved locally.`);
  }

  const [admit, attachments] = ipexAdmitExn(args.hab, args.message ?? "", args.grant, args.options ?? {});
  return {
    admit,
    attachments,
    wire: concatBytes(args.hab.endorse(admit, { pipelined: false }), attachments),
  };
}

/** Parse grant-embedded artifacts in KERIpy admit order: `anc`, `iss`, `acdc`. */
export function processCredentialPresentationArtifacts(
  reactor: Reactor,
  artifacts: CredentialPresentationArtifacts,
): void {
  reactor.processChunk(artifacts.anc);
  reactor.processChunk(artifacts.iss);
  reactor.processChunk(artifacts.acdc);
  reactor.processEscrowsOnce();
}

/** Return a raw exported credential message by SAID. */
export function credentialExportMessage(reger: Reger, credentialSaidValue: string): Uint8Array {
  return new CredentialWallet(reger).exportCredential(credentialSaidValue);
}

function credentialSaid(creder: SerderACDC): string {
  if (!creder.said) {
    throw new ValidationError("Credential is missing SAID.");
  }
  return creder.said;
}

function credentialIssuee(creder: SerderACDC): string | null {
  const attrib = creder.attrib;
  if (attrib && typeof attrib === "object" && !Array.isArray(attrib)) {
    const issuee = (attrib as Record<string, unknown>).i;
    return typeof issuee === "string" ? issuee : null;
  }
  return null;
}

function credentialSaidFromGrant(grant: SerderKERI): string | null {
  const embeds = embeddedSection(grant);
  const acdc = embeds?.acdc;
  if (!acdc || typeof acdc !== "object" || Array.isArray(acdc)) {
    return null;
  }
  const said = (acdc as Record<string, unknown>).d;
  return typeof said === "string" ? said : null;
}

function embeddedSection(serder: SerderKERI): Record<string, unknown> | null {
  const ked = serder.ked;
  if (!ked) {
    return null;
  }
  if (ked.e && typeof ked.e === "object" && !Array.isArray(ked.e)) {
    return ked.e as Record<string, unknown>;
  }
  const attrs = ked.a;
  if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
    const embeds = (attrs as Record<string, unknown>).e;
    if (embeds && typeof embeds === "object" && !Array.isArray(embeds)) {
      return embeds as Record<string, unknown>;
    }
  }
  return null;
}
