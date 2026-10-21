import { concatBytes } from "cesr-ts";
import { call, type Operation, spawn } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { Reger } from "../../db/reger.ts";
import type { Regery } from "../../vdr/credentialing.ts";
import { type AgentRuntime, runAgentRuntime } from "../agent-runtime.ts";
import { importCredentialStream } from "../credential-importing.ts";
import {
  createCredential,
  credentialRegistryRecords,
  credentialRegistryStatus,
  credentialStreamBytes,
  exportCredentialStream,
  inceptCredentialRegistry,
  type IssueResult,
  listCredentials,
  pinSchemaBytes,
  type RegistryResult,
  revocationRecipients,
  revokeCredential,
} from "../credential-workflows.ts";
import { isLocalGroupHab, localGroupMember } from "../group-members.ts";
import type { Hab, Habery } from "../habbing.ts";
import { withAgentRuntime, withExistingHabery } from "./common/context.ts";
import { parseBooleanOption, parseNumberOption, parseStringListOption, parseStringOption } from "./common/parsing.ts";
import { waitForIssuedCredential, waitForTelPublication } from "./common/tel-completion.ts";

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
}

interface VcListArgs extends VcBaseArgs {
  alias?: string;
  aid?: string;
  schema?: string;
  issued?: boolean;
}

interface VcImportArgs extends VcBaseArgs {
  /** Finite CESR file; absence selects stdin, read after command validation. */
  inPath?: string;
  /** Positive finite post-EOF settlement window in milliseconds; the importer floors with a one-millisecond minimum. */
  settlementTimeoutMs: number;
}

interface VcSchemaImportArgs extends VcBaseArgs {
  schema?: string[];
}

/** Implement `tufa vc schema import` by pinning JSON schemas into `schema.`. */
export function* vcSchemaImportCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs: VcSchemaImportArgs = {
    ...baseArgs(args),
    schema: asStringList(args.schema, "schema"),
  };
  yield* withVcHabery(vcArgs, function*({ hby }) {
    for (const path of vcArgs.schema ?? []) {
      const schema = pinSchemaBytes(hby, Deno.readFileSync(path));
      console.log(JSON.stringify({ schema, path }));
    }
  });
}

/**
 * Implement `tufa vc registry incept` for single-sig or group registries.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* vcRegistryInceptCommand(
  args: Record<string, unknown>,
): Operation<RegistryResult> {
  const vcArgs = registryArgs(args);
  const timeout = publicationTimeout(args.timeout);
  return yield* withVcRuntime(vcArgs, function*({ hby, runtime, rgy }) {
    const hab = requireHab(hby, vcArgs.alias);
    const group = isLocalGroupHab(hby, hab);
    const signer = group ? localGroupMember(hby, hab.pre) : hab;
    const result = yield* call(function*() {
      const postman = runtime.postman;
      const worker = yield* spawn(() => runAgentRuntime(runtime, { hab: signer, pollMailbox: group }));
      try {
        const deadline = Date.now() + timeout * 1000;
        const created = yield* inceptCredentialRegistry(rgy, runtime.reactor, postman, hab, {
          registryName: vcArgs.registryName!,
          estOnly: vcArgs.estOnly,
          usage: vcArgs.usage,
        });
        created.publicationComplete = yield* waitForTelPublication(rgy.publication, created.registry!, 0, deadline);
        if (created.group) {
          created.group.accepted = rgy.reger.tels.getOn(created.registry!, 0)?.qb64 === created.registry;
          if (created.group.accepted) created.group.status = "accept";
        }
        return created;
      } finally {
        yield* worker.halt();
      }
    });
    return result;
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
  yield* withVcRuntime(vcArgs, function*({ rgy }) {
    console.log(JSON.stringify(credentialRegistryStatus(rgy, vcArgs.registryName!)));
  });
}

/**
 * Implement `tufa vc create` by constructing and issuing one registry-backed ACDC.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* vcCreateCommand(args: Record<string, unknown>): Operation<IssueResult> {
  const timeout = publicationTimeout(args.timeout);
  const vcArgs: VcCreateArgs = {
    ...baseArgs(args),
    alias: parseStringOption(args.alias, "alias"),
    registryName: parseStringOption(args.registryName, "registryName"),
    schema: parseStringOption(args.schema, "schema"),
    schemaFile: parseStringOption(args.schemaFile, "schemaFile"),
    recipient: parseStringOption(args.recipient, "recipient"),
    data: parseStringOption(args.data, "data"),
    edges: parseStringOption(args.edges, "edges"),
    rules: parseStringOption(args.rules, "rules"),
    out: parseStringOption(args.out, "out"),
  };
  requireNonEmpty(vcArgs.alias, "Alias");
  requireNonEmpty(vcArgs.registryName, "Registry name");
  const data = parseSubjectDataArg(vcArgs.data) ?? {};
  const edges = parseJsonSectionArg(vcArgs.edges, "edges");
  const rules = parseJsonSectionArg(vcArgs.rules, "rules");

  return yield* withVcRuntime(vcArgs, function*({ hby, runtime, reger, rgy }) {
    const schema = vcArgs.schemaFile ? pinSchemaBytes(hby, Deno.readFileSync(vcArgs.schemaFile)) : vcArgs.schema;
    requireNonEmpty(schema, "Schema");
    const recipient = vcArgs.recipient ? resolveAid(hby, vcArgs.recipient) : undefined;
    const registry = rgy.registryByName(vcArgs.registryName!);
    if (!registry) throw new ValidationError(`Registry ${vcArgs.registryName} not found.`);
    const issuer = requireHab(hby, vcArgs.alias);
    if (issuer.pre !== registry.hab.pre) throw new ValidationError("Selected alias does not control this registry.");
    const group = isLocalGroupHab(hby, issuer);
    const signer = group ? localGroupMember(hby, issuer.pre) : issuer;
    const result = yield* call(function*() {
      const postman = runtime.postman;
      const worker = yield* spawn(() => runAgentRuntime(runtime, { hab: signer, pollMailbox: group }));
      try {
        const deadline = Date.now() + timeout * 1000;
        const created = yield* createCredential(rgy, runtime.reactor, postman, {
          registryName: vcArgs.registryName!,
          schema: schema!,
          recipient,
          data,
          edges,
          rules,
        });
        yield* waitForIssuedCredential(rgy.publication, created.creder.said!, deadline);
        const saved = rgy.reger.saved.get(created.creder.said!) !== null;
        created.publicationComplete = rgy.publication.complete(created.creder.said!);
        if (saved) created.status = "accept";
        if (created.group) {
          created.group.saved = saved;
          if (rgy.reger.tels.getOn(created.creder.said!, 0)?.qb64 === created.tel) created.group.telStatus = "accept";
        }
        return created;
      } finally {
        yield* worker.halt();
      }
    });
    if (vcArgs.out) {
      writeBytes(credentialStreamBytes(hby, reger, result.creder, result.recipient), vcArgs.out);
    }
    return result;
  });
}

/** Implement `tufa vc list` over verifier-backed wallet indexes. */
export function* vcListCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs: VcListArgs = {
    ...baseArgs(args),
    alias: parseStringOption(args.alias, "alias"),
    aid: parseStringOption(args.aid, "aid"),
    schema: parseStringOption(args.schema, "schema"),
    issued: parseBooleanOption(args.issued, "issued"),
  };
  yield* withVcRuntime(vcArgs, function*({ hby, rgy }) {
    const aid = vcArgs.aid ?? (vcArgs.alias ? requireHab(hby, vcArgs.alias).pre : undefined);
    for (
      const item of listCredentials(rgy, { issued: vcArgs.issued ?? false, aid, schema: vcArgs.schema })
    ) {
      console.log(JSON.stringify(item));
    }
  });
}

/** Implement `tufa vc export` as a KERIpy-compatible credential support stream. */
export function* vcExportCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs: VcSaidArgs = {
    ...baseArgs(args),
    said: parseStringOption(args.said, "said"),
    recipient: parseStringOption(args.recipient, "recipient"),
    out: parseStringOption(args.out, "out"),
  };
  requireNonEmpty(vcArgs.said, "Credential SAID");
  yield* withVcRuntime(vcArgs, function*({ hby, reger }) {
    const recipient = vcArgs.recipient ? resolveAid(hby, vcArgs.recipient) : undefined;
    const result = exportCredentialStream(hby, reger, vcArgs.said!, recipient);
    writeBytes(result.bytes, vcArgs.out);
  });
}

/**
 * Import finite CESR input and report its observed records' persisted acceptance.
 * Validate the settlement deadline before opening stores or reading input. The importer owns
 * normalization and post-EOF settlement; incomplete results are printed before command failure.
 *
 * @param args Parsed store/file choices and positive finite settlementTimeoutMs, default 5000 milliseconds.
 * Input is buffered before parser ownership begins; fractions are floored with a one-millisecond minimum.
 * @throws ValidationError for an invalid deadline or incomplete acceptance; intake and cleanup failures propagate.
 */
export function* vcImportCommand(args: Record<string, unknown>): Operation<void> {
  const settlementTimeoutMs = parseNumberOption(args.settlementTimeoutMs, "--settlement-timeout-ms") ?? 5_000;
  if (settlementTimeoutMs <= 0) {
    throw new ValidationError("--settlement-timeout-ms must be finite and positive.");
  }
  const vcArgs: VcImportArgs = {
    ...baseArgs(args),
    inPath: parseStringOption(args.inPath, "inPath"),
    settlementTimeoutMs,
  };
  yield* withVcRuntime(vcArgs, function*({ runtime, reger }) {
    const result = yield* importCredentialStream(
      runtime.protocol,
      reger,
      readBytes(vcArgs.inPath),
      runtime.clock,
      vcArgs.settlementTimeoutMs,
    );
    console.log(JSON.stringify(result));
    if (!result.complete) {
      throw new ValidationError(
        "Credential import incomplete; inspect the unaccepted identities and stderr diagnostics.",
      );
    }
  });
}

/**
 * Implement `tufa vc revoke`, including optional revocation delivery/export.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* vcRevokeCommand(args: Record<string, unknown>): Operation<void> {
  const vcArgs: VcSaidArgs = {
    ...baseArgs(args),
    alias: parseStringOption(args.alias, "alias"),
    registryName: parseStringOption(args.registryName, "registryName"),
    said: parseStringOption(args.said, "said"),
    recipient: parseStringOption(args.recipient, "recipient"),
    out: parseStringOption(args.out, "out"),
    send: asStringList(args.send, "send"),
  };
  requireNonEmpty(vcArgs.registryName, "Registry name");
  requireNonEmpty(vcArgs.said, "Credential SAID");
  yield* withVcRuntime(vcArgs, function*({ hby, runtime, reger, rgy }) {
    const [creder] = reger.cloneCred(vcArgs.said!);
    if ((vcArgs.send?.length ?? 0) > 0 && !vcArgs.alias) {
      throw new ValidationError("Alias is required when sending revocation events.");
    }
    const sendRecipients = revocationRecipients(creder, vcArgs.send ?? [], !!vcArgs.alias);
    const senderHab = sendRecipients.length > 0 ? requireHab(hby, vcArgs.alias) : undefined;
    const result = yield* call(function*() {
      const postman = runtime.postman;
      const worker = yield* spawn(() => postman.deliverDo());
      try {
        return yield* revokeCredential(rgy, postman, {
          registryName: vcArgs.registryName!,
          credentialSaid: vcArgs.said!,
          sendRecipients,
          senderHab,
        });
      } finally {
        yield* worker.halt();
      }
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
    }));
  });
}

function baseArgs(args: Record<string, unknown>): VcBaseArgs {
  return {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    compat: parseBooleanOption(args.compat, "compat"),
  };
}

function registryArgs(
  args: Record<string, unknown>,
  { aliasRequired = true }: { aliasRequired?: boolean } = {},
): VcRegistryArgs {
  const parsed: VcRegistryArgs = {
    ...baseArgs(args),
    alias: parseStringOption(args.alias, "alias"),
    registryName: parseStringOption(args.registryName, "registryName"),
    estOnly: parseBooleanOption(args.estOnly, "estOnly"),
    usage: parseStringOption(args.usage, "usage"),
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
  rgy: Regery;
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
    const rgy = runtime.vdr;
    if (!rgy) throw new ValidationError("Legacy credential registry is unavailable in this runtime.");
    const reger = rgy.reger;
    return yield* use({ hby, runtime, reger, rgy });
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

/** Accept the command's scalar/list forms without dropping malformed members. */
function asStringList(value: unknown, label: string): string[] {
  if (typeof value === "string") return [value];
  return parseStringListOption(value, label) ?? [];
}

function requireNonEmpty(value: string | undefined, label: string): void {
  if (!value) {
    throw new ValidationError(`${label} is required and cannot be empty.`);
  }
}

/** Publication waits accept explicit zero/fractions and reject malformed or overflowing values before opening storage. */
function publicationTimeout(value: unknown): number {
  const seconds = parseNumberOption(value, "timeout") ?? 60;
  if (seconds < 0 || !Number.isFinite(seconds * 1000)) {
    throw new ValidationError("timeout must be a finite nonnegative duration.");
  }
  return seconds;
}
