/** Long-lived `tufa dws resolver` service command. */
import type { Operation } from "effection";
import { parseBooleanOption, parseIntegerOption, parseStringListOption, parseStringOption } from "keri-ts/cli";
import { systemClock } from "keri-ts/runtime";
import { FetchHttpClient } from "keri-ts/runtime";
import {
  consoleLogger,
  createAgentRuntime,
  ValidationError,
} from "keri-ts/runtime";
import { startServer } from "../../host/http-server.ts";
import { setupHby } from "../support/existing.ts";

interface DwsResolverArgs {
  port?: number;
  listenHost?: string;
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  compat?: boolean;
  staticFilesDir?: string;
  didPath?: string;
  dynamic?: boolean;
  hostedPrefixes: string[];
  insecureHttp?: boolean;
}

/**
 * Run the DID Webs Universal Resolver and optional artifact host.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* dwsResolverCommand(args: Record<string, unknown>): Operation<void> {
  const commandArgs: DwsResolverArgs = {
    port: parseIntegerOption(args.port, "port") ?? 7723,
    listenHost: parseStringOption(args.listenHost, "listenHost"),
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    compat: parseBooleanOption(args.compat, "compat"),
    staticFilesDir: parseStringOption(args.staticFilesDir, "staticFilesDir"),
    didPath: parseStringOption(args.didPath, "didPath"),
    dynamic: parseBooleanOption(args.dynamic, "dynamic"),
    hostedPrefixes: asStringList(args.hostedPrefix, "hostedPrefix"),
    insecureHttp: parseBooleanOption(args.insecureHttp, "insecureHttp"),
  };
  const port = commandArgs.port ?? 7723;
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new ValidationError(`Invalid port number: ${port}.`);
  }
  if (!commandArgs.name) {
    throw new ValidationError("Name is required.");
  }
  if ((commandArgs.dynamic ?? false) && commandArgs.hostedPrefixes.length === 0) {
    throw new ValidationError("Dynamic DID Webs hosting requires at least one --hosted-prefix.");
  }
  const hby = yield* setupHby(
    commandArgs.name,
    commandArgs.base ?? "",
    commandArgs.passcode,
    false,
    commandArgs.headDirPath,
    {
      compat: commandArgs.compat ?? false,
      readonly: false,
      skipConfig: true,
      skipSignator: false,
    },
  );
  const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
  try {
    yield* startServer(port, consoleLogger, runtime, {
      hostname: commandArgs.listenHost ?? "127.0.0.1",
      hostedPrefixes: commandArgs.hostedPrefixes,
      dwsStaticFilesDir: commandArgs.staticFilesDir,
      dwsDidPath: commandArgs.didPath,
      dwsDynamic: commandArgs.dynamic ?? false,
      dwsInsecureHttp: commandArgs.insecureHttp ?? false,
      onListen: ({ hostname, port }) => {
        console.log(`DID resolver listening on http://${hostname}:${port}`);
      },
    });
  } finally {
    yield* runtime.close();
    yield* hby.close();
  }
}

/** Accept a scalar occurrence or the complete repeated-option list without dropping invalid entries. */
function asStringList(value: unknown, flag: string): string[] {
  if (typeof value === "string") return [value];
  return parseStringListOption(value, flag) ?? [];
}
