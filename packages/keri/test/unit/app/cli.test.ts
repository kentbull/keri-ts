// @file-test-lane app-stateful-a

import { type Operation, run } from "effection";
import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import { tufa } from "../../../../tufa/src/cli/cli.ts";
import { mailboxStartCommand } from "../../../../tufa/src/cli/mailbox.ts";
import { setupHby } from "../../../src/app/cli/common/existing.ts";
import { inceptCommand } from "../../../src/app/cli/incept.ts";
import { initCommand } from "../../../src/app/cli/init.ts";
import { interactCommand } from "../../../src/app/cli/interact.ts";
import { rotateCommand } from "../../../src/app/cli/rotate.ts";
import { signCommand } from "../../../src/app/cli/sign.ts";
import { verifyCommand } from "../../../src/app/cli/verify.ts";
import { assertOperationThrows, CLITestHarness, createMockArgs } from "../../../test/utils.ts";

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
  const repoRoot = new URL("../../../../../", import.meta.url);
  const out = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "packages/tufa/mod.ts",
      ...args,
    ],
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

async function captureCommand(operation: Operation<void>): Promise<CmdResult> {
  const harness = new CLITestHarness();
  harness.captureOutput();
  try {
    await run(() => operation);
    return {
      code: 0,
      stdout: harness.getOutput().join("\n"),
      stderr: harness.getErrors().join("\n"),
    };
  } finally {
    harness.restoreOutput();
  }
}

Deno.test("CLI - init command with valid arguments", async () => {
  await run(() =>
    initCommand({
      name: `testkeystore-${crypto.randomUUID()}`,
      temp: true,
      nopasscode: true,
    })
  );
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
  await run(() =>
    initCommand({
      name: `fulltest-${crypto.randomUUID()}`,
      base: "/custom/base",
      temp: true,
      salt: "0AAwMTIzNDU2Nzg5YWJjZGVm",
      configDir,
      configFile: "custom.json",
      passcode: "testpasscode123456789012",
      nopasscode: true,
    })
  );
});

Deno.test("CLI - init command with custom salt", async () => {
  await run(() =>
    initCommand({
      name: `salttest-${crypto.randomUUID()}`,
      temp: true,
      salt: "0AAwMTIzNDU2Nzg5YWJjZGVm",
      nopasscode: true,
    })
  );
});

Deno.test("CLI - init command with config overrides", async () => {
  const configDir = `/tmp/tufa-config-${crypto.randomUUID()}`;
  await run(() =>
    initCommand({
      name: `configtest-${crypto.randomUUID()}`,
      temp: true,
      configDir,
      configFile: "custom-config.json",
      nopasscode: true,
    })
  );
});

Deno.test("CLI - init command honors custom head directory", async () => {
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  const name = `headtest-${crypto.randomUUID()}`;

  await run(() =>
    initCommand({
      name,
      headDirPath,
      nopasscode: true,
    })
  );

  assertExists(Deno.statSync(`${headDirPath}/keri/ks/${name}`));
  assertExists(Deno.statSync(`${headDirPath}/keri/db/${name}`));
});

Deno.test("CLI - init --outboxer creates the Tufa outbox sidecar", async () => {
  const name = `outbox-init-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  await run(() =>
    initCommand({
      name,
      headDirPath,
      nopasscode: true,
      outboxer: true,
    })
  );
  assertExists(Deno.statSync(`${headDirPath}/keri/obx/${name}`));
});

Deno.test("CLI - init stores the configured CESR body mode", async () => {
  const name = `cesr-mode-init-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  await run(() =>
    initCommand({
      name,
      headDirPath,
      nopasscode: true,
      cesrBodyMode: "body",
    })
  );

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
  await run(() =>
    initCommand({
      name,
      headDirPath,
      nopasscode: true,
    })
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
  await run(() =>
    initCommand({
      name,
      headDirPath,
      nopasscode: true,
    })
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

  await run(() =>
    initCommand({
      name,
      headDirPath,
      nopasscode: true,
    })
  );

  const incept = await captureCommand(
    inceptCommand({
      name,
      headDirPath,
      configDir,
      configFile: "bootstrap",
      alias: "alice",
      transferable: true,
    }),
  );
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

Deno.test("CLI - sign, verify, rotate, and interact commands work for one persistent single-sig store", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-cli-sign-" });
  const name = `cli-sign-${crypto.randomUUID()}`;
  const alias = "alice";
  const message = "cli sign verify rotate";

  await run(() =>
    initCommand({
      name,
      headDirPath,
      nopasscode: true,
    })
  );

  const incept = await captureCommand(
    inceptCommand({
      name,
      headDirPath,
      alias,
      transferable: true,
      isith: "1",
      icount: 1,
      nsith: "1",
      ncount: 1,
      toad: 0,
    }),
  );
  assertEquals(
    incept.code,
    0,
    `stdout:\n${incept.stdout}\nstderr:\n${incept.stderr}`,
  );
  const prefix = extractPrefixLine(incept.stdout);

  const sign = await captureCommand(signCommand({
    name,
    headDirPath,
    alias,
    text: message,
  }));
  assertEquals(
    sign.code,
    0,
    `stdout:\n${sign.stdout}\nstderr:\n${sign.stderr}`,
  );
  const signature = extractRawSignature(sign.stdout);

  const verify = await captureCommand(verifyCommand({
    name,
    headDirPath,
    prefix,
    text: message,
    signature: [signature],
  }));
  assertEquals(
    verify.code,
    0,
    `stdout:\n${verify.stdout}\nstderr:\n${verify.stderr}`,
  );
  assertStringIncludes(verify.stdout, "Signature 1 is valid.");

  const rotate = await captureCommand(rotateCommand({
    name,
    headDirPath,
    alias,
  }));
  assertEquals(
    rotate.code,
    0,
    `stdout:\n${rotate.stdout}\nstderr:\n${rotate.stderr}`,
  );
  assertStringIncludes(rotate.stdout, `Prefix  ${prefix}`);
  assertStringIncludes(rotate.stdout, "New Sequence No.  1");
  assertStringIncludes(rotate.stdout, "Public key 1");

  const interact = await captureCommand(interactCommand({
    name,
    headDirPath,
    alias,
    data: ["{\"anchor\":\"acdc\"}"],
  }));
  assertEquals(
    interact.code,
    0,
    `stdout:\n${interact.stdout}\nstderr:\n${interact.stderr}`,
  );
  assertStringIncludes(interact.stdout, `Prefix  ${prefix}`);
  assertStringIncludes(interact.stdout, "New Sequence No.  2");
  assertStringIncludes(interact.stdout, "Public key 1");

  const rotatedSign = await captureCommand(signCommand({
    name,
    headDirPath,
    alias,
    text: message,
  }));
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
