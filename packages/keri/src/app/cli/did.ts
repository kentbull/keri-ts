/**
 * DID-related CLI operations shared by the Tufa command dispatcher.
 */
import { type Operation } from "effection";
import { ValidationError } from "../../core/errors.ts";
import {
  bindDesignatedAliases,
  DEFAULT_DESIGNATED_ALIASES_REGISTRY_NAME,
  generateDidWebsArtifacts,
  parseDidKeriIdentifier,
  parseDidWebs,
  resolveDidKeri,
  resolveDidWebs,
} from "../../did/index.ts";
import { type AgentRuntime, runAgentRuntimeUntil, runtimeOobiConverged } from "../agent-runtime.ts";
import type { Habery } from "../habbing.ts";
import { WitnessReceiptor } from "../witnessing.ts";
import { withAgentRuntime } from "./common/context.ts";
import { parseBooleanOption, parseStringListOption, parseStringOption, requireNonEmpty } from "./common/parsing.ts";

interface DidBaseArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  compat?: boolean;
}

interface DwsBindArgs extends DidBaseArgs {
  alias?: string;
  dids: string[];
  registryName?: string;
  createRegistry?: boolean;
  allowExternalDid?: boolean;
}

interface DwsGenerateArgs extends DidBaseArgs {
  alias?: string;
  did?: string;
  outputDir?: string;
  meta?: boolean;
}

interface DwsResolveArgs extends DidBaseArgs {
  did?: string;
  meta?: boolean;
  insecureHttp?: boolean;
}

interface DkrResolveArgs extends DidBaseArgs {
  did?: string;
  oobis: string[];
  meta?: boolean;
}

/** Implement `tufa dws bind`. */
export function* dwsBindCommand(args: Record<string, unknown>): Operation<void> {
  const commandArgs: DwsBindArgs = {
    ...baseArgs(args),
    alias: parseStringOption(args.alias, "alias"),
    dids: asStringList(args.did, "did"),
    registryName: parseStringOption(args.registryName, "registryName"),
    createRegistry: parseBooleanOption(args.createRegistry, "createRegistry"),
    allowExternalDid: parseBooleanOption(args.allowExternalDid, "allowExternalDid"),
  };
  requireNonEmpty(commandArgs.name, "Name");
  requireNonEmpty(commandArgs.alias, "Alias");
  const alias = commandArgs.alias!;
  yield* withAgentRuntime(
    commandArgs,
    runtimeOpenOptions(commandArgs),
    function*({ hby, runtime }) {
      const rgy = runtime.vdr;
      if (!rgy) throw new ValidationError("Legacy credential registry is unavailable in this runtime.");
      const hab = hby.habByName(alias);
      const priorSn = hab?.kever?.sn ?? 0;
      const result = bindDesignatedAliases(rgy, {
        alias,
        dids: commandArgs.dids,
        registryName: commandArgs.registryName ?? DEFAULT_DESIGNATED_ALIASES_REGISTRY_NAME,
        createRegistry: commandArgs.createRegistry ?? true,
        allowExternalDid: commandArgs.allowExternalDid ?? false,
      });
      if (hab?.pre) {
        yield* receiptNewWitnessEvents(hby, hab.pre, priorSn, runtime);
      }
      console.log(JSON.stringify(result));
    },
  );
}

/** Implement `tufa dws generate`. */
export function* dwsGenerateCommand(args: Record<string, unknown>): Operation<void> {
  const commandArgs: DwsGenerateArgs = {
    ...baseArgs(args),
    alias: parseStringOption(args.alias, "alias"),
    did: parseStringOption(args.did, "did"),
    outputDir: parseStringOption(args.outputDir, "outputDir"),
    meta: parseBooleanOption(args.meta, "meta"),
  };
  requireNonEmpty(commandArgs.name, "Name");
  requireNonEmpty(commandArgs.alias, "Alias");
  requireNonEmpty(commandArgs.did, "DID");
  requireNonEmpty(commandArgs.outputDir, "Output directory");
  const alias = commandArgs.alias!;
  const did = commandArgs.did!;
  const outputDir = commandArgs.outputDir!;
  yield* withAgentRuntime(
    commandArgs,
    runtimeOpenOptions(commandArgs),
    function*({ runtime }) {
      const rgy = runtime.vdr;
      if (!rgy) throw new ValidationError("Legacy credential registry is unavailable in this runtime.");
      const artifacts = generateDidWebsArtifacts(rgy, {
        alias,
        did,
        metadata: commandArgs.meta ?? false,
      });
      const parsed = parseDidWebs(did);
      const dir = artifactOutputDir(
        outputDir,
        parsed.path,
        artifacts.aid,
      );
      Deno.mkdirSync(dir, { recursive: true });
      Deno.writeFileSync(`${dir}/did.json`, artifacts.didJson);
      Deno.writeFileSync(`${dir}/keri.cesr`, artifacts.keriCesr);
      console.log(JSON.stringify({
        aid: artifacts.aid,
        did,
        didJson: `${dir}/did.json`,
        keriCesr: `${dir}/keri.cesr`,
      }));
    },
  );
}

/**
 * Implement `tufa dws resolve`.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* dwsResolveCommand(args: Record<string, unknown>): Operation<void> {
  const commandArgs: DwsResolveArgs = {
    ...baseArgs(args),
    did: parseStringOption(args.did, "did"),
    meta: parseBooleanOption(args.meta, "meta"),
    insecureHttp: parseBooleanOption(args.insecureHttp, "insecureHttp"),
  };
  requireNonEmpty(commandArgs.name, "Name");
  requireNonEmpty(commandArgs.did, "DID");
  const did = commandArgs.did!;
  yield* withAgentRuntime(
    commandArgs,
    runtimeOpenOptions(commandArgs),
    function*({ runtime }) {
      const rgy = runtime.vdr;
      if (!rgy) throw new ValidationError("Legacy credential registry is unavailable in this runtime.");
      const result = yield* resolveDidWebs(rgy, runtime.reactor, runtime.http, {
        did,
        metadata: commandArgs.meta ?? false,
        insecureHttp: commandArgs.insecureHttp ?? false,
      });
      console.log(JSON.stringify(commandArgs.meta ? result.resolution : result.document, null, 2));
    },
  );
}

/** Implement `tufa dkr resolve`. */
export function* dkrResolveCommand(args: Record<string, unknown>): Operation<void> {
  const commandArgs: DkrResolveArgs = {
    ...baseArgs(args),
    did: parseStringOption(args.did, "did"),
    oobis: asStringList(args.oobi, "oobi"),
    meta: parseBooleanOption(args.meta, "meta"),
  };
  requireNonEmpty(commandArgs.name, "Name");
  requireNonEmpty(commandArgs.did, "DID");
  const did = parseDidKeriIdentifier(commandArgs.did!).canonical;
  yield* withAgentRuntime(
    commandArgs,
    runtimeOpenOptions(commandArgs),
    function*({ hby, runtime }) {
      const rgy = runtime.vdr;
      if (!rgy) throw new ValidationError("Legacy credential registry is unavailable in this runtime.");
      for (const oobi of commandArgs.oobis) runtime.oobiery.resolve(oobi);
      if (commandArgs.oobis.length > 0) {
        yield* runAgentRuntimeUntil(
          runtime,
          () => commandArgs.oobis.every((url) => runtimeOobiConverged(runtime, url)),
          { timeoutMs: 30_000, pollMailbox: false },
        );
      }
      const result = resolveDidKeri(hby, rgy, did);
      console.log(JSON.stringify(commandArgs.meta ? result.resolution : result.document, null, 2));
    },
  );
}

function baseArgs(args: Record<string, unknown>): DidBaseArgs {
  return {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    compat: parseBooleanOption(args.compat, "compat"),
  };
}

function runtimeOpenOptions(args: DidBaseArgs) {
  return {
    compat: args.compat ?? false,
    skipConfig: true,
  };
}

/**
 * Submit newly created witnessed events in sequence through the composed receipt owner.
 *
 * @param hby Borrowed local identities and accepted-state stores.
 * @param pre Local AID whose new accepted events need receipts.
 * @param priorSn Sequence before the operation; only later events are submitted.
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 */
function* receiptNewWitnessEvents(
  hby: Habery,
  pre: string,
  priorSn: number,
  runtime: AgentRuntime,
): Operation<void> {
  const hab = hby.habs.get(pre);
  const latestSn = hab?.kever?.sn;
  if (!hab?.kever || latestSn === undefined || latestSn <= priorSn || hab.kever.wits.length === 0) {
    return;
  }
  const receiptor = new WitnessReceiptor(hby, runtime.protocol, runtime.http, runtime.clock);
  for (let sn = priorSn + 1; sn <= latestSn; sn += 1) {
    yield* receiptor.submit(pre, { sn });
  }
}

/** Accept a scalar occurrence or the complete repeated-option list without dropping invalid entries. */
function asStringList(value: unknown, flag: string): string[] {
  if (typeof value === "string") return [value];
  return parseStringListOption(value, flag) ?? [];
}

function artifactOutputDir(
  root: string,
  didPath: readonly string[],
  aid: string,
): string {
  const normalizedRoot = root.replace(/\/+$/u, "");
  return [
    normalizedRoot,
    ...didPath.map(safePathSegment),
    safePathSegment(aid),
  ].filter((part) => part.length > 0).join("/");
}

function safePathSegment(segment: string): string {
  if (segment.includes("/") || segment === ".." || segment.includes("\0")) {
    throw new ValidationError(`Unsafe DID path segment ${segment}.`);
  }
  return segment;
}
