import { assertEquals } from "jsr:@std/assert";
import { t } from '../../../../cesr/mod.ts'

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
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
  } catch (_error) {
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

function extractKelStream(output: string): string {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('{"v":"KERI'))
    .join("\n");
}

Deno.test("Interop: kli and tufa produce identical single-sig prefix and KEL stream", async () => {
  const home = await Deno.makeTempDir({ prefix: "tufa-kli-home-" });
  const env = {
    ...Deno.env.toObject(),
    HOME: home,
  };

  if (!(await hasKli(env))) {
    console.warn("Skipping interop test because kli is not available on PATH.");
    return;
  }

  const repoRoot = "/Users/kbull/code/keri/kentbull/keri-ts/packages/keri";
  const base = `interop-${crypto.randomUUID().slice(0, 8)}`;
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
  ], env);
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
