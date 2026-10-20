import type { Operation } from "effection";
import { parseBooleanOption, parseIntegerOption, parseStringListOption, parseStringOption } from "keri-ts/cli";
import {
  type Configer,
  createConfiger,
  EndpointRoles,
  type Hab,
  type Habery,
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
  schemas?: string[];
  schemaDirs?: string[];
  backerAlias?: string;
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
    schemas: asStringList(args.schema, "schema"),
    schemaDirs: asStringList(args.schemaDir, "schemaDir"),
  };
}

/** Accept scalar or repeated paths while rejecting malformed list members. */
function asStringList(value: unknown, label: string): string[] {
  if (typeof value === "string") return [value];
  return parseStringListOption(value, label) ?? [];
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
  hostedHabs: readonly Hab[],
): void {
  for (const hab of hostedHabs) {
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
    port: parseIntegerOption(args.port, "port") ?? 8000,
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    configDir: parseStringOption(args.configDir, "configDir"),
    configFile: parseStringOption(args.configFile, "configFile"),
    passcode: parseStringOption(args.passcode, "passcode"),
    compat: parseBooleanOption(args.compat, "compat"),
    ...schemaInputsFromArgs(args),
    backerAlias: parseStringOption(args.backerAlias, "backerAlias"),
  };
  const port = agentArgs.port ?? 8000;

  // Validate port number
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new ValidationError(
      `Invalid port number: ${port}. Port must be between 1 and 65535.`,
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
    },
  );

  try {
    const hostedHabs = [...hby.habs.values()].filter((hab) => !hby.db.getHab(hab.pre)?.mid);
    const backerHab = agentArgs.backerAlias ? hostedHabs.find((hab) => hab.name === agentArgs.backerAlias) : undefined;
    if (agentArgs.backerAlias && (!backerHab || backerHab.kever?.transferable)) {
      throw new ValidationError("Backer alias must select a local nontransferable identifier.");
    }
    importHostedSchemas(
      hby,
      agentArgs.schemas ?? [],
      agentArgs.schemaDirs ?? [],
    );
    const cueHab = hostedHabs[0];
    if (!cueHab) {
      throw new ValidationError(
        "Agent host requires at least one local identifier.",
      );
    }
    validateHostedControllerBootstrap(hby, hostedHabs);
    yield* runIndirectHost(hby, {
      port,
      listenHost: "127.0.0.1",
      serviceHab: cueHab,
      backerHab,
      hostedPrefixes: hostedHabs.map((hab) => hab.pre),
      onListen: ({ hostname, port }) => {
        console.log(`Server listening on http://${hostname}:${port}`);
      },
    });
  } finally {
    yield* hby.close();
  }
}
