// @file-test-lane app-stateful-a

import { run } from "effection";
import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import { tufa } from "../../../src/app/cli/cli.ts";
import { setupHby } from "../../../src/app/cli/common/existing.ts";
import { initCommand } from "../../../src/app/cli/init.ts";
import { mailboxStartCommand } from "../../../src/app/cli/mailbox.ts";
import { assertOperationThrows, createMockArgs } from "../../../test/utils.ts";

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

function extractPrefixLine(output: string): string {
  const line = output.split(/\r?\n/).find((line) => line.trim().startsWith("Prefix"));
  if (!line) {
    throw new Error(`Unable to parse prefix from output:\n${output}`);
  }
  return line.trim().split(/\s+/).at(-1) ?? "";
}

function extractRawSignature(output: string): string {
  const line = output.split(/\r?\n/).find((line) => /^\d+\.\s+/.test(line.trim()));
  if (!line) {
    throw new Error(`Unable to parse signature output:\n${output}`);
  }
  return line.trim().replace(/^\d+\.\s+/, "");
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

Deno.test("CLI - mailbox start rejects --url without --datetime", async () => {
  await assertOperationThrows(
    mailboxStartCommand(createMockArgs({
      name: `mailbox-start-${crypto.randomUUID()}`,
      alias: "relay",
      url: "http://127.0.0.1:5632",
    })),
    "--url and --datetime must be provided together",
  );
});

Deno.test("CLI - mailbox start rejects --datetime without --url", async () => {
  await assertOperationThrows(
    mailboxStartCommand(createMockArgs({
      name: `mailbox-start-${crypto.randomUUID()}`,
      alias: "relay",
      datetime: "2026-04-06T00:00:00.000Z",
    })),
    "--url and --datetime must be provided together",
  );
});

Deno.test("CLI - mailbox start rejects conflicting config and explicit startup material", async () => {
  const headDirPath = `/tmp/tufa-mailbox-start-${crypto.randomUUID()}`;
  const configPath = `${headDirPath}/mailbox-start.json`;
  Deno.mkdirSync(headDirPath, { recursive: true });
  Deno.writeTextFileSync(
    configPath,
    JSON.stringify({
      relay: {
        dt: "2026-04-06T12:00:00.000Z",
        curls: ["http://127.0.0.1:5632"],
      },
    }),
  );

  await assertOperationThrows(
    mailboxStartCommand(createMockArgs({
      name: `mailbox-start-${crypto.randomUUID()}`,
      alias: "relay",
      headDirPath,
      configFile: configPath,
      url: "http://127.0.0.1:5632",
      datetime: "2026-04-06T12:05:00.000Z",
    })),
    "conflicts with explicit --url/--datetime startup material",
  );
});

Deno.test("CLI - mailbox start missing required options prints one Commander-owned error without fatal stack", async () => {
  const res = await runTufa(["mailbox", "start"]);

  assertEquals(res.code, 1, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertStringIncludes(
    res.stderr,
    "error: required option '-n, --name <name>' not specified",
  );
  assertEquals(res.stderr.includes("Fatal error:"), false, res.stderr);
  assertEquals(res.stderr.includes("CommanderError:"), false, res.stderr);
  assertEquals(
    res.stderr.includes("Error: error: required option"),
    false,
    res.stderr,
  );
  assertEquals(res.stderr.includes("\n    at "), false, res.stderr);
});

Deno.test("CLI - mailbox start validation errors print one concise app error without fatal stack", async () => {
  const res = await runTufa([
    "mailbox",
    "start",
    "--name",
    `mailbox-start-${crypto.randomUUID()}`,
    "--alias",
    "relay",
    "--url",
    "http://127.0.0.1:5632",
  ]);

  assertEquals(res.code, 1, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertStringIncludes(
    res.stderr,
    "Error: --url and --datetime must be provided together",
  );
  assertEquals(res.stderr.includes("Fatal error:"), false, res.stderr);
  assertEquals(res.stderr.includes("CommanderError:"), false, res.stderr);
  assertEquals(res.stderr.includes("\n    at "), false, res.stderr);
  assertEquals((res.stderr.match(/Error:/g) ?? []).length, 1, res.stderr);
});

Deno.test("CLI - --debug-error prints the Commander stack for parse failures", async () => {
  const res = await runTufa(["--debug-error", "mailbox", "start"]);

  assertEquals(res.code, 1, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertStringIncludes(
    res.stderr,
    "error: required option '-n, --name <name>' not specified",
  );
  assertStringIncludes(res.stderr, "CommanderError:", res.stderr);
  assertStringIncludes(res.stderr, "\n    at ", res.stderr);
  assertEquals(res.stderr.includes("Fatal error:"), false, res.stderr);
});

Deno.test("CLI - --debug-error prints the AppError stack for handled command failures", async () => {
  const res = await runTufa([
    "--debug-error",
    "mailbox",
    "start",
    "--name",
    `mailbox-start-${crypto.randomUUID()}`,
    "--alias",
    "relay",
    "--url",
    "http://127.0.0.1:5632",
  ]);

  assertEquals(res.code, 1, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertStringIncludes(
    res.stderr,
    "Error: --url and --datetime must be provided together",
  );
  assertStringIncludes(res.stderr, "ValidationError:", res.stderr);
  assertStringIncludes(res.stderr, "\n    at ", res.stderr);
  assertEquals(res.stderr.includes("Fatal error:"), false, res.stderr);
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

Deno.test("CLI - init --outboxer creates the Tufa outbox sidecar", async () => {
  const name = `outbox-init-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  const res = await runTufaInit([
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--nopasscode",
    "--outboxer",
  ]);

  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertExists(Deno.statSync(`${headDirPath}/keri/obx/${name}`));
});

Deno.test("CLI - init stores the configured CESR body mode", async () => {
  const name = `cesr-mode-init-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  const res = await runTufaInit([
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--nopasscode",
    "--cesr-body-mode",
    "body",
  ]);

  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);

  await run(function*() {
    const hby = yield* setupHby(name, "", undefined, false, headDirPath, {
      readonly: true,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      assertEquals(hby.cesrBodyMode, "body");
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("CLI - setupHby rejects --outboxer when init did not enable it", async () => {
  const name = `outbox-disabled-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  const init = await runTufaInit([
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--nopasscode",
  ]);
  assertEquals(
    init.code,
    0,
    `stdout:\n${init.stdout}\nstderr:\n${init.stderr}`,
  );

  await assertOperationThrows(
    (function*() {
      const hby = yield* setupHby(name, "", undefined, false, headDirPath, {
        readonly: true,
        skipConfig: true,
        skipSignator: true,
        outboxer: true,
      });
      yield* hby.close();
    })(),
    "Outboxer is not enabled for this keystore",
  );
});

Deno.test("CLI - setupHby defaults CESR body mode to header for older keystores", async () => {
  const name = `cesr-mode-default-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  const init = await runTufaInit([
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--nopasscode",
  ]);
  assertEquals(
    init.code,
    0,
    `stdout:\n${init.stdout}\nstderr:\n${init.stderr}`,
  );

  await run(function*() {
    const hby = yield* setupHby(name, "", undefined, false, headDirPath, {
      readonly: true,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      assertEquals(hby.cesrBodyMode, "header");
    } finally {
      yield* hby.close();
    }
  });
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
  assertEquals(
    init.code,
    0,
    `stdout:\n${init.stdout}\nstderr:\n${init.stderr}`,
  );

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

Deno.test("CLI - exchange send help exposes KERIpy-style EXN flags", async () => {
  const res = await runTufa(["exchange", "send", "--help"]);

  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertStringIncludes(res.stdout, "--sender <alias>");
  assertStringIncludes(res.stdout, "--recipient <recipient>");
  assertStringIncludes(res.stdout, "--topic <topic>");
  assertStringIncludes(res.stdout, "--data <item>");
  assertEquals(res.stdout.includes("--alias <alias>"), false);
  assertEquals(res.stdout.includes("--payload <json>"), false);
  assertEquals(res.stdout.includes("--transport <transport>"), false);
});

Deno.test("CLI - exn send help mirrors exchange send help", async () => {
  const res = await runTufa(["exn", "send", "--help"]);

  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertStringIncludes(res.stdout, "--sender <alias>");
  assertStringIncludes(res.stdout, "--recipient <recipient>");
  assertStringIncludes(res.stdout, "--data <item>");
});

Deno.test("CLI - exchange send rejects removed legacy flags", async () => {
  const res = await runTufa([
    "exchange",
    "send",
    "--name",
    `legacy-${crypto.randomUUID()}`,
    "--sender",
    "alice",
    "--recipient",
    "bob",
    "--route",
    "/challenge/response",
    "--alias",
    "alice",
  ]);

  assertEquals(
    res.code === 0,
    false,
    `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
  );
  assertStringIncludes(
    `${res.stdout}\n${res.stderr}`,
    "unknown option '--alias'",
  );
  assertEquals(res.stderr.includes("Fatal error:"), false, res.stderr);
  assertEquals(res.stderr.includes("CommanderError:"), false, res.stderr);
  assertEquals(res.stderr.includes("\n    at "), false, res.stderr);
});

Deno.test("CLI - sign, verify, and rotate commands work for one persistent single-sig store", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-cli-sign-" });
  const name = `cli-sign-${crypto.randomUUID()}`;
  const alias = "alice";
  const message = "cli sign verify rotate";

  const init = await runTufa([
    "init",
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--nopasscode",
  ]);
  assertEquals(init.code, 0, `stdout:\n${init.stdout}\nstderr:\n${init.stderr}`);

  const incept = await runTufa([
    "incept",
    "--name",
    name,
    "--head-dir",
    headDirPath,
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
  ]);
  assertEquals(incept.code, 0, `stdout:\n${incept.stdout}\nstderr:\n${incept.stderr}`);
  const prefix = extractPrefixLine(incept.stdout);

  const sign = await runTufa([
    "sign",
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--alias",
    alias,
    "--text",
    message,
  ]);
  assertEquals(sign.code, 0, `stdout:\n${sign.stdout}\nstderr:\n${sign.stderr}`);
  const signature = extractRawSignature(sign.stdout);

  const verify = await runTufa([
    "verify",
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--prefix",
    prefix,
    "--text",
    message,
    "--signature",
    signature,
  ]);
  assertEquals(verify.code, 0, `stdout:\n${verify.stdout}\nstderr:\n${verify.stderr}`);
  assertStringIncludes(verify.stdout, "Signature 1 is valid.");

  const rotate = await runTufa([
    "rotate",
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--alias",
    alias,
  ]);
  assertEquals(rotate.code, 0, `stdout:\n${rotate.stdout}\nstderr:\n${rotate.stderr}`);
  assertStringIncludes(rotate.stdout, `Prefix  ${prefix}`);
  assertStringIncludes(rotate.stdout, "New Sequence No.  1");
  assertStringIncludes(rotate.stdout, "Public key 1");

  const rotatedSign = await runTufa([
    "sign",
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--alias",
    alias,
    "--text",
    message,
  ]);
  assertEquals(
    rotatedSign.code,
    0,
    `stdout:\n${rotatedSign.stdout}\nstderr:\n${rotatedSign.stderr}`,
  );
  assertEquals(rotatedSign.stdout !== sign.stdout, true);
});

Deno.test("CLI - query help exposes KLI-compatible core flags", async () => {
  const res = await runTufa(["query", "--help"]);

  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertStringIncludes(res.stdout, "--alias <alias>");
  assertStringIncludes(res.stdout, "--prefix <prefix>");
  assertStringIncludes(res.stdout, "--anchor <file>");
});
