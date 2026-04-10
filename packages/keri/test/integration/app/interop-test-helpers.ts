/**
 * Shared helpers for subprocess-heavy `kli` <-> `tufa` interoperability tests.
 *
 * These helpers keep the interop suites focused on protocol assertions instead
 * of repeating process plumbing, temp-home setup, and compat-store inspection.
 */
import { type Operation } from "npm:effection@^3.6.0";
import { t } from "../../../../cesr/mod.ts";
import { createHabery, type Habery } from "../../../src/app/habbing.ts";

/** Decoded subprocess result. */
export interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Long-lived subprocess handle with tee'd output streams for health-gated hosts.
 */
export interface SpawnedChild {
  status: Promise<Deno.CommandStatus>;
  kill(signal: Deno.Signal): void;
  stdout?: ReadableStream<Uint8Array>;
  stderr?: ReadableStream<Uint8Array>;
  liveStdout?: ReadableStream<Uint8Array>;
  liveStderr?: ReadableStream<Uint8Array>;
}

/** Shared temp-home context used by live interop tests. */
export interface InteropContext {
  home: string;
  env: Record<string, string>;
  repoRoot: string;
  kliCommand: string;
}

/** One started KERIpy witness process plus its advertised network state. */
export interface KeriPyWitnessNode {
  alias: string;
  name: string;
  pre: string;
  httpPort: number;
  tcpPort: number;
  httpOrigin: string;
  tcpUrl: string;
  controllerOobi: string;
  witnessOobi: string;
}

/** One started Tufa witness process plus its advertised network state. */
export interface TufaWitnessNode {
  alias: string;
  name: string;
  pre: string;
  httpPort: number;
  tcpPort: number;
  httpOrigin: string;
  tcpUrl: string;
  controllerOobi: string;
  witnessOobi: string;
}

/** Options for the explicit KERIpy witness harness. */
export interface KeriPyWitnessHarnessOptions {
  aliases?: readonly string[];
  base?: string;
}

/** Options for the explicit Tufa witness harness. */
export interface TufaWitnessHarnessOptions {
  aliases?: readonly string[];
  headDirPath?: string;
}

/** Default KERIpy witness aliases shipped in the reference config set. */
const DEFAULT_KERIPY_WITNESS_ALIASES = [
  "wan",
  "wil",
  "wes",
  "wit",
  "wub",
  "wyz",
] as const;

/** Default Tufa witness aliases used by controller-symmetry interop tests. */
const DEFAULT_TUFA_WITNESS_ALIASES = [
  "twan",
  "twil",
  "twes",
  "twit",
] as const;

/**
 * Runs one command and returns decoded stdout/stderr.
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

/**
 * Runs one command with a hard timeout so interop failures stop at the blocked
 * step instead of hanging the full file.
 */
export async function runCmdWithTimeout(
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
 * Sanity-check a resolved `kli` candidate before trusting it in live tests.
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
 * Resolve pyenv-managed tools against the caller's real shell env instead of a
 * temp HOME used for isolated interop keystores.
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
 * Resolve the concrete `kli` executable to use for live interop.
 */
export async function resolveKliCommand(
  env: Record<string, string>,
): Promise<string> {
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

/** Parse the human-readable `Prefix` line emitted by both CLIs. */
export function extractPrefix(output: string): string {
  const line = output.split(/\r?\n/).find((line) => line.trim().startsWith("Prefix"));
  if (!line) {
    throw new Error(`Unable to parse prefix from output:\n${output}`);
  }
  const parts = line.trim().split(/\s+/);
  return parts[parts.length - 1];
}

/** Parse the raw qb64 signature from numbered KLI/Tufa sign output. */
export function extractRawSignature(output: string): string {
  const line = output.split(/\r?\n/).find((line) => /^\d+\.\s+/.test(line.trim()));
  if (!line) {
    throw new Error(`Unable to parse signature from output:\n${output}`);
  }
  return line.trim().replace(/^\d+\.\s+/, "");
}

/**
 * Normalize non-deterministic timestamp encodings out of exported CESR text.
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

/** Extract only serialized KEL event JSON lines from mixed CLI output. */
export function extractKelStream(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("{\"v\":\"KERI"))
    .join("\n");
}

/**
 * Preserve the active Deno cache directory when tests override HOME.
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
 * Resolve the workspace root used for `deno run packages/tufa/mod.ts ...`
 * test invocations.
 *
 * Historical note:
 * - many older tests called this the "package root" because `keri/mod.ts`
 *   used to be the CLI entrypoint
 * - after the package split, the real runnable entrypoint lives in `tufa`
 */
export function packageRoot(): string {
  return workspaceRoot();
}

/** Resolve the `keri-ts` workspace root. */
export function workspaceRoot(): string {
  return new URL("../../../../../", import.meta.url).pathname;
}

/** Resolve the sibling KERIpy repo root checked into this workspace. */
export function keripyRepoRoot(): string {
  return new URL("../../../../../../keripy/", import.meta.url).pathname;
}

/** Resolve the local-source KERIpy Python package root. */
export function keripySourceRoot(): string {
  return new URL("../../../../../../keripy/src/", import.meta.url).pathname;
}

/** Resolve the checked-in KERIpy witness config directory. */
export function keripyWitnessConfigSourceRoot(): string {
  return new URL(
    "../../../../../../keripy/scripts/keri/cf/main/",
    import.meta.url,
  )
    .pathname;
}

/** Resolve the checked-in KERIpy witness inception sample file. */
export function keripyWitnessSamplePath(): string {
  return new URL(
    "../../../../../../keripy/scripts/demo/data/wil-witness-sample.json",
    import.meta.url,
  )
    .pathname;
}

/** Return the last non-empty line from human-oriented CLI output. */
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

/** Wait until one long-lived host reports healthy on `/health`. */
export async function waitForHealth(port: number): Promise<void> {
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

/** Wait until one specific HTTP URL responds with any 2xx status. */
async function waitForHttpOk(url: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError = `HTTP probe did not return 2xx for ${url}`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      try {
        if (response.ok) {
          return;
        }
        lastError = `${url} returned HTTP ${response.status}`;
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

/** Wait until a KERIpy witness exposes either controller or witness OOBI HTTP. */
async function waitForKeriPyWitnessReady(
  node: Pick<KeriPyWitnessNode, "controllerOobi" | "witnessOobi">,
): Promise<void> {
  let controllerError: unknown;
  try {
    await waitForHttpOk(node.controllerOobi);
    return;
  } catch (error) {
    controllerError = error;
  }

  try {
    await waitForHttpOk(node.witnessOobi);
    return;
  } catch (witnessError) {
    throw new Error(
      `KERIpy witness OOBIs never became ready.\ncontroller: ${
        controllerError instanceof Error
          ? controllerError.message
          : String(controllerError)
      }\nwitness: ${
        witnessError instanceof Error
          ? witnessError.message
          : String(witnessError)
      }`,
    );
  }
}

/**
 * Spawn one subprocess with piped stdout/stderr and tee'd live streams.
 */
export function spawnChild(
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

/** Read buffered stdout and stderr from one spawned subprocess. */
export async function readChildOutput(child: SpawnedChild): Promise<string> {
  const readStream = async (
    stream: ReadableStream<Uint8Array> | undefined,
  ): Promise<string> => {
    if (!stream) {
      return "";
    }
    try {
      return await new Response(stream).text();
    } catch (error) {
      if (
        error instanceof TypeError
        && error.message.includes("ReadableStream is locked or disturbed")
      ) {
        return "";
      }
      throw error;
    }
  };

  const [stdout, stderr] = await Promise.all([
    readStream(child.stdout),
    readStream(child.stderr),
  ]);
  return `${stdout}\n${stderr}`.trim();
}

/**
 * Stop one spawned subprocess and return any buffered output for debugging.
 */
export async function stopChild(child: SpawnedChild): Promise<string> {
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

/**
 * Start one host process, wait for health, run the body, and always shut it down.
 */
export async function withStartedChild<T>(
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

/**
 * Resolve the Python interpreter that matches the active `kli` installation.
 */
export async function resolvePythonCommand(
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

/** Run the local `tufa` CLI from source. */
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

/** Run the local `tufa` CLI from source with a hard timeout. */
export async function runTufaWithTimeout(
  args: string[],
  env: Record<string, string>,
  cwd: string,
  timeoutMs = 20_000,
): Promise<CmdResult> {
  return await runCmdWithTimeout(
    Deno.execPath(),
    ["run", "--allow-all", "--unstable-ffi", "packages/tufa/mod.ts", ...args],
    env,
    timeoutMs,
    cwd,
  );
}

/**
 * Create the shared temp-home context used by live KLI/Tufa interop tests.
 */
export async function createInteropContext(): Promise<InteropContext> {
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
    repoRoot: workspaceRoot(),
    kliCommand: await resolveKliCommand(env),
  };
}

/** Require one command result to succeed and keep the label in failures. */
export async function requireSuccess(
  label: string,
  resultPromise: Promise<CmdResult>,
): Promise<CmdResult> {
  const result = await resultPromise;
  if (result.code !== 0) {
    throw new Error(`${label} failed: ${result.stderr}\n${result.stdout}`);
  }
  return result;
}

/** Return one random localhost port for temporary test hosts. */
export function randomPort(): number {
  return 20_000 + Math.floor(Math.random() * 20_000);
}

/**
 * Temporarily override process env inside one Effection operation.
 */
export function* withProcessEnv<T>(
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
 */
export function* inspectCompatHabery(
  ctx: InteropContext,
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

/** Build the env used for local-source KERIpy hosts. */
export function localKeriPySourceEnv(
  env: Record<string, string>,
): Record<string, string> {
  return {
    ...env,
    PYTHONPATH: [
      keripySourceRoot(),
      env.PYTHONPATH ?? "",
    ].filter((item) => item.length > 0).join(":"),
  };
}

/**
 * Explicit, randomized KERIpy witness topology used by interop receipt tests.
 *
 * The KERIpy CLI has an awkward config-path split:
 * - `init --config-dir/--config-file` and `incept --config` look under
 *   `keri/cf/<name>.json`
 * - `witness start --config-dir/--config-file` reopens through
 *   `keri/cf/main/<name>.json`
 *
 * The harness writes both layouts so the tests exercise real KERIpy commands
 * without inheriting the fixed-port `kli witness demo` topology.
 */
export class KeriPyWitnessHarness {
  private closed = false;

  constructor(
    readonly home: string,
    readonly base: string,
    readonly configRoot: string,
    readonly env: Record<string, string>,
    readonly pythonCommand: string,
    readonly nodes: readonly KeriPyWitnessNode[],
    private readonly children: readonly SpawnedChild[],
  ) {}

  /** Return one witness by alias or fail loudly if the harness was miswired. */
  node(alias: string): KeriPyWitnessNode {
    const node = this.nodes.find((candidate) => candidate.alias === alias);
    if (!node) {
      throw new Error(`Unknown KERIpy witness alias '${alias}'.`);
    }
    return node;
  }

  /** Return the first `count` witnesses in deterministic alias order. */
  activeWitnesses(count: number): readonly KeriPyWitnessNode[] {
    if (count < 0 || count > this.nodes.length) {
      throw new Error(
        `Requested ${count} active witnesses from a harness with ${this.nodes.length}.`,
      );
    }
    return this.nodes.slice(0, count);
  }

  /** Stop all witness hosts exactly once. */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await Promise.all(this.children.map((child) => stopChild(child)));
  }
}

/** Write one randomized KERIpy witness config into both CLI lookup layouts. */
async function writeKeriPyWitnessConfig(
  configRoot: string,
  alias: string,
  httpPort: number,
  tcpPort: number,
): Promise<void> {
  const sourcePath = `${keripyWitnessConfigSourceRoot()}${alias}.json`;
  const raw = await Deno.readTextFile(sourcePath);
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const node = parsed[alias];
  if (!node || typeof node !== "object") {
    throw new Error(
      `Witness config ${sourcePath} is missing alias '${alias}'.`,
    );
  }

  parsed[alias] = {
    ...(node as Record<string, unknown>),
    curls: [
      `tcp://127.0.0.1:${tcpPort}/`,
      `http://127.0.0.1:${httpPort}/`,
    ],
  };

  const encoded = `${JSON.stringify(parsed, null, 2)}\n`;
  const directPath = `${configRoot}/keri/cf/${alias}.json`;
  const mainPath = `${configRoot}/keri/cf/main/${alias}.json`;
  await Deno.mkdir(`${configRoot}/keri/cf`, { recursive: true });
  await Deno.mkdir(`${configRoot}/keri/cf/main`, { recursive: true });
  await Deno.writeTextFile(directPath, encoded);
  await Deno.writeTextFile(mainPath, encoded);
}

/** Seed one KERIpy witness store with real CLI init + incept commands. */
async function initializeKeriPyWitness(
  kliCommand: string,
  env: Record<string, string>,
  base: string,
  configRoot: string,
  alias: string,
): Promise<string> {
  await requireSuccess(
    `${alias} init`,
    runCmd(
      kliCommand,
      [
        "init",
        "--name",
        alias,
        "--base",
        base,
        "--nopasscode",
        "--config-dir",
        configRoot,
        "--config-file",
        alias,
      ],
      env,
    ),
  );

  const incepted = await requireSuccess(
    `${alias} incept`,
    runCmd(
      kliCommand,
      [
        "incept",
        "--name",
        alias,
        "--base",
        base,
        "--alias",
        alias,
        "--config",
        configRoot,
        "--file",
        keripyWitnessSamplePath(),
      ],
      env,
    ),
  );
  return extractPrefix(incepted.stdout);
}

/** Start explicit KERIpy witness hosts from temp-copied configs and random ports. */
export async function startKeriPyWitnessHarness(
  ctx: InteropContext,
  options: KeriPyWitnessHarnessOptions = {},
): Promise<KeriPyWitnessHarness> {
  const aliases = options.aliases ?? DEFAULT_KERIPY_WITNESS_ALIASES;
  const home = await Deno.makeTempDir({ prefix: "keripy-witness-home-" });
  const configRoot = await Deno.makeTempDir({
    prefix: "keripy-witness-config-",
  });
  const base = options.base
    ?? `interop-wits-${crypto.randomUUID().slice(0, 8)}`;
  const env = {
    ...ctx.env,
    HOME: home,
  };
  const pythonCommand = await resolvePythonCommand(env, ctx.kliCommand);

  const nodes: KeriPyWitnessNode[] = [];
  for (const alias of aliases) {
    const httpPort = randomPort();
    const tcpPort = randomPort();
    await writeKeriPyWitnessConfig(configRoot, alias, httpPort, tcpPort);
    const pre = await initializeKeriPyWitness(
      ctx.kliCommand,
      env,
      base,
      configRoot,
      alias,
    );
    nodes.push({
      alias,
      name: alias,
      pre,
      httpPort,
      tcpPort,
      httpOrigin: `http://127.0.0.1:${httpPort}`,
      tcpUrl: `tcp://127.0.0.1:${tcpPort}`,
      controllerOobi: `http://127.0.0.1:${httpPort}/oobi/${pre}/controller`,
      witnessOobi: `http://127.0.0.1:${httpPort}/oobi/${pre}/witness/${pre}`,
    });
  }

  const children = nodes.map((node) =>
    spawnChild(
      pythonCommand,
      [
        "-m",
        "keri.cli.kli",
        "witness",
        "start",
        "--name",
        node.name,
        "--base",
        base,
        "--alias",
        node.alias,
        "--config-dir",
        configRoot,
        "--config-file",
        node.alias,
        "--http",
        String(node.httpPort),
        "--tcp",
        String(node.tcpPort),
      ],
      localKeriPySourceEnv(env),
      keripyRepoRoot(),
    )
  );

  try {
    await Promise.all(nodes.map((node) => waitForKeriPyWitnessReady(node)));
  } catch (error) {
    const details = await Promise.all(
      children.map((child, index) =>
        stopChild(child).then((output) =>
          output.length > 0
            ? `# ${nodes[index]?.alias}\n${output}`
            : `# ${nodes[index]?.alias}\n<no output>`
        )
      ),
    );
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${details.join("\n\n")}`,
    );
  }

  return new KeriPyWitnessHarness(
    home,
    base,
    configRoot,
    env,
    pythonCommand,
    nodes,
    children,
  );
}

/**
 * Explicit, randomized Tufa witness topology used by controller-symmetry
 * interop tests.
 */
export class TufaWitnessHarness {
  private closed = false;

  constructor(
    readonly headDirPath: string,
    readonly env: Record<string, string>,
    readonly nodes: readonly TufaWitnessNode[],
    private readonly children: readonly SpawnedChild[],
  ) {}

  /** Return one witness by alias or fail loudly if the harness was miswired. */
  node(alias: string): TufaWitnessNode {
    const node = this.nodes.find((candidate) => candidate.alias === alias);
    if (!node) {
      throw new Error(`Unknown Tufa witness alias '${alias}'.`);
    }
    return node;
  }

  /** Return the first `count` witnesses in deterministic alias order. */
  activeWitnesses(count: number): readonly TufaWitnessNode[] {
    if (count < 0 || count > this.nodes.length) {
      throw new Error(
        `Requested ${count} active witnesses from a harness with ${this.nodes.length}.`,
      );
    }
    return this.nodes.slice(0, count);
  }

  /** Stop all witness hosts exactly once. */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await Promise.all(this.children.map((child) => stopChild(child)));
  }
}

/** Initialize one unencrypted Tufa store. */
async function initTufaStore(
  name: string,
  headDirPath: string,
  env: Record<string, string>,
  repoRoot: string,
): Promise<void> {
  await requireSuccess(
    `${name} init`,
    runTufa(
      [
        "init",
        "--name",
        name,
        "--head-dir",
        headDirPath,
        "--nopasscode",
      ],
      env,
      repoRoot,
    ),
  );
}

/** Incept one non-transferable Tufa witness identity. */
async function inceptTufaWitnessIdentity(
  name: string,
  alias: string,
  headDirPath: string,
  env: Record<string, string>,
  repoRoot: string,
): Promise<string> {
  const incepted = await requireSuccess(
    `${name} incept`,
    runTufa(
      [
        "incept",
        "--name",
        name,
        "--head-dir",
        headDirPath,
        "--alias",
        alias,
        "--icount",
        "1",
        "--isith",
        "1",
        "--toad",
        "0",
      ],
      env,
      repoRoot,
    ),
  );
  return extractPrefix(incepted.stdout);
}

/** Start one long-lived Tufa witness host. */
function startTufaWitnessHost(
  name: string,
  alias: string,
  headDirPath: string,
  httpPort: number,
  tcpPort: number,
  env: Record<string, string>,
  repoRoot: string,
): SpawnedChild {
  return spawnChild(
    "deno",
    [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "mod.ts",
      "witness",
      "start",
      "--name",
      name,
      "--head-dir",
      headDirPath,
      "--alias",
      alias,
      "--url",
      `http://127.0.0.1:${httpPort}`,
      "--tcp-url",
      `tcp://127.0.0.1:${tcpPort}`,
      "--listen-host",
      "127.0.0.1",
    ],
    env,
    repoRoot,
  );
}

/** Start explicit Tufa witness hosts from isolated stores and random ports. */
export async function startTufaWitnessHarness(
  ctx: InteropContext,
  options: TufaWitnessHarnessOptions = {},
): Promise<TufaWitnessHarness> {
  const aliases = options.aliases ?? DEFAULT_TUFA_WITNESS_ALIASES;
  const headDirPath = options.headDirPath ?? await Deno.makeTempDir({
    prefix: "tufa-witness-harness-",
  });
  const nodes: TufaWitnessNode[] = [];
  const children: SpawnedChild[] = [];

  try {
    for (const alias of aliases) {
      const name = `tufa-${alias}-${crypto.randomUUID().slice(0, 8)}`;
      await initTufaStore(name, headDirPath, ctx.env, ctx.repoRoot);
      const pre = await inceptTufaWitnessIdentity(
        name,
        alias,
        headDirPath,
        ctx.env,
        ctx.repoRoot,
      );
      const httpPort = randomPort();
      const tcpPort = randomPort();
      const child = startTufaWitnessHost(
        name,
        alias,
        headDirPath,
        httpPort,
        tcpPort,
        ctx.env,
        ctx.repoRoot,
      );
      await waitForHealth(httpPort);

      nodes.push({
        alias,
        name,
        pre,
        httpPort,
        tcpPort,
        httpOrigin: `http://127.0.0.1:${httpPort}`,
        tcpUrl: `tcp://127.0.0.1:${tcpPort}`,
        controllerOobi: `http://127.0.0.1:${httpPort}/oobi/${pre}/controller`,
        witnessOobi: `http://127.0.0.1:${httpPort}/oobi/${pre}/witness/${pre}`,
      });
      children.push(child);
    }
  } catch (error) {
    const details = await Promise.all(
      children.map((child, index) =>
        stopChild(child).then((output) =>
          output.length > 0
            ? `# ${nodes[index]?.alias ?? aliases[index]}\n${output}`
            : `# ${nodes[index]?.alias ?? aliases[index]}\n<no output>`
        )
      ),
    );
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${details.join("\n\n")}`,
    );
  }

  return new TufaWitnessHarness(headDirPath, ctx.env, nodes, children);
}
