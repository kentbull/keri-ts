import { type Operation } from "npm:effection@^3.6.0";
import { concatBytes, SerderACDC } from "../../../../cesr/mod.ts";
import { ValidationError } from "../../core/errors.ts";
import { CREDENTIAL_MAILBOX_TOPIC } from "../../core/mailbox-topics.ts";
import { Schemer } from "../../core/scheming.ts";
import { Reger } from "../../db/reger.ts";
import { Credentialer, CredentialWallet, Regery, type Registry } from "../../vdr/credentialing.ts";
import { Tevery } from "../../vdr/eventing.ts";
import { type AgentRuntime, createAgentRuntime, settleRuntimeIngress } from "../agent-runtime.ts";
import type { ExchangeDeliveryPreference } from "../forwarding.ts";
import type { Hab, Habery } from "../habbing.ts";
import { credentialStreamMessages } from "../ipex-credentialing.ts";
import { Verifier } from "../verifying.ts";
import { setupHby } from "./common/existing.ts";

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

export function* vcSchemaImportCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs = baseArgs(args) as VcSchemaImportArgs;
  vcArgs.schema = asStringList(args.schema);
  const { hby } = yield* openHabery(vcArgs);
  try {
    for (const path of vcArgs.schema ?? []) {
      const schemer = new Schemer({ raw: Deno.readFileSync(path) });
      hby.db.schema.pin(schemer.said, schemer);
      console.log(JSON.stringify({ schema: schemer.said, path }));
    }
  } finally {
    yield* hby.close();
  }
}

export function* vcRegistryInceptCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs = registryArgs(args);
  const { hby, runtime } = yield* openRuntime(vcArgs);
  try {
    const hab = requireHab(hby, vcArgs.alias);
    const rgy = requireRegery(runtime);
    const registry = rgy.makeRegistry(vcArgs.registryName!, hab, {
      noBackers: vcArgs.noBackers ?? true,
      estOnly: vcArgs.estOnly ?? false,
    });
    console.log(JSON.stringify({
      name: vcArgs.registryName,
      registry: registry.regk,
      issuer: hab.pre,
    }));
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

export function* vcRegistryListCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs = baseArgs(args);
  const { hby, runtime, reger } = yield* openRuntime(vcArgs);
  try {
    for (const [keys, record] of reger.regs.getTopItemIter()) {
      console.log(JSON.stringify({
        name: keys[0],
        registry: record.registryKey,
        issuer: record.prefix,
      }));
    }
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

export function* vcRegistryStatusCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs = registryArgs(args, { aliasRequired: false });
  const { hby, runtime, reger } = yield* openRuntime(vcArgs);
  try {
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
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

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

  const { hby, runtime, reger } = yield* openRuntime(vcArgs);
  try {
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
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

export function* vcListCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs: VcListArgs = {
    ...baseArgs(args),
    alias: args.alias as string | undefined,
    aid: args.aid as string | undefined,
    schema: args.schema as string | undefined,
    issued: args.issued as boolean | undefined,
  };
  const { hby, runtime, reger } = yield* openRuntime(vcArgs);
  try {
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
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

export function* vcExportCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs: VcSaidArgs = {
    ...baseArgs(args),
    said: args.said as string | undefined,
    recipient: args.recipient as string | undefined,
    out: args.out as string | undefined,
  };
  requireNonEmpty(vcArgs.said, "Credential SAID");
  const { hby, runtime, reger } = yield* openRuntime(vcArgs);
  try {
    const [creder] = reger.cloneCred(vcArgs.said!);
    const recipient = vcArgs.recipient ? resolveAid(hby, vcArgs.recipient) : creder.issuee ?? "";
    const bytes = concatBytes(...credentialStreamMessages(hby, reger, creder, recipient));
    writeBytes(bytes, vcArgs.out);
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

export function* vcImportCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs: VcImportArgs = {
    ...baseArgs(args),
    inPath: args.inPath as string | undefined,
  };
  const { hby, runtime, reger } = yield* openRuntime(vcArgs);
  try {
    const before = savedCredentials(reger);
    settleRuntimeIngress(runtime, [readBytes(vcArgs.inPath)]);
    runtime.reactor.processEscrowsOnce();
    const after = [...savedCredentials(reger)].filter((said) => !before.has(said));
    console.log(JSON.stringify({ saved: after }));
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

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
  const { hby, runtime, reger } = yield* openRuntime(vcArgs);
  try {
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
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
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
  };
  if (aliasRequired) {
    requireNonEmpty(parsed.alias, "Alias");
  }
  requireNonEmpty(parsed.registryName, "Registry name");
  return parsed;
}

function* openHabery(args: VcBaseArgs) {
  requireNonEmpty(args.name, "Name");
  const hby = yield* setupHby(
    args.name!,
    args.base ?? "",
    args.passcode,
    false,
    args.headDirPath,
    {
      compat: args.compat ?? false,
      skipConfig: true,
    },
  );
  return { hby };
}

function* openRuntime(args: VcBaseArgs): Operation<{ hby: Habery; runtime: AgentRuntime; reger: Reger }> {
  const { hby } = yield* openHabery(args);
  const runtime = yield* createAgentRuntime(hby, { mode: "local" });
  const reger = runtime.vdr.reger;
  if (!(reger instanceof Reger)) {
    throw new ValidationError("VDR runtime did not open Reger.");
  }
  return { hby, runtime, reger };
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
