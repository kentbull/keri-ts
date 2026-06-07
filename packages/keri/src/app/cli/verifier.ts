import { action, type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { Reger } from "../../db/reger.ts";
import { createVerifierCueBaser, type VerifierCueBaser } from "../../db/verifier-cueing.ts";
import { type AgentRuntime, createAgentRuntime } from "../agent-runtime.ts";
import type { Habery } from "../habbing.ts";
import { validatorsFromVerifierConfig, VerifierAgent, type VerifierAgentProcessResult } from "../verifier-agent.ts";
import { setupHby } from "./common/existing.ts";

interface VerifierRunArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  compat?: boolean;
  hook?: string;
  config?: string;
  once?: boolean;
  intervalMs?: number;
  timeoutMs?: number;
}

export function* verifierRunCommand(args: Record<string, unknown>): Operation<void> {
  const runArgs: VerifierRunArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    compat: args.compat as boolean | undefined,
    hook: args.hook as string | undefined,
    config: args.config as string | undefined,
    once: args.once as boolean | undefined,
    intervalMs: numberArg(args.intervalMs, 1000),
    timeoutMs: numberArg(args.timeoutMs, undefined),
  };
  requireNonEmpty(runArgs.name, "Name");
  requireNonEmpty(runArgs.hook, "Webhook URL");

  const { hby, runtime, reger, cdb } = yield* openVerifierRuntime(runArgs);
  try {
    const config = runArgs.config ? JSON.parse(Deno.readTextFileSync(runArgs.config)) : {};
    const agent = new VerifierAgent({
      hby,
      reger,
      cdb,
      reactor: runtime.reactor,
      cues: runtime.cues,
      services: runtime.services,
      hook: runArgs.hook!,
      timeoutMs: runArgs.timeoutMs,
      validators: validatorsFromVerifierConfig(config),
      requireKnownSchemas: isRecord(config) && config.requireKnownSchemas === true,
    });

    if (runArgs.once ?? false) {
      const result = yield* processAgentOnce(agent);
      console.log(JSON.stringify({ result, counts: cdb.getCounts() }));
      return;
    }

    while (true) {
      const result = yield* processAgentOnce(agent);
      console.log(JSON.stringify({ result, counts: cdb.getCounts() }));
      yield* sleep(runArgs.intervalMs ?? 1000);
    }
  } finally {
    yield* cdb.close();
    yield* runtime.close();
    yield* hby.close();
  }
}

function* processAgentOnce(agent: VerifierAgent): Operation<VerifierAgentProcessResult> {
  return yield* action((resolve, reject) => {
    agent.processOnce().then(resolve, reject);
    return () => {};
  });
}

function* openVerifierRuntime(
  args: VerifierRunArgs,
): Operation<{ hby: Habery; runtime: AgentRuntime; reger: Reger; cdb: VerifierCueBaser }> {
  const hby = yield* setupHby(
    args.name!,
    args.base ?? "",
    args.passcode,
    false,
    args.headDirPath,
    {
      compat: args.compat ?? false,
      skipConfig: true,
    },
  );
  const runtime = yield* createAgentRuntime(hby, { mode: "local" });
  const reger = runtime.vdr.reger;
  if (!(reger instanceof Reger)) {
    throw new ValidationError("VDR runtime did not open Reger.");
  }
  const cdb = yield* createVerifierCueBaser({
    name: hby.name,
    base: hby.base,
    temp: hby.temp,
    headDirPath: hby.headDirPath,
    compat: hby.compat,
  });
  return { hby, runtime, reger, cdb };
}

function* sleep(ms: number): Operation<void> {
  yield* action((resolve) => {
    const timeoutId = setTimeout(() => resolve(undefined), ms);
    return () => clearTimeout(timeoutId);
  });
}

function numberArg(value: unknown, fallback: number | undefined): number | undefined {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError(`Invalid numeric argument ${String(value)}.`);
  }
  return parsed;
}

function requireNonEmpty(value: string | undefined, label: string): void {
  if (!value) {
    throw new ValidationError(`${label} is required and cannot be empty.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
