/** Long-lived `tufa dws resolver` service command. */
import type { Operation } from "effection";
import {
  type CesrBodyMode,
  consoleLogger,
  createAgentRuntime,
  normalizeCesrBodyMode,
  ValidationError,
} from "keri-ts/runtime";
import { startServer } from "../host/http-server.ts";
import { setupHby } from "./support/existing.ts";

interface DwsResolverArgs {
  port?: number;
  listenHost?: string;
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  compat?: boolean;
  cesrBodyMode?: CesrBodyMode;
  staticFilesDir?: string;
  didPath?: string;
  dynamic?: boolean;
  hostedPrefixes: string[];
  insecureHttp?: boolean;
}

/** Run the DID Webs Universal Resolver and optional artifact host. */
export function* dwsResolverCommand(args: Record<string, unknown>): Operation<void> {
  const commandArgs: DwsResolverArgs = {
    port: args.port ? Number(args.port) : 7723,
    listenHost: args.listenHost as string | undefined,
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    compat: args.compat as boolean | undefined,
    cesrBodyMode: normalizeCesrBodyMode(args.cesrBodyMode as string | undefined),
    staticFilesDir: args.staticFilesDir as string | undefined,
    didPath: args.didPath as string | undefined,
    dynamic: args.dynamic as boolean | undefined,
    hostedPrefixes: asStringList(args.hostedPrefix),
    insecureHttp: args.insecureHttp as boolean | undefined,
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
      cesrBodyMode: commandArgs.cesrBodyMode,
    },
  );
  const runtime = yield* createAgentRuntime(hby, { mode: "local" });
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

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" ? [value] : [];
}
