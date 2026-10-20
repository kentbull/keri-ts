import type { Operation } from "npm:effection@^3.6.0";
/**
 * IPEX credential artifact assembly for registry-backed ACDC workflows.
 *
 * KERIpy correspondence:
 * - mirrors the byte material gathered by `vdr.credentialing.sendArtifacts`
 *   and the grant/admit command helpers
 * - keeps EXN route construction in `ipexing.ts`
 * - keeps registry, wallet, and verifier persistence in VDR modules
 */
import {
  concatBytes,
  Counter,
  parsePather,
  type Serder,
  SerderACDC,
  SerderKERI,
  type Versionage,
  Vrsn_1_0,
} from "cesr-ts";
import { resolveAttachmentGvrsn } from "../core/attachment-countering.ts";
import { ValidationError } from "../core/errors.ts";
import { dgKey } from "../db/core/keys.ts";
import type { Reger } from "../db/reger.ts";
import { CredentialWallet, serializeCredential } from "../vdr/credentialing.ts";
import { chunkBytes } from "./byte-source.ts";
import { acceptedEventReplayMessage, type Hab, type Habery } from "./habbing.ts";
import { IPEX_GRANT_ROUTE, ipexAdmitExn, type IpexBuilderOptions, ipexGrantExn } from "./ipexing.ts";
import { processMessages } from "./message-source.ts";
import type { ProtocolProcessor } from "./protocol-processing.ts";

const textEncoder = new TextEncoder();

/** Body-first embedded bytes plus the context needed to parse their attachments. */
export interface CredentialArtifact {
  wire: Uint8Array;
  genus: Versionage;
}

/** Grant-embedded presentation streams required by KERIpy verifier import. */
export interface CredentialPresentationArtifacts {
  /** ACDC body plus its SealSourceTriples proof attachment. */
  acdc: CredentialArtifact;
  /** Credential TEL issue/revoke stream message for the presented ACDC. */
  iss: CredentialArtifact;
  /** Issuer KEL event that anchors `iss`. */
  anc: CredentialArtifact;
}

/** Complete `/ipex/grant` message plus credential support material. */
export interface CredentialGrantMessage {
  grant: SerderKERI;
  attachments: Uint8Array;
  wire: Uint8Array;
  artifacts: CredentialPresentationArtifacts;
  support: Uint8Array[];
}

/** Complete `/ipex/admit` response message for an accepted credential grant. */
export interface CredentialAdmitMessage {
  admit: SerderKERI;
  attachments: Uint8Array;
  wire: Uint8Array;
}

/** Builder options for credential-bearing grants. */
export interface IpexCredentialGrantOptions extends IpexBuilderOptions {
  agree?: SerderKERI | null;
}

/** Builder options for grant admits and holder-side save behavior. */
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
  messages.push(...hby.db.clonePreIter(issuer, 0));

  const issuee = credentialIssuee(creder);
  if (issuee && issuee !== recipient) {
    const issueeKever = hby.db.getKever(issuee);
    if (!issueeKever) {
      throw new ValidationError(`Missing issuee KEL state for ${issuee}.`);
    }
    messages.push(...hby.db.cloneDelegation(issueeKever));
    messages.push(...hby.db.clonePreIter(issuee, 0));
  }

  const registry = creder.regid;
  if (registry) {
    messages.push(...reger.clonePreIter(registry, 0));
  }

  const said = credentialSaid(creder);
  messages.push(...reger.clonePreIter(said, 0));
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
  gvrsn: Versionage = Vrsn_1_0,
): Uint8Array[] {
  return [
    ...credentialPresentationSupportMessages(
      hby,
      reger,
      creder,
      recipient,
      gvrsn,
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
  gvrsn: Versionage = Vrsn_1_0,
): Uint8Array[] {
  const messages = credentialSupportMessages(
    hby,
    reger,
    creder,
    recipient,
  );
  for (const [source, atc] of reger.sources(hby.db, creder, gvrsn)) {
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
  gvrsn: Versionage = Vrsn_1_0,
): CredentialPresentationArtifacts {
  const [creder, prefixer, number, diger] = reger.cloneCred(credentialSaidValue);
  const acdc = serializeCredential(creder, prefixer, number, diger, gvrsn);
  const iss = reger.cloneTvtAt(credentialSaidValue, 0, gvrsn);
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
  const replay = acceptedEventReplayMessage(hby, issuer, sn, gvrsn);
  if (replay.serder.said !== anchorDiger.qb64) {
    throw new ValidationError(
      `Credential anchor event ${replay.serder.said ?? "<missing>"} did not match ${anchorDiger.qb64}.`,
    );
  }

  return {
    acdc: { wire: acdc, genus: resolveAttachmentGvrsn(creder, gvrsn) },
    iss: { wire: iss, genus: resolveAttachmentGvrsn(iserder, gvrsn) },
    anc: { wire: replay.message, genus: resolveAttachmentGvrsn(replay.serder, gvrsn) },
  };
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
  const gvrsn = args.options?.gvrsn ?? Vrsn_1_0;
  const artifacts = credentialPresentationArtifacts(
    args.hby,
    args.reger,
    args.credentialSaid,
    gvrsn,
  );
  const support = credentialPresentationSupportMessages(
    args.hby,
    args.reger,
    creder,
    args.recipient,
    gvrsn,
  );
  const [grant, attachments] = ipexGrantExn(
    args.hab,
    args.recipient,
    args.message ?? "",
    artifacts.acdc.wire,
    {
      ...(args.options ?? {}),
      iss: artifacts.iss.wire,
      anc: artifacts.anc.wire,
      agree: args.options?.agree ?? null,
    },
  );
  return {
    grant,
    attachments,
    wire: args.sign === false ? new Uint8Array() : concatBytes(
      args.hab.endorse(grant, { pipelined: false, gvrsn }),
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
    wire: concatBytes(
      args.hab.endorse(admit, { pipelined: false, gvrsn: args.options?.gvrsn ?? undefined }),
      attachments,
    ),
  };
}

/**
 * Parse grant-embedded artifacts in KERIpy admit order: `anc`, `iss`, `acdc`.
 *
 * @param protocol Borrowed shared protocol processor; this operation owns its parser and input-specific Kevery.
 * @param artifacts Grant-embedded anchor, issuance and credential streams in their named fields.
 */
export function* processCredentialPresentationArtifacts(
  protocol: ProtocolProcessor,
  artifacts: CredentialPresentationArtifacts,
): Operation<void> {
  const kvy = protocol.makeKevery();
  // Each artifact carries its own attachment genus; finish its dispatch before opening the next.
  for (const artifact of [artifacts.anc, artifacts.iss, artifacts.acdc]) {
    const bytes = concatBytes(Counter.makeGVC(artifact.genus), artifact.wire);
    yield* processMessages((signal) => chunkBytes(bytes, { signal }), protocol, kvy);
  }
  // Recurring IPEX/verifier callers retain their existing single-pass escrow scheduling.
  yield* protocol.processEscrowsOnce();
}

/** Rebuild grant-embedded `anc`, `iss`, and `acdc` streams from exchange storage. */
export function storedGrantArtifacts(
  hby: Habery,
  grant: SerderKERI,
  gvrsn: Versionage = Vrsn_1_0,
): CredentialPresentationArtifacts {
  if (grant.route !== IPEX_GRANT_ROUTE || !grant.said) {
    throw new ValidationError(`Expected stored ${IPEX_GRANT_ROUTE} EXN.`);
  }
  const embeds = embeddedSection(grant);
  if (!embeds) {
    throw new ValidationError(`Grant ${grant.said} is missing embedded artifacts.`);
  }
  return {
    anc: storedArtifact(keriBody(embeds.anc, "anc"), pathedAttachment(hby, grant.said, "anc"), gvrsn),
    iss: storedArtifact(keriBody(embeds.iss, "iss"), pathedAttachment(hby, grant.said, "iss"), gvrsn),
    acdc: storedArtifact(acdcBody(embeds.acdc, "acdc"), pathedAttachment(hby, grant.said, "acdc"), gvrsn),
  };
}

/** Extract the embedded credential SAID from an accepted `/ipex/grant`. */
export function credentialSaidFromGrant(grant: SerderKERI): string | null {
  const embeds = embeddedSection(grant);
  const acdc = embeds?.acdc;
  if (!isRecord(acdc)) return null;
  const said = acdc.d;
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
  if (isRecord(attrib)) {
    const issuee = attrib.i;
    return typeof issuee === "string" ? issuee : null;
  }
  return null;
}

/** Project only grant children; protocol readers below own body reconstruction. */
function embeddedSection(serder: SerderKERI): { anc: unknown; iss: unknown; acdc: unknown } | null {
  const ked = serder.ked;
  if (!ked) return null;
  const embeds = isRecord(ked.e) ? ked.e : isRecord(ked.a) && isRecord(ked.a.e) ? ked.a.e : null;
  return embeds ? { anc: embeds.anc, iss: embeds.iss, acdc: embeds.acdc } : null;
}

/** Wire/schema-defined SAD keys remain unknown until a named-field check or Serder validates them. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keriBody(value: unknown, label: string): SerderKERI {
  if (!isRecord(value)) {
    throw new ValidationError(`Grant embedded ${label} is missing.`);
  }
  return new SerderKERI({ sad: value });
}

function acdcBody(value: unknown, label: string): SerderACDC {
  if (!isRecord(value)) {
    throw new ValidationError(`Grant embedded ${label} is missing.`);
  }
  return new SerderACDC({ sad: value, verify: false });
}

/** Use the receiver-configured child genus; legacy parent framing does not determine it. */
function storedArtifact(body: Serder, attachment: Uint8Array, gvrsn: Versionage): CredentialArtifact {
  return { wire: concatBytes(body.raw, attachment), genus: resolveAttachmentGvrsn(body, gvrsn) };
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
