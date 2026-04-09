import type { Operation } from "npm:effection@^3.6.0";
import {
  type CesrBodyMode,
  type Configer,
  createAgentRuntime,
  createConfiger,
  type Hab,
  type Habery,
  ingestKeriBytes,
  normalizeCesrBodyMode,
  processRuntimeTurn,
} from "../../../keri/runtime.ts";
import { setupHby } from "../../../keri/src/app/cli/common/existing.ts";
import { ValidationError } from "../../../keri/src/core/errors.ts";
import { EndpointRoles } from "../../../keri/src/core/roles.ts";
import { Schemes } from "../../../keri/src/core/schemes.ts";
import { runHostKernel } from "../host/kernel.ts";

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
}

/** Shared long-lived indirect-host settings used by `agent` and mailbox start. */
export interface IndirectHostOptions {
  port: number;
  listenHost?: string;
  serviceHab: Hab;
  hostedPrefixes?: readonly string[];
  seedHabs?: readonly Hab[];
  onListen?: (address: { port: number; hostname: string }) => void;
}

/**
 * Run one long-lived indirect host over the shared protocol runtime.
 *
 * This is the reusable host seam that higher-level porcelain commands build
 * upon. Startup policy is intentionally explicit so mailbox-specific porcelain
 * can select one hosted prefix without inheriting `agent`-specific role
 * seeding.
 */
export function* runIndirectHost(
  hby: Habery,
  options: IndirectHostOptions,
): Operation<void> {
  const seedHabs = options.seedHabs ?? [options.serviceHab];
  const hostedPrefixes = options.hostedPrefixes
    ?? seedHabs.map((hab) => hab.pre);
  yield* runHostKernel(hby, {
    runtimeMode: "indirect",
    serviceHab: options.serviceHab,
    seedHabs,
    hostedPrefixes,
    http: {
      port: options.port,
      hostname: options.listenHost,
      onListen: options.onListen,
    },
    protocolPolicy: {
      serviceHab: options.serviceHab,
      hostedPrefixes,
    },
  });
}

function configuredControllerState(hab: Hab): boolean {
  return hab.hasConfigSection();
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

function* reconcileHostedControllerBootstrap(
  hby: Habery,
  seedHabs: readonly Hab[],
  synthesizeRootUrl: string,
): Operation<void> {
  const runtime = yield* createAgentRuntime(hby, { mode: "local" });
  try {
    for (const hab of seedHabs) {
      if (configuredControllerState(hab)) {
        if (!controllerStartupComplete(hby, hab)) {
          throw new ValidationError(
            `Configured controller endpoint state for alias ${hab.name} is incomplete.`,
          );
        }
        continue;
      }

      if (!controllerRoleEnabled(hby, hab.pre)) {
        ingestKeriBytes(
          runtime,
          hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
        );
      }
      if (!preferredControllerUrl(hab)) {
        ingestKeriBytes(
          runtime,
          hab.makeLocScheme(synthesizeRootUrl, hab.pre, Schemes.http),
        );
      }
      yield* processRuntimeTurn(runtime, { hab, pollMailbox: false });

      if (!controllerStartupComplete(hby, hab)) {
        throw new ValidationError(
          `Fallback controller endpoint bootstrap failed for alias ${hab.name}.`,
        );
      }
    }
  } finally {
    yield* runtime.close();
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
    const seedHabs = [...hby.habs.values()];
    const cueHab = seedHabs[0];
    if (!cueHab) {
      throw new ValidationError(
        "Agent host requires at least one local identifier.",
      );
    }
    yield* reconcileHostedControllerBootstrap(
      hby,
      seedHabs,
      `http://127.0.0.1:${port}`,
    );
    yield* runIndirectHost(hby, {
      port,
      listenHost: "127.0.0.1",
      serviceHab: cueHab,
      hostedPrefixes: seedHabs.map((hab) => hab.pre),
      seedHabs,
      onListen: ({ hostname, port }) => {
        console.log(`Server listening on http://${hostname}:${port}`);
      },
    });
  } finally {
    yield* hby.close();
  }
}
