import { action, type Operation, run } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { t } from "../../../../cesr/mod.ts";
import { createHabery, type Habery } from "../../../src/app/habbing.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { ensureCompatLmdbBuild } from "../../../test/utils.ts";

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

type Gate = "A" | "B" | "C" | "D" | "E" | "F" | "G";
type ScenarioState = "ready" | "pending";

interface ScenarioContext {
  env: Record<string, string>;
  packageRoot: string;
  kliCommand: string;
}

interface GateScenario {
  id: string;
  gate: Gate;
  state: ScenarioState;
  requiredTufaCommands: string[];
  expectedOutputShape: string;
  blockedReason?: string;
  run?: (ctx: ScenarioContext) => Promise<void>;
}

type SpawnedChild = Deno.ChildProcess;

/**
 * Runs a CLI command under the supplied environment and returns decoded output.
 *
 * The interop tests execute both `kli` and `tufa`, so keeping command execution
 * in one helper ensures stdout/stderr decoding and cwd/env handling stay
 * consistent across all scenarios.
 */
async function runCmd(
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

/**
 * Probes a resolved `kli` candidate to verify that it is both executable and
 * actually the KERI CLI.
 *
 * PATHs that flow through `pyenv` or shell shims can resolve to stale or
 * unrelated binaries. Checking `--help` output gives the harness a cheap,
 * non-mutating sanity check before we trust the command in live scenarios.
 */
async function canUseKli(
  command: string,
  env: Record<string, string>,
): Promise<boolean> {
  try {
    const res = await runCmd(command, ["--help"], env);
    const text = `${res.stdout}\n${res.stderr}`;
    return res.code === 0 && /usage:\s*kli\b/i.test(text);
  } catch {
    return false;
  }
}

/**
 * Resolves the concrete `kli` executable to use for interop scenarios.
 *
 * We prefer `pyenv which kli` when available because the desktop environment
 * may expose shims on PATH that do not survive isolated test environments. We
 * then fall back to plain PATH lookup. Each candidate is validated with
 * `canUseKli()` so the harness fails loudly instead of silently skipping.
 */
async function resolveKliCommand(env: Record<string, string>): Promise<string> {
  const candidates: string[] = [];

  try {
    const pyenvWhich = await runCmd("pyenv", ["which", "kli"], env);
    const resolved = pyenvWhich.stdout.trim();
    if (pyenvWhich.code === 0 && resolved.length > 0) {
      candidates.push(resolved);
    }
  } catch {
    // Fall through to PATH resolution.
  }

  candidates.push("kli");

  for (const candidate of candidates) {
    if (await canUseKli(candidate, env)) {
      return candidate;
    }
  }

  throw new Error(
    `kli is required for interop tests but could not be resolved. Tried: ${candidates.join(", ")}`,
  );
}

/**
 * Parses the human-readable `Prefix` line emitted by both CLIs after `incept`.
 *
 * This helper keeps the tests focused on parity assertions instead of
 * re-implementing line parsing at each call site.
 */
function extractPrefix(output: string): string {
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
function normalizeCesr(text: string): string {
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
function extractKelStream(output: string): string {
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
function extractIdentifierLines(output: string): string[] {
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
function extractLastNonEmptyLine(output: string): string {
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
 * Resolves the package root used when invoking the local `tufa` CLI entrypoint.
 */
function packageRoot(): string {
  return new URL("../../../", import.meta.url).pathname;
}

/**
 * Executes the local `tufa` CLI from source rather than an installed binary.
 *
 * Interop tests compare installed KERIpy tooling to the in-repo implementation
 * under development, so they intentionally run `deno run mod.ts ...` in the
 * package root instead of assuming a globally installed `tufa`.
 */
async function runTufa(
  args: string[],
  env: Record<string, string>,
  cwd: string,
): Promise<CmdResult> {
  return await runCmd(
    "deno",
    ["run", "--allow-all", "--unstable-ffi", "mod.ts", ...args],
    env,
    cwd,
  );
}

/**
 * Scrapes the top-level `tufa --help` output into a command set.
 *
 * The harness uses this to keep gate metadata honest by checking whether a
 * planned scenario only references commands that the CLI actually exposes.
 */
async function listTufaCommands(
  env: Record<string, string>,
  cwd: string,
): Promise<Set<string>> {
  const help = await runTufa(["--help"], env, cwd);
  const text = `${help.stdout}\n${help.stderr}`;
  const commands = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s{2,}([a-z][a-z0-9-]*)\s+/i);
    if (match) {
      commands.add(match[1]);
    }
  }
  return commands;
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
    const out = await new Deno.Command("deno", {
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
async function createScenarioContext(): Promise<ScenarioContext> {
  const home = await Deno.makeTempDir({ prefix: "tufa-gate-harness-home-" });
  const denoDir = await detectDenoDir();
  const env = {
    ...Deno.env.toObject(),
    HOME: home,
    ...(denoDir ? { DENO_DIR: denoDir } : {}),
  };
  return {
    env,
    packageRoot: packageRoot(),
    kliCommand: await resolveKliCommand(env),
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
function* inspectHabery(
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
function* promiseOp<T>(fn: () => Promise<T>): Operation<T> {
  return yield* action((resolve, reject) => {
    fn().then(resolve, reject);
    return () => {};
  });
}

/**
 * Poll a spawned agent's `/health` endpoint until it is reachable.
 *
 * Boundary note:
 * - this stays promise-based because it only wraps host `fetch()` plus timer
 *   polling and does not itself own any Effection-managed resource
 * - lifecycle-owning helpers such as `startTufaAgent()` adapt it locally at
 *   the subprocess boundary
 */
async function waitForHealth(
  port: number,
  attempts = 40,
): Promise<void> {
  const url = `http://127.0.0.1:${port}/health`;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await response.text();
        return;
      }
    } catch {
      // Keep polling until the process is ready or we time out.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

/**
 * Spawn a raw `tufa agent` child process with piped stdio.
 *
 * This is intentionally the low-level host boundary. It does not own cleanup;
 * higher-level helpers such as `startTufaAgent()` express the subprocess
 * lifecycle inside Effection scopes.
 */
function spawnTufaProcess(
  args: string[],
  ctx: ScenarioContext,
): SpawnedChild {
  return new Deno.Command("deno", {
    args: ["run", "--allow-all", "--unstable-ffi", "mod.ts", ...args],
    env: ctx.env,
    cwd: ctx.packageRoot,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
}

/** Best-effort host cleanup for one child stdio stream after shutdown. */
async function cancelChildStream(
  stream: ReadableStream<Uint8Array> | null,
): Promise<void> {
  if (!stream) {
    return;
  }

  try {
    await stream.cancel();
  } catch {
    // Streams may already be closed or fully consumed.
  }
}

/**
 * Perform the actual host-boundary subprocess shutdown and optional output
 * capture.
 *
 * This stays promise-based because Effection cleanup callbacks cannot `yield*`.
 * The public `stopChild()` operation wraps this path when shutdown itself needs
 * to stay inside an Effection task.
 */
async function stopChildNow(
  child: SpawnedChild,
  options: { captureOutput?: boolean } = {},
): Promise<string> {
  try {
    child.kill("SIGTERM");
  } catch {
    // Child may already be gone.
  }
  await child.status;
  if (options.captureOutput) {
    return await readChildOutput(child);
  }

  await Promise.all([
    cancelChildStream(child.stdout),
    cancelChildStream(child.stderr),
  ]);
  return "";
}

/**
 * Drain any remaining child stdout/stderr into a diagnostic string.
 *
 * This is used only after shutdown or startup failure so the harness can turn
 * opaque subprocess failures into actionable test messages.
 */
async function readChildOutput(child: SpawnedChild): Promise<string> {
  const [stdout, stderr] = await Promise.all([
    child.stdout ? new Response(child.stdout).text() : Promise.resolve(""),
    child.stderr ? new Response(child.stderr).text() : Promise.resolve(""),
  ]);
  return `${stdout}\n${stderr}`.trim();
}

/**
 * Stop one spawned child process inside the current Effection task.
 *
 * This is the structured-concurrency facade over the raw subprocess shutdown
 * path. It is intentionally an `Operation` so callers can keep shutdown inside
 * the same task tree that owned the process.
 */
function* stopChild(
  child: SpawnedChild,
  options: { captureOutput?: boolean } = {},
): Operation<string> {
  return yield* action((resolve, reject) => {
    stopChildNow(child, options).then(resolve, reject);
    return () => {};
  });
}

/**
 * Start `tufa agent` inside the current Effection task and wait for readiness.
 *
 * Responsibility split:
 * - this helper owns startup and startup-failure cleanup
 * - longer-lived ownership belongs to `withTufaAgent()`, which keeps the child
 *   alive for a scoped body and `yield* stopChild(...)` in `finally`
 *
 * The startup probe remains ordinary host-boundary async glue; the process is
 * only returned after `/health` is reachable.
 */
function* startTufaAgent(
  ctx: ScenarioContext,
  args: string[],
  port: number,
): Operation<SpawnedChild> {
  const child = spawnTufaProcess(args, ctx);
  try {
    yield* promiseOp(() => waitForHealth(port));
    return child;
  } catch (error) {
    const details = yield* stopChild(child, { captureOutput: true });
    throw new Error(
      `Failed to start tufa agent on port ${port}: ${
        error instanceof Error ? error.message : String(error)
      }\n${details}`,
    );
  }
}

/**
 * Own one started `tufa agent` subprocess for the duration of a scoped body.
 *
 * This is the structured-concurrency helper the harness should prefer when a
 * scenario needs a live protocol host across multiple assertions or CLI steps.
 */
function* withTufaAgent<T>(
  ctx: ScenarioContext,
  args: string[],
  port: number,
  body: (child: SpawnedChild) => Operation<T>,
): Operation<T> {
  const child = yield* startTufaAgent(ctx, args, port);
  try {
    return yield* body(child);
  } finally {
    yield* stopChild(child);
  }
}

async function runInitInceptExportParity(
  ctx: ScenarioContext,
): Promise<void> {
  const base = `gate-h-${crypto.randomUUID().slice(0, 8)}`;
  const alias = "interop-aid";
  const passcode = "MyPasscodeARealSecret";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const kliName = `kli-${crypto.randomUUID().slice(0, 8)}`;
  const tufaName = `tufa-${crypto.randomUUID().slice(0, 8)}`;

  const kliInit = await runCmd(ctx.kliCommand, [
    "init",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--salt",
    salt,
  ], ctx.env);
  if (kliInit.code !== 0) {
    throw new Error(`kli init failed: ${kliInit.stderr}\n${kliInit.stdout}`);
  }

  const kliIncept = await runCmd(ctx.kliCommand, [
    "incept",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
    "--transferable",
    "--isith",
    "1",
    "--icount",
    "1",
    "--nsith",
    "1",
    "--ncount",
    "1",
    "--toad",
    "0",
  ], ctx.env);
  if (kliIncept.code !== 0) {
    throw new Error(
      `kli incept failed: ${kliIncept.stderr}\n${kliIncept.stdout}`,
    );
  }

  const tufaInit = await runTufa(
    [
      "init",
      "--name",
      tufaName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--salt",
      salt,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaInit.code !== 0) {
    throw new Error(`tufa init failed: ${tufaInit.stderr}\n${tufaInit.stdout}`);
  }

  const tufaIncept = await runTufa(
    [
      "incept",
      "--name",
      tufaName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
      "--transferable",
      "--isith",
      "1",
      "--icount",
      "1",
      "--nsith",
      "1",
      "--ncount",
      "1",
      "--toad",
      "0",
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaIncept.code !== 0) {
    throw new Error(
      `tufa incept failed: ${tufaIncept.stderr}\n${tufaIncept.stdout}`,
    );
  }

  assertEquals(
    extractPrefix(tufaIncept.stdout),
    extractPrefix(kliIncept.stdout),
  );

  const kliExport = await runCmd(ctx.kliCommand, [
    "export",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
  ], ctx.env);
  if (kliExport.code !== 0) {
    throw new Error(
      `kli export failed: ${kliExport.stderr}\n${kliExport.stdout}`,
    );
  }

  const tufaExport = await runTufa(
    [
      "export",
      "--name",
      tufaName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaExport.code !== 0) {
    throw new Error(
      `tufa export failed: ${tufaExport.stderr}\n${tufaExport.stdout}`,
    );
  }

  assertEquals(
    normalizeCesr(extractKelStream(tufaExport.stdout)),
    normalizeCesr(extractKelStream(kliExport.stdout)),
  );
}

async function runListAidVisibilityParity(
  ctx: ScenarioContext,
): Promise<void> {
  const base = `gate-b-${crypto.randomUUID().slice(0, 8)}`;
  const alias = "interop-aid";
  const passcode = "MyPasscodeARealSecret";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const kliName = `kli-${crypto.randomUUID().slice(0, 8)}`;
  const tufaName = `tufa-${crypto.randomUUID().slice(0, 8)}`;

  const kliInit = await runCmd(ctx.kliCommand, [
    "init",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--salt",
    salt,
  ], ctx.env);
  if (kliInit.code !== 0) {
    throw new Error(`kli init failed: ${kliInit.stderr}\n${kliInit.stdout}`);
  }

  const tufaInit = await runTufa(
    [
      "init",
      "--name",
      tufaName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--salt",
      salt,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaInit.code !== 0) {
    throw new Error(`tufa init failed: ${tufaInit.stderr}\n${tufaInit.stdout}`);
  }

  const kliListBefore = await runCmd(ctx.kliCommand, [
    "list",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
  ], ctx.env);
  if (kliListBefore.code !== 0) {
    throw new Error(
      `kli list (before) failed: ${kliListBefore.stderr}\n${kliListBefore.stdout}`,
    );
  }

  const tufaListBefore = await runTufa(
    [
      "list",
      "--name",
      tufaName,
      "--base",
      base,
      "--passcode",
      passcode,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaListBefore.code !== 0) {
    throw new Error(
      `tufa list (before) failed: ${tufaListBefore.stderr}\n${tufaListBefore.stdout}`,
    );
  }

  assertEquals(extractIdentifierLines(kliListBefore.stdout), []);
  assertEquals(extractIdentifierLines(tufaListBefore.stdout), []);

  const kliIncept = await runCmd(ctx.kliCommand, [
    "incept",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
    "--transferable",
    "--isith",
    "1",
    "--icount",
    "1",
    "--nsith",
    "1",
    "--ncount",
    "1",
    "--toad",
    "0",
  ], ctx.env);
  if (kliIncept.code !== 0) {
    throw new Error(
      `kli incept failed: ${kliIncept.stderr}\n${kliIncept.stdout}`,
    );
  }

  const tufaIncept = await runTufa(
    [
      "incept",
      "--name",
      tufaName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
      "--transferable",
      "--isith",
      "1",
      "--icount",
      "1",
      "--nsith",
      "1",
      "--ncount",
      "1",
      "--toad",
      "0",
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaIncept.code !== 0) {
    throw new Error(
      `tufa incept failed: ${tufaIncept.stderr}\n${tufaIncept.stdout}`,
    );
  }

  const kliPre = extractPrefix(kliIncept.stdout);
  const tufaPre = extractPrefix(tufaIncept.stdout);
  assertEquals(tufaPre, kliPre);

  const expectedListLine = `${alias} (${tufaPre})`;

  const kliListAfter = await runCmd(ctx.kliCommand, [
    "list",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
  ], ctx.env);
  if (kliListAfter.code !== 0) {
    throw new Error(
      `kli list (after) failed: ${kliListAfter.stderr}\n${kliListAfter.stdout}`,
    );
  }

  const tufaListAfter = await runTufa(
    [
      "list",
      "--name",
      tufaName,
      "--base",
      base,
      "--passcode",
      passcode,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaListAfter.code !== 0) {
    throw new Error(
      `tufa list (after) failed: ${tufaListAfter.stderr}\n${tufaListAfter.stdout}`,
    );
  }

  assertEquals(extractIdentifierLines(kliListAfter.stdout), [expectedListLine]);
  assertEquals(extractIdentifierLines(tufaListAfter.stdout), [
    expectedListLine,
  ]);

  const kliAid = await runCmd(ctx.kliCommand, [
    "aid",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
  ], ctx.env);
  if (kliAid.code !== 0) {
    throw new Error(`kli aid failed: ${kliAid.stderr}\n${kliAid.stdout}`);
  }

  const tufaAid = await runTufa(
    [
      "aid",
      "--name",
      tufaName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaAid.code !== 0) {
    throw new Error(`tufa aid failed: ${tufaAid.stderr}\n${tufaAid.stdout}`);
  }

  assertEquals(extractLastNonEmptyLine(kliAid.stdout), tufaPre);
  assertEquals(extractLastNonEmptyLine(tufaAid.stdout), tufaPre);
}

async function runKliCompatStoreOpen(
  ctx: ScenarioContext,
): Promise<void> {
  await ensureCompatLmdbBuild(ctx.packageRoot);

  const alias = "interop-aid";
  const passcode = "MyPasscodeARealSecret";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const name = `kli-${crypto.randomUUID().slice(0, 8)}`;

  const kliInit = await runCmd(ctx.kliCommand, [
    "init",
    "--name",
    name,
    "--passcode",
    passcode,
    "--salt",
    salt,
  ], ctx.env);
  if (kliInit.code !== 0) {
    throw new Error(`kli init failed: ${kliInit.stderr}\n${kliInit.stdout}`);
  }

  const kliIncept = await runCmd(ctx.kliCommand, [
    "incept",
    "--name",
    name,
    "--passcode",
    passcode,
    "--alias",
    alias,
    "--transferable",
    "--isith",
    "1",
    "--icount",
    "1",
    "--nsith",
    "1",
    "--ncount",
    "1",
    "--toad",
    "0",
  ], ctx.env);
  if (kliIncept.code !== 0) {
    throw new Error(
      `kli incept failed: ${kliIncept.stderr}\n${kliIncept.stdout}`,
    );
  }
  const kliPre = extractPrefix(kliIncept.stdout);
  const expectedListLine = `${alias} (${kliPre})`;

  const tufaList = await runTufa(
    [
      "list",
      "--name",
      name,
      "--passcode",
      passcode,
      "--compat",
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaList.code !== 0) {
    throw new Error(`tufa list failed: ${tufaList.stderr}\n${tufaList.stdout}`);
  }

  const tufaAid = await runTufa(
    [
      "aid",
      "--name",
      name,
      "--passcode",
      passcode,
      "--alias",
      alias,
      "--compat",
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaAid.code !== 0) {
    throw new Error(`tufa aid failed: ${tufaAid.stderr}\n${tufaAid.stdout}`);
  }

  assertEquals(extractIdentifierLines(tufaList.stdout), [expectedListLine]);
  assertEquals(extractLastNonEmptyLine(tufaAid.stdout), kliPre);
}

async function runEncryptedKeeperSemantics(
  ctx: ScenarioContext,
): Promise<void> {
  const base = `gate-d-${crypto.randomUUID().slice(0, 8)}`;
  const alias = "encrypted-aid";
  const passcode = "MyPasscodeARealSecret";
  const wrongPasscode = "WrongPasscodeSecretAB";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const name = `tufa-${crypto.randomUUID().slice(0, 8)}`;

  const tufaInit = await runTufa(
    [
      "init",
      "--name",
      name,
      "--base",
      base,
      "--passcode",
      passcode,
      "--salt",
      salt,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaInit.code !== 0) {
    throw new Error(`tufa init failed: ${tufaInit.stderr}\n${tufaInit.stdout}`);
  }

  const tufaIncept = await runTufa(
    [
      "incept",
      "--name",
      name,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
      "--transferable",
      "--isith",
      "1",
      "--icount",
      "1",
      "--nsith",
      "1",
      "--ncount",
      "1",
      "--toad",
      "0",
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaIncept.code !== 0) {
    throw new Error(
      `tufa incept failed: ${tufaIncept.stderr}\n${tufaIncept.stdout}`,
    );
  }
  const pre = extractPrefix(tufaIncept.stdout);
  const expectedListLine = `${alias} (${pre})`;

  const tufaList = await runTufa(
    [
      "list",
      "--name",
      name,
      "--base",
      base,
      "--passcode",
      passcode,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaList.code !== 0) {
    throw new Error(`tufa list failed: ${tufaList.stderr}\n${tufaList.stdout}`);
  }

  const tufaAid = await runTufa(
    [
      "aid",
      "--name",
      name,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaAid.code !== 0) {
    throw new Error(`tufa aid failed: ${tufaAid.stderr}\n${tufaAid.stdout}`);
  }

  const tufaExport = await runTufa(
    [
      "export",
      "--name",
      name,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaExport.code !== 0) {
    throw new Error(
      `tufa export failed: ${tufaExport.stderr}\n${tufaExport.stdout}`,
    );
  }

  const wrongList = await runTufa(
    [
      "list",
      "--name",
      name,
      "--base",
      base,
      "--passcode",
      wrongPasscode,
    ],
    ctx.env,
    ctx.packageRoot,
  );

  assertEquals(extractIdentifierLines(tufaList.stdout), [expectedListLine]);
  assertEquals(extractLastNonEmptyLine(tufaAid.stdout), pre);
  assertEquals(
    normalizeCesr(extractKelStream(tufaExport.stdout)).length > 0,
    true,
  );
  assertEquals(wrongList.code === 0, false);
  assert(
    /too many attempts|not associated with last aeid|valid passcode required/i
      .test(`${wrongList.stdout}\n${wrongList.stderr}`),
    `Expected wrong passcode failure, got:\n${wrongList.stdout}\n${wrongList.stderr}`,
  );
}

async function runGateEBootstrapParity(
  ctx: ScenarioContext,
): Promise<void> {
  const base = `gate-e-${crypto.randomUUID().slice(0, 8)}`;
  const alias = "bootstrap-aid";
  const resolveAlias = "resolved-peer";
  const passcode = "MyPasscodeARealSecret";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const port = 8915;
  const url = `http://127.0.0.1:${port}`;
  const kliSourceName = `kli-src-${crypto.randomUUID().slice(0, 8)}`;
  const tufaSourceName = `tufa-src-${crypto.randomUUID().slice(0, 8)}`;
  const kliTargetName = `kli-dst-${crypto.randomUUID().slice(0, 8)}`;
  const tufaTargetName = `tufa-dst-${crypto.randomUUID().slice(0, 8)}`;

  const kliInit = await runCmd(ctx.kliCommand, [
    "init",
    "--name",
    kliSourceName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--salt",
    salt,
  ], ctx.env);
  if (kliInit.code !== 0) {
    throw new Error(`kli init failed: ${kliInit.stderr}\n${kliInit.stdout}`);
  }

  const kliIncept = await runCmd(ctx.kliCommand, [
    "incept",
    "--name",
    kliSourceName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
    "--transferable",
    "--isith",
    "1",
    "--icount",
    "1",
    "--nsith",
    "1",
    "--ncount",
    "1",
    "--toad",
    "0",
  ], ctx.env);
  if (kliIncept.code !== 0) {
    throw new Error(
      `kli incept failed: ${kliIncept.stderr}\n${kliIncept.stdout}`,
    );
  }
  const kliPre = extractPrefix(kliIncept.stdout);

  const tufaInit = await runTufa(
    [
      "init",
      "--name",
      tufaSourceName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--salt",
      salt,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaInit.code !== 0) {
    throw new Error(`tufa init failed: ${tufaInit.stderr}\n${tufaInit.stdout}`);
  }

  const tufaIncept = await runTufa(
    [
      "incept",
      "--name",
      tufaSourceName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
      "--transferable",
      "--isith",
      "1",
      "--icount",
      "1",
      "--nsith",
      "1",
      "--ncount",
      "1",
      "--toad",
      "0",
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaIncept.code !== 0) {
    throw new Error(
      `tufa incept failed: ${tufaIncept.stderr}\n${tufaIncept.stdout}`,
    );
  }
  const tufaPre = extractPrefix(tufaIncept.stdout);
  assertEquals(tufaPre, kliPre);

  const kliLoc = await runCmd(ctx.kliCommand, [
    "location",
    "add",
    "--name",
    kliSourceName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
    "--url",
    url,
  ], ctx.env);
  if (kliLoc.code !== 0) {
    throw new Error(
      `kli location add failed: ${kliLoc.stderr}\n${kliLoc.stdout}`,
    );
  }

  const tufaLoc = await runTufa(
    [
      "loc",
      "add",
      "--name",
      tufaSourceName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
      "--url",
      url,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaLoc.code !== 0) {
    throw new Error(
      `tufa loc add failed: ${tufaLoc.stderr}\n${tufaLoc.stdout}`,
    );
  }
  assertEquals(
    extractLastNonEmptyLine(kliLoc.stdout),
    extractLastNonEmptyLine(tufaLoc.stdout),
  );

  const kliEnds = await runCmd(ctx.kliCommand, [
    "ends",
    "add",
    "--name",
    kliSourceName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
    "--role",
    "mailbox",
    "--eid",
    kliPre,
  ], ctx.env);
  if (kliEnds.code !== 0) {
    throw new Error(
      `kli ends add failed: ${kliEnds.stderr}\n${kliEnds.stdout}`,
    );
  }

  const tufaEnds = await runTufa(
    [
      "ends",
      "add",
      "--name",
      tufaSourceName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
      "--role",
      "mailbox",
      "--eid",
      tufaPre,
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaEnds.code !== 0) {
    throw new Error(
      `tufa ends add failed: ${tufaEnds.stderr}\n${tufaEnds.stdout}`,
    );
  }

  await run(() =>
    inspectHabery(
      ctx,
      {
        name: kliSourceName,
        base,
        compat: true,
        readonly: true,
        skipConfig: true,
        skipSignator: true,
        bran: passcode,
      },
      (hby) => {
        assertEquals(hby.db.getState(kliPre)?.i, kliPre);
        assertEquals(hby.db.locs.get([kliPre, "http"])?.url, url);
        assertEquals(
          hby.db.ends.get([kliPre, EndpointRoles.mailbox, kliPre])?.allowed,
          true,
        );
      },
    )
  );

  await run(() =>
    inspectHabery(
      ctx,
      {
        name: tufaSourceName,
        base,
        readonly: true,
        skipConfig: true,
        skipSignator: true,
        bran: passcode,
      },
      (hby) => {
        assertEquals(hby.db.getState(tufaPre)?.i, tufaPre);
        assertEquals(hby.db.locs.get([tufaPre, "http"])?.url, url);
        assertEquals(
          hby.db.ends.get([tufaPre, EndpointRoles.mailbox, tufaPre])?.allowed,
          true,
        );
      },
    )
  );

  const kliOobi = await runCmd(ctx.kliCommand, [
    "oobi",
    "generate",
    "--name",
    kliSourceName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
    "--role",
    "mailbox",
  ], ctx.env);
  if (kliOobi.code !== 0) {
    throw new Error(
      `kli oobi generate failed: ${kliOobi.stderr}\n${kliOobi.stdout}`,
    );
  }

  const tufaOobi = await runTufa(
    [
      "oobi",
      "generate",
      "--name",
      tufaSourceName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      alias,
      "--role",
      "mailbox",
    ],
    ctx.env,
    ctx.packageRoot,
  );
  if (tufaOobi.code !== 0) {
    throw new Error(
      `tufa oobi generate failed: ${tufaOobi.stderr}\n${tufaOobi.stdout}`,
    );
  }

  const kliMailboxUrl = extractLastNonEmptyLine(kliOobi.stdout);
  const tufaMailboxUrl = extractLastNonEmptyLine(tufaOobi.stdout);
  assertEquals(tufaMailboxUrl, kliMailboxUrl);

  await run(function*(): Operation<void> {
    yield* withTufaAgent(
      ctx,
      [
        "agent",
        "--name",
        tufaSourceName,
        "--base",
        base,
        "--passcode",
        passcode,
        "--port",
        String(port),
      ],
      port,
      function*() {
        const kliTargetInit = yield* promiseOp(() =>
          runCmd(ctx.kliCommand, [
            "init",
            "--name",
            kliTargetName,
            "--base",
            base,
            "--passcode",
            passcode,
            "--salt",
            salt,
          ], ctx.env)
        );
        if (kliTargetInit.code !== 0) {
          throw new Error(
            `kli target init failed: ${kliTargetInit.stderr}\n${kliTargetInit.stdout}`,
          );
        }

        const tufaTargetInit = yield* promiseOp(() =>
          runTufa(
            [
              "init",
              "--name",
              tufaTargetName,
              "--base",
              base,
              "--passcode",
              passcode,
              "--salt",
              salt,
            ],
            ctx.env,
            ctx.packageRoot,
          )
        );
        if (tufaTargetInit.code !== 0) {
          throw new Error(
            `tufa target init failed: ${tufaTargetInit.stderr}\n${tufaTargetInit.stdout}`,
          );
        }

        const kliResolve = yield* promiseOp(() =>
          runCmd(ctx.kliCommand, [
            "oobi",
            "resolve",
            "--name",
            kliTargetName,
            "--base",
            base,
            "--passcode",
            passcode,
            "--oobi",
            tufaMailboxUrl,
            "--oobi-alias",
            resolveAlias,
          ], ctx.env)
        );
        if (kliResolve.code !== 0) {
          throw new Error(
            `kli oobi resolve failed: ${kliResolve.stderr}\n${kliResolve.stdout}`,
          );
        }

        const tufaResolve = yield* promiseOp(() =>
          runTufa(
            [
              "oobi",
              "resolve",
              "--name",
              tufaTargetName,
              "--base",
              base,
              "--passcode",
              passcode,
              "--url",
              tufaMailboxUrl,
              "--oobi-alias",
              resolveAlias,
            ],
            ctx.env,
            ctx.packageRoot,
          )
        );
        if (tufaResolve.code !== 0) {
          throw new Error(
            `tufa oobi resolve failed: ${tufaResolve.stderr}\n${tufaResolve.stdout}`,
          );
        }

        yield* inspectHabery(
          ctx,
          {
            name: kliTargetName,
            base,
            compat: true,
            readonly: true,
            skipConfig: true,
            skipSignator: true,
            bran: passcode,
          },
          (hby) => {
            assertEquals(hby.db.getState(kliPre)?.i, kliPre);
          },
        );

        yield* inspectHabery(
          ctx,
          {
            name: tufaTargetName,
            base,
            readonly: true,
            skipConfig: true,
            skipSignator: true,
            bran: passcode,
          },
          (hby) => {
            assertEquals(hby.db.getState(tufaPre)?.i, tufaPre);
            assertEquals(hby.db.locs.get([tufaPre, "http"])?.url, url);
            assertEquals(
              hby.db.ends.get([tufaPre, EndpointRoles.mailbox, tufaPre])
                ?.allowed,
              true,
            );
            assertEquals(hby.db.roobi.get(tufaMailboxUrl)?.state, "resolved");
          },
        );
      },
    );
  });
}

const GATE_SCENARIOS: GateScenario[] = [
  {
    id: "A-DB-FOUNDATION-READINESS",
    gate: "A",
    state: "pending",
    requiredTufaCommands: [],
    expectedOutputShape: "DB and escrow readiness evidence",
    blockedReason: "Tracks DB-layer parity artifacts and escrow work, not a single CLI command.",
  },
  {
    id: "B-INIT-INCEPT-EXPORT-PARITY",
    gate: "B",
    state: "ready",
    requiredTufaCommands: ["init", "incept", "export"],
    expectedOutputShape: "Prefix line parity and normalized exported KEL stream parity.",
    run: runInitInceptExportParity,
  },
  {
    id: "B-LIST-AID-VISIBILITY",
    gate: "B",
    state: "ready",
    requiredTufaCommands: ["list", "aid"],
    expectedOutputShape: "list(empty)->list(alias+pre)->aid(pre)",
    run: runListAidVisibilityParity,
  },
  {
    id: "C-KLI-COMPAT-STORE-OPEN",
    gate: "C",
    state: "ready",
    requiredTufaCommands: ["list", "aid"],
    expectedOutputShape: "kli-created store visible through tufa compatibility mode",
    run: runKliCompatStoreOpen,
  },
  {
    id: "D-ENCRYPTED-AT-REST-SEMANTICS",
    gate: "D",
    state: "ready",
    requiredTufaCommands: ["init", "incept", "list", "aid", "export"],
    expectedOutputShape: "AEID and encrypted keeper semantics parity",
    run: runEncryptedKeeperSemantics,
  },
  {
    id: "E-ENDS-OOBI-BOOTSTRAP",
    gate: "E",
    state: "ready",
    requiredTufaCommands: ["ends", "loc", "oobi", "agent"],
    expectedOutputShape: "loc add + ends add + mailbox OOBI generate/resolve parity against KERIpy",
    run: runGateEBootstrapParity,
  },
  {
    id: "F-DIRECT-MAILBOX-COMMS",
    gate: "F",
    state: "pending",
    requiredTufaCommands: ["exchange"],
    expectedOutputShape: "direct and mailbox message flow parity",
    blockedReason: "Direct/mailbox interop flow commands are not implemented yet.",
  },
  {
    id: "G-CHALLENGE-ROUNDTRIP",
    gate: "G",
    state: "pending",
    requiredTufaCommands: ["challenge"],
    expectedOutputShape: "challenge generate/respond/verify parity",
    blockedReason: "Challenge command set is not implemented yet.",
  },
];

function readyScenario(id: string): GateScenario {
  const scenario = GATE_SCENARIOS.find((scenario) => scenario.id === id && scenario.state === "ready");
  if (!scenario) {
    throw new Error(`Expected ready interop scenario '${id}' to exist.`);
  }
  return scenario;
}

async function runReadyScenario(id: string): Promise<void> {
  const scenario = readyScenario(id);
  const ctx = await createScenarioContext();
  const tufaCommands = await listTufaCommands(ctx.env, ctx.packageRoot);

  for (const command of scenario.requiredTufaCommands) {
    assert(
      tufaCommands.has(command),
      `Ready scenario ${scenario.id} requires tufa command '${command}'`,
    );
  }

  if (!scenario.run) {
    throw new Error(
      `Ready scenario ${scenario.id} has no run() implementation.`,
    );
  }

  await scenario.run(ctx);
}

Deno.test("Interop gate harness matrix covers Gate A-G", () => {
  const gates = new Set<Gate>(GATE_SCENARIOS.map((scenario) => scenario.gate));
  assertEquals([...gates].sort(), ["A", "B", "C", "D", "E", "F", "G"]);
});

Deno.test(
  "Interop gate harness ready scenario: B-INIT-INCEPT-EXPORT-PARITY",
  async () => {
    await runReadyScenario("B-INIT-INCEPT-EXPORT-PARITY");
  },
);

Deno.test(
  "Interop gate harness ready scenario: B-LIST-AID-VISIBILITY",
  async () => {
    await runReadyScenario("B-LIST-AID-VISIBILITY");
  },
);

Deno.test(
  "Interop gate harness ready scenario: C-KLI-COMPAT-STORE-OPEN",
  async () => {
    await runReadyScenario("C-KLI-COMPAT-STORE-OPEN");
  },
);

Deno.test(
  "Interop gate harness ready scenario: D-ENCRYPTED-AT-REST-SEMANTICS",
  async () => {
    await runReadyScenario("D-ENCRYPTED-AT-REST-SEMANTICS");
  },
);

Deno.test(
  "Interop gate harness ready scenario: E-ENDS-OOBI-BOOTSTRAP",
  async () => {
    await runReadyScenario("E-ENDS-OOBI-BOOTSTRAP");
  },
);
