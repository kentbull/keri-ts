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
  mailboxOobi: string;
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
  mailboxOobi: string;
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

export interface KeriPyWitnessDemoHarnessOptions {
  readonly kliCommand?: string;
  readonly useBase?: boolean;
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

const DEFAULT_HEALTH_TIMEOUT_MS = 15_000;
const TUFA_WITNESS_START_TIMEOUT_MS = 45_000;
const TEST_PORT_MIN = 20_000;
const TEST_PORT_MAX_EXCLUSIVE = 32_768;

const KERIPY_DEMO_WITNESS_NODES: readonly KeriPyWitnessNode[] = [
  {
    alias: "wan",
    name: "wan",
    pre: "BBilc4-L3tFUnfM_wJr4S4OJanAv_VmF_dJNN6vkf2Ha",
    httpPort: 5642,
    tcpPort: 5632,
    httpOrigin: "http://127.0.0.1:5642",
    tcpUrl: "tcp://127.0.0.1:5632",
    controllerOobi: "http://127.0.0.1:5642/oobi/BBilc4-L3tFUnfM_wJr4S4OJanAv_VmF_dJNN6vkf2Ha/controller",
    witnessOobi:
      "http://127.0.0.1:5642/oobi/BBilc4-L3tFUnfM_wJr4S4OJanAv_VmF_dJNN6vkf2Ha/witness/BBilc4-L3tFUnfM_wJr4S4OJanAv_VmF_dJNN6vkf2Ha",
    mailboxOobi:
      "http://127.0.0.1:5642/oobi/BBilc4-L3tFUnfM_wJr4S4OJanAv_VmF_dJNN6vkf2Ha/mailbox/BBilc4-L3tFUnfM_wJr4S4OJanAv_VmF_dJNN6vkf2Ha",
  },
  {
    alias: "wil",
    name: "wil",
    pre: "BLskRTInXnMxWaGqcpSyMgo0nYbalW99cGZESrz3zapM",
    httpPort: 5643,
    tcpPort: 5633,
    httpOrigin: "http://127.0.0.1:5643",
    tcpUrl: "tcp://127.0.0.1:5633",
    controllerOobi: "http://127.0.0.1:5643/oobi/BLskRTInXnMxWaGqcpSyMgo0nYbalW99cGZESrz3zapM/controller",
    witnessOobi:
      "http://127.0.0.1:5643/oobi/BLskRTInXnMxWaGqcpSyMgo0nYbalW99cGZESrz3zapM/witness/BLskRTInXnMxWaGqcpSyMgo0nYbalW99cGZESrz3zapM",
    mailboxOobi:
      "http://127.0.0.1:5643/oobi/BLskRTInXnMxWaGqcpSyMgo0nYbalW99cGZESrz3zapM/mailbox/BLskRTInXnMxWaGqcpSyMgo0nYbalW99cGZESrz3zapM",
  },
  {
    alias: "wes",
    name: "wes",
    pre: "BIKKuvBwpmDVA4Ds-EpL5bt9OqPzWPja2LigFYZN2YfX",
    httpPort: 5644,
    tcpPort: 5634,
    httpOrigin: "http://127.0.0.1:5644",
    tcpUrl: "tcp://127.0.0.1:5634",
    controllerOobi: "http://127.0.0.1:5644/oobi/BIKKuvBwpmDVA4Ds-EpL5bt9OqPzWPja2LigFYZN2YfX/controller",
    witnessOobi:
      "http://127.0.0.1:5644/oobi/BIKKuvBwpmDVA4Ds-EpL5bt9OqPzWPja2LigFYZN2YfX/witness/BIKKuvBwpmDVA4Ds-EpL5bt9OqPzWPja2LigFYZN2YfX",
    mailboxOobi:
      "http://127.0.0.1:5644/oobi/BIKKuvBwpmDVA4Ds-EpL5bt9OqPzWPja2LigFYZN2YfX/mailbox/BIKKuvBwpmDVA4Ds-EpL5bt9OqPzWPja2LigFYZN2YfX",
  },
];

/** Pinned KERIpy fork commit used by all KLI interop tests. */
export const KERIPY_INTEROP_COMMIT = "98b88cf73a746813a8719f05264400467a474c05";

const KERIPY_INTEROP_REPO = "https://github.com/kentbull/keripy.git";
const KERIPY_INTEROP_INSTALL = `git+${KERIPY_INTEROP_REPO}@${KERIPY_INTEROP_COMMIT}`;
const KERIPY_INTEROP_RAW_BASE = `https://raw.githubusercontent.com/kentbull/keripy/${KERIPY_INTEROP_COMMIT}`;

/** Pinned interop verifier fixture used by mixed KERIpy/Tufa ACDC tests. */
export const INTEROP_VERIFIER_COMMIT = "fef457d65df1ca72bd44d52bea57d28cc78e62d0";

const INTEROP_VERIFIER_RAW_BASE =
  `https://raw.githubusercontent.com/kentbull/interop-verifier/${INTEROP_VERIFIER_COMMIT}`;
const INTEROP_VERIFIER_FIXTURE_FILES = [
  "scripts/interop-verifier-incept-no-wits.json",
  "src/interop_verifier/__init__.py",
  "src/interop_verifier/app/__init__.py",
  "src/interop_verifier/app/cli.py",
  "src/interop_verifier/core/__init__.py",
  "src/interop_verifier/core/basing.py",
  "src/interop_verifier/core/credentials.py",
  "src/interop_verifier/core/handling.py",
  "src/interop_verifier/core/httping.py",
  "src/interop_verifier/core/monitoring.py",
  "src/interop_verifier/core/policy.py",
  "src/interop_verifier/core/serving.py",
  "src/interop_verifier/core/verifying.py",
  "src/interop_verifier/data/__init__.py",
  "src/interop_verifier/data/interop-verifier-incept-no-wits.json",
] as const;

/** Pinned Python did-webs-resolver checkout used by DID interop tests. */
export const DID_WEBS_RESOLVER_INTEROP_REPO = "https://github.com/kentbull/did-webs-resolver.git";
export const DID_WEBS_RESOLVER_INTEROP_REF = "refs/heads/clean-up-deps";
export const DID_WEBS_RESOLVER_INTEROP_COMMIT = "8395277f32b37129fa6ef734c9f3902bb6cbbcbc";
export const DID_WEBS_RESOLVER_HIO_PIN = "hio==0.6.14";

export interface DidWebsResolverTooling {
  readonly root: string;
  readonly dwsCommand: string;
  readonly pythonCommand: string;
}

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
  const stdoutPromise = child.stdout ? new Response(child.stdout).text() : Promise.resolve("");
  const stderrPromise = child.stderr ? new Response(child.stderr).text() : Promise.resolve("");

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
    return res.code === 0
      && (/usage:\s*kli\b/i.test(text)
        || /usage:\s*python\s+-m\s+keri\.cli\.kli\b/i.test(text));
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
    ...(Deno.env.get("PYENV_ROOT") ? { PYENV_ROOT: Deno.env.get("PYENV_ROOT")! } : {}),
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

/** Resolve the sibling local KERIpy checkout used for branch-local interop fixes. */
export function localKeripyRoot(): string {
  return new URL("../../../../../../../python/keripy/", import.meta.url).pathname;
}

/** Create a temp executable that runs KLI from the local KERIpy checkout. */
export async function createLocalKeripyKliWrapper(workDir: string): Promise<string> {
  const path = `${workDir}/local-kli`;
  const root = localKeripyRoot().replace(/'/g, "'\\''");
  await Deno.writeTextFile(
    path,
    [
      "#!/bin/sh",
      `KERIPY_ROOT='${root}'`,
      "exec uv run --project \"$KERIPY_ROOT\" --with-editable \"$KERIPY_ROOT\" python -m keri.cli.kli \"$@\"",
      "",
    ].join("\n"),
  );
  await Deno.chmod(path, 0o755);
  return path;
}

let localKeripyRunnable: Promise<boolean> | undefined;

/** Return true when the branch-local KERIpy checkout can be run through uv. */
export async function canRunLocalKeripy(
  env: Record<string, string>,
): Promise<boolean> {
  localKeripyRunnable ??= (async () => {
    try {
      await Deno.stat(localKeripyRoot());
      return await canRunCommand("uv", ["--version"], pyenvProbeEnv(env));
    } catch {
      return false;
    }
  })();
  return await localKeripyRunnable;
}

/**
 * Prefer the branch-local KERIpy checkout when it is runnable, otherwise use
 * the already-provisioned pinned interop KLI command.
 */
export async function resolveLocalKeripyKliCommand(
  workDir: string,
  fallbackCommand: string,
  env: Record<string, string>,
): Promise<string> {
  if (await canRunLocalKeripy(env)) {
    return await createLocalKeripyKliWrapper(workDir);
  }
  return fallbackCommand;
}

function cacheHome(): string {
  return Deno.env.get("XDG_CACHE_HOME")
    ?? `${Deno.env.get("HOME") ?? "/tmp"}/.cache`;
}

function keripyInteropCacheRoot(): string {
  return `${cacheHome()}/tufa-interop/keripy/${KERIPY_INTEROP_COMMIT}`;
}

function keripyInteropVenvRoot(): string {
  return `${keripyInteropCacheRoot()}/venv`;
}

function keripyInteropFixtureRoot(): string {
  return `${keripyInteropCacheRoot()}/fixtures`;
}

function keripyInteropVenvBin(name: string): string {
  return `${keripyInteropVenvRoot()}/bin/${name}`;
}

function interopVerifierCacheRoot(): string {
  return `${cacheHome()}/tufa-interop/interop-verifier/${INTEROP_VERIFIER_COMMIT}`;
}

function didWebsResolverCacheRoot(): string {
  return `${cacheHome()}/tufa-interop/did-webs-resolver/${DID_WEBS_RESOLVER_INTEROP_COMMIT}`;
}

function didWebsResolverCheckoutRoot(): string {
  return `${didWebsResolverCacheRoot()}/checkout`;
}

function didWebsResolverVenvRoot(): string {
  return `${didWebsResolverCacheRoot()}/venv`;
}

function didWebsResolverVenvBin(name: string): string {
  return `${didWebsResolverVenvRoot()}/bin/${name}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function gitHead(path: string): Promise<string | null> {
  if (!(await pathExists(`${path}/.git`))) {
    return null;
  }
  const result = await runCmd("git", ["rev-parse", "HEAD"], Deno.env.toObject(), path);
  return result.code === 0 ? result.stdout.trim() : null;
}

async function ensurePinnedDidWebsResolverCheckout(
  env: Record<string, string>,
): Promise<string> {
  const checkout = didWebsResolverCheckoutRoot();
  if (await gitHead(checkout) === DID_WEBS_RESOLVER_INTEROP_COMMIT) {
    return checkout;
  }

  if (await pathExists(checkout)) {
    await Deno.remove(checkout, { recursive: true });
  }
  await Deno.mkdir(checkout, { recursive: true });
  await requireSuccess(
    "initialize did-webs-resolver checkout",
    runCmdWithTimeout("git", ["init"], env, 30_000, checkout),
  );
  await requireSuccess(
    "fetch pinned did-webs-resolver ref",
    runCmdWithTimeout(
      "git",
      [
        "fetch",
        "--depth",
        "1",
        DID_WEBS_RESOLVER_INTEROP_REPO,
        DID_WEBS_RESOLVER_INTEROP_REF,
      ],
      env,
      120_000,
      checkout,
    ),
  );
  await requireSuccess(
    "checkout pinned did-webs-resolver commit",
    runCmdWithTimeout(
      "git",
      ["checkout", "--detach", DID_WEBS_RESOLVER_INTEROP_COMMIT],
      env,
      30_000,
      checkout,
    ),
  );
  const head = await gitHead(checkout);
  if (head !== DID_WEBS_RESOLVER_INTEROP_COMMIT) {
    throw new Error(
      `Expected did-webs-resolver ${DID_WEBS_RESOLVER_INTEROP_COMMIT}, got ${head ?? "<unknown>"}.`,
    );
  }
  return checkout;
}

async function canUseDws(
  command: string,
  env: Record<string, string>,
): Promise<boolean> {
  try {
    const result = await runCmd(command, ["--help"], env);
    return result.code === 0 && `${result.stdout}\n${result.stderr}`.includes("dws");
  } catch {
    return false;
  }
}

async function installDidWebsResolverIntoVenv(
  python: string,
  checkout: string,
  env: Record<string, string>,
): Promise<void> {
  const venv = didWebsResolverVenvRoot();
  if (await pathExists(venv)) {
    await Deno.remove(venv, { recursive: true });
  }
  await requireSuccess(
    "create did-webs-resolver venv",
    runCmdWithTimeout(python, ["-m", "venv", venv], env, 120_000),
  );
  const venvPython = didWebsResolverVenvBin("python");
  if (await canRunCommand("uv", ["--version"], env)) {
    await requireSuccess(
      "install pinned did-webs-resolver with uv",
      runCmdWithTimeout(
        "uv",
        [
          "pip",
          "install",
          "--python",
          venvPython,
          "-e",
          checkout,
        ],
        env,
        600_000,
      ),
    );
    await requireSuccess(
      "pin did-webs-resolver hio dependency with uv",
      runCmdWithTimeout(
        "uv",
        [
          "pip",
          "install",
          "--python",
          venvPython,
          DID_WEBS_RESOLVER_HIO_PIN,
        ],
        env,
        240_000,
      ),
    );
  } else {
    await requireSuccess(
      "upgrade did-webs-resolver venv packaging tools",
      runCmdWithTimeout(
        venvPython,
        ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"],
        env,
        240_000,
      ),
    );
    await requireSuccess(
      "install pinned did-webs-resolver with pip",
      runCmdWithTimeout(
        venvPython,
        ["-m", "pip", "install", "-e", checkout],
        env,
        600_000,
      ),
    );
    await requireSuccess(
      "pin did-webs-resolver hio dependency with pip",
      runCmdWithTimeout(
        venvPython,
        ["-m", "pip", "install", DID_WEBS_RESOLVER_HIO_PIN],
        env,
        240_000,
      ),
    );
  }
}

/** Resolve a pinned Python `dws` executable for did:webs interop. */
export async function ensurePinnedDidWebsResolver(
  env: Record<string, string>,
): Promise<DidWebsResolverTooling> {
  const checkout = await ensurePinnedDidWebsResolverCheckout(env);
  const marker = `${didWebsResolverCacheRoot()}/PIN`;
  const markerValue = `${DID_WEBS_RESOLVER_INTEROP_COMMIT}\n${DID_WEBS_RESOLVER_HIO_PIN}`;
  const dws = didWebsResolverVenvBin("dws");
  const markerMatches = await pathExists(marker) ? (await Deno.readTextFile(marker)).trim() === markerValue : false;
  if (markerMatches && await canUseDws(dws, env)) {
    return {
      root: checkout,
      dwsCommand: dws,
      pythonCommand: didWebsResolverVenvBin("python"),
    };
  }

  const python = await resolveDidWebsResolverPython(env);
  const installEnv = {
    ...pyenvProbeEnv(env),
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
  };
  await installDidWebsResolverIntoVenv(python, checkout, installEnv);
  if (!(await canUseDws(dws, env))) {
    throw new Error(`Pinned did-webs-resolver install did not produce a runnable dws at ${dws}.`);
  }
  await Deno.mkdir(didWebsResolverCacheRoot(), { recursive: true });
  await Deno.writeTextFile(marker, `${markerValue}\n`);
  return {
    root: checkout,
    dwsCommand: dws,
    pythonCommand: didWebsResolverVenvBin("python"),
  };
}

/** Resolve the checked-in KERIpy witness config directory. */
export function keripyWitnessConfigSourceRoot(): string {
  return `${keripyInteropFixtureRoot()}/scripts/keri/cf/main/`;
}

/** Resolve the checked-in KERIpy witness inception sample file. */
export function keripyWitnessSamplePath(): string {
  return `${keripyInteropFixtureRoot()}/scripts/demo/data/wil-witness-sample.json`;
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
export async function waitForHealth(
  port: number,
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
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

async function waitForHealthOrChildExit(
  child: SpawnedChild,
  port: number,
  label: string,
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
): Promise<void> {
  const health = waitForHealth(port, timeoutMs).then(
    () => ({ kind: "healthy" as const }),
    (error) => ({ kind: "unhealthy" as const, error }),
  );
  const exited = child.status.then(
    (status) => ({ kind: "exited" as const, status }),
    (error) => ({ kind: "exit-error" as const, error }),
  );

  const result = await Promise.race([health, exited]);
  if (result.kind === "healthy") {
    return;
  }
  if (result.kind === "exited") {
    const signal = result.status.signal ? `, signal ${result.status.signal}` : "";
    throw new Error(
      `${label} exited before /health became ready on port ${port} (code ${result.status.code}${signal})`,
    );
  }
  if (result.kind === "exit-error") {
    throw new Error(
      `${label} status failed before /health became ready on port ${port}: ${
        result.error instanceof Error ? result.error.message : String(result.error)
      }`,
    );
  }
  throw new Error(
    `${label} /health did not become ready on port ${port}: ${
      result.error instanceof Error ? result.error.message : String(result.error)
    }`,
  );
}

/** Wait until one specific HTTP URL responds with any 2xx status. */
export async function waitForHttpOk(url: string): Promise<void> {
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

async function tcpPortIsListening(port: number): Promise<boolean> {
  try {
    const connection = await Deno.connect({
      hostname: "127.0.0.1",
      port,
    });
    connection.close();
    return true;
  } catch {
    return false;
  }
}

async function assertTcpPortsFree(
  ports: readonly number[],
  label: string,
): Promise<void> {
  const occupied: number[] = [];
  for (const port of ports) {
    if (await tcpPortIsListening(port)) {
      occupied.push(port);
    }
  }
  if (occupied.length > 0) {
    throw new Error(
      `${label} expected free ports but these are already listening: ${occupied.join(", ")}`,
    );
  }
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
        controllerError instanceof Error ? controllerError.message : String(controllerError)
      }\nwitness: ${witnessError instanceof Error ? witnessError.message : String(witnessError)}`,
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

  const [liveStdout, stdout] = child.stdout ? child.stdout.tee() : [undefined, undefined];
  const [liveStderr, stderr] = child.stderr ? child.stderr.tee() : [undefined, undefined];

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

function parsePythonVersion(
  output: string,
): { major: number; minor: number } | null {
  const match = output.match(/Python\s+(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
  };
}

async function canUsePython314(
  command: string,
  env: Record<string, string>,
): Promise<boolean> {
  try {
    const result = await runCmd(command, ["--version"], env);
    const version = parsePythonVersion(`${result.stdout}\n${result.stderr}`);
    return result.code === 0 && !!version
      && (version.major > 3 || (version.major === 3 && version.minor >= 14));
  } catch {
    return false;
  }
}

async function resolvePython314Command(
  env: Record<string, string>,
): Promise<string> {
  const probeEnv = pyenvProbeEnv(env);
  const candidates: string[] = [];
  const explicit = Deno.env.get("KERIPY_INTEROP_PYTHON");
  if (explicit) {
    candidates.push(explicit);
  }

  try {
    const pyenvWhich = await runCmd("pyenv", ["which", "python"], probeEnv);
    const resolved = pyenvWhich.stdout.trim();
    if (pyenvWhich.code === 0 && resolved.length > 0) {
      candidates.push(resolved);
    }
  } catch {
    // Fall through to PATH candidates.
  }

  candidates.push("python3.14", "python3");
  for (const candidate of candidates) {
    if (await canUsePython314(candidate, probeEnv)) {
      return candidate;
    }
  }

  throw new Error(
    `KERIpy interop requires Python >= 3.14. Tried: ${candidates.join(", ")}`,
  );
}

async function canUsePythonForDidWebsResolver(
  command: string,
  env: Record<string, string>,
): Promise<boolean> {
  try {
    const result = await runCmd(command, ["--version"], env);
    const version = parsePythonVersion(`${result.stdout}\n${result.stderr}`);
    return result.code === 0 && !!version
      && version.major === 3
      && version.minor >= 12
      && version.minor < 14;
  } catch {
    return false;
  }
}

async function resolveDidWebsResolverPython(
  env: Record<string, string>,
): Promise<string> {
  const probeEnv = pyenvProbeEnv(env);
  const candidates: string[] = [];
  const explicit = Deno.env.get("DID_WEBS_RESOLVER_PYTHON");
  if (explicit) {
    candidates.push(explicit);
  }

  try {
    const pyenvWhich = await runCmd("pyenv", ["which", "python"], probeEnv);
    const resolved = pyenvWhich.stdout.trim();
    if (pyenvWhich.code === 0 && resolved.length > 0) {
      candidates.push(resolved);
    }
  } catch {
    // Fall through to PATH candidates.
  }

  candidates.push("python3.13", "python3.12", "python3");
  for (const candidate of candidates) {
    if (await canUsePythonForDidWebsResolver(candidate, probeEnv)) {
      return candidate;
    }
  }

  throw new Error(
    `did-webs-resolver requires Python >= 3.12 and < 3.14. Tried: ${candidates.join(", ")}`,
  );
}

async function canRunCommand(
  command: string,
  args: string[],
  env: Record<string, string>,
): Promise<boolean> {
  try {
    return (await runCmd(command, args, env)).code === 0;
  } catch {
    return false;
  }
}

async function installKeripyIntoVenv(
  python: string,
  venvRoot: string,
  env: Record<string, string>,
): Promise<void> {
  await Deno.mkdir(keripyInteropCacheRoot(), { recursive: true });
  await requireSuccess(
    "create pinned KERIpy venv",
    runCmdWithTimeout(python, ["-m", "venv", venvRoot], env, 120_000),
  );

  const venvPython = keripyInteropVenvBin("python");
  if (await canRunCommand("uv", ["--version"], env)) {
    await requireSuccess(
      "install pinned KERIpy with uv",
      runCmdWithTimeout(
        "uv",
        [
          "pip",
          "install",
          "--python",
          venvPython,
          KERIPY_INTEROP_INSTALL,
        ],
        env,
        600_000,
      ),
    );
  } else {
    await requireSuccess(
      "upgrade pinned KERIpy venv packaging tools",
      runCmdWithTimeout(
        venvPython,
        ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"],
        env,
        240_000,
      ),
    );
    await requireSuccess(
      "install pinned KERIpy with pip",
      runCmdWithTimeout(
        venvPython,
        ["-m", "pip", "install", KERIPY_INTEROP_INSTALL],
        env,
        600_000,
      ),
    );
  }
}

async function downloadPinnedKeripyFixture(
  relativePath: string,
): Promise<void> {
  const target = `${keripyInteropFixtureRoot()}/${relativePath}`;
  if (await pathExists(target)) {
    return;
  }
  const url = `${KERIPY_INTEROP_RAW_BASE}/${relativePath}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Unable to fetch pinned KERIpy fixture ${url}: HTTP ${response.status}`,
    );
  }
  await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
    recursive: true,
  });
  await Deno.writeFile(target, new Uint8Array(await response.arrayBuffer()));
}

async function downloadPinnedInteropVerifierFixture(
  relativePath: string,
): Promise<void> {
  const target = `${interopVerifierCacheRoot()}/${relativePath}`;
  if (await pathExists(target)) {
    return;
  }
  const url = `${INTEROP_VERIFIER_RAW_BASE}/${relativePath}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Unable to fetch pinned interop-verifier fixture ${url}: HTTP ${response.status}`,
    );
  }
  await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), {
    recursive: true,
  });
  await Deno.writeFile(target, new Uint8Array(await response.arrayBuffer()));
}

/** Resolve the pinned interop-verifier fixture root, downloading it if needed. */
export async function ensureInteropVerifierFixtureRoot(): Promise<string> {
  await Promise.all(
    INTEROP_VERIFIER_FIXTURE_FILES.map((relativePath) => downloadPinnedInteropVerifierFixture(relativePath)),
  );
  return interopVerifierCacheRoot();
}

async function ensurePinnedKeripyFixtures(): Promise<void> {
  await Promise.all([
    ...DEFAULT_KERIPY_WITNESS_ALIASES.map((alias) => downloadPinnedKeripyFixture(`scripts/keri/cf/main/${alias}.json`)),
    downloadPinnedKeripyFixture(
      "scripts/demo/data/wil-witness-sample.json",
    ),
  ]);
}

async function ensurePinnedKeripyKli(
  env: Record<string, string>,
): Promise<string> {
  const marker = `${keripyInteropCacheRoot()}/PIN`;
  const kli = keripyInteropVenvBin("kli");
  const markerMatches = await pathExists(marker)
    ? (await Deno.readTextFile(marker)).trim() === KERIPY_INTEROP_COMMIT
    : false;

  if (markerMatches && await canUseKli(kli, env)) {
    await ensurePinnedKeripyFixtures();
    return kli;
  }

  if (await pathExists(keripyInteropVenvRoot())) {
    await Deno.remove(keripyInteropVenvRoot(), { recursive: true });
  }

  const python = await resolvePython314Command(env);
  const installEnv = {
    ...pyenvProbeEnv(env),
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
  };
  await installKeripyIntoVenv(python, keripyInteropVenvRoot(), installEnv);

  if (!(await canUseKli(kli, env))) {
    throw new Error(
      `Pinned KERIpy install did not produce a runnable kli at ${kli}.`,
    );
  }

  await Deno.mkdir(keripyInteropCacheRoot(), { recursive: true });
  await Deno.writeTextFile(marker, `${KERIPY_INTEROP_COMMIT}\n`);
  await ensurePinnedKeripyFixtures();
  return kli;
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
  const baseEnv: Record<string, string> = {
    ...Deno.env.toObject(),
    HOME: home,
    ...(denoDir ? { DENO_DIR: denoDir } : {}),
  };
  const kliCommand = await ensurePinnedKeripyKli(baseEnv);
  const kliBin = kliCommand.slice(0, kliCommand.lastIndexOf("/"));
  const env = {
    ...baseEnv,
    PATH: `${kliBin}:${baseEnv.PATH ?? ""}`,
  };
  return {
    home,
    env,
    repoRoot: workspaceRoot(),
    kliCommand,
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

/** Return one currently available localhost port for temporary test hosts. */
export function randomPort(): number {
  return availableLocalhostPort();
}

function availableLocalhostPort(excludedPorts = new Set<number>()): number {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = TEST_PORT_MIN + Math.floor(
      Math.random() * (TEST_PORT_MAX_EXCLUSIVE - TEST_PORT_MIN),
    );
    if (excludedPorts.has(port)) {
      continue;
    }

    let listener: Deno.Listener | undefined;
    try {
      listener = Deno.listen({ hostname: "127.0.0.1", port });
      excludedPorts.add(port);
      return port;
    } catch {
      continue;
    } finally {
      listener?.close();
    }
  }
  throw new Error("Unable to allocate an available localhost port.");
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
    readonly kliCommand: string,
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

  const nodes: KeriPyWitnessNode[] = [];
  const allocatedPorts = new Set<number>();
  for (const alias of aliases) {
    const httpPort = availableLocalhostPort(allocatedPorts);
    const tcpPort = availableLocalhostPort(allocatedPorts);
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
      mailboxOobi: `http://127.0.0.1:${httpPort}/oobi/${pre}/mailbox/${pre}`,
    });
  }

  const children = nodes.map((node) =>
    spawnChild(
      ctx.kliCommand,
      [
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
      env,
    )
  );

  try {
    await Promise.all(nodes.map((node) => waitForKeriPyWitnessReady(node)));
  } catch (error) {
    const details = await Promise.all(
      children.map((child, index) =>
        stopChild(child).then((output) =>
          output.length > 0 ? `# ${nodes[index]?.alias}\n${output}` : `# ${nodes[index]?.alias}\n<no output>`
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
    ctx.kliCommand,
    nodes,
    children,
  );
}

/** Start KERIpy's fixed-port demo witness topology with its built-in curls config. */
export async function startKeriPyWitnessDemoHarness(
  ctx: InteropContext,
  options: KeriPyWitnessDemoHarnessOptions = {},
): Promise<KeriPyWitnessHarness> {
  await ensurePinnedKeripyFixtures();
  const home = await Deno.makeTempDir({ prefix: "keripy-witness-demo-home-" });
  const base = `interop-demo-wits-${crypto.randomUUID().slice(0, 8)}`;
  const kliCommand = options.kliCommand ?? ctx.kliCommand;
  const useBase = options.useBase ?? true;
  const env = {
    ...ctx.env,
    HOME: home,
  };
  await assertTcpPortsFree(
    KERIPY_DEMO_WITNESS_NODES.flatMap((node) => [node.httpPort, node.tcpPort]),
    "KERIpy witness demo",
  );
  const args = ["witness", "demo"];
  if (useBase) {
    args.push("--base", base);
  }
  const child = spawnChild(
    kliCommand,
    args,
    env,
    keripyInteropFixtureRoot(),
  );

  try {
    for (const node of KERIPY_DEMO_WITNESS_NODES) {
      await waitForHttpOk(`${node.httpOrigin}/oobi/${node.pre}`);
      await waitForHttpOk(node.controllerOobi);
      await waitForHttpOk(node.witnessOobi);
    }
  } catch (error) {
    const details = await stopChild(child);
    throw new Error(
      `KERIpy witness demo did not become ready: ${error instanceof Error ? error.message : String(error)}\n${details}`,
    );
  }

  return new KeriPyWitnessHarness(
    home,
    useBase ? base : "",
    "",
    env,
    kliCommand,
    KERIPY_DEMO_WITNESS_NODES,
    [child],
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
  const allocatedPorts = new Set<number>();

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
      const httpPort = availableLocalhostPort(allocatedPorts);
      const tcpPort = availableLocalhostPort(allocatedPorts);
      await assertTcpPortsFree(
        [httpPort, tcpPort],
        `Tufa witness ${alias}`,
      );
      const child = startTufaWitnessHost(
        name,
        alias,
        headDirPath,
        httpPort,
        tcpPort,
        ctx.env,
        ctx.repoRoot,
      );
      children.push(child);
      await waitForHealthOrChildExit(
        child,
        httpPort,
        `Tufa witness ${alias}`,
        TUFA_WITNESS_START_TIMEOUT_MS,
      );

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
        mailboxOobi: `http://127.0.0.1:${httpPort}/oobi/${pre}/mailbox/${pre}`,
      });
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
