import { Registrar } from "@keri-ts/registrar";
import { AcdcV2Verifier, createVerifierCueBaser, validatorsFromVerifierConfig, VerifierAgent } from "@keri-ts/verifier";
import type { Versionage } from "cesr-ts";
import { parseBooleanOption, parseGvrsn, parseNumberOption, parseStringOption } from "keri-ts/cli";
import { ValidationError } from "keri-ts/runtime";
import { action, type Operation } from "npm:effection@^3.6.0";
import { withAgentRuntime } from "../support/context.ts";

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
  const acdcV2 = parseBooleanOption(args.acdcV2, "acdc-v2") ?? false;
  const alias = parseStringOption(args.alias, "alias");
  if (acdcV2 && !alias) {
    throw new ValidationError("ACDC v2 verifier requires alias.");
  }
  const config = runArgs.config ? JSON.parse(Deno.readTextFileSync(runArgs.config)) : {};
  const observation = acdcV2 ? observationConfig(config) : undefined;

  const completed = yield* withAgentRuntime(
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
      let failure: { error: unknown } | undefined;
      try {
        const acdcV2Hab = alias ? hby.habByName(alias) : null;
        if (acdcV2 && (!acdcV2Hab || !runtime.acdc)) {
          throw new ValidationError("ACDC v2 verifier identity or registry store is unavailable.");
        }
        const acdcV2Verifier = acdcV2
          ? new AcdcV2Verifier(
            hby,
            acdcV2Hab!,
            runtime.exc,
            new Registrar(runtime.protocol, runtime.acdc!.store),
            runtime.http,
            {
              ...observation!,
              now: () => runtime.clock.now(),
            },
          )
          : undefined;
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
            acdcV2: acdcV2Verifier,
            gvrsn: runArgs.gvrsn,
            timeoutMs: runArgs.timeoutMs,
            requireKnownSchemas: isRecord(config) && config.requireKnownSchemas === true,
          },
        );

        if (runArgs.once ?? false) {
          const result = yield* agent.processOnce();
          return { result, counts: cdb.getCounts() };
        }

        while (true) {
          const result = yield* agent.processOnce();
          console.log(JSON.stringify({ result, counts: cdb.getCounts() }));
          yield* sleep(runArgs.intervalMs ?? 1000);
        }
      } catch (error) {
        failure = { error };
        throw error;
      } finally {
        try {
          yield* cdb.close();
        } catch (error) {
          if (failure) {
            // deno-lint-ignore no-unsafe-finally -- Preserve operation failure alongside owned-store shutdown failure.
            throw new AggregateError([failure.error, error], "Verifier operation and cue-store close failed", {
              cause: failure.error,
            });
          }
          // deno-lint-ignore no-unsafe-finally -- A failed owned shutdown cannot become successful command completion.
          throw error;
        }
      }
    },
  );
  // --once is a final command result; the loop's per-pass output is progress.
  // Required cue-store, runtime and Habery cleanup finishes before this success line.
  if (completed) console.log(JSON.stringify(completed));
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

/** Application observation policy shares the existing schema-policy config and validates before stores open. */
function observationConfig(config: unknown): { source: string; requestTimeoutMs: number } {
  const observation = isRecord(config) && isRecord(config.observation) ? config.observation : {};
  const source = parseStringOption(observation.url, "observation.url");
  if (!source) throw new ValidationError("observation.url is required for ACDC v2 verification.");
  const url = new URL(source);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new ValidationError("observation.url must be HTTPS without credentials, query or fragment.");
  }
  const requestTimeoutMs = numberArg(observation.requestTimeoutMs, 5000, "observation.requestTimeoutMs")!;
  if (requestTimeoutMs <= 0) {
    throw new ValidationError("Request timeout must be positive.");
  }
  return { source, requestTimeoutMs };
}
