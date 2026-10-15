import type { Versionage } from "cesr-ts";
import { action, type Operation } from "npm:effection@^3.6.0";
import { parseGvrsn } from "../../core/attachment-countering.ts";
import { ValidationError } from "../../core/errors.ts";
import { Reger } from "../../db/reger.ts";
import { createVerifierCueBaser } from "../../db/verifier-cueing.ts";
import type { AgentRuntime } from "../agent-runtime.ts";
import { validatorsFromVerifierConfig, VerifierAgent } from "../verifier-agent.ts";
import { withAgentRuntime } from "./common/context.ts";

interface VerifierRunArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  compat?: boolean;
  hook?: string;
  gvrsn?: Versionage;
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
    gvrsn: parseGvrsn(args.gvrsn),
    config: args.config as string | undefined,
    once: args.once as boolean | undefined,
    intervalMs: numberArg(args.intervalMs, 1000),
    timeoutMs: numberArg(args.timeoutMs, undefined),
  };
  requireNonEmpty(runArgs.name, "Name");
  requireNonEmpty(runArgs.hook, "Webhook URL");
  const hook = runArgs.hook!;

  yield* withAgentRuntime(
    runArgs,
    {
      compat: runArgs.compat ?? false,
      skipConfig: true,
    },
    function*({ hby, runtime }) {
      const reger = requireReger(runtime);
      const cdb = yield* createVerifierCueBaser({
        name: hby.name,
        base: hby.base,
        temp: hby.temp,
        headDirPath: hby.headDirPath,
        compat: hby.compat,
      });
      try {
        const config = runArgs.config ? JSON.parse(Deno.readTextFileSync(runArgs.config)) : {};
        const agent = new VerifierAgent({
          hby,
          reger,
          cdb,
          reactor: runtime.reactor,
          cues: runtime.cues,
          services: runtime.services,
          hook,
          gvrsn: runArgs.gvrsn,
          timeoutMs: runArgs.timeoutMs,
          validators: validatorsFromVerifierConfig(config),
          requireKnownSchemas: isRecord(config) && config.requireKnownSchemas === true,
        });

        if (runArgs.once ?? false) {
          const result = yield* agent.processOnce();
          console.log(JSON.stringify({ result, counts: cdb.getCounts() }));
          return;
        }

        while (true) {
          const result = yield* agent.processOnce();
          console.log(JSON.stringify({ result, counts: cdb.getCounts() }));
          yield* sleep(runArgs.intervalMs ?? 1000);
        }
      } finally {
        yield* cdb.close();
      }
    },
  );
}

function requireReger(runtime: AgentRuntime): Reger {
  const reger = runtime.vdr.reger;
  if (!(reger instanceof Reger)) {
    throw new ValidationError("VDR runtime did not open Reger.");
  }
  return reger;
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
