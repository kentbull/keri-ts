import { type Operation } from "npm:effection@^3.6.0";
import { concatBytes } from "../../../../cesr/mod.ts";
import { ValidationError } from "../../core/errors.ts";
import { Reger } from "../../db/reger.ts";
import { type AgentRuntime } from "../agent-runtime.ts";
import {
  createCredential,
  credentialRegistryRecords,
  credentialRegistryStatus,
  credentialStreamBytes,
  exportCredentialStream,
  importCredentialStream,
  inceptCredentialRegistry,
  listCredentials,
  pinSchemaBytes,
  requireReger,
  revocationRecipients,
  revokeCredential,
} from "../credential-workflows.ts";
import type { ExchangeDeliveryPreference } from "../forwarding.ts";
import type { Hab, Habery } from "../habbing.ts";
import { withAgentRuntime, withExistingHabery } from "./common/context.ts";

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
      const schema = pinSchemaBytes(hby, Deno.readFileSync(path));
      console.log(JSON.stringify({ schema, path }));
    }
  });
}

/** Implement `tufa vc registry incept` for single-sig or group registries. */
export function* vcRegistryInceptCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs = registryArgs(args);
  yield* withVcRuntime(vcArgs, function*({ hby, runtime }) {
    const hab = requireHab(hby, vcArgs.alias);
    const result = yield* inceptCredentialRegistry(hby, runtime, hab, {
      registryName: vcArgs.registryName!,
      noBackers: vcArgs.noBackers,
      estOnly: vcArgs.estOnly,
      usage: vcArgs.usage,
    });
    console.log(JSON.stringify(result));
  });
}

/** Implement `tufa vc registry list` from local `Reger.regs` state. */
export function* vcRegistryListCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs = baseArgs(args);
  yield* withVcRuntime(vcArgs, function*({ reger }) {
    for (const record of credentialRegistryRecords(reger)) {
      console.log(JSON.stringify(record));
    }
  });
}

/** Implement `tufa vc registry status` from current TEL registry state. */
export function* vcRegistryStatusCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs = registryArgs(args, { aliasRequired: false });
  yield* withVcRuntime(vcArgs, function*({ runtime, reger }) {
    console.log(JSON.stringify(credentialRegistryStatus(runtime, reger, vcArgs.registryName!)));
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
    const schema = vcArgs.schemaFile ? pinSchemaBytes(hby, Deno.readFileSync(vcArgs.schemaFile)) : vcArgs.schema;
    requireNonEmpty(schema, "Schema");
    const recipient = vcArgs.recipient ? resolveAid(hby, vcArgs.recipient) : undefined;
    const result = yield* createCredential(hby, runtime, reger, {
      registryName: vcArgs.registryName!,
      schema: schema!,
      recipient,
      data: parseSubjectDataArg(vcArgs.data) ?? {},
      edges: parseJsonSectionArg(vcArgs.edges, "edges"),
      rules: parseJsonSectionArg(vcArgs.rules, "rules"),
    });
    if (vcArgs.out) {
      writeBytes(credentialStreamBytes(hby, reger, result.creder, result.recipient), vcArgs.out);
    }
    console.log(JSON.stringify(result.output));
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
    for (
      const item of listCredentials(runtime, reger, { issued: vcArgs.issued ?? false, aid, schema: vcArgs.schema })
    ) {
      console.log(JSON.stringify(item));
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
    const recipient = vcArgs.recipient ? resolveAid(hby, vcArgs.recipient) : undefined;
    const result = exportCredentialStream(hby, reger, vcArgs.said!, recipient);
    writeBytes(result.bytes, vcArgs.out);
  });
}

/** Implement `tufa vc import` by ingesting one CESR credential stream. */
export function* vcImportCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs: VcImportArgs = {
    ...baseArgs(args),
    inPath: args.inPath as string | undefined,
  };
  yield* withVcRuntime(vcArgs, function*({ runtime, reger }) {
    console.log(JSON.stringify(importCredentialStream(runtime, reger, readBytes(vcArgs.inPath))));
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
    const [creder] = reger.cloneCred(vcArgs.said!);
    if ((vcArgs.send?.length ?? 0) > 0 && !vcArgs.alias) {
      throw new ValidationError("Alias is required when sending revocation events.");
    }
    const sendRecipients = revocationRecipients(creder, vcArgs.send ?? [], !!vcArgs.alias);
    const senderHab = sendRecipients.length > 0 ? requireHab(hby, vcArgs.alias) : undefined;
    const result = yield* revokeCredential(hby, runtime, reger, {
      registryName: vcArgs.registryName!,
      credentialSaid: vcArgs.said!,
      sendRecipients,
      senderHab,
      delivery: vcArgs.delivery,
    });
    if (vcArgs.out) {
      const recipient = vcArgs.recipient ? resolveAid(hby, vcArgs.recipient) : result.creder.issuee ?? "";
      writeBytes(credentialStreamBytes(hby, reger, result.creder, recipient), vcArgs.out);
    }
    console.log(JSON.stringify({
      said: result.said,
      tel: result.tel,
      status: result.status,
      deliveries: result.deliveries,
      queued: result.queued,
    }));
  });
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
