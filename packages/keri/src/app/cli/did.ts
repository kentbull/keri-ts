/**
 * DID-related CLI operations shared by the Tufa command dispatcher.
 */
import { type Operation } from "effection";
import { ValidationError } from "../../core/errors.ts";
import { Reger } from "../../db/reger.ts";
import {
  bindDesignatedAliases,
  DEFAULT_DESIGNATED_ALIASES_REGISTRY_NAME,
  generateDidWebsArtifacts,
  parseDidWebs,
  resolveDidKeri,
  resolveDidWebs,
} from "../../did/index.ts";
import type { AgentRuntime } from "../agent-runtime.ts";
import type { Habery } from "../habbing.ts";
import { WitnessReceiptor } from "../witnessing.ts";
import { withAgentRuntime } from "./common/context.ts";
import { requireNonEmpty } from "./common/parsing.ts";

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
    alias: args.alias as string | undefined,
    dids: asStringList(args.did),
    registryName: args.registryName as string | undefined,
    createRegistry: args.createRegistry as boolean | undefined,
    allowExternalDid: args.allowExternalDid as boolean | undefined,
  };
  requireNonEmpty(commandArgs.name, "Name");
  requireNonEmpty(commandArgs.alias, "Alias");
  const alias = commandArgs.alias!;
  yield* withAgentRuntime(
    commandArgs,
    runtimeOpenOptions(commandArgs),
    function*({ hby, runtime }) {
      requireReger(runtime);
      const hab = hby.habByName(alias);
      const priorSn = hab?.kever?.sn ?? 0;
      const result = bindDesignatedAliases(runtime, {
        alias,
        dids: commandArgs.dids,
        registryName: commandArgs.registryName ?? DEFAULT_DESIGNATED_ALIASES_REGISTRY_NAME,
        createRegistry: commandArgs.createRegistry ?? true,
        allowExternalDid: commandArgs.allowExternalDid ?? false,
      });
      if (hab?.pre) {
        yield* receiptNewWitnessEvents(hby, hab.pre, priorSn);
      }
      console.log(JSON.stringify(result));
    },
  );
}

/** Implement `tufa dws generate`. */
export function* dwsGenerateCommand(args: Record<string, unknown>): Operation<void> {
  const commandArgs: DwsGenerateArgs = {
    ...baseArgs(args),
    alias: args.alias as string | undefined,
    did: args.did as string | undefined,
    outputDir: args.outputDir as string | undefined,
    meta: args.meta as boolean | undefined,
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
      requireReger(runtime);
      const artifacts = generateDidWebsArtifacts(runtime, {
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

/** Implement `tufa dws resolve`. */
export function* dwsResolveCommand(args: Record<string, unknown>): Operation<void> {
  const commandArgs: DwsResolveArgs = {
    ...baseArgs(args),
    did: args.did as string | undefined,
    meta: args.meta as boolean | undefined,
    insecureHttp: args.insecureHttp as boolean | undefined,
  };
  requireNonEmpty(commandArgs.name, "Name");
  requireNonEmpty(commandArgs.did, "DID");
  const did = commandArgs.did!;
  yield* withAgentRuntime(
    commandArgs,
    runtimeOpenOptions(commandArgs),
    function*({ runtime }) {
      requireReger(runtime);
      const result = yield* resolveDidWebs(runtime, {
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
    did: args.did as string | undefined,
    oobis: asStringList(args.oobi),
    meta: args.meta as boolean | undefined,
  };
  requireNonEmpty(commandArgs.name, "Name");
  requireNonEmpty(commandArgs.did, "DID");
  const did = commandArgs.did!;
  yield* withAgentRuntime(
    commandArgs,
    runtimeOpenOptions(commandArgs),
    function*({ runtime }) {
      requireReger(runtime);
      const result = yield* resolveDidKeri(runtime, {
        did,
        oobis: commandArgs.oobis,
        metadata: commandArgs.meta ?? false,
      });
      console.log(JSON.stringify(commandArgs.meta ? result.resolution : result.document, null, 2));
    },
  );
}

function baseArgs(args: Record<string, unknown>): DidBaseArgs {
  return {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    compat: args.compat as boolean | undefined,
  };
}

function runtimeOpenOptions(args: DidBaseArgs) {
  return {
    compat: args.compat ?? false,
    skipConfig: true,
  };
}

function requireReger(runtime: AgentRuntime): Reger {
  const reger = runtime.vdr.reger;
  if (!(reger instanceof Reger)) {
    throw new ValidationError("VDR runtime did not open Reger.");
  }
  return reger;
}

function* receiptNewWitnessEvents(
  hby: Habery,
  pre: string,
  priorSn: number,
): Operation<void> {
  const hab = hby.habs.get(pre);
  const latestSn = hab?.kever?.sn;
  if (!hab?.kever || latestSn === undefined || latestSn <= priorSn || hab.kever.wits.length === 0) {
    return;
  }
  const receiptor = new WitnessReceiptor(hby);
  for (let sn = priorSn + 1; sn <= latestSn; sn += 1) {
    yield* receiptor.submit(pre, { sn });
  }
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" ? [value] : [];
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
