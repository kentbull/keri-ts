import type { Operation } from "effection";
import {
  type CesrBodyMode,
  type Configer,
  createConfiger,
  EndpointRoles,
  type Hab,
  type Habery,
  normalizeCesrBodyMode,
  Schemer,
  Schemes,
  ValidationError,
} from "keri-ts/runtime";
import { runIndirectHost } from "../host/indirect-host.ts";
import { setupHby } from "./support/existing.ts";

/** Parsed arguments for the long-lived `tufa agent` host command. */
interface AgentArgs {
  port?: number;
  name?: string;
  base?: string;
  headDirPath?: string;
  configDir?: string;
  configFile?: string;
  passcode?: string;
  compat?: boolean;
  outboxer?: boolean;
  cesrBodyMode?: CesrBodyMode;
  schemas?: string[];
  schemaDirs?: string[];
}

function controllerRoleEnabled(hby: Habery, pre: string): boolean {
  const end = hby.db.ends.get([pre, EndpointRoles.controller, pre]);
  return !!(end?.allowed || end?.enabled);
}

function preferredControllerUrl(hab: Hab): string | null {
  const https = hab.fetchUrls(hab.pre, Schemes.https).https;
  if (typeof https === "string" && https.length > 0) {
    return https;
  }
  const http = hab.fetchUrls(hab.pre, Schemes.http).http;
  return typeof http === "string" && http.length > 0 ? http : null;
}

function controllerStartupComplete(hby: Habery, hab: Hab): boolean {
  return controllerRoleEnabled(hby, hab.pre)
    && preferredControllerUrl(hab) !== null;
}

function schemaInputsFromArgs(args: Record<string, unknown>): {
  schemas: string[];
  schemaDirs: string[];
} {
  return {
    schemas: asStringList(args.schema),
    schemaDirs: asStringList(args.schemaDir),
  };
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" ? [value] : [];
}

function schemaFiles(schemaFiles: readonly string[], schemaDirs: readonly string[]): string[] {
  const files = [...schemaFiles];
  for (const dir of schemaDirs) {
    for (const entry of Deno.readDirSync(dir)) {
      if (entry.isFile) {
        files.push(`${dir.replace(/\/+$/u, "")}/${entry.name}`);
      }
    }
  }
  return [...new Set(files)].sort();
}

function importHostedSchemas(
  hby: Habery,
  schemaFilesInput: readonly string[],
  schemaDirsInput: readonly string[],
): void {
  for (const path of schemaFiles(schemaFilesInput, schemaDirsInput)) {
    try {
      const schemer = new Schemer({ raw: Deno.readFileSync(path) });
      hby.db.schema.pin(schemer.said, schemer);
    } catch (error) {
      throw new ValidationError(
        `Unable to import schema ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function validateHostedControllerBootstrap(
  hby: Habery,
  seedHabs: readonly Hab[],
): void {
  for (const hab of seedHabs) {
    if (!hab.hasConfigSection()) {
      throw new ValidationError(
        `Agent alias ${hab.name} is missing controller curls config.`,
      );
    }
    if (!controllerStartupComplete(hby, hab)) {
      throw new ValidationError(
        `Configured controller endpoint state for alias ${hab.name} is incomplete.`,
      );
    }
  }
}

/**
 * Agent command operation - starts the HTTP server
 *
 * Host model:
 * - reopen one local habery
 * - create one shared `AgentRuntime`
 * - seed only the minimum local self-auth state needed for current host
 *   behavior into the runtime path
 * - run the continuous runtime loop and protocol HTTP host together
 *
 * Current scope:
 * - this is the Gate E indirect-mode host for OOBI/resource serving
 * - it is not a localhost admin API and should not be documented as one
 *
 * Intentional non-goal:
 * - do not auto-seed self `agent` end roles just because the role exists in
 *   the endpoint model; support for a role and startup synthesis of that role
 *   are separate choices
 */
export function* agentCommand(args: Record<string, unknown>): Operation<void> {
  const agentArgs: AgentArgs = {
    port: args.port ? Number(args.port) : 8000,
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    configDir: args.configDir as string | undefined,
    configFile: args.configFile as string | undefined,
    passcode: args.passcode as string | undefined,
    compat: args.compat as boolean | undefined,
    outboxer: args.outboxer as boolean | undefined,
    cesrBodyMode: normalizeCesrBodyMode(
      args.cesrBodyMode as string | undefined,
    ),
    ...schemaInputsFromArgs(args),
  };
  const port = agentArgs.port ?? 8000;

  // Validate port number
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new ValidationError(
      `Invalid port number: ${port}. Port must be between 1 and 65535.`,
      { port },
    );
  }
  if (!agentArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }

  const cf: Configer | undefined = agentArgs.configFile
    ? (yield* createConfiger({
      name: agentArgs.configFile,
      base: "",
      temp: false,
      headDirPath: agentArgs.configDir,
      reopen: true,
      clear: false,
    }))
    : undefined;
  const hby = yield* setupHby(
    agentArgs.name,
    agentArgs.base ?? "",
    agentArgs.passcode,
    false,
    agentArgs.headDirPath,
    {
      compat: agentArgs.compat ?? false,
      readonly: false,
      cf,
      skipConfig: false,
      skipSignator: false,
      outboxer: agentArgs.outboxer ?? false,
      cesrBodyMode: agentArgs.cesrBodyMode,
    },
  );

  try {
    const seedHabs = [...hby.habs.values()].filter((hab) => !hby.db.getHab(hab.pre)?.mid);
    importHostedSchemas(
      hby,
      agentArgs.schemas ?? [],
      agentArgs.schemaDirs ?? [],
    );
    const cueHab = seedHabs[0];
    if (!cueHab) {
      throw new ValidationError(
        "Agent host requires at least one local identifier.",
      );
    }
    validateHostedControllerBootstrap(hby, seedHabs);
    yield* runIndirectHost(hby, {
      port,
      listenHost: "127.0.0.1",
      serviceHab: cueHab,
      hostedPrefixes: seedHabs.map((hab) => hab.pre),
      seedHabs,
      directQueryResponses: true,
      onListen: ({ hostname, port }) => {
        console.log(`Server listening on http://${hostname}:${port}`);
      },
    });
  } finally {
    yield* hby.close();
  }
}
