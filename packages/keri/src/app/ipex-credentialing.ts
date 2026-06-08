/**
 * IPEX credential artifact assembly for registry-backed ACDC workflows.
 *
 * KERIpy correspondence:
 * - mirrors the byte material gathered by `vdr.credentialing.sendArtifacts`
 *   and the grant/admit command helpers
 * - keeps EXN route construction in `ipexing.ts`
 * - keeps registry, wallet, and verifier persistence in VDR modules
 */
import { concatBytes, Counter, parsePather, SerderACDC, SerderKERI } from "../../../cesr/mod.ts";
import type { AttachmentCounterProfile } from "../core/attachment-counter-profile.ts";
import { ValidationError } from "../core/errors.ts";
import { dgKey } from "../db/core/keys.ts";
import type { Reger } from "../db/reger.ts";
import { CredentialWallet, serializeCredential } from "../vdr/credentialing.ts";
import { acceptedEventReplayMessage, type Hab, type Habery } from "./habbing.ts";
import { IPEX_GRANT_ROUTE, ipexAdmitExn, type IpexBuilderOptions, ipexGrantExn } from "./ipexing.ts";
import type { Reactor } from "./reactor.ts";

const textEncoder = new TextEncoder();

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
  counterProfile: AttachmentCounterProfile = "legacy",
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
  messages.push(...hby.db.cloneDelegation(issuerKever, counterProfile));
  messages.push(...hby.db.clonePreIter(issuer, 0, counterProfile));

  const issuee = credentialIssuee(creder);
  if (issuee && issuee !== recipient) {
    const issueeKever = hby.db.getKever(issuee);
    if (!issueeKever) {
      throw new ValidationError(`Missing issuee KEL state for ${issuee}.`);
    }
    messages.push(...hby.db.cloneDelegation(issueeKever, counterProfile));
    messages.push(...hby.db.clonePreIter(issuee, 0, counterProfile));
  }

  const registry = creder.regid;
  if (registry) {
    messages.push(...reger.clonePreIter(registry, 0, counterProfile));
  }

  const said = credentialSaid(creder);
  messages.push(...reger.clonePreIter(said, 0, counterProfile));
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
  counterProfile: AttachmentCounterProfile = "legacy",
): Uint8Array[] {
  return [
    ...credentialPresentationSupportMessages(
      hby,
      reger,
      creder,
      recipient,
      counterProfile,
    ),
    credentialExportMessage(reger, credentialSaid(creder)),
  ];
}

/** Build the support stream used before sending a credential grant EXN. */
export function credentialPresentationSupportMessages(
  hby: Habery,
  reger: Reger,
  creder: SerderACDC,
  recipient: string,
  counterProfile: AttachmentCounterProfile = "legacy",
): Uint8Array[] {
  const messages = credentialSupportMessages(
    hby,
    reger,
    creder,
    recipient,
    counterProfile,
  );
  for (const [source, atc] of reger.sources(hby.db, creder, counterProfile)) {
    messages.push(...credentialSupportMessages(hby, reger, source, recipient, counterProfile));
    messages.push(concatBytes(source.raw, atc));
  }
  return messages;
}

/** Build grant-embedded `acdc`, `iss`, and `anc` artifacts for one credential. */
export function credentialPresentationArtifacts(
  hby: Habery,
  reger: Reger,
  credentialSaidValue: string,
  counterProfile: AttachmentCounterProfile = "legacy",
): CredentialPresentationArtifacts {
  const [creder, prefixer, number, diger] = reger.cloneCred(credentialSaidValue);
  const acdc = serializeCredential(creder, prefixer, number, diger, counterProfile);
  const iss = reger.cloneTvtAt(credentialSaidValue, 0, counterProfile);
  const iserder = new SerderKERI({ raw: iss });
  if (!iserder.said) {
    throw new ValidationError(`Credential TEL message ${credentialSaidValue} is missing SAID.`);
  }
  if (iserder.pre !== prefixer.qb64 || iserder.snh !== number.numh || iserder.said !== diger.qb64) {
    throw new ValidationError(`Credential source seal mismatch for ${credentialSaidValue}.`);
  }

  const telAnchor = reger.ancs.get(dgKey(credentialSaidValue, iserder.said));
  if (!telAnchor) {
    throw new ValidationError(`Credential TEL anchor missing for ${credentialSaidValue}.`);
  }

  const issuer = creder.issuer;
  if (!issuer) {
    throw new ValidationError(`Credential ${credentialSaidValue} is missing issuer.`);
  }
  const [anchorNumber, anchorDiger] = telAnchor;
  const sn = Number(anchorNumber.num);
  if (!Number.isSafeInteger(sn)) {
    throw new ValidationError(`Credential anchor sequence is too large for replay: ${anchorNumber.qb64}.`);
  }
  const replay = acceptedEventReplayMessage(hby, issuer, sn, counterProfile);
  if (replay.serder.said !== anchorDiger.qb64) {
    throw new ValidationError(
      `Credential anchor event ${replay.serder.said ?? "<missing>"} did not match ${anchorDiger.qb64}.`,
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
  sign?: boolean;
}): CredentialGrantMessage {
  const [creder] = args.reger.cloneCred(args.credentialSaid);
  const counterProfile = args.options?.counterProfile ?? "legacy";
  const artifacts = credentialPresentationArtifacts(
    args.hby,
    args.reger,
    args.credentialSaid,
    counterProfile,
  );
  const support = credentialPresentationSupportMessages(
    args.hby,
    args.reger,
    creder,
    args.recipient,
    counterProfile,
  );
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
    wire: args.sign === false ? new Uint8Array() : concatBytes(
      args.hab.endorse(grant, { pipelined: false, counterProfile }),
      attachments,
    ),
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
  reactor.processCompleteChunk(artifacts.anc);
  reactor.processCompleteChunk(artifacts.iss);
  reactor.processCompleteChunk(artifacts.acdc);
  reactor.processEscrowsOnce();
}

/** Rebuild grant-embedded `anc`, `iss`, and `acdc` streams from exchange storage. */
export function storedGrantArtifacts(
  hby: Habery,
  grant: SerderKERI,
): CredentialPresentationArtifacts {
  if (grant.route !== IPEX_GRANT_ROUTE || !grant.said) {
    throw new ValidationError(`Expected stored ${IPEX_GRANT_ROUTE} EXN.`);
  }
  const embeds = embeddedSection(grant);
  if (!embeds) {
    throw new ValidationError(`Grant ${grant.said} is missing embedded artifacts.`);
  }
  return {
    anc: concatBytes(keriRaw(embeds.anc, "anc"), pathedAttachment(hby, grant.said, "anc")),
    iss: concatBytes(keriRaw(embeds.iss, "iss"), pathedAttachment(hby, grant.said, "iss")),
    acdc: concatBytes(acdcRaw(embeds.acdc, "acdc"), pathedAttachment(hby, grant.said, "acdc")),
  };
}

export function credentialSaidFromGrant(grant: SerderKERI): string | null {
  const embeds = embeddedSection(grant);
  const acdc = embeds?.acdc;
  if (!acdc || typeof acdc !== "object" || Array.isArray(acdc)) {
    return null;
  }
  const said = (acdc as Record<string, unknown>).d;
  return typeof said === "string" ? said : null;
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

function keriRaw(value: unknown, label: string): Uint8Array {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`Grant embedded ${label} is missing.`);
  }
  return new SerderKERI({ sad: value as Record<string, unknown> }).raw;
}

function acdcRaw(value: unknown, label: string): Uint8Array {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`Grant embedded ${label} is missing.`);
  }
  return new SerderACDC({ sad: value as Record<string, unknown>, verify: false }).raw;
}

function pathedAttachment(hby: Habery, said: string, label: string): Uint8Array {
  const path = `/e/${label}`;
  for (const text of hby.db.epath.get([said])) {
    const attachment = pathedAttachmentFromRaw(textEncoder.encode(text), path);
    if (attachment) {
      return attachment;
    }
  }
  return new Uint8Array();
}

function pathedAttachmentFromRaw(raw: Uint8Array, path: string): Uint8Array | null {
  if (raw.length === 0) {
    return null;
  }
  const counter = new Counter({ qb64b: raw });
  const body = raw.slice(counter.fullSize);
  try {
    const pather = parsePather(body, "txt");
    if (pather.path === path) {
      return body.slice(pather.fullSize);
    }
  } catch {
    // A multisig wrapper can preserve the grant's own pathed-material group as
    // the counted payload. In that case unwrap one group layer and retry.
  }
  return body[0] === "-".charCodeAt(0) ? pathedAttachmentFromRaw(body, path) : null;
}
