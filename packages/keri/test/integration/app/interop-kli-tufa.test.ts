/**
 * Cross-implementation CLI and mailbox interoperability tests.
 *
 * The mailbox handoff relies especially on the two mailbox scenarios in this
 * file:
 * - KLI mailbox operations against a Tufa mailbox host
 * - Tufa mailbox operations against the real local-source KERIpy mailbox host
 *
 * The helper layer exists to keep those subprocess-heavy scenarios readable and
 * debuggable instead of burying the protocol assertions in process plumbing.
 */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { type Operation, run } from "npm:effection@^3.6.0";
import { t } from "../../../../cesr/mod.ts";
import { createHabery, type Habery } from "../../../src/app/habbing.ts";
import { mailboxTopicKey, openMailboxerForHabery } from "../../../src/app/mailboxing.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface SpawnedChild {
  status: Promise<Deno.CommandStatus>;
  kill(signal: Deno.Signal): void;
  stdout?: ReadableStream<Uint8Array>;
  stderr?: ReadableStream<Uint8Array>;
  liveStdout?: ReadableStream<Uint8Array>;
  liveStderr?: ReadableStream<Uint8Array>;
}

/**
 * Runs a CLI command under the supplied environment and returns decoded output.
 *
 * The parity test drives both `kli` and the local `tufa` entrypoint, so this
 * helper centralizes subprocess execution and byte-to-string decoding.
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

async function runCmdWithTimeout(
  command: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
  cwd?: string,
): Promise<CmdResult> {
  const child = spawnChild(command, args, env, cwd);
  const stdoutPromise = child.stdout
    ? new Response(child.stdout).text()
    : Promise.resolve("");
  const stderrPromise = child.stderr
    ? new Response(child.stderr).text()
    : Promise.resolve("");

  const timedOut = Symbol("timedOut");
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const winner = await Promise.race([
    child.status,
    new Promise<symbol>((resolve) => {
      timeoutId = setTimeout(() => resolve(timedOut), timeoutMs);
    }),
  ]);
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }

  if (winner === timedOut) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Child may already be gone.
    }
    await child.status.catch(() => undefined);
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    throw new Error(
      `Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  const status = winner as Deno.CommandStatus;
  return {
    code: status.code,
    stdout,
    stderr,
  };
}

/**
 * Probes a resolved `kli` candidate to verify that it is executable and really
 * is the KERI CLI.
 *
 * A PATH entry can exist but still be the wrong binary or a broken shim. The
 * `--help` probe is a cheap, read-only check before the test starts mutating
 * keystores.
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
 * Resolve pyenv-managed tool paths against the real shell environment, not the
 * temp HOME used by interop tests for isolated keystores.
 *
 * The subprocesses themselves should still run under the temp HOME, but tool
 * resolution needs the caller's actual pyenv root and PATH to find `kli` and
 * its companion Python interpreter.
 */
function pyenvProbeEnv(env: Record<string, string>): Record<string, string> {
  return {
    ...env,
    HOME: Deno.env.get("HOME") ?? env.HOME,
    PATH: Deno.env.get("PATH") ?? env.PATH,
    ...(Deno.env.get("PYENV_ROOT")
      ? { PYENV_ROOT: Deno.env.get("PYENV_ROOT")! }
      : {}),
  };
}

/**
 * Resolves the concrete `kli` executable to use for live interop.
 *
 * We try `pyenv which kli` first because desktop shells often expose `kli`
 * through pyenv shims, and then fall back to plain PATH lookup. Each candidate
 * is validated with `canUseKli()` so the test fails loudly instead of skipping
 * or using the wrong tool.
 */
async function resolveKliCommand(env: Record<string, string>): Promise<string> {
  const candidates: string[] = [];
  const probeEnv = pyenvProbeEnv(env);

  try {
    const pyenvWhich = await runCmd("pyenv", ["which", "kli"], probeEnv);
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
 * Parses the human-readable `Prefix` line emitted after `incept`.
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
 * Export parity should surface semantic differences, not fail because KEL
 * attachments embed run-specific timestamps.
 */
function normalizeCesr(text: string): string {
  return text
    // normalize any ISO-8601 date literals that may appear in attachments
    .replace(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}:\d{2})/g,
      "<TS>",
    )
    // normalize KERI CESR datetime attachments (e.g. 2026-02-16T03c43c30d415348p00c00)
    .replace(
      /\d{4}-\d{2}-\d{2}T\d{2}c\d{2}c\d{2}d\d{6}p\d{2}c\d{2}/g,
      "<TS>",
    )
    .replace(/\r\n/g, "\n")
    .trim();
}

/**
 * Extracts only serialized KEL events from mixed export output.
 */
function extractKelStream(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("{\"v\":\"KERI"))
    .join("\n");
}

/**
 * Preserves the active Deno cache directory when the test overrides `HOME`.
 *
 * The test isolates KERIpy home directories with a temp HOME. If we do not
 * also preserve the existing `DENO_DIR`, `deno run` may look under the temp
 * home for a cold cache and fail for reasons unrelated to KERI parity.
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

/** Resolve the package root dynamically so CI and other machines can spawn tufa. */
function packageRoot(): string {
  return new URL("../../../", import.meta.url).pathname;
}

/** Resolve the checked-in KERIpy source root used by the real mailbox host. */
function keripySourceRoot(): string {
  return new URL("../../../../../keripy/src/", import.meta.url).pathname;
}

/** Return the last non-empty line from human-oriented CLI output. */
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

/** Wait until a long-lived mailbox or agent host reports healthy. */
async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError = "health check did not return 200";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      try {
        if (response.ok) {
          return;
        }
        lastError = `health returned HTTP ${response.status}`;
      } finally {
        await response.body?.cancel().catch(() => undefined);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(lastError);
}

/** Spawn one subprocess with piped stdout/stderr for later inspection. */
function spawnChild(
  command: string,
  args: string[],
  env: Record<string, string>,
  cwd?: string,
): SpawnedChild {
  const child = new Deno.Command(command, {
    args,
    env,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const [liveStdout, stdout] = child.stdout
    ? child.stdout.tee()
    : [undefined, undefined];
  const [liveStderr, stderr] = child.stderr
    ? child.stderr.tee()
    : [undefined, undefined];

  return {
    status: child.status,
    kill: child.kill.bind(child),
    stdout,
    stderr,
    liveStdout,
    liveStderr,
  };
}

/** Read both stdout and stderr from one spawned subprocess. */
async function readChildOutput(child: SpawnedChild): Promise<string> {
  const [stdout, stderr] = await Promise.all([
    child.stdout ? new Response(child.stdout).text() : Promise.resolve(""),
    child.stderr ? new Response(child.stderr).text() : Promise.resolve(""),
  ]);
  return `${stdout}\n${stderr}`.trim();
}

/** Stop one spawned subprocess and return any buffered output for debugging. */
async function stopChild(child: SpawnedChild): Promise<string> {
  try {
    child.kill("SIGTERM");
  } catch {
    // Child may already be gone.
  }
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const status = await Promise.race([
    child.status,
    new Promise<symbol>((resolve) => {
      timeoutId = setTimeout(() => resolve(Symbol("timeout")), 5_000);
    }),
  ]);
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }
  if (typeof status === "symbol") {
    try {
      child.kill("SIGKILL");
    } catch {
      // Child may already be gone.
    }
    await child.status.catch(() => undefined);
  }
  return await readChildOutput(child);
}

/** Start one host process, wait for health, run the body, and guarantee shutdown. */
async function withStartedChild<T>(
  child: SpawnedChild,
  port: number,
  body: () => Promise<T>,
): Promise<T> {
  try {
    await waitForHealth(port);
  } catch (error) {
    const details = await stopChild(child);
    throw new Error(
      `Failed to start host on port ${port}: ${error instanceof Error ? error.message : String(error)}\n${details}`,
    );
  }

  try {
    return await body();
  } finally {
    await stopChild(child);
  }
}

async function resolvePythonCommand(
  env: Record<string, string>,
  kliCommand: string,
): Promise<string> {
  const probeEnv = pyenvProbeEnv(env);
  if (kliCommand.includes("/")) {
    try {
      const first = (await Deno.readTextFile(kliCommand)).split(/\r?\n/, 1)[0] ?? "";
      if (first.startsWith("#!")) {
        const parts = first.slice(2).trim().split(/\s+/);
        const python = parts.at(-1);
        if (python && python.startsWith("python")) {
          return python;
        }
      }
    } catch {
      // Fall through to pyenv/PATH lookup.
    }
  }

  try {
    const pyenvWhich = await runCmd("pyenv", ["which", "python"], probeEnv);
    const resolved = pyenvWhich.stdout.trim();
    if (pyenvWhich.code === 0 && resolved.length > 0) {
      return resolved;
    }
  } catch {
    // Fall through to PATH resolution.
  }

  return "python3";
}

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
 * Run one `tufa` CLI command with a hard timeout so long-running reverse
 * interop failures fail at the blocked step instead of hanging the whole test.
 */
async function runTufaWithTimeout(
  args: string[],
  env: Record<string, string>,
  cwd: string,
  timeoutMs = 20_000,
): Promise<CmdResult> {
  return await runCmdWithTimeout(
    "deno",
    ["run", "--allow-all", "--unstable-ffi", "mod.ts", ...args],
    env,
    timeoutMs,
    cwd,
  );
}

/**
 * Create the shared integration context for live KLI/Tufa mailbox scenarios.
 *
 * The temporary HOME isolates keystores while preserving the active Deno cache
 * so failures stay about protocol behavior instead of cold-cache setup.
 */
async function createInteropContext(): Promise<{
  home: string;
  env: Record<string, string>;
  repoRoot: string;
  kliCommand: string;
}> {
  const home = await Deno.makeTempDir({ prefix: "tufa-kli-home-" });
  const denoDir = await detectDenoDir();
  const env = {
    ...Deno.env.toObject(),
    HOME: home,
    ...(denoDir ? { DENO_DIR: denoDir } : {}),
  };
  return {
    home,
    env,
    repoRoot: packageRoot(),
    kliCommand: await resolveKliCommand(env),
  };
}

/** Require one CLI/subprocess result to succeed and keep the label in failures. */
async function requireSuccess(
  label: string,
  resultPromise: Promise<CmdResult>,
): Promise<CmdResult> {
  const result = await resultPromise;
  if (result.code !== 0) {
    throw new Error(`${label} failed: ${result.stderr}\n${result.stdout}`);
  }
  return result;
}

/** Return a random localhost port for temporary integration hosts. */
function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 20000);
}

/** Temporarily override process environment variables inside one Effection block. */
function* withProcessEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => Operation<T>,
): Operation<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
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
 * Open one compat-mode habery and run assertions against its durable state.
 *
 * This is how the mailbox interop tests prove that cross-implementation flows
 * really landed in compatibility stores instead of only producing the right
 * CLI text.
 */
function* inspectCompatHabery(
  ctx: Awaited<ReturnType<typeof createInteropContext>>,
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

Deno.test("Interop: kli and tufa produce identical single-sig prefix and KEL stream", async () => {
  const home = await Deno.makeTempDir({ prefix: "tufa-kli-home-" });
  const denoDir = await detectDenoDir();
  const env = {
    ...Deno.env.toObject(),
    HOME: home,
    ...(denoDir ? { DENO_DIR: denoDir } : {}),
  };
  const kliCommand = await resolveKliCommand(env);

  const repoRoot = packageRoot();
  const base = `interop-${crypto.randomUUID().slice(0, 8)}`;
  const alias = "interop-aid";
  const passcode = "MyPasscodeARealSecret";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const kliName = `kli-${crypto.randomUUID().slice(0, 8)}`;
  const tufaName = `tufa-${crypto.randomUUID().slice(0, 8)}`;

  const kliInit = await runCmd(kliCommand, [
    "init",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--salt",
    salt,
  ], env);
  if (kliInit.code !== 0) {
    throw new Error(`kli init failed: ${kliInit.stderr}\n${kliInit.stdout}`);
  }

  const kliIncept = await runCmd(kliCommand, [
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
  ], env);
  if (kliIncept.code !== 0) {
    throw new Error(
      `kli incept failed: ${kliIncept.stderr}\n${kliIncept.stdout}`,
    );
  }
  const kliPre = extractPrefix(kliIncept.stdout);

  const tufaEnv = { ...env };
  const tufaInit = await runCmd(
    "deno",
    [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "mod.ts",
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
    tufaEnv,
    repoRoot,
  );
  if (tufaInit.code !== 0) {
    throw new Error(`tufa init failed: ${tufaInit.stderr}\n${tufaInit.stdout}`);
  }

  const tufaIncept = await runCmd(
    "deno",
    [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "mod.ts",
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
    tufaEnv,
    repoRoot,
  );
  if (tufaIncept.code !== 0) {
    throw new Error(
      `tufa incept failed: ${tufaIncept.stderr}\n${tufaIncept.stdout}`,
    );
  }
  const tufaPre = extractPrefix(tufaIncept.stdout);

  assertEquals(tufaPre, kliPre);

  const kliExport = await runCmd(kliCommand, [
    "export",
    "--name",
    kliName,
    "--base",
    base,
    "--passcode",
    passcode,
    "--alias",
    alias,
  ], env);
  if (kliExport.code !== 0) {
    throw new Error(
      `kli export failed: ${kliExport.stderr}\n${kliExport.stdout}`,
    );
  }

  const tufaExport = await runCmd(
    "deno",
    [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "mod.ts",
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
    tufaEnv,
    repoRoot,
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
});

/**
 * Proves the forward mailbox interop direction:
 * - KLI authorizes a Tufa mailbox host
 * - Tufa resolves the resulting mailbox OOBI
 * - Tufa delivers `/challenge` traffic that KLI later polls and verifies
 */
Deno.test("Interop: kli mailbox add works against a tufa mailbox host and kli challenge verify polls it", async () => {
  const ctx = await createInteropContext();
  const base = `interop-mailbox-kli-${crypto.randomUUID().slice(0, 8)}`;
  const passcode = "MyPasscodeARealSecret";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const tufaHeadDir = `${ctx.home}/tufa-head`;
  const providerPort = randomPort();
  const bobPort = randomPort();
  const providerOrigin = `http://127.0.0.1:${providerPort}`;
  const bobOrigin = `http://127.0.0.1:${bobPort}`;
  const providerName = `tufa-mbx-${crypto.randomUUID().slice(0, 8)}`;
  const providerAlias = "relay";
  const kliName = `kli-ctrl-${crypto.randomUUID().slice(0, 8)}`;
  const kliAlias = "alice";
  const bobName = `tufa-bob-${crypto.randomUUID().slice(0, 8)}`;
  const bobAlias = "bob";
  const providerInit = await requireSuccess(
    "tufa provider init",
    runTufa(
      [
        "init",
        "--name",
        providerName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--salt",
        salt,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  assertEquals(providerInit.code, 0);

  const providerIncept = await requireSuccess(
    "tufa provider incept",
    runTufa(
      [
        "incept",
        "--name",
        providerName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        providerAlias,
        "--icount",
        "1",
        "--isith",
        "1",
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  const providerPre = extractPrefix(providerIncept.stdout);
  const providerUrl = `http://127.0.0.1:${providerPort}/${providerPre}`;

  await requireSuccess(
    "tufa provider location add",
    runTufa(
      [
        "loc",
        "add",
        "--name",
        providerName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        providerAlias,
        "--url",
        providerUrl,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  await requireSuccess(
    "tufa provider controller end role",
    runTufa(
      [
        "ends",
        "add",
        "--name",
        providerName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        providerAlias,
        "--role",
        "controller",
        "--eid",
        providerPre,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  await requireSuccess(
    "tufa provider mailbox end role",
    runTufa(
      [
        "ends",
        "add",
        "--name",
        providerName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        providerAlias,
        "--role",
        "mailbox",
        "--eid",
        providerPre,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );

  const kliInit = await requireSuccess(
    "kli init",
    runCmd(ctx.kliCommand, [
      "init",
      "--name",
      kliName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--salt",
      salt,
    ], ctx.env),
  );
  assertEquals(kliInit.code, 0);

  const kliIncept = await requireSuccess(
    "kli incept",
    runCmd(ctx.kliCommand, [
      "incept",
      "--name",
      kliName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      kliAlias,
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
    ], ctx.env),
  );
  const alicePre = extractPrefix(kliIncept.stdout);

  const bobInit = await requireSuccess(
    "tufa bob init",
    runTufa(
      [
        "init",
        "--name",
        bobName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--salt",
        salt,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  assertEquals(bobInit.code, 0);

  const bobIncept = await requireSuccess(
    "tufa bob incept",
    runTufa(
      [
        "incept",
        "--name",
        bobName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        bobAlias,
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
      ctx.repoRoot,
    ),
  );
  const bobPre = extractPrefix(bobIncept.stdout);
  const bobUrl = `http://127.0.0.1:${bobPort}/${bobPre}`;

  await requireSuccess(
    "tufa bob location add",
    runTufa(
      [
        "loc",
        "add",
        "--name",
        bobName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        bobAlias,
        "--url",
        bobUrl,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  await requireSuccess(
    "tufa bob controller end role",
    runTufa(
      [
        "ends",
        "add",
        "--name",
        bobName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        bobAlias,
        "--role",
        "controller",
        "--eid",
        bobPre,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );

  const providerAgent = spawnChild(
    "deno",
    [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "mod.ts",
      "agent",
      "--name",
      providerName,
      "--base",
      base,
      "--head-dir",
      tufaHeadDir,
      "--passcode",
      passcode,
      "--port",
      String(providerPort),
    ],
    ctx.env,
    ctx.repoRoot,
  );
  const providerMailboxOobi = `${providerOrigin}/oobi/${providerPre}/mailbox/${providerPre}`;
  const bobControllerOobi = `${bobOrigin}/oobi/${bobPre}/controller`;
  const bobAgent = spawnChild(
    "deno",
    [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "mod.ts",
      "agent",
      "--name",
      bobName,
      "--base",
      base,
      "--head-dir",
      tufaHeadDir,
      "--passcode",
      passcode,
      "--port",
      String(bobPort),
    ],
    ctx.env,
    ctx.repoRoot,
  );

  await withStartedChild(providerAgent, providerPort, async () => {
    await withStartedChild(bobAgent, bobPort, async () => {
      const providerFetch = await fetch(providerMailboxOobi);
      assertEquals(providerFetch.status, 200);
      assertStringIncludes(
        providerFetch.headers.get("content-type") ?? "",
        "application/cesr",
      );
      assertStringIncludes(
        await providerFetch.text(),
        "\"r\":\"/loc/scheme\"",
      );

      await requireSuccess(
        "kli resolve tufa provider mailbox",
        runCmdWithTimeout(
          ctx.kliCommand,
          [
            "oobi",
            "resolve",
            "--name",
            kliName,
            "--base",
            base,
            "--passcode",
            passcode,
            "--oobi",
            providerMailboxOobi,
            "--oobi-alias",
            providerAlias,
          ],
          ctx.env,
          20_000,
        ),
      );

      await run(() =>
        inspectCompatHabery(
          ctx,
          {
            name: kliName,
            base,
            compat: true,
            readonly: true,
            skipConfig: true,
            skipSignator: true,
            bran: passcode,
          },
          (hby) => {
            assertEquals(
              hby.db.locs.get([providerPre, "http"])?.url,
              providerUrl,
            );
            assertEquals(
              hby.db.ends.get([providerPre, EndpointRoles.mailbox, providerPre])
                ?.allowed,
              true,
            );
          },
        )
      );

      const mailboxAdd = await requireSuccess(
        "kli mailbox add",
        runCmdWithTimeout(
          ctx.kliCommand,
          [
            "mailbox",
            "add",
            "--name",
            kliName,
            "--base",
            base,
            "--passcode",
            passcode,
            "--alias",
            kliAlias,
            "--mailbox",
            providerAlias,
          ],
          ctx.env,
          20_000,
        ),
      );
      assertStringIncludes(mailboxAdd.stdout, providerPre);

      const mailboxList = await requireSuccess(
        "kli mailbox list",
        runCmdWithTimeout(
          ctx.kliCommand,
          [
            "mailbox",
            "list",
            "--name",
            kliName,
            "--base",
            base,
            "--passcode",
            passcode,
            "--alias",
            kliAlias,
          ],
          ctx.env,
          20_000,
        ),
      );
      assertStringIncludes(mailboxList.stdout, providerPre);

      await requireSuccess(
        "kli resolve bob controller",
        runCmdWithTimeout(
          ctx.kliCommand,
          [
            "oobi",
            "resolve",
            "--name",
            kliName,
            "--base",
            base,
            "--passcode",
            passcode,
            "--oobi",
            bobControllerOobi,
            "--oobi-alias",
            bobAlias,
          ],
          ctx.env,
          20_000,
        ),
      );

      const mailboxOobi = await requireSuccess(
        "kli mailbox oobi generate",
        runCmdWithTimeout(
          ctx.kliCommand,
          [
            "oobi",
            "generate",
            "--name",
            kliName,
            "--base",
            base,
            "--passcode",
            passcode,
            "--alias",
            kliAlias,
            "--role",
            "mailbox",
          ],
          ctx.env,
          20_000,
        ),
      );
      const mailboxUrl = extractLastNonEmptyLine(mailboxOobi.stdout);
      assertStringIncludes(mailboxUrl, `${providerUrl}/oobi/`);
      assertStringIncludes(mailboxUrl, alicePre);
      assertStringIncludes(mailboxUrl, providerPre);

      await requireSuccess(
        "tufa resolve provider controller for kli mailbox",
        runTufa(
          [
            "oobi",
            "resolve",
            "--name",
            bobName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--url",
            `${providerOrigin}/oobi/${providerPre}/controller`,
            "--oobi-alias",
            providerAlias,
          ],
          ctx.env,
          ctx.repoRoot,
        ),
      );

      await requireSuccess(
        "tufa resolve kli mailbox oobi",
        runTufa(
          [
            "oobi",
            "resolve",
            "--name",
            bobName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--url",
            mailboxUrl,
            "--oobi-alias",
            kliAlias,
          ],
          ctx.env,
          ctx.repoRoot,
        ),
      );

      const words = ["able", "baker", "charlie"].join(" ");
      const challengeSend = await requireSuccess(
        "tufa challenge respond to kli mailbox",
        runTufa(
          [
            "challenge",
            "respond",
            "--name",
            bobName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--alias",
            bobAlias,
            "--recipient",
            alicePre,
            "--words",
            JSON.stringify(words.split(" ")),
          ],
          ctx.env,
          ctx.repoRoot,
        ),
      );
      assertStringIncludes(challengeSend.stdout, "Sent EXN message");

      const challengeVerify = await requireSuccess(
        "kli challenge verify",
        runCmdWithTimeout(
          ctx.kliCommand,
          [
            "challenge",
            "verify",
            "--name",
            kliName,
            "--base",
            base,
            "--passcode",
            passcode,
            "--signer",
            bobPre,
            "--words",
            words,
          ],
          ctx.env,
          20_000,
        ),
      );
      assertStringIncludes(challengeVerify.stdout, "successfully responded");
    });
  });

  await run(function*() {
    const hby = yield* createHabery({
      name: providerName,
      base,
      headDirPath: tufaHeadDir,
      bran: passcode,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      const mailboxer = yield* openMailboxerForHabery(hby);
      assertEquals(
        hby.db.ends.get([alicePre, EndpointRoles.mailbox, providerPre])
          ?.allowed,
        true,
      );
      assertEquals(
        mailboxer.getTopicMsgs(mailboxTopicKey(alicePre, "/challenge")).length,
        1,
      );
      yield* mailboxer.close();
    } finally {
      yield* hby.close();
    }
  });
});

/**
 * Proves the reverse mailbox interop direction:
 * - Tufa authorizes a real KERIpy/HIO mailbox host
 * - Tufa advertises mailbox OOBIs that another controller resolves
 * - mailbox-forwarded `/challenge` traffic lands in KERIpy mailbox storage and
 *   is later polled back into Tufa verification flow
 */
Deno.test("Interop: tufa mailbox add works against the real KERIpy mailbox host", async () => {
  const ctx = await createInteropContext();
  const pythonCommand = await resolvePythonCommand(ctx.env, ctx.kliCommand);
  const base = `interop-mailbox-tufa-${crypto.randomUUID().slice(0, 8)}`;
  const passcode = "MyPasscodeARealSecret";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const tufaHeadDir = `${ctx.home}/tufa-head`;
  const providerPort = randomPort();
  const bobPort = randomPort();
  const providerOrigin = `http://127.0.0.1:${providerPort}`;
  const bobOrigin = `http://127.0.0.1:${bobPort}`;
  const providerName = `kli-mbx-${crypto.randomUUID().slice(0, 8)}`;
  const providerAlias = "relay";
  const aliceName = `tufa-alice-${crypto.randomUUID().slice(0, 8)}`;
  const aliceAlias = "alice";
  const bobName = `tufa-bob-${crypto.randomUUID().slice(0, 8)}`;
  const bobAlias = "bob";

  const providerInit = await requireSuccess(
    "kli provider init",
    runCmd(ctx.kliCommand, [
      "init",
      "--name",
      providerName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--salt",
      salt,
    ], ctx.env),
  );
  assertEquals(providerInit.code, 0);

  const providerIncept = await requireSuccess(
    "kli provider incept",
    runCmd(ctx.kliCommand, [
      "incept",
      "--name",
      providerName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      providerAlias,
      "--icount",
      "1",
      "--isith",
      "1",
      "--ncount",
      "1",
      "--nsith",
      "1",
      "--toad",
      "0",
    ], ctx.env),
  );
  const providerPre = extractPrefix(providerIncept.stdout);
  const providerUrl = `http://127.0.0.1:${providerPort}/${providerPre}`;

  await requireSuccess(
    "kli provider location add",
    runCmd(ctx.kliCommand, [
      "location",
      "add",
      "--name",
      providerName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      providerAlias,
      "--url",
      providerUrl,
    ], ctx.env),
  );
  await requireSuccess(
    "kli provider controller end role",
    runCmd(ctx.kliCommand, [
      "ends",
      "add",
      "--name",
      providerName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      providerAlias,
      "--role",
      "controller",
      "--eid",
      providerPre,
    ], ctx.env),
  );
  await requireSuccess(
    "kli provider mailbox end role",
    runCmd(ctx.kliCommand, [
      "ends",
      "add",
      "--name",
      providerName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      providerAlias,
      "--role",
      "mailbox",
      "--eid",
      providerPre,
    ], ctx.env),
  );

  const aliceInit = await requireSuccess(
    "tufa alice init",
    runTufa(
      [
        "init",
        "--name",
        aliceName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--salt",
        salt,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  assertEquals(aliceInit.code, 0);

  const aliceIncept = await requireSuccess(
    "tufa alice incept",
    runTufa(
      [
        "incept",
        "--name",
        aliceName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        aliceAlias,
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
      ctx.repoRoot,
    ),
  );
  const alicePre = extractPrefix(aliceIncept.stdout);

  const bobInit = await requireSuccess(
    "tufa bob init",
    runTufa(
      [
        "init",
        "--name",
        bobName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--salt",
        salt,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  assertEquals(bobInit.code, 0);

  const bobIncept = await requireSuccess(
    "tufa bob incept",
    runTufa(
      [
        "incept",
        "--name",
        bobName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        bobAlias,
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
      ctx.repoRoot,
    ),
  );
  const bobPre = extractPrefix(bobIncept.stdout);
  const bobUrl = bobOrigin;

  await requireSuccess(
    "tufa bob location add",
    runTufa(
      [
        "loc",
        "add",
        "--name",
        bobName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        bobAlias,
        "--url",
        bobUrl,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  await requireSuccess(
    "tufa bob controller end role",
    runTufa(
      [
        "ends",
        "add",
        "--name",
        bobName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        bobAlias,
        "--role",
        "controller",
        "--eid",
        bobPre,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );

  const providerHost = spawnChild(
    pythonCommand,
    [
      "-m",
      "keri.cli.kli",
      "mailbox",
      "start",
      "--name",
      providerName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      providerAlias,
      "--http",
      String(providerPort),
    ],
    {
      ...ctx.env,
      PYTHONPATH: [
        keripySourceRoot(),
        ctx.env.PYTHONPATH ?? "",
      ].filter((item) => item.length > 0).join(":"),
    },
  );
  const bobAgent = spawnChild(
    "deno",
    [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "mod.ts",
      "agent",
      "--name",
      bobName,
      "--base",
      base,
      "--head-dir",
      tufaHeadDir,
      "--passcode",
      passcode,
      "--port",
      String(bobPort),
    ],
    ctx.env,
    ctx.repoRoot,
  );

  await withStartedChild(providerHost, providerPort, async () => {
    await withStartedChild(bobAgent, bobPort, async () => {
      await requireSuccess(
        "tufa resolve keripy provider controller",
        runTufaWithTimeout(
          [
            "oobi",
            "resolve",
            "--name",
            aliceName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--url",
            `${providerOrigin}/oobi/${providerPre}/controller`,
            "--oobi-alias",
            providerAlias,
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );

      const mailboxAdd = await requireSuccess(
        "tufa mailbox add against real keripy host",
        runTufaWithTimeout(
          [
            "mailbox",
            "add",
            "--name",
            aliceName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--alias",
            aliceAlias,
            "--mailbox",
            providerAlias,
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );
      assertStringIncludes(mailboxAdd.stdout, `added ${providerPre}`);

      const mailboxList = await requireSuccess(
        "tufa mailbox list",
        runTufaWithTimeout(
          [
            "mailbox",
            "list",
            "--name",
            aliceName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--alias",
            aliceAlias,
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );
      assertStringIncludes(mailboxList.stdout, providerPre);
      assertStringIncludes(mailboxList.stdout, providerUrl);

      await requireSuccess(
        "tufa resolve bob controller",
        runTufaWithTimeout(
          [
            "oobi",
            "resolve",
            "--name",
            aliceName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--url",
            `${bobOrigin}/oobi/${bobPre}/controller`,
            "--oobi-alias",
            bobAlias,
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );

      const mailboxOobi = await requireSuccess(
        "tufa mailbox oobi generate",
        runTufaWithTimeout(
          [
            "oobi",
            "generate",
            "--name",
            aliceName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--alias",
            aliceAlias,
            "--role",
            "mailbox",
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );
      const mailboxUrl = extractLastNonEmptyLine(mailboxOobi.stdout);
      assertStringIncludes(mailboxUrl, `${providerUrl}/oobi/`);
      assertStringIncludes(mailboxUrl, alicePre);
      assertStringIncludes(mailboxUrl, providerPre);

      await requireSuccess(
        "tufa bob resolve provider controller",
        runTufaWithTimeout(
          [
            "oobi",
            "resolve",
            "--name",
            bobName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--url",
            `${providerOrigin}/oobi/${providerPre}/controller`,
            "--oobi-alias",
            providerAlias,
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );

      await requireSuccess(
        "tufa bob resolve alice mailbox oobi",
        runTufaWithTimeout(
          [
            "oobi",
            "resolve",
            "--name",
            bobName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--url",
            mailboxUrl,
            "--oobi-alias",
            aliceAlias,
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );

      const firstWords = ["hotel", "india", "juliet"];
      const firstSend = await requireSuccess(
        "tufa challenge respond via real keripy mailbox host",
        runTufaWithTimeout(
          [
            "challenge",
            "respond",
            "--name",
            bobName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--alias",
            bobAlias,
            "--recipient",
            alicePre,
            "--words",
            JSON.stringify(firstWords),
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );
      assertStringIncludes(firstSend.stdout, "Sent EXN message");

      const firstVerify = await requireSuccess(
        "tufa challenge verify via real keripy mailbox host",
        runTufaWithTimeout(
          [
            "challenge",
            "verify",
            "--name",
            aliceName,
            "--base",
            base,
            "--head-dir",
            tufaHeadDir,
            "--passcode",
            passcode,
            "--signer",
            bobPre,
            "--words",
            JSON.stringify(firstWords),
            "--timeout",
            "5",
          ],
          ctx.env,
          ctx.repoRoot,
          20_000,
        ),
      );
      assertStringIncludes(firstVerify.stdout, bobPre);
    });
  });
});
