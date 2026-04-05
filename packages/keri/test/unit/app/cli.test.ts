import { run } from "effection";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { tufa } from "../../../src/app/cli/cli.ts";
import { initCommand } from "../../../src/app/cli/init.ts";
import { assertOperationThrows, createMockArgs } from "../../../test/utils.ts";

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runTufa(args: string[]): Promise<CmdResult> {
  const repoRoot = new URL("../../../", import.meta.url);
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "--unstable-ffi", "mod.ts", ...args],
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();

  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

function runTufaInit(args: string[]): Promise<CmdResult> {
  return runTufa(["init", ...args]);
}

function runTufaIncept(args: string[]): Promise<CmdResult> {
  return runTufa(["incept", ...args]);
}

Deno.test("CLI - init command with valid arguments", async () => {
  const res = await runTufaInit([
    "--name",
    `testkeystore-${crypto.randomUUID()}`,
    "--temp",
    "--nopasscode",
  ]);

  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
});

Deno.test("CLI - init command requires name", async () => {
  const args = createMockArgs({
    name: "",
    nopasscode: true,
  });

  await assertOperationThrows(
    initCommand(args),
    "Name is required and cannot be empty",
  );
});

Deno.test("CLI - init command with missing name", async () => {
  const args = createMockArgs({
    name: undefined,
    nopasscode: true,
  });

  await assertOperationThrows(
    initCommand(args),
    "Name is required and cannot be empty",
  );
});

Deno.test("CLI - init command with help flag", async () => {
  // Help is parsed by commander; command handlers should not be invoked directly for help tests.
  await run(() => tufa(["init", "--help"]));
});

Deno.test("CLI - init command with all options", async () => {
  const configDir = `/tmp/tufa-config-${crypto.randomUUID()}`;
  const res = await runTufaInit([
    "--name",
    `fulltest-${crypto.randomUUID()}`,
    "--base",
    "/custom/base",
    "--temp",
    "--salt",
    "0AAwMTIzNDU2Nzg5YWJjZGVm",
    "--config-dir",
    configDir,
    "--config-file",
    "custom.json",
    "--passcode",
    "testpasscode123456789012",
    "--nopasscode",
  ]);

  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
});

Deno.test("CLI - init command with custom salt", async () => {
  const res = await runTufaInit([
    "--name",
    `salttest-${crypto.randomUUID()}`,
    "--temp",
    "--salt",
    "0AAwMTIzNDU2Nzg5YWJjZGVm",
    "--nopasscode",
  ]);

  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
});

Deno.test("CLI - init command with config overrides", async () => {
  const configDir = `/tmp/tufa-config-${crypto.randomUUID()}`;
  const res = await runTufaInit([
    "--name",
    `configtest-${crypto.randomUUID()}`,
    "--temp",
    "--config-dir",
    configDir,
    "--config-file",
    "custom-config.json",
    "--nopasscode",
  ]);

  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
});

Deno.test("CLI - init command honors custom head directory", async () => {
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  const res = await runTufaInit([
    "--name",
    `headtest-${crypto.randomUUID()}`,
    "--head-dir",
    headDirPath,
    "--nopasscode",
  ]);

  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertStringIncludes(res.stdout, headDirPath);
});

Deno.test("CLI - default loglevel suppresses debug LMDB traces", async () => {
  const res = await runTufaInit([
    "--name",
    `quiettest-${crypto.randomUUID()}`,
    "--temp",
    "--nopasscode",
  ]);

  const combined = `${res.stdout}\n${res.stderr}`;
  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertEquals(combined.includes("Opening LMDB at:"), false);
  assertEquals(combined.includes("Creating directory at"), false);
});

Deno.test("CLI - --loglevel debug enables debug LMDB traces", async () => {
  const res = await runTufaInit([
    "--loglevel",
    "debug",
    "--name",
    `debugtest-${crypto.randomUUID()}`,
    "--temp",
    "--nopasscode",
  ]);

  const combined = `${res.stdout}\n${res.stderr}`;
  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertStringIncludes(combined, "Opening LMDB at:");
});

Deno.test("CLI - incept command accepts explicit config-dir and config-file overrides", async () => {
  const name = `incept-config-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  const configDir = `/tmp/tufa-config-${crypto.randomUUID()}`;
  Deno.mkdirSync(configDir, { recursive: true });
  Deno.writeTextFileSync(`${configDir}/bootstrap.json`, "{}\n");

  const init = await runTufaInit([
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--nopasscode",
  ]);
  assertEquals(init.code, 0, `stdout:\n${init.stdout}\nstderr:\n${init.stderr}`);

  const incept = await runTufaIncept([
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--config-dir",
    configDir,
    "--config-file",
    "bootstrap",
    "--alias",
    "alice",
    "--transferable",
  ]);

  assertEquals(
    incept.code,
    0,
    `stdout:\n${incept.stdout}\nstderr:\n${incept.stderr}`,
  );
  assertStringIncludes(incept.stdout, "Prefix");
});
