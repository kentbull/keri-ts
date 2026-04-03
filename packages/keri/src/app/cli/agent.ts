import { type Operation, spawn } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { consoleLogger } from "../../core/logger.ts";
import { EndpointRoles } from "../../core/roles.ts";
import { Schemes } from "../../core/schemes.ts";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn, runAgentRuntime } from "../agent-runtime.ts";
import { startServer } from "../server.ts";
import { setupHby } from "./common/existing.ts";

/** Parsed arguments for the long-lived `tufa agent` host command. */
interface AgentArgs {
  port?: number;
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  compat?: boolean;
}

/**
 * Agent command operation - starts the HTTP server
 *
 * Host model:
 * - reopen one local habery
 * - create one shared `AgentRuntime`
 * - seed local controller/agent location auth into the runtime path
 * - run the continuous runtime loop and protocol HTTP host together
 *
 * Current scope:
 * - this is the Gate E indirect-mode host for OOBI/resource serving
 * - it is not a localhost admin API and should not be documented as one
 */
export function* agentCommand(args: Record<string, unknown>): Operation<void> {
  const agentArgs: AgentArgs = {
    port: args.port ? Number(args.port) : 8000,
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    compat: args.compat as boolean | undefined,
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

  const hby = yield* setupHby(
    agentArgs.name,
    agentArgs.base ?? "",
    agentArgs.passcode,
    false,
    agentArgs.headDirPath,
    {
      compat: agentArgs.compat ?? false,
      readonly: false,
      skipConfig: false,
      skipSignator: false,
    },
  );

  const runtime = createAgentRuntime(hby, { mode: "indirect" });
  try {
    const publicUrl = `http://127.0.0.1:${port}`;
    for (const hab of hby.habs.values()) {
      // add local CESR stream bytes for the loc scheme and endroles for the local controller config
      ingestKeriBytes(runtime, hab.makeLocScheme(publicUrl, hab.pre, Schemes.http));
      ingestKeriBytes(runtime, hab.makeEndRole(hab.pre, EndpointRoles.controller, true));
      ingestKeriBytes(runtime, hab.makeEndRole(hab.pre, EndpointRoles.agent, true));
      yield* processRuntimeTurn(runtime, { hab });
    }

    console.log(`Starting server on port ${port}`);
    const cueHab = hby.habs.values().next().value;
    // spawn here creates a child Effection frame and immediately starts it. Lifetime is this lexical scope.
    const runtimeTask = yield* spawn(function*() {
      yield* runAgentRuntime(runtime, { hab: cueHab });
    });
    try {
      yield* startServer(port, consoleLogger, runtime);
    } finally {
      yield* runtimeTask.halt();
    }
  } finally {
    yield* hby.close();
  }
}
