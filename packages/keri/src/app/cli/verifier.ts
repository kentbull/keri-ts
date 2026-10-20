import type { Versionage } from "cesr-ts";
import { action, type Operation } from "npm:effection@^3.6.0";
import { parseGvrsn } from "../../core/attachment-countering.ts";
import { ValidationError } from "../../core/errors.ts";
import { createVerifierCueBaser } from "../../db/verifier-cueing.ts";
import { validatorsFromVerifierConfig, VerifierAgent } from "../verifier-agent.ts";
import { withAgentRuntime } from "./common/context.ts";
import { parseBooleanOption, parseNumberOption, parseStringOption } from "./common/parsing.ts";

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

/**
 * Run the verifier workflow once or on its configured interval, closing its workflow store before the enclosing runtime/Habery.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* verifierRunCommand(args: Record<string, unknown>): Operation<void> {
  const runArgs: VerifierRunArgs = {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    compat: parseBooleanOption(args.compat, "compat"),
    hook: parseStringOption(args.hook, "hook"),
    gvrsn: parseGvrsn(args.gvrsn),
    config: parseStringOption(args.config, "config"),
    once: parseBooleanOption(args.once, "once"),
    intervalMs: numberArg(args.intervalMs, 1000, "intervalMs"),
    timeoutMs: numberArg(args.timeoutMs, undefined, "timeoutMs"),
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
      const rgy = runtime.vdr;
      if (!rgy) throw new ValidationError("Legacy credential registry is unavailable in this runtime.");
      const reger = rgy.reger;
      const cdb = yield* createVerifierCueBaser({
        name: hby.name,
        base: hby.base,
        temp: hby.temp,
        headDirPath: hby.headDirPath,
        compat: hby.compat,
      });
      try {
        const config = runArgs.config ? JSON.parse(Deno.readTextFileSync(runArgs.config)) : {};
        const agent = new VerifierAgent(
          hby,
          reger,
          cdb,
          runtime.protocol,
          runtime.cues,
          runtime.http,
          () => runtime.clock.now(),
          validatorsFromVerifierConfig(config),
          {
            hook,
            gvrsn: runArgs.gvrsn,
            timeoutMs: runArgs.timeoutMs,
            requireKnownSchemas: isRecord(config) && config.requireKnownSchemas === true,
          },
        );

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

function* sleep(ms: number): Operation<void> {
  yield* action((resolve) => {
    const timeoutId = setTimeout(() => resolve(undefined), ms);
    return () => clearTimeout(timeoutId);
  });
}

function numberArg(value: unknown, fallback: number | undefined, label: string): number | undefined {
  const parsed = parseNumberOption(value, label) ?? fallback;
  if (parsed !== undefined && parsed < 0) {
    throw new ValidationError(`${label} must not be negative.`);
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
