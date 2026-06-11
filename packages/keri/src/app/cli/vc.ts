import { type Operation } from "npm:effection@^3.6.0";
import {
  concatBytes,
  Diger,
  Ilks,
  NumberPrimitive,
  NumDex,
  Prefixer,
  Saider,
  Seqner,
  SerderACDC,
  TraitDex,
} from "../../../../cesr/mod.ts";
import { ValidationError } from "../../core/errors.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../../core/mailbox-topics.ts";
import { incept as inceptRegistryEvent, issue as issueEvent } from "../../core/protocol-vdr-eventing.ts";
import { RegistryRecord } from "../../core/records.ts";
import { Schemer } from "../../core/scheming.ts";
import { Reger } from "../../db/reger.ts";
import { Credentialer, CredentialWallet, Regery, Registry, serializeCredential } from "../../vdr/credentialing.ts";
import { Tevery } from "../../vdr/eventing.ts";
import { type AgentRuntime, settleRuntimeIngress } from "../agent-runtime.ts";
import type { ExchangeDeliveryPreference } from "../forwarding.ts";
import { MULTISIG_ISS_ROUTE, MULTISIG_VCP_ROUTE } from "../grouping.ts";
import type { Hab, Habery } from "../habbing.ts";
import { credentialStreamMessages } from "../ipex-credentialing.ts";
import { Verifier } from "../verifying.ts";
import { withAgentRuntime, withExistingHabery } from "./common/context.ts";

const MULTISIG_TOPIC = "multisig";

interface VcBaseArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  compat?: boolean;
}

interface VcRegistryArgs extends VcBaseArgs {
  alias?: string;
  registryName?: string;
  noBackers?: boolean;
  estOnly?: boolean;
  usage?: string;
}

interface VcCreateArgs extends VcBaseArgs {
  alias?: string;
  registryName?: string;
  schema?: string;
  schemaFile?: string;
  recipient?: string;
  data?: string;
  edges?: string;
  rules?: string;
  out?: string;
}

interface VcSaidArgs extends VcBaseArgs {
  alias?: string;
  registryName?: string;
  said?: string;
  recipient?: string;
  out?: string;
  send?: string[];
  delivery?: ExchangeDeliveryPreference;
}

interface VcListArgs extends VcBaseArgs {
  alias?: string;
  aid?: string;
  schema?: string;
  issued?: boolean;
}

interface VcImportArgs extends VcBaseArgs {
  inPath?: string;
}

interface VcSchemaImportArgs extends VcBaseArgs {
  schema?: string[];
}

/** Implement `tufa vc schema import` by pinning JSON schemas into `schema.`. */
export function* vcSchemaImportCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs = baseArgs(args) as VcSchemaImportArgs;
  vcArgs.schema = asStringList(args.schema);
  yield* withVcHabery(vcArgs, function*({ hby }) {
    for (const path of vcArgs.schema ?? []) {
      const schemer = new Schemer({ raw: Deno.readFileSync(path) });
      hby.db.schema.pin(schemer.said, schemer);
      console.log(JSON.stringify({ schema: schemer.said, path }));
    }
  });
}

/** Implement `tufa vc registry incept` for single-sig or group registries. */
export function* vcRegistryInceptCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs = registryArgs(args);
  yield* withVcRuntime(vcArgs, function*({ hby, runtime }) {
    const hab = requireHab(hby, vcArgs.alias);
    const rgy = requireRegery(runtime);
    if (isGroupHab(hby, hab)) {
      const result = yield* proposeGroupRegistryIncept(hby, runtime, rgy, hab, vcArgs);
      console.log(JSON.stringify(result));
      return;
    }
    const registry = rgy.makeRegistry(vcArgs.registryName!, hab, {
      noBackers: vcArgs.noBackers ?? true,
      estOnly: vcArgs.estOnly ?? false,
    });
    console.log(JSON.stringify({
      name: vcArgs.registryName,
      registry: registry.regk,
      issuer: hab.pre,
    }));
  });
}

/** Implement `tufa vc registry list` from local `Reger.regs` state. */
export function* vcRegistryListCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs = baseArgs(args);
  yield* withVcRuntime(vcArgs, function*({ reger }) {
    for (const [keys, record] of reger.regs.getTopItemIter()) {
      console.log(JSON.stringify({
        name: keys[0],
        registry: record.registryKey,
        issuer: record.prefix,
      }));
    }
  });
}

/** Implement `tufa vc registry status` from current TEL registry state. */
export function* vcRegistryStatusCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs = registryArgs(args, { aliasRequired: false });
  yield* withVcRuntime(vcArgs, function*({ runtime, reger }) {
    const record = reger.regs.get(vcArgs.registryName!);
    if (!record?.registryKey) {
      throw new ValidationError(`Registry ${vcArgs.registryName} not found.`);
    }
    const tever = requireTevery(runtime).tevers.get(record.registryKey);
    console.log(JSON.stringify({
      name: vcArgs.registryName,
      registry: record.registryKey,
      issuer: record.prefix,
      state: tever?.state() ?? null,
    }));
  });
}

/** Implement `tufa vc create` by constructing and issuing one registry-backed ACDC. */
export function* vcCreateCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs: VcCreateArgs = {
    ...baseArgs(args),
    alias: args.alias as string | undefined,
    registryName: args.registryName as string | undefined,
    schema: args.schema as string | undefined,
    schemaFile: args.schemaFile as string | undefined,
    recipient: args.recipient as string | undefined,
    data: args.data as string | undefined,
    edges: args.edges as string | undefined,
    rules: args.rules as string | undefined,
    out: args.out as string | undefined,
  };
  requireNonEmpty(vcArgs.alias, "Alias");
  requireNonEmpty(vcArgs.registryName, "Registry name");

  yield* withVcRuntime(vcArgs, function*({ hby, runtime, reger }) {
    const rgy = requireRegery(runtime);
    const registry = requireRegistry(rgy, vcArgs.registryName);
    const schema = vcArgs.schemaFile ? importSchemaFile(hby, vcArgs.schemaFile) : vcArgs.schema;
    requireNonEmpty(schema, "Schema");
    const recipient = vcArgs.recipient ? resolveAid(hby, vcArgs.recipient) : undefined;
    const credentialer = new Credentialer(hby, {
      reger,
      vry: requireVerifier(runtime),
    });
    const creder = credentialer.create({
      registry,
      schema: schema!,
      recipient,
      data: parseSubjectDataArg(vcArgs.data) ?? {},
      edges: parseJsonSectionArg(vcArgs.edges, "edges"),
      rules: parseJsonSectionArg(vcArgs.rules, "rules"),
    });
    if (isGroupHab(hby, registry.hab)) {
      const result = yield* proposeGroupCredentialIssue(hby, runtime, reger, registry, creder);
      if (vcArgs.out && result.saved) {
        writeCredentialStream(hby, reger, creder, recipient ?? creder.issuee ?? "", vcArgs.out);
      }
      console.log(JSON.stringify(result));
      return;
    }
    const result = credentialer.issue(registry, creder);
    if (vcArgs.out) {
      writeCredentialStream(hby, reger, creder, recipient ?? creder.issuee ?? "", vcArgs.out);
    }
    console.log(JSON.stringify({
      said: creder.said,
      registry: creder.regid,
      issuer: creder.issuer,
      issuee: creder.issuee,
      schema: creder.schema,
      tel: result.tel.said,
      status: result.verifierDecision.kind,
    }));
  });
}

/** Implement `tufa vc list` over verifier-backed wallet indexes. */
export function* vcListCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs: VcListArgs = {
    ...baseArgs(args),
    alias: args.alias as string | undefined,
    aid: args.aid as string | undefined,
    schema: args.schema as string | undefined,
    issued: args.issued as boolean | undefined,
  };
  yield* withVcRuntime(vcArgs, function*({ hby, runtime, reger }) {
    const aid = vcArgs.aid ?? (vcArgs.alias ? requireHab(hby, vcArgs.alias).pre : undefined);
    const wallet = new CredentialWallet(reger);
    const tvy = requireTevery(runtime);
    for (const said of wallet.list({ issued: vcArgs.issued ?? false, aid, schema: vcArgs.schema })) {
      const [creder] = reger.cloneCred(said);
      const tever = creder.regid ? tvy.tevers.get(creder.regid) : null;
      console.log(JSON.stringify({
        said,
        issuer: creder.issuer,
        issuee: creder.issuee,
        schema: creder.schema,
        status: tever?.vcState(said)?.et ?? null,
      }));
    }
  });
}

/** Implement `tufa vc export` as a KERIpy-compatible credential support stream. */
export function* vcExportCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs: VcSaidArgs = {
    ...baseArgs(args),
    said: args.said as string | undefined,
    recipient: args.recipient as string | undefined,
    out: args.out as string | undefined,
  };
  requireNonEmpty(vcArgs.said, "Credential SAID");
  yield* withVcRuntime(vcArgs, function*({ hby, reger }) {
    const [creder] = reger.cloneCred(vcArgs.said!);
    const recipient = vcArgs.recipient ? resolveAid(hby, vcArgs.recipient) : creder.issuee ?? "";
    const bytes = concatBytes(...credentialStreamMessages(hby, reger, creder, recipient));
    writeBytes(bytes, vcArgs.out);
  });
}

/** Implement `tufa vc import` by ingesting one CESR credential stream. */
export function* vcImportCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs: VcImportArgs = {
    ...baseArgs(args),
    inPath: args.inPath as string | undefined,
  };
  yield* withVcRuntime(vcArgs, function*({ runtime, reger }) {
    const before = savedCredentials(reger);
    settleRuntimeIngress(runtime, [readBytes(vcArgs.inPath)]);
    runtime.reactor.processEscrowsOnce();
    const after = [...savedCredentials(reger)].filter((said) => !before.has(said));
    console.log(JSON.stringify({ saved: after }));
  });
}

/** Implement `tufa vc revoke`, including optional revocation delivery/export. */
export function* vcRevokeCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs: VcSaidArgs = {
    ...baseArgs(args),
    alias: args.alias as string | undefined,
    registryName: args.registryName as string | undefined,
    said: args.said as string | undefined,
    recipient: args.recipient as string | undefined,
    out: args.out as string | undefined,
    send: asStringList(args.send),
    delivery: args.delivery as ExchangeDeliveryPreference | undefined,
  };
  requireNonEmpty(vcArgs.registryName, "Registry name");
  requireNonEmpty(vcArgs.said, "Credential SAID");
  yield* withVcRuntime(vcArgs, function*({ hby, runtime, reger }) {
    const rgy = requireRegery(runtime);
    const registry = requireRegistry(rgy, vcArgs.registryName);
    const result = registry.revoke(vcArgs.said!);
    const [creder] = reger.cloneCred(vcArgs.said!);
    const sendRecipients = revocationRecipients(creder, vcArgs);
    const deliveries: string[] = [];
    const queued: string[] = [];
    if (sendRecipients.length > 0) {
      requireNonEmpty(vcArgs.alias, "Alias");
      const hab = requireHab(hby, vcArgs.alias);
      const messages = revocationStreamMessages(hby, reger, creder);
      for (const recipient of sendRecipients) {
        for (const message of messages) {
          const sent = yield* runtime.poster.sendBytes(hab, {
            recipient,
            message,
            topic: CREDENTIAL_MAILBOX_TOPIC,
            delivery: vcArgs.delivery,
          });
          deliveries.push(...sent.deliveries);
          queued.push(...sent.queued);
        }
      }
    }
    if (vcArgs.out) {
      const recipient = vcArgs.recipient ? resolveAid(hby, vcArgs.recipient) : creder.issuee ?? "";
      writeCredentialStream(hby, reger, creder, recipient, vcArgs.out);
    }
    console.log(JSON.stringify({
      said: vcArgs.said,
      tel: result.serder.said,
      status: result.decision.kind,
      deliveries,
      queued,
    }));
  });
}

function revocationRecipients(creder: SerderACDC, args: VcSaidArgs): string[] {
  const explicit = args.send ?? [];
  if (explicit.length > 0 && !args.alias) {
    throw new ValidationError("Alias is required when sending revocation events.");
  }
  const recipients = args.alias && creder.issuee ? [creder.issuee, ...explicit] : explicit;
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

function baseArgs(args: Record<string, unknown>): VcBaseArgs {
  return {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    compat: args.compat as boolean | undefined,
  };
}

function registryArgs(
  args: Record<string, unknown>,
  { aliasRequired = true }: { aliasRequired?: boolean } = {},
): VcRegistryArgs {
  const parsed: VcRegistryArgs = {
    ...baseArgs(args),
    alias: args.alias as string | undefined,
    registryName: args.registryName as string | undefined,
    noBackers: args.noBackers as boolean | undefined,
    estOnly: args.estOnly as boolean | undefined,
    usage: args.usage as string | undefined,
  };
  if (aliasRequired) {
    requireNonEmpty(parsed.alias, "Alias");
  }
  requireNonEmpty(parsed.registryName, "Registry name");
  return parsed;
}

interface VcHaberyContext {
  hby: Habery;
}

interface VcRuntimeContext extends VcHaberyContext {
  runtime: AgentRuntime;
  reger: Reger;
}

function* withVcHabery<TResult>(
  args: VcBaseArgs,
  use: (context: VcHaberyContext) => Operation<TResult>,
): Operation<TResult> {
  requireNonEmpty(args.name, "Name");
  return yield* withExistingHabery(args, vcOpenOptions(args), use);
}

function* withVcRuntime<TResult>(
  args: VcBaseArgs,
  use: (context: VcRuntimeContext) => Operation<TResult>,
): Operation<TResult> {
  requireNonEmpty(args.name, "Name");
  return yield* withAgentRuntime(args, vcOpenOptions(args), function*({ hby, runtime }) {
    const reger = requireReger(runtime);
    return yield* use({ hby, runtime, reger });
  });
}

function vcOpenOptions(args: VcBaseArgs) {
  return {
    compat: args.compat ?? false,
    skipConfig: true,
  };
}

function requireRegery(runtime: AgentRuntime): Regery {
  if (!(runtime.vdr.rgy instanceof Regery)) {
    throw new ValidationError("VDR runtime did not open Regery.");
  }
  return runtime.vdr.rgy;
}

function requireTevery(runtime: AgentRuntime): Tevery {
  if (!(runtime.vdr.tvy instanceof Tevery)) {
    throw new ValidationError("VDR runtime did not open Tevery.");
  }
  return runtime.vdr.tvy;
}

function requireVerifier(runtime: AgentRuntime): Verifier {
  if (!(runtime.vdr.vry instanceof Verifier)) {
    throw new ValidationError("VDR runtime did not open Verifier.");
  }
  return runtime.vdr.vry;
}

function requireRegistry(rgy: Regery, name: string | undefined): Registry {
  requireNonEmpty(name, "Registry name");
  const registry = rgy.registryByName(name!);
  if (!registry) {
    throw new ValidationError(`Registry ${name} not found.`);
  }
  return registry;
}

function requireHab(hby: { habByName(name: string): unknown }, alias: string | undefined): Hab {
  requireNonEmpty(alias, "Alias");
  const hab = hby.habByName(alias!) as { pre?: string } | null;
  if (!hab?.pre) {
    throw new ValidationError(`No local AID found for alias ${alias}.`);
  }
  return hab as Hab;
}

function resolveAid(hby: { habByName(name: string): unknown }, value: string): string {
  const local = hby.habByName(value) as { pre?: string } | null;
  if (local?.pre) {
    return local.pre;
  }
  return value;
}

function importSchemaFile(
  hby: { db: { schema: { pin(key: string, value: Schemer): unknown } } },
  path: string,
): string {
  const schemer = new Schemer({ raw: Deno.readFileSync(path) });
  hby.db.schema.pin(schemer.said, schemer);
  return schemer.said;
}

function parseJsonArg(value: string | undefined): unknown | undefined {
  if (!value) {
    return undefined;
  }
  const text = value.startsWith("@") ? Deno.readTextFileSync(value.slice(1)) : value;
  return JSON.parse(text) as unknown;
}

function parseSubjectDataArg(value: string | undefined): Record<string, unknown> | string | undefined {
  const parsed = parseJsonArg(value);
  if (parsed === undefined) {
    return undefined;
  }
  if (isRecord(parsed) || typeof parsed === "string") {
    return parsed;
  }
  throw new ValidationError("data must be a JSON object or string.");
}

function parseJsonSectionArg(
  value: string | undefined,
  label: string,
): Record<string, unknown> | Record<string, unknown>[] | undefined {
  const parsed = parseJsonArg(value);
  if (parsed === undefined) {
    return undefined;
  }
  if (isRecord(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed) && parsed.every(isRecord)) {
    return parsed;
  }
  throw new ValidationError(`${label} must be a JSON object or array of objects.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeCredentialStream(
  hby: Habery,
  reger: Reger,
  creder: SerderACDC,
  recipient: string,
  path: string,
): void {
  Deno.writeFileSync(path, concatBytes(...credentialStreamMessages(hby, reger, creder, recipient)));
}

function* proposeGroupRegistryIncept(
  hby: Habery,
  runtime: AgentRuntime,
  rgy: Regery,
  hab: Hab,
  args: VcRegistryArgs,
) {
  const noBackers = args.noBackers ?? true;
  const estOnly = args.estOnly ?? false;
  if (!noBackers) {
    throw new ValidationError("Group registry inception currently requires a no-backers registry.");
  }
  const cnfg = [
    ...(noBackers ? [TraitDex.NoBackers] : []),
    ...(estOnly ? [TraitDex.EstOnly] : []),
  ];
  const vcp = inceptRegistryEvent(hab.pre, { cnfg });
  const anchor = hby.interactGroupHab(args.alias!, undefined, {
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
  registerRegistry(rgy, args.registryName!, hab, regk, { noBackers, estOnly });
  if (telAccepted(runtime, regk, 0, requireSerderSaid(vcp, "registry inception"))) {
    markTelComplete(runtime, regk, 0, requireSerderSaid(vcp, "registry inception"));
  }

  const deliveries = yield* publishGroupVcProposal(runtime, hab, MULTISIG_VCP_ROUTE, {
    gid: hab.pre,
    usage: args.usage ?? args.registryName ?? "credential registry",
  }, {
    vcp: vcp.raw,
    anc: anchor.message,
  });

  return {
    name: args.registryName,
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

function isGroupHab(hby: Habery, hab: Hab): boolean {
  return !!hab.pre && !!hby.db.getHab(hab.pre)?.mid;
}

function localGroupMember(hby: Habery, groupPre: string): Hab {
  const record = hby.db.getHab(groupPre);
  const member = record?.mid ? hby.habs.get(record.mid) : null;
  if (!member) {
    throw new ValidationError(`Group ${groupPre} is missing local member metadata.`);
  }
  return member;
}

function groupSigningMembers(hby: Habery, groupPre: string): string[] {
  const stored = hby.ks.getSmids(groupPre).map((tuple) => tuple[0].qb64);
  if (stored.length > 0) {
    return stored;
  }
  const record = hby.db.getHab(groupPre);
  return record?.smids ?? [];
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

function requireReger(runtime: AgentRuntime): Reger {
  if (!(runtime.vdr.reger instanceof Reger)) {
    throw new ValidationError("VDR runtime did not open Reger.");
  }
  return runtime.vdr.reger;
}

function savedCredentials(reger: Reger): Set<string> {
  return new Set([...reger.saved.getTopItemIter()].map(([keys]) => keys[0]).filter((key): key is string => !!key));
}

function readBytes(path: string | undefined): Uint8Array {
  if (path) {
    return Deno.readFileSync(path);
  }
  const chunks: Uint8Array[] = [];
  const buffer = new Uint8Array(64 * 1024);
  while (true) {
    const read = Deno.stdin.readSync(buffer);
    if (read === null) {
      break;
    }
    chunks.push(buffer.slice(0, read));
  }
  return chunks.length === 0 ? new Uint8Array() : concatBytes(...chunks);
}

function writeBytes(bytes: Uint8Array, path: string | undefined): void {
  if (path) {
    Deno.writeFileSync(path, bytes);
    return;
  }
  Deno.stdout.writeSync(bytes);
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return typeof value === "string" ? [value] : [];
}

function requireNonEmpty(value: string | undefined, label: string): void {
  if (!value) {
    throw new ValidationError(`${label} is required and cannot be empty.`);
  }
}
