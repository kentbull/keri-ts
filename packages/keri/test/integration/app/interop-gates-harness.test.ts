import { assert, assertEquals } from "jsr:@std/assert";
import { t } from "../../../../cesr/mod.ts";

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
  assertEquals(normalizeCesr(extractKelStream(tufaExport.stdout)).length > 0, true);
  assertEquals(wrongList.code === 0, false);
  assert(
    /too many attempts|not associated with last aeid|valid passcode required/i
      .test(`${wrongList.stdout}\n${wrongList.stderr}`),
    `Expected wrong passcode failure, got:\n${wrongList.stdout}\n${wrongList.stderr}`,
  );
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
    state: "pending",
    requiredTufaCommands: ["ends", "oobi"],
    expectedOutputShape: "ends add + oobi generate/resolve parity",
    blockedReason: "Top-level ends/oobi command surface is not implemented yet.",
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
  const scenario = GATE_SCENARIOS.find((scenario) =>
    scenario.id === id && scenario.state === "ready"
  );
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
    throw new Error(`Ready scenario ${scenario.id} has no run() implementation.`);
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
