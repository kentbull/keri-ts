import { Organizer } from "./organizing.ts";
/**
 * Credential registry and lifecycle workflow orchestration.
 *
 * CLI adapters parse inputs and render outputs. This module owns registry state,
 * credential issue/revoke/import/export,
 * and multisig VC proposal coordination.
 */
import { concatBytes, Diger, NumberPrimitive, NumDex, Prefixer, Saider, Seqner, SerderACDC, TraitDex } from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../core/errors.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../core/mailbox-topics.ts";
import { incept as inceptRegistryEvent, issue as issueEvent } from "../core/protocol-vdr-eventing.ts";
import { RegistryRecord } from "../core/records.ts";
import { Schemer } from "../core/scheming.ts";
import { Reger } from "../db/reger.ts";
import { Credentialer, CredentialWallet, Regery, Registry, serializeCredential } from "../vdr/credentialing.ts";
import type { TelProcessDecision } from "../vdr/eventing.ts";
import type { Poster } from "./forwarding.ts";
import { groupSigningMembers, isLocalGroupHab, localGroupMember } from "./group-members.ts";
import { MULTISIG_ISS_ROUTE, MULTISIG_VCP_ROUTE, type MultisigVdrProposal, prepareMultisigVdrExn } from "./grouping.ts";
import type { Hab, Habery } from "./habbing.ts";
import { credentialStreamMessages } from "./ipex-credentialing.ts";
import type { VerifierDecision } from "./verifying.ts";

import {
  type GroupDelivery,
  type GroupSendResult,
  groupSendResult,
  remoteGroupMembers,
  sendGroupMessage,
  signGroupMessage,
} from "./multisig-messaging.ts";

export interface CredentialRegistryInceptOptions {
  registryName: string;
  noBackers?: boolean;
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

/** Created registry identity, with group coordination distinct from transport and acceptance. */
export interface RegistryResult {
  name: string;
  registry: string | null;
  issuer: string;
  group?: GroupSendResult & {
    route: typeof MULTISIG_VCP_ROUTE;
    status: TelProcessDecision["kind"];
    accepted: boolean;
  };
}

/** Credential issuance facts; successful group transport does not imply saved credential state. */
export interface IssueResult {
  creder: SerderACDC;
  recipient: string;
  tel: string | null;
  status: VerifierDecision["kind"];
  group?: GroupSendResult & {
    route: typeof MULTISIG_ISS_ROUTE;
    telStatus: TelProcessDecision["kind"];
    saved: boolean;
  };
}

export interface CredentialExportResult {
  creder: SerderACDC;
  recipient: string;
  bytes: Uint8Array;
}

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
 * @param postman Borrowed Poster; its delivery worker must run while this operation awaits outcomes.
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param options Registry name/configuration and optional group proposal usage.
 * @returns Registry/proposal state and actual deliveries, with acceptance reported separately.
 */
export function* inceptCredentialRegistry(
  rgy: Regery,
  postman: Poster,
  hab: Hab,
  options: CredentialRegistryInceptOptions,
): Operation<RegistryResult> {
  const { hby } = rgy;
  if (isLocalGroupHab(hby, hab)) {
    return yield* proposeGroupRegistryIncept(rgy, postman, hab, options);
  }
  const registry = rgy.makeRegistry(options.registryName, hab, {
    noBackers: options.noBackers ?? true,
    estOnly: options.estOnly ?? false,
  });
  return {
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
 * @param postman Borrowed Poster; its delivery worker must run while this operation awaits outcomes.
 * @param options Issuer registry, credential data/schema, and optional delivery/export choices.
 * @returns Credential/TEL result with saved/accepted state distinct from delivered URLs.
 */
export function* createCredential(
  rgy: Regery,
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
    return yield* proposeGroupCredentialIssue(rgy, postman, registry, creder, recipient);
  }

  const result = credentialer.issue(registry, creder);
  return {
    creder,
    recipient,
    tel: result.tel.said,
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

/** Build a KERIpy-compatible credential stream for an already loaded credential. */
export function credentialStreamBytes(
  hby: Habery,
  reger: Reger,
  creder: SerderACDC,
  recipient: string,
): Uint8Array {
  return concatBytes(...credentialStreamMessages(hby, reger, creder, recipient));
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

/**
 * Construct a group registry inception and anchored proposal, then await member delivery.
 * Local TEL acceptance is reported separately from successful proposal transmission.
 *
 * @param rgy Borrowed registry owner and accepted state.
 * @param postman Borrowed Poster; its delivery worker must run while this operation awaits outcomes.
 * @param hab Group issuer habitat.
 * @param options Registry name and no-backers/establishment policy; group backer registries are unsupported.
 * @returns Proposal route, registry identity, TEL status and completed target deliveries.
 */
function* proposeGroupRegistryIncept(
  rgy: Regery,
  postman: Poster,
  hab: Hab,
  options: CredentialRegistryInceptOptions,
): Operation<RegistryResult> {
  const { hby, reger } = rgy;
  const noBackers = options.noBackers ?? true;
  const estOnly = options.estOnly ?? false;
  if (!noBackers) {
    throw new ValidationError("Group registry inception currently requires a no-backers registry.");
  }
  const cnfg = [
    ...(noBackers ? [TraitDex.NoBackers] : []),
    ...(estOnly ? [TraitDex.EstOnly] : []),
  ];
  const vcp = inceptRegistryEvent(hab.pre, { cnfg });
  const anchor = hby.interactGroupHab(hab.name, undefined, {
    data: [eventSeal(vcp)],
  });
  const seal = sourceSeal(anchor.serder);
  const decision = rgy.tvy.processEvent({
    serder: vcp,
    seqner: seal.seqner,
    saider: seal.saider,
  });
  rgy.processEscrows();

  const regk = requireSerderPrefix(vcp, "registry inception");
  registerRegistry(rgy, options.registryName, hab, regk, { noBackers, estOnly });
  if (telAccepted(reger, regk, 0, requireSerderSaid(vcp, "registry inception"))) {
    markTelComplete(reger, regk, 0, requireSerderSaid(vcp, "registry inception"));
  }

  const publication = yield* publishGroupVcProposal(hby, postman, hab, {
    route: MULTISIG_VCP_ROUTE,
    attrs: { gid: hab.pre, usage: options.usage ?? options.registryName },
    embeds: { vcp: vcp.raw, anc: anchor.message },
  });

  return {
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
 * @param postman Borrowed Poster; its delivery worker must run while this operation awaits outcomes.
 * @param registry Group issuer registry to anchor issuance.
 * @param creder Constructed credential to validate and bind to the TEL issue event.
 * @param recipient Resolved issuee retained for the caller's subsequent export or delivery.
 * @returns Credential/TEL decisions, saved state and completed member deliveries.
 */
function* proposeGroupCredentialIssue(
  rgy: Regery,
  postman: Poster,
  registry: Registry,
  creder: SerderACDC,
  recipient: string,
): Operation<IssueResult> {
  const { hby, reger } = rgy;
  const regk = requireRegistryKey(registry);
  const iss = issueEvent(requireCredentialSaid(creder), regk);
  const anchor = hby.interactGroupHab(registry.hab.name, undefined, {
    data: [eventSeal(iss)],
  });
  const seal = sourceSeal(anchor.serder);
  const telDecision = rgy.tvy.processEvent({
    serder: iss,
    seqner: seal.seqner,
    saider: seal.saider,
  });
  rgy.processEscrows();
  const credentialer = new Credentialer(hby, {
    reger,
    vry: rgy.vry,
  });
  credentialer.validate(creder);
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
  if (
    telAccepted(
      reger,
      requireSerderPrefix(iss, "credential issue"),
      iss.sn ?? 0,
      requireSerderSaid(iss, "credential issue"),
    )
  ) {
    markTelComplete(reger, requireCredentialSaid(creder), iss.sn ?? 0, requireSerderSaid(iss, "credential issue"));
  }

  const publication = yield* publishGroupVcProposal(hby, postman, registry.hab, {
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
 * @param proposal Registry or issuance route with its required named evidence.
 * @returns Stable proposal/wrapper identities and successful target URLs after concrete Poster completion.
 */
function* publishGroupVcProposal(
  hby: Habery,
  postman: Poster,
  groupHab: Hab,
  proposal: MultisigVdrProposal,
): Operation<GroupSendResult> {
  const member = localGroupMember(hby, groupHab.pre);
  const outcomes: GroupDelivery[] = [];
  for (const recipient of remoteGroupMembers(hby, member, groupSigningMembers(hby, groupHab.pre))) {
    const prepared = prepareMultisigVdrExn(member.pre, proposal, { recipient });
    outcomes.push(yield* sendGroupMessage(postman, signGroupMessage(member, recipient, prepared)));
  }
  return groupSendResult(outcomes);
}

function registerRegistry(
  rgy: Regery,
  name: string,
  hab: Hab,
  regk: string,
  options: { noBackers: boolean; estOnly: boolean },
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
        name,
        hab,
        reger: rgy.reger,
        tvy: rgy.tvy,
        cues: rgy.cues,
        regk,
        noBackers: options.noBackers,
        estOnly: options.estOnly,
      }),
    );
  }
}

function eventSeal(
  serder: { pre: string | null; snh?: string | null; sn: number | null; said: string | null },
): Record<string, string> {
  const pre = requireSerderPrefix(serder, "TEL event");
  const sn = serder.snh ?? (serder.sn ?? 0).toString(16);
  const dig = requireSerderSaid(serder, "TEL event");
  return { i: pre, s: sn, d: dig };
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

function seqner(num: number | bigint): Seqner {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new Seqner({ code: NumDex.Huge, raw });
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

function markTelComplete(
  reger: Reger,
  pre: string,
  sn: number,
  eventSaid: string,
): void {
  reger.ctel.pin([pre, seqner(sn).qb64], new Saider({ qb64: eventSaid }));
}
