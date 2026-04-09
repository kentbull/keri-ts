// @file-test-lane app-fast-isolated

import { run } from "effection";
import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";
import { DISPLAY_VERSION } from "../../keri/src/app/version.ts";
import { ValidationError } from "../../keri/src/core/errors.ts";
import { tufa } from "../src/cli/cli.ts";
import { mailboxStartCommand } from "../src/cli/mailbox.ts";

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

function packageRoot(): string {
  return new URL("../", import.meta.url).pathname;
}

async function runTufa(args: string[]): Promise<CmdResult> {
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "--unstable-ffi", "mod.ts", ...args],
    cwd: packageRoot(),
    stdout: "piped",
    stderr: "piped",
  }).output();

  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

async function captureConsoleLog(runCommand: () => Promise<void>): Promise<string[]> {
  const originalLog = console.log;
  const captured: string[] = [];
  console.log = (...messages: unknown[]) => {
    captured.push(messages.map(String).join(" "));
  };

  try {
    await runCommand();
    return captured;
  } finally {
    console.log = originalLog;
  }
}

Deno.test("tufa/cli - version command prints display version", async () => {
  const captured = await captureConsoleLog(() => run(() => tufa(["version"])));

  assertEquals(captured, [DISPLAY_VERSION]);
});

Deno.test("tufa/cli - --version prints display version", async () => {
  const res = await runTufa(["--version"]);

  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertStringIncludes(res.stdout, DISPLAY_VERSION);
});

Deno.test("tufa/cli - --help advertises the Tufa-owned command tree", async () => {
  const res = await runTufa(["--help"]);
  const text = `${res.stdout}\n${res.stderr}`;

  assertEquals(res.code, 0, text);
  assertStringIncludes(text, "agent");
  assertStringIncludes(text, "mailbox");
  assertStringIncludes(text, "witness");
  assertStringIncludes(text, "benchmark");
});

Deno.test("tufa/cli - agent help advertises -p for port and -P for passcode", async () => {
  const res = await runTufa(["agent", "--help"]);
  const text = `${res.stdout}\n${res.stderr}`;

  assertEquals(res.code, 0, text);
  assertStringIncludes(text, "-P, --passcode <passcode>");
  assertStringIncludes(text, "-p, --port <port>");
});

Deno.test("tufa/cli - mailbox start rejects --url without --datetime", async () => {
  await assertRejects(
    async () => {
      await run(() =>
        mailboxStartCommand({
          name: `mailbox-start-${crypto.randomUUID()}`,
          alias: "relay",
          url: "http://127.0.0.1:5632",
        })
      );
    },
    ValidationError,
    "--url and --datetime must be provided together",
  );
});

Deno.test("tufa/cli - mailbox start rejects --datetime without --url", async () => {
  await assertRejects(
    async () => {
      await run(() =>
        mailboxStartCommand({
          name: `mailbox-start-${crypto.randomUUID()}`,
          alias: "relay",
          datetime: "2026-04-06T00:00:00.000Z",
        })
      );
    },
    ValidationError,
    "--url and --datetime must be provided together",
  );
});

Deno.test("tufa/cli - mailbox start missing required options prints one Commander-owned error without fatal stack", async () => {
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

Deno.test("tufa/cli - mailbox start validation errors print one concise app error without fatal stack", async () => {
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

Deno.test("tufa/cli - --debug-error prints the Commander stack for parse failures", async () => {
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
