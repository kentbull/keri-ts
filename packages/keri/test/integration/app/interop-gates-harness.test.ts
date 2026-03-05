import { assert, assertEquals } from "jsr:@std/assert";
import { t } from '../../../../cesr/mod.ts'

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

async function hasKli(env: Record<string, string>): Promise<boolean> {
  try {
    const res = await runCmd("kli", ["--help"], env);
    return res.code === 0 || res.stdout.length > 0 || res.stderr.length > 0;
  } catch {
    return false;
  }
}

function extractPrefix(output: string): string {
  const line = output.split(/\r?\n/).find((line) =>
    line.trim().startsWith("Prefix")
  );
  if (!line) {
    throw new Error(`Unable to parse prefix from output:\n${output}`);
  }
  const parts = line.trim().split(/\s+/);
  return parts[parts.length - 1];
}

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

function extractKelStream(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('{"v":"KERI'))
    .join("\n");
}

function packageRoot(): string {
  return new URL("../../../", import.meta.url).pathname;
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

async function runInitInceptExportParity(
  ctx: ScenarioContext,
): Promise<void> {
  const base = `gate-h-${crypto.randomUUID().slice(0, 8)}`;
  const alias = "interop-aid";
  const passcode = "MyPasscodeARealSecret";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const kliName = `kli-${crypto.randomUUID().slice(0, 8)}`;
  const tufaName = `tufa-${crypto.randomUUID().slice(0, 8)}`;

  const kliInit = await runCmd("kli", [
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

  const kliIncept = await runCmd("kli", [
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

  const kliExport = await runCmd("kli", [
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

const GATE_SCENARIOS: GateScenario[] = [
  {
    id: "A-DB-FOUNDATION-READINESS",
    gate: "A",
    state: "pending",
    requiredTufaCommands: [],
    expectedOutputShape: "DB and escrow readiness evidence",
    blockedReason:
      "Tracks DB-layer parity artifacts and escrow work, not a single CLI command.",
  },
  {
    id: "B-INIT-INCEPT-EXPORT-PARITY",
    gate: "B",
    state: "ready",
    requiredTufaCommands: ["init", "incept", "export"],
    expectedOutputShape:
      "Prefix line parity and normalized exported KEL stream parity.",
    run: runInitInceptExportParity,
  },
  {
    id: "B-LIST-AID-VISIBILITY",
    gate: "B",
    state: "pending",
    requiredTufaCommands: ["list", "aid"],
    expectedOutputShape: "list(empty)->list(alias+pre)->aid(pre)",
    blockedReason: "Top-level tufa list/aid commands are not implemented yet.",
  },
  {
    id: "C-KLI-COMPAT-STORE-OPEN",
    gate: "C",
    state: "pending",
    requiredTufaCommands: ["list", "aid"],
    expectedOutputShape:
      "kli-created store visible through tufa compatibility mode",
    blockedReason:
      "Depends on compatibility mode behavior and list/aid command surface.",
  },
  {
    id: "D-ENCRYPTED-AT-REST-SEMANTICS",
    gate: "D",
    state: "pending",
    requiredTufaCommands: ["init"],
    expectedOutputShape: "AEID and encrypted keeper semantics parity",
    blockedReason:
      "Needs explicit reopen/decrypt parity assertions beyond current smoke coverage.",
  },
  {
    id: "E-ENDS-OOBI-BOOTSTRAP",
    gate: "E",
    state: "pending",
    requiredTufaCommands: ["ends", "oobi"],
    expectedOutputShape: "ends add + oobi generate/resolve parity",
    blockedReason:
      "Top-level ends/oobi command surface is not implemented yet.",
  },
  {
    id: "F-DIRECT-MAILBOX-COMMS",
    gate: "F",
    state: "pending",
    requiredTufaCommands: ["exchange"],
    expectedOutputShape: "direct and mailbox message flow parity",
    blockedReason:
      "Direct/mailbox interop flow commands are not implemented yet.",
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

Deno.test("Interop gate harness matrix covers Gate A-G", () => {
  const gates = new Set<Gate>(GATE_SCENARIOS.map((scenario) => scenario.gate));
  assertEquals([...gates].sort(), ["A", "B", "C", "D", "E", "F", "G"]);
});

Deno.test("Interop gate harness executes ready scenarios", async () => {
  const home = await Deno.makeTempDir({ prefix: "tufa-gate-harness-home-" });
  const denoDir = await detectDenoDir();
  const env = {
    ...Deno.env.toObject(),
    HOME: home,
    ...(denoDir ? { DENO_DIR: denoDir } : {}),
  };

  if (!(await hasKli(env))) {
    console.warn(
      "Skipping gate harness interop test because kli is not available.",
    );
    return;
  }

  const ready = GATE_SCENARIOS.filter((scenario) => scenario.state === "ready");
  assert(ready.length > 0, "Expected at least one ready interop scenario.");

  const tufaCommands = await listTufaCommands(env, packageRoot());
  for (const scenario of ready) {
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
    await scenario.run({ env, packageRoot: packageRoot() });
  }
});
