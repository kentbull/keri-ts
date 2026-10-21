/**
 * Credential registry and lifecycle workflow orchestration.
 *
 * CLI adapters parse inputs and render outputs. This module owns registry state,
 * credential issuance/import/export,
 * and multisig VC proposal coordination.
 */
import {
  concatBytes,
  Diger,
  NumberPrimitive,
  NumDex,
  Prefixer,
  SerderACDC,
  type SerderKERI,
  TraitDex,
} from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { incept as inceptRegistryEvent, issue as issueEvent } from "../../core/protocol-vdr-eventing.ts";
import { RegistryRecord } from "../../core/records.ts";
import { Schemer } from "../../core/scheming.ts";
import { Reger } from "../../db/reger.ts";
import { Credentialer, CredentialWallet, Regery, Registry, serializeCredential } from "../../vdr/credentialing.ts";
import { type TelProcessDecision, validateRegistryInception } from "../../vdr/eventing.ts";
import type { Poster } from "../delivery/forwarding.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { credentialStreamMessages } from "../ipex/ipex-credentialing.ts";
import { groupSigningMembers, isLocalGroupHab, localGroupMember } from "../multisig/group-members.ts";
import {
  MULTISIG_ISS_ROUTE,
  MULTISIG_VCP_ROUTE,
  type MultisigVdrProposal,
  prepareMultisigVdrExn,
} from "../multisig/grouping.ts";
import type { Reactor } from "../protocol/reactor.ts";
import {
  validateCredentialIssueProposal,
  validateRegistryName,
} from "./credential-proposals.ts";
import type { VerifierDecision } from "./verifying.ts";

import {
  admitAndSendGroupMessage,
  type GroupDelivery,
  type GroupSendResult,
  groupSendResult,
  prepareGroupMessage,
  remoteGroupMembers,
} from "../multisig/multisig-messaging.ts";

export interface CredentialRegistryInceptOptions {
  registryName: string;
  estOnly?: boolean;
  usage?: string;
}

export interface CredentialCreateOptions {
  registryName: string;
  schema: string;
  recipient?: string;
  data: Record<string, unknown> | string;
  edges?: Record<string, unknown> | Record<string, unknown>[];
  rules?: Record<string, unknown> | Record<string, unknown>[];
}

export interface CredentialListOptions {
  issued?: boolean;
  aid?: string;
  schema?: string;
}

export interface CredentialListItem {
  said: string;
  issuer: string | null;
  issuee: string | null;
  schema: string | null;
  status: string | null;
}

/**
 * Registry creation/proposal facts for one operation. The same result shape
 * covers single-author and group paths; group adds coordination facts without
 * changing registry identity into a different variant. Consumers must distinguish
 * successful member delivery from accepted registry state.
 */
export interface RegistryResult {
  /** Completed local witness collection and TEL publication; never remote acknowledgement. */
  publicationComplete: boolean;
  name: string;
  /** Registry identifier when constructed; null if this operation has none to report. */
  registry: string | null;
  /** Registry controller AID; may identify a group rather than the signing member. */
  issuer: string;
  /** Present for group coordination, with acceptance assessed separately from sending. */
  group?: GroupSendResult & {
    route: typeof MULTISIG_VCP_ROUTE;
    status: TelProcessDecision["kind"];
    accepted: boolean;
  };
}

/**
 * Credential issuance facts, leaving JSON projection to the command adapter.
 * A constructed ACDC and successful transport do not establish accepted TEL or
 * saved verifier state. Those results are reported independently below.
 */
export interface IssueResult {
  /** TEL publication is independent of credential saving and member transport outcomes. */
  publicationComplete: boolean;
  /** Constructed credential; ordinary Serder data remains usable after store closure. */
  creder: SerderACDC;
  /** Resolved issuee retained for later export/delivery, not a transport endpoint. */
  recipient: string;
  /** Issuance TEL event SAID, when available. */
  tel: string | null;
  /** Credential verifier decision for this issuance attempt. */
  status: VerifierDecision["kind"];
  group?: GroupSendResult & {
    route: typeof MULTISIG_ISS_ROUTE;
    /** Registry event processor decision, independent of the credential verifier decision. */
    telStatus: TelProcessDecision["kind"];
    /** Whether the credential is actually saved; sending a proposal does not make it so. */
    saved: boolean;
  };
}

export interface CredentialExportResult {
  creder: SerderACDC;
  recipient: string;
  bytes: Uint8Array;
}

/** Pin a JSON schema body into the local schema table. */
export function pinSchemaBytes(hby: Habery, raw: Uint8Array): string {
  const schemer = new Schemer({ raw });
  hby.db.schema.pin(schemer.said, schemer);
  return schemer.said;
}

/**
 * Create a single-sig registry or propose a group registry inception.
 *
 * @param rgy Borrowed legacy registry/credential owner.
 * @param input Borrowed byte intake; commits each exact local wrapper before peer delivery.
 * @param postman Borrowed Poster; its delivery worker must run while this operation awaits outcomes.
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param options Registry name/configuration and optional group proposal usage.
 * @returns Registry/proposal state and actual deliveries, with acceptance reported separately.
 */
export function* inceptCredentialRegistry(
  rgy: Regery,
  input: Reactor,
  postman: Poster,
  hab: Hab,
  options: CredentialRegistryInceptOptions,
): Operation<RegistryResult> {
  const { hby } = rgy;
  validateRegistryName(rgy.reger, options.registryName);
  if (isLocalGroupHab(hby, hab)) {
    return yield* proposeGroupRegistryIncept(rgy, input, postman, hab, options);
  }
  const registry = rgy.makeRegistry(options.registryName, hab, {
    estOnly: options.estOnly ?? false,
  });
  return {
    publicationComplete: rgy.publication.complete(registry.regk!),
    name: options.registryName,
    registry: registry.regk,
    issuer: hab.pre,
  };
}

/** Return locally known credential registry records. */
export function credentialRegistryRecords(
  reger: Reger,
): Array<{ name: string | undefined; registry: string; issuer: string }> {
  const records: Array<{ name: string | undefined; registry: string; issuer: string }> = [];
  for (const [keys, record] of reger.regs.getTopItemIter()) {
    records.push({
      name: keys[0],
      registry: record.registryKey,
      issuer: record.prefix,
    });
  }
  return records;
}

/** Return current TEL status for one local registry name. */
export function credentialRegistryStatus(rgy: Regery, registryName: string) {
  const record = rgy.reger.regs.get(registryName);
  if (!record?.registryKey) {
    throw new ValidationError(`Registry ${registryName} not found.`);
  }
  const tever = rgy.tvy.tevers.get(record.registryKey);
  return {
    name: registryName,
    registry: record.registryKey,
    issuer: record.prefix,
    state: tever?.state() ?? null,
  };
}

/**
 * Create and issue one registry-backed credential.
 *
 * @param rgy Borrowed registry/TEL/credential owner.
 * @param input Borrowed byte intake; commits each exact local wrapper before peer delivery.
 * @param postman Borrowed Poster; its delivery worker must run while this operation awaits outcomes.
 * @param options Issuer registry, credential data/schema, and optional delivery/export choices.
 * @returns Credential/TEL result with saved/accepted state distinct from delivered URLs.
 */
export function* createCredential(
  rgy: Regery,
  input: Reactor,
  postman: Poster,
  options: CredentialCreateOptions,
): Operation<IssueResult> {
  const { hby, reger } = rgy;
  const registry = requireRegistry(rgy, options.registryName);
  const credentialer = new Credentialer(hby, {
    reger,
    vry: rgy.vry,
  });
  const creder = credentialer.create({
    registry,
    schema: options.schema,
    recipient: options.recipient,
    data: options.data,
    edges: options.edges,
    rules: options.rules,
  });
  const recipient = options.recipient ?? creder.issuee ?? "";

  if (isLocalGroupHab(hby, registry.hab)) {
    return yield* proposeGroupCredentialIssue(rgy, input, postman, registry, creder, recipient);
  }

  const result = credentialer.issue(registry, creder);
  return {
    creder,
    recipient,
    tel: result.tel.said,
    publicationComplete: rgy.publication.complete(creder.said!),
    status: result.verifierDecision.kind,
  };
}

/** List locally saved credentials through wallet indexes. */
export function listCredentials(
  rgy: Regery,
  options: CredentialListOptions,
): CredentialListItem[] {
  const { reger } = rgy;
  const wallet = new CredentialWallet(reger);
  const tvy = rgy.tvy;
  return wallet.list({ issued: options.issued ?? false, aid: options.aid, schema: options.schema }).map((said) => {
    const [creder] = reger.cloneCred(said);
    const tever = creder.regid ? tvy.tevers.get(creder.regid) : null;
    return {
      said,
      issuer: creder.issuer,
      issuee: creder.issuee,
      schema: typeof creder.schema === "string" ? creder.schema : null,
      status: tever?.vcState(said)?.et ?? null,
    };
  });
}

/** Build a KERIpy-compatible credential export stream. */
export function exportCredentialStream(
  hby: Habery,
  reger: Reger,
  credentialSaid: string,
  recipient?: string,
): CredentialExportResult {
  const [creder] = reger.cloneCred(credentialSaid);
  const resolvedRecipient = recipient ?? creder.issuee ?? "";
  return {
    creder,
    recipient: resolvedRecipient,
    bytes: credentialStreamBytes(hby, reger, creder, resolvedRecipient),
  };
}

/** Build a KERIpy-compatible credential stream for an already loaded credential. */
export function credentialStreamBytes(
  hby: Habery,
  reger: Reger,
  creder: SerderACDC,
  recipient: string,
): Uint8Array {
  return concatBytes(...credentialStreamMessages(hby, reger, creder, recipient));
}

/** Author the required group anchor after all available business evidence has been validated. */
export function anchorGroupCredentialEvent(hby: Habery, hab: Hab, event: SerderKERI, estOnly: boolean) {
  const data = [{ i: event.pre!, s: event.snh!, d: event.said! }];
  if (estOnly || hab.kever?.estOnly) return hby.rotateGroupHab(hab.name, undefined, undefined, { data });
  return hby.interactGroupHab(hab.name, undefined, { data });
}

/**
 * Construct a group registry inception and anchored proposal, then await member delivery.
 * Local TEL acceptance is reported separately from successful proposal transmission.
 *
 * @param rgy Borrowed registry owner and accepted state.
 * @param input Borrowed byte intake; commits each exact local wrapper before peer delivery.
 * @param postman Borrowed Poster; its delivery worker must run while this operation awaits outcomes.
 * @param hab Group issuer habitat.
 * @param options Registry name and establishment policy; local authoring always uses NoBackers.
 * @returns Proposal route, registry identity, TEL status and completed target deliveries.
 */
function* proposeGroupRegistryIncept(
  rgy: Regery,
  input: Reactor,
  postman: Poster,
  hab: Hab,
  options: CredentialRegistryInceptOptions,
): Operation<RegistryResult> {
  const { hby, reger } = rgy;
  const estOnly = options.estOnly ?? false;
  const cnfg = [
    TraitDex.NoBackers,
    ...(estOnly ? [TraitDex.EstOnly] : []),
  ];
  const vcp = inceptRegistryEvent(hab.pre, { cnfg });
  validateRegistryInception(vcp);
  const anchor = anchorGroupCredentialEvent(hby, hab, vcp, estOnly);
  const seal = sourceSeal(anchor.serder);
  const decision = rgy.tvy.processEvent({
    serder: vcp,
    seqner: seal.seqner,
    saider: seal.saider,
  });
  rgy.processEscrows();

  const regk = requireSerderPrefix(vcp, "registry inception");
  registerRegistry(rgy, options.registryName, hab, regk, { estOnly });
  rgy.publication.track(vcp, anchor.serder);

  const publication = yield* publishGroupVcProposal(hby, input, postman, hab, {
    route: MULTISIG_VCP_ROUTE,
    attrs: { gid: hab.pre, usage: options.usage ?? options.registryName },
    embeds: { vcp: vcp.raw, anc: anchor.message },
  });

  return {
    publicationComplete: rgy.publication.complete(regk),
    name: options.registryName,
    registry: regk,
    issuer: hab.pre,
    group: {
      route: MULTISIG_VCP_ROUTE,
      status: decision.kind,
      accepted: telAccepted(reger, regk, 0, requireSerderSaid(vcp, "registry inception")),
      ...publication,
    },
  };
}

/**
 * Prepare group issuance evidence and publish it to remote signing members.
 * Return protocol status separately from transport delivery; peer signature
 * collection may still be incomplete.
 *
 * @param rgy Borrowed registry and credential verification owner.
 * @param input Borrowed byte intake; commits each exact local wrapper before peer delivery.
 * @param postman Borrowed Poster; its delivery worker must run while this operation awaits outcomes.
 * @param registry Group issuer registry to anchor issuance.
 * @param creder Constructed credential to validate and bind to the TEL issue event.
 * @param recipient Resolved issuee retained for the caller's subsequent export or delivery.
 * @returns Credential/TEL decisions, saved state and completed member deliveries.
 */
function* proposeGroupCredentialIssue(
  rgy: Regery,
  input: Reactor,
  postman: Poster,
  registry: Registry,
  creder: SerderACDC,
  recipient: string,
): Operation<IssueResult> {
  const { hby, reger } = rgy;
  const regk = requireRegistryKey(registry);
  const iss = issueEvent(requireCredentialSaid(creder), regk);
  if (!validateCredentialIssueProposal(rgy, registry.hab.pre, creder, iss)) {
    throw new ValidationError("Credential issuance is missing accepted registry or schema evidence.");
  }
  const estOnly = registry.estOnly || (reger.states.get(regk)?.c ?? []).includes(TraitDex.EstOnly);
  const anchor = anchorGroupCredentialEvent(hby, registry.hab, iss, estOnly);
  const seal = sourceSeal(anchor.serder);
  const telDecision = rgy.tvy.processEvent({
    serder: iss,
    seqner: seal.seqner,
    saider: seal.saider,
  });
  rgy.processEscrows();
  const credentialSeal = telCredentialSeal(iss);
  const verifierDecision = rgy.vry.processCredential({
    creder,
    prefixer: credentialSeal.prefixer,
    seqner: credentialSeal.seqner,
    saider: credentialSeal.saider,
  });
  if (verifierDecision.kind === "accept") {
    reger.ccrd.pin(requireCredentialSaid(creder), creder);
  }
  rgy.vry.processEscrows();
  rgy.publication.track(iss, anchor.serder);

  const publication = yield* publishGroupVcProposal(hby, input, postman, registry.hab, {
    route: MULTISIG_ISS_ROUTE,
    attrs: { gid: registry.hab.pre },
    embeds: {
      acdc: serializeCredential(
        creder,
        credentialSeal.prefixer,
        credentialSeal.seqner,
        credentialSeal.saider,
      ),
      iss: iss.raw,
      anc: anchor.message,
    },
  });

  return {
    creder,
    recipient,
    tel: iss.said,
    publicationComplete: rgy.publication.complete(creder.said!),
    status: verifierDecision.kind,
    group: {
      route: MULTISIG_ISS_ROUTE,
      telStatus: telDecision.kind,
      saved: credentialSaved(reger, creder),
      ...publication,
    },
  };
}

/**
 * Send one signed proposal per remote signing member and await each delivery.
 * Local members are skipped; a failed outcome throws before reporting success.
 *
 * @param hby Borrowed local identities and accepted-state stores.
 * @param postman Borrowed Poster; its delivery worker must run while this operation awaits outcomes.
 * @param groupHab Group issuer habitat whose remote signing members receive the proposal.
 * @param proposal Registry, issuance or revocation route with its required named evidence.
 * @returns Stable proposal/wrapper identities and successful target URLs after concrete Poster completion.
 */
export function* publishGroupVcProposal(
  hby: Habery,
  input: Reactor,
  postman: Poster,
  groupHab: Hab,
  proposal: MultisigVdrProposal,
): Operation<GroupSendResult> {
  const member = localGroupMember(hby, groupHab.pre);
  const outcomes: GroupDelivery[] = [];
  for (const recipient of remoteGroupMembers(hby, member, groupSigningMembers(hby, groupHab.pre))) {
    const prepared = prepareMultisigVdrExn(member.pre, proposal, { recipient });
    const signed = yield* prepareGroupMessage(input.protocol.exc, member, recipient, prepared);
    outcomes.push(yield* admitAndSendGroupMessage(input, postman, signed));
  }
  return groupSendResult(outcomes);
}

function registerRegistry(
  rgy: Regery,
  name: string,
  hab: Hab,
  regk: string,
  options: { estOnly: boolean },
): void {
  rgy.reger.registries.add(regk);
  rgy.reger.regs.pin(
    name,
    new RegistryRecord({
      registryKey: regk,
      prefix: hab.pre,
    }),
  );
  if (!rgy.registries.has(name)) {
    rgy.registries.set(
      name,
      new Registry({
        publication: rgy.publication,
        name,
        hab,
        reger: rgy.reger,
        tvy: rgy.tvy,
        cues: rgy.cues,
        regk,
        estOnly: options.estOnly,
      }),
    );
  }
}

function sourceSeal(serder: { pre: string | null; sn: number | null; said: string | null }) {
  return {
    prefixer: new Prefixer({ qb64: requireSerderPrefix(serder, "anchor event") }),
    seqner: ordinal(serder.sn ?? 0),
    saider: new Diger({ qb64: requireSerderSaid(serder, "anchor event") }),
  };
}

function telCredentialSeal(serder: { pre: string | null; sn: number | null; said: string | null }) {
  return {
    prefixer: new Prefixer({ qb64: requireSerderPrefix(serder, "credential TEL event") }),
    seqner: ordinal(serder.sn ?? 0),
    saider: new Diger({ qb64: requireSerderSaid(serder, "credential TEL event") }),
  };
}

function ordinal(num: number | bigint): NumberPrimitive {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new NumberPrimitive({ code: NumDex.Huge, raw });
}

function requireRegistry(rgy: Regery, name: string): Registry {
  const registry = rgy.registryByName(name);
  if (!registry) {
    throw new ValidationError(`Registry ${name} not found.`);
  }
  return registry;
}

function requireRegistryKey(registry: Registry): string {
  if (!registry.regk) {
    throw new ValidationError(`Registry ${registry.name} has not been incepted.`);
  }
  return registry.regk;
}

function requireCredentialSaid(creder: SerderACDC): string {
  if (!creder.said) {
    throw new ValidationError("Credential is missing SAID.");
  }
  return creder.said;
}

function credentialSaved(reger: Reger, creder: SerderACDC): boolean {
  const said = requireCredentialSaid(creder);
  return reger.saved.get([said]) !== null || reger.ccrd.get(said) !== null;
}

function requireSerderPrefix(
  serder: { pre: string | null },
  label: string,
): string {
  if (!serder.pre) {
    throw new ValidationError(`${label} is missing prefix.`);
  }
  return serder.pre;
}

function requireSerderSaid(
  serder: { said: string | null },
  label: string,
): string {
  if (!serder.said) {
    throw new ValidationError(`${label} is missing SAID.`);
  }
  return serder.said;
}

function telAccepted(
  reger: Reger,
  pre: string,
  sn: number,
  eventSaid: string,
): boolean {
  return reger.tels.getOn(pre, sn)?.qb64 === eventSaid;
}
