import { action, type Operation } from "effection";
import { t } from "../../../../cesr/mod.ts";
import { createHabery, type Habery } from "../../../src/app/habbing.ts";
import { resolveKeripyRuntime } from "./interop-test-helpers.ts";

/** Exit status and decoded diagnostics from one CLI invocation. */
interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Isolated filesystem home and explicitly verified CLI runtime for one test. */
export interface ScenarioContext {
  env: Record<string, string>;
  packageRoot: string;
  kliCommand: string;
}

/**
 * Runs a CLI command under the supplied environment and returns decoded output.
 *
 * The interop tests execute both `kli` and `tufa`, so keeping command execution
 * in one helper ensures stdout/stderr decoding and cwd/env handling stay
 * consistent across all scenarios.
 */
export async function runCmd(
  command: string,
  args: string[],
  env: Record<string, string>,
  cwd?: string,
): Promise<CmdResult> {
  const out = await new Deno.Command(command, {
    args,
    stdout: "piped",
    stderr: "piped",
    env,
    cwd,
  }).output();
  return {
    code: out.code,
    stdout: t(out.stdout),
    stderr: t(out.stderr),
  };
}

/** Select the exact configured KERIpy revision before launching either CLI. */
async function resolveKliCommand(env: Record<string, string>, workDir: string): Promise<string> {
  return (await resolveKeripyRuntime(workDir, env)).kliCommand;
}

/**
 * Parses the human-readable `Prefix` line emitted by both CLIs after `incept`.
 *
 * This helper keeps the tests focused on parity assertions instead of
 * re-implementing line parsing at each call site.
 */
export function extractPrefix(output: string): string {
  const line = output.split(/\r?\n/).find((line) => line.trim().startsWith("Prefix"));
  if (!line) {
    throw new Error(`Unable to parse prefix from output:\n${output}`);
  }
  const parts = line.trim().split(/\s+/);
  return parts[parts.length - 1];
}

/**
 * Normalizes non-deterministic timestamp encodings out of exported CESR text.
 *
 * KEL export parity should fail on semantic differences, not on attachment
 * timestamps that are expected to vary between runs. This replaces both ISO
 * timestamps and CESR datetime encodings with a stable token before comparing.
 */
export function normalizeCesr(text: string): string {
  return text
    .replace(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}:\d{2})/g,
      "<TS>",
    )
    .replace(
      /\d{4}-\d{2}-\d{2}T\d{2}c\d{2}c\d{2}d\d{6}p\d{2}c\d{2}/g,
      "<TS>",
    )
    .replace(/\r\n/g, "\n")
    .trim();
}

/**
 * Extracts only serialized KEL events from mixed CLI export output.
 *
 * The CLIs may include banner or status lines around an export. Gate parity is
 * about the event stream itself, so this helper filters to the JSON KERI event
 * payloads that should match exactly after normalization.
 */
export function extractKelStream(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("{\"v\":\"KERI"))
    .join("\n");
}

/**
 * Parses `tufa list` / `kli list` output down to the identifier summary lines.
 *
 * The visibility scenarios only care that the same identifiers are exposed, so
 * this strips decorative output and retains the `alias (prefix)` records used
 * for parity assertions.
 */
export function extractIdentifierLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[^:()]+ \([A-Za-z0-9_-]{10,}\)$/.test(line));
}

/**
 * Returns the final meaningful line from command output.
 *
 * `aid` currently emits a single identifier on the last non-empty line. Using
 * a helper makes that output contract explicit and keeps the scenario code
 * terse.
 */
export function extractLastNonEmptyLine(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const line = lines.at(-1);
  if (!line) {
    throw new Error(`Unable to parse line from output:\n${output}`);
  }
  return line;
}

/**
 * Resolves the workspace root used when invoking the local `tufa` CLI
 * entrypoint.
 */
function packageRoot(): string {
  return new URL("../../../../../", import.meta.url).pathname;
}

/**
 * Executes the local `tufa` CLI from source rather than an installed binary.
 *
 * Interop tests compare installed KERIpy tooling to the in-repo implementation
 * under development, so they intentionally run
 * `deno run packages/tufa/mod.ts ...` in the workspace root instead of
 * assuming a globally installed `tufa`.
 */
export async function runTufa(
  args: string[],
  env: Record<string, string>,
  cwd: string,
): Promise<CmdResult> {
  return await runCmd(
    Deno.execPath(),
    ["run", "--allow-all", "--unstable-ffi", "packages/tufa/mod.ts", ...args],
    env,
    cwd,
  );
}

/**
 * Preserves the active Deno cache directory when tests override `HOME`.
 *
 * These interop tests create isolated homes so KERIpy and `tufa` stores do not
 * collide. Without also carrying forward `DENO_DIR`, `deno run` may look for a
 * different cache rooted under the temp home and spuriously fail on dependency
 * resolution. We first respect an explicit environment override, then fall back
 * to `deno info --json` to discover the current cache location.
 */
async function detectDenoDir(): Promise<string | undefined> {
  const explicit = Deno.env.get("DENO_DIR");
  if (explicit) {
    return explicit;
  }

  try {
    const out = await new Deno.Command(Deno.execPath(), {
      args: ["info", "--json"],
      stdout: "piped",
      stderr: "null",
    }).output();
    if (out.code !== 0) {
      return undefined;
    }
    const parsed = JSON.parse(t(out.stdout)) as {
      denoDir?: string;
    };
    return parsed.denoDir;
  } catch {
    return undefined;
  }
}

/**
 * Build one isolated interop scenario context rooted in a temporary home.
 *
 * Boundary note:
 * - this intentionally stays promise-based because it only performs host setup
 *   (`makeTempDir`, env discovery, CLI lookup) before any Effection-owned
 *   runtime resource is opened
 */
export async function createScenarioContext(): Promise<ScenarioContext> {
  const home = await Deno.makeTempDir({ prefix: "tufa-keystore-interop-home-" });
  const denoDir = await detectDenoDir();
  const env = {
    ...Deno.env.toObject(),
    HOME: home,
    ...(denoDir ? { DENO_DIR: denoDir } : {}),
  };
  return {
    env,
    packageRoot: packageRoot(),
    kliCommand: await resolveKliCommand(env, home),
  };
}

/**
 * Temporarily override process-global environment variables for one Effection
 * operation and restore them when the surrounding scope exits.
 *
 * This is modeled as an `Operation` because it owns mutable process-global
 * state for the duration of another Effection-managed resource open.
 */
function* withProcessEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Operation<T>,
): Operation<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Deno.env.get(key));
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }

  try {
    return yield* fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  }
}

/**
 * Open one `Habery` under the scenario's isolated environment, inspect it, and
 * close it before the current Effection scope exits.
 *
 * Ownership rule:
 * - this helper owns both temporary env mutation and the `Habery` lifecycle
 * - callers should `yield*` it from an Effection scope instead of manually
 *   wrapping `createHabery()` / `close()` in ad hoc `run()` calls
 */
export function* inspectHabery(
  ctx: ScenarioContext,
  args: Parameters<typeof createHabery>[0],
  inspect: (hby: Habery) => void,
): Operation<void> {
  yield* withProcessEnv(
    {
      HOME: ctx.env.HOME,
      DENO_DIR: ctx.env.DENO_DIR,
    },
    function*() {
      const hby = yield* createHabery(args);
      try {
        inspect(hby);
      } finally {
        yield* hby.close();
      }
    },
  );
}

/**
 * Adapt one uncancellable host promise into the current Effection task.
 *
 * Use this sparingly for outer test-harness glue such as subprocess-backed CLI
 * invocations. The promise itself remains a host boundary; this helper just
 * keeps that boundary explicit when the surrounding scenario is modeled as an
 * `Operation`.
 */
export function* promiseOp<T>(fn: () => Promise<T>): Operation<T> {
  return yield* action((resolve, reject) => {
    fn().then(resolve, reject);
    return () => {};
  });
}
