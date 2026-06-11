/**
 * Credential registry and lifecycle workflow orchestration.
 *
 * CLI adapters parse inputs and render outputs. This module owns VDR runtime
 * service validation, registry state, credential issue/revoke/import/export,
 * and multisig VC proposal coordination.
 */
import { type Operation } from "npm:effection@^3.6.0";
import {
  concatBytes,
  Diger,
  NumberPrimitive,
  NumDex,
  Prefixer,
  Saider,
  Seqner,
  SerderACDC,
  TraitDex,
} from "../../../cesr/mod.ts";
import { ValidationError } from "../core/errors.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../core/mailbox-topics.ts";
import { incept as inceptRegistryEvent, issue as issueEvent } from "../core/protocol-vdr-eventing.ts";
import { RegistryRecord } from "../core/records.ts";
import { Schemer } from "../core/scheming.ts";
import { Reger } from "../db/reger.ts";
import { Credentialer, CredentialWallet, Regery, Registry, serializeCredential } from "../vdr/credentialing.ts";
import { Tevery } from "../vdr/eventing.ts";
import { type AgentRuntime, settleRuntimeIngress } from "./agent-runtime.ts";
import type { ExchangeDeliveryPreference } from "./forwarding.ts";
import { groupSigningMembers, isLocalGroupHab, localGroupMember } from "./group-members.ts";
import { MULTISIG_ISS_ROUTE, MULTISIG_VCP_ROUTE } from "./grouping.ts";
import type { Hab, Habery } from "./habbing.ts";
import { credentialStreamMessages } from "./ipex-credentialing.ts";
import { Verifier } from "./verifying.ts";

const MULTISIG_TOPIC = "multisig";

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

export interface CredentialCreateResult {
  creder: SerderACDC;
  recipient: string;
  output: Record<string, unknown>;
}

export interface CredentialExportResult {
  creder: SerderACDC;
  recipient: string;
  bytes: Uint8Array;
}

export interface CredentialImportResult {
  saved: string[];
}

export interface CredentialRevokeOptions {
  registryName: string;
  credentialSaid: string;
  sendRecipients?: readonly string[];
  senderHab?: Hab;
  delivery?: ExchangeDeliveryPreference;
}

export interface CredentialRevokeResult {
  creder: SerderACDC;
  said: string;
  tel: string | null;
  status: string;
  deliveries: string[];
  queued: string[];
}

/** Pin a JSON schema body into the local schema table. */
export function pinSchemaBytes(hby: Habery, raw: Uint8Array): string {
  const schemer = new Schemer({ raw });
  hby.db.schema.pin(schemer.said, schemer);
  return schemer.said;
}

/** Create a single-sig registry or propose a group registry inception. */
export function* inceptCredentialRegistry(
  hby: Habery,
  runtime: AgentRuntime,
  hab: Hab,
  options: CredentialRegistryInceptOptions,
) {
  const rgy = requireRegery(runtime);
  if (isLocalGroupHab(hby, hab)) {
    return yield* proposeGroupRegistryIncept(hby, runtime, rgy, hab, options);
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
export function credentialRegistryStatus(runtime: AgentRuntime, reger: Reger, registryName: string) {
  const record = reger.regs.get(registryName);
  if (!record?.registryKey) {
    throw new ValidationError(`Registry ${registryName} not found.`);
  }
  const tever = requireTevery(runtime).tevers.get(record.registryKey);
  return {
    name: registryName,
    registry: record.registryKey,
    issuer: record.prefix,
    state: tever?.state() ?? null,
  };
}

/** Create and issue one registry-backed credential. */
export function* createCredential(
  hby: Habery,
  runtime: AgentRuntime,
  reger: Reger,
  options: CredentialCreateOptions,
): Operation<CredentialCreateResult> {
  const rgy = requireRegery(runtime);
  const registry = requireRegistry(rgy, options.registryName);
  const credentialer = new Credentialer(hby, {
    reger,
    vry: requireVerifier(runtime),
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
    const output = yield* proposeGroupCredentialIssue(hby, runtime, reger, registry, creder);
    return { creder, recipient, output };
  }

  const result = credentialer.issue(registry, creder);
  return {
    creder,
    recipient,
    output: {
      said: creder.said,
      registry: creder.regid,
      issuer: creder.issuer,
      issuee: creder.issuee,
      schema: creder.schema,
      tel: result.tel.said,
      status: result.verifierDecision.kind,
    },
  };
}

/** List locally saved credentials through wallet indexes. */
export function listCredentials(
  runtime: AgentRuntime,
  reger: Reger,
  options: CredentialListOptions,
): CredentialListItem[] {
  const wallet = new CredentialWallet(reger);
  const tvy = requireTevery(runtime);
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

/** Import one CESR credential stream and return newly saved credential SAIDs. */
export function importCredentialStream(
  runtime: AgentRuntime,
  reger: Reger,
  bytes: Uint8Array,
): CredentialImportResult {
  const before = savedCredentials(reger);
  settleRuntimeIngress(runtime, [bytes]);
  runtime.reactor.processEscrowsOnce();
  return { saved: [...savedCredentials(reger)].filter((said) => !before.has(said)) };
}

/** Revoke one credential and optionally deliver revocation stream bytes. */
export function* revokeCredential(
  hby: Habery,
  runtime: AgentRuntime,
  reger: Reger,
  options: CredentialRevokeOptions,
): Operation<CredentialRevokeResult> {
  const registry = requireRegistry(requireRegery(runtime), options.registryName);
  const result = registry.revoke(options.credentialSaid);
  const [creder] = reger.cloneCred(options.credentialSaid);
  const deliveries: string[] = [];
  const queued: string[] = [];

  if ((options.sendRecipients?.length ?? 0) > 0) {
    if (!options.senderHab) {
      throw new ValidationError("Revocation sender habitat is required when sending revocation events.");
    }
    const messages = revocationStreamMessages(hby, reger, creder);
    for (const recipient of options.sendRecipients ?? []) {
      for (const message of messages) {
        const sent = yield* runtime.poster.sendBytes(options.senderHab, {
          recipient,
          message,
          topic: CREDENTIAL_MAILBOX_TOPIC,
          delivery: options.delivery,
        });
        deliveries.push(...sent.deliveries);
        queued.push(...sent.queued);
      }
    }
  }

  return {
    creder,
    said: options.credentialSaid,
    tel: result.serder.said,
    status: result.decision.kind,
    deliveries,
    queued,
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

function* proposeGroupRegistryIncept(
  hby: Habery,
  runtime: AgentRuntime,
  rgy: Regery,
  hab: Hab,
  options: CredentialRegistryInceptOptions,
) {
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
  const decision = requireTevery(runtime).processEvent({
    serder: vcp,
    seqner: seal.seqner,
    saider: seal.saider,
  });
  requireRegery(runtime).processEscrows();

  const regk = requireSerderPrefix(vcp, "registry inception");
  registerRegistry(rgy, options.registryName, hab, regk, { noBackers, estOnly });
  if (telAccepted(runtime, regk, 0, requireSerderSaid(vcp, "registry inception"))) {
    markTelComplete(runtime, regk, 0, requireSerderSaid(vcp, "registry inception"));
  }

  const deliveries = yield* publishGroupVcProposal(runtime, hab, MULTISIG_VCP_ROUTE, {
    gid: hab.pre,
    usage: options.usage ?? options.registryName ?? "credential registry",
  }, {
    vcp: vcp.raw,
    anc: anchor.message,
  });

  return {
    name: options.registryName,
    registry: regk,
    issuer: hab.pre,
    route: MULTISIG_VCP_ROUTE,
    status: decision.kind,
    accepted: telAccepted(runtime, regk, 0, requireSerderSaid(vcp, "registry inception")),
    deliveries,
  };
}

function* proposeGroupCredentialIssue(
  hby: Habery,
  runtime: AgentRuntime,
  reger: Reger,
  registry: Registry,
  creder: SerderACDC,
) {
  const regk = requireRegistryKey(registry);
  const iss = issueEvent(requireCredentialSaid(creder), regk);
  const anchor = hby.interactGroupHab(registry.hab.name, undefined, {
    data: [eventSeal(iss)],
  });
  const seal = sourceSeal(anchor.serder);
  const telDecision = requireTevery(runtime).processEvent({
    serder: iss,
    seqner: seal.seqner,
    saider: seal.saider,
  });
  requireRegery(runtime).processEscrows();
  const credentialer = new Credentialer(hby, {
    reger,
    vry: requireVerifier(runtime),
  });
  credentialer.validate(creder);
  const credentialSeal = telCredentialSeal(iss);
  const verifierDecision = requireVerifier(runtime).processCredential({
    creder,
    prefixer: credentialSeal.prefixer,
    seqner: credentialSeal.seqner,
    saider: credentialSeal.saider,
  });
  if (verifierDecision.kind === "accept") {
    reger.ccrd.pin(requireCredentialSaid(creder), creder);
  }
  requireVerifier(runtime).processEscrows();
  if (
    telAccepted(
      runtime,
      requireSerderPrefix(iss, "credential issue"),
      iss.sn ?? 0,
      requireSerderSaid(iss, "credential issue"),
    )
  ) {
    markTelComplete(runtime, requireCredentialSaid(creder), iss.sn ?? 0, requireSerderSaid(iss, "credential issue"));
  }

  const deliveries = yield* publishGroupVcProposal(runtime, registry.hab, MULTISIG_ISS_ROUTE, {
    gid: registry.hab.pre,
  }, {
    acdc: serializeCredential(
      creder,
      credentialSeal.prefixer,
      credentialSeal.seqner,
      credentialSeal.saider,
    ),
    iss: iss.raw,
    anc: anchor.message,
  });

  return {
    said: creder.said,
    registry: creder.regid,
    issuer: creder.issuer,
    issuee: creder.issuee,
    schema: creder.schema,
    tel: iss.said,
    route: MULTISIG_ISS_ROUTE,
    status: verifierDecision.kind,
    telStatus: telDecision.kind,
    saved: credentialSaved(reger, creder),
    deliveries,
  };
}

function* publishGroupVcProposal(
  runtime: AgentRuntime,
  groupHab: Hab,
  route: typeof MULTISIG_VCP_ROUTE | typeof MULTISIG_ISS_ROUTE,
  payload: Record<string, unknown>,
  embeds: Record<string, Uint8Array>,
) {
  const member = localGroupMember(runtime.hby, groupHab.pre);
  const deliveries: string[] = [];
  for (const recipient of groupSigningMembers(runtime.hby, groupHab.pre)) {
    if (recipient === member.pre || runtime.hby.habs.has(recipient)) {
      continue;
    }
    const result = yield* runtime.poster.sendExchange(member, {
      recipient,
      route,
      payload,
      embeds,
      topic: MULTISIG_TOPIC,
    });
    deliveries.push(...result.deliveries, ...result.queued);
  }
  return deliveries;
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
  runtime: AgentRuntime,
  pre: string,
  sn: number,
  eventSaid: string,
): boolean {
  return requireReger(runtime).tels.getOn(pre, sn)?.qb64 === eventSaid;
}

function markTelComplete(
  runtime: AgentRuntime,
  pre: string,
  sn: number,
  eventSaid: string,
): void {
  requireReger(runtime).ctel.pin([pre, seqner(sn).qb64], new Saider({ qb64: eventSaid }));
}

export function requireReger(runtime: AgentRuntime): Reger {
  if (!(runtime.vdr.reger instanceof Reger)) {
    throw new ValidationError("VDR runtime did not open Reger.");
  }
  return runtime.vdr.reger;
}

export function requireRegery(runtime: AgentRuntime): Regery {
  if (!(runtime.vdr.rgy instanceof Regery)) {
    throw new ValidationError("VDR runtime did not open Regery.");
  }
  return runtime.vdr.rgy;
}

export function requireTevery(runtime: AgentRuntime): Tevery {
  if (!(runtime.vdr.tvy instanceof Tevery)) {
    throw new ValidationError("VDR runtime did not open Tevery.");
  }
  return runtime.vdr.tvy;
}

export function requireVerifier(runtime: AgentRuntime): Verifier {
  if (!(runtime.vdr.vry instanceof Verifier)) {
    throw new ValidationError("VDR runtime did not open Verifier.");
  }
  return runtime.vdr.vry;
}

function savedCredentials(reger: Reger): Set<string> {
  return new Set([...reger.saved.getTopItemIter()].map(([keys]) => keys[0]).filter((key): key is string => !!key));
}
