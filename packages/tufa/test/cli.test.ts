// @file-test-lane app-fast-isolated

import { run } from "effection";
import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "jsr:@std/assert";
import { createHabery, DISPLAY_VERSION as KERI_DISPLAY_VERSION, Schemer, ValidationError } from "keri-ts/runtime";
import { Command } from "npm:commander@^10.0.1";
import { tufa } from "../src/cli/cli.ts";
import { registerCmds } from "../src/cli/command-definitions.ts";
import type { CommandSelection } from "../src/cli/command-types.ts";
import { createCmdHandlers } from "../src/cli/handlers.ts";
import { mailboxAddCommand, mailboxStartCommand } from "../src/cli/mailbox.ts";
import { DISPLAY_VERSION as TUFA_DISPLAY_VERSION } from "../src/version.ts";

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

function parseCommandSelection(args: string[]): CommandSelection {
  let selection: CommandSelection | undefined;
  const program = new Command();
  program.exitOverride();
  registerCmds(program, (next) => {
    selection = next;
  });
  program.parse(args, { from: "user" });
  if (!selection) {
    throw new Error(`No command selection for ${args.join(" ")}`);
  }
  return selection;
}

function leafCommandNames(command: Command, prefix: string[] = []): string[] {
  const leaves: string[] = [];
  for (const child of command.commands) {
    const next = [...prefix, child.name()];
    if (child.commands.length === 0) {
      leaves.push(next.join(" "));
    } else {
      leaves.push(...leafCommandNames(child, next));
    }
  }
  return leaves;
}

const CLI_COMMAND_EXAMPLES: string[][] = [
  ["init", "-n", "store"],
  ["incept", "-n", "store", "-a", "aid"],
  ["rotate", "-n", "store", "-a", "aid"],
  ["interact", "-n", "store", "-a", "aid"],
  ["delegate", "confirm", "-n", "store", "-a", "delegator"],
  ["agent", "-n", "store"],
  ["multisig", "incept", "-n", "store", "-a", "aid", "-g", "group", "-f", "group.json"],
  ["multisig", "interact", "-n", "store", "-a", "group"],
  ["multisig", "join", "-n", "store"],
  ["multisig", "rotate", "-n", "store", "-a", "group"],
  ["multisig", "rpy", "-n", "store", "--eid", "mailbox"],
  ["sign", "-n", "store", "-a", "aid", "-t", "hello"],
  ["verify", "-n", "store", "--prefix", "Eaid", "-t", "hello", "-s", "0sig"],
  ["query", "-n", "store", "-a", "aid", "--prefix", "Eremote"],
  ["export", "-n", "store", "-a", "aid"],
  ["list", "-n", "store"],
  ["aid", "-n", "store", "-a", "aid"],
  ["saidify", "-f", "sad.json"],
  ["annotate"],
  ["challenge", "generate"],
  ["challenge", "respond", "-n", "store", "-a", "aid", "-r", "peer", "-w", "one two"],
  ["challenge", "verify", "-n", "store", "-s", "peer", "-w", "one two"],
  ["vc", "schema", "import", "-n", "store", "--schema", "schema.json"],
  ["vc", "registry", "incept", "-n", "store", "-a", "issuer", "--registry-name", "vlei"],
  ["vc", "registry", "list", "-n", "store"],
  ["vc", "registry", "status", "-n", "store", "--registry-name", "vlei"],
  ["vc", "create", "-n", "store", "-a", "issuer", "--registry-name", "vlei"],
  ["vc", "list", "-n", "store"],
  ["vc", "export", "-n", "store", "--said", "Ecredential"],
  ["vc", "import", "-n", "store"],
  ["vc", "revoke", "-n", "store", "--registry-name", "vlei", "--said", "Ecredential"],
  ["ipex", "apply", "-n", "store", "-a", "aid", "-r", "peer", "--schema", "Eschema"],
  ["ipex", "offer", "-n", "store", "-a", "aid", "-r", "peer", "--acdc", "acdc.cesr"],
  ["ipex", "agree", "-n", "store", "-a", "aid", "-r", "peer", "--offer", "Eoffer"],
  ["ipex", "grant", "-n", "store", "-a", "aid", "-r", "peer", "--said", "Ecredential"],
  ["ipex", "admit", "-n", "store", "-a", "aid"],
  ["ipex", "spurn", "-n", "store", "-a", "aid", "-r", "peer", "--prior", "Eprior"],
  ["ipex", "list", "-n", "store"],
  ["ipex", "poll", "-n", "store", "-a", "aid"],
  ["ipex", "join", "-n", "store"],
  ["verifier", "run", "-n", "store", "--hook", "http://127.0.0.1:9923"],
  ["hook", "demo"],
  ["dws", "bind", "-n", "store", "-a", "aid", "--did", "did:keri:Eaid"],
  ["dws", "generate", "-n", "store", "-a", "aid", "--did", "did:webs:example.com:Eaid", "--output-dir", "/tmp/dws"],
  ["dws", "resolve", "-n", "store", "--did", "did:webs:example.com:Eaid"],
  ["dws", "resolver", "-n", "store"],
  ["dkr", "resolve", "-n", "store", "--did", "did:keri:Eaid"],
  ["exchange", "send", "-n", "store", "-s", "aid", "-r", "peer", "-R", "/route"],
  ["exn", "send", "-n", "store", "-s", "aid", "-r", "peer", "-R", "/route"],
  ["ends", "add", "-n", "store", "-a", "aid", "-r", "mailbox", "-e", "Eendpoint"],
  ["loc", "add", "-n", "store", "-a", "aid", "-u", "http://127.0.0.1:7723"],
  ["oobi", "generate", "-n", "store", "-a", "aid", "-r", "controller"],
  ["oobi", "clean", "-n", "store", "--key-file", "keys.json"],
  ["oobi", "resolve", "-n", "store", "-u", "http://127.0.0.1:7723/oobi/Eaid"],
  ["oobi", "request", "-n", "store", "-a", "aid", "-r", "peer", "-u", "http://127.0.0.1:7723/oobi/Eaid"],
  ["notifications", "list", "-n", "store"],
  ["notifications", "mark-read", "-n", "store", "rid"],
  ["notifications", "remove", "-n", "store", "rid"],
  ["mailbox", "start", "-n", "store", "-a", "mailbox"],
  ["mailbox", "add", "-n", "store", "-a", "aid", "-w", "mailbox"],
  ["mailbox", "remove", "-n", "store", "-a", "aid", "-w", "mailbox"],
  ["mailbox", "list", "-n", "store", "-a", "aid"],
  ["mailbox", "update", "-n", "store", "-a", "aid", "-w", "mailbox", "-t", "/receipt", "-i", "1"],
  ["mailbox", "debug", "-n", "store", "-a", "aid", "-w", "mailbox"],
  ["witness", "start", "-n", "store", "-a", "witness"],
  ["witness", "submit", "-n", "store", "-a", "aid"],
  ["benchmark", "cesr"],
  ["db", "dump", "-n", "store"],
];

async function captureConsoleLog(
  runCommand: () => Promise<void>,
): Promise<string[]> {
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

function extractPrefix(output: string): string {
  const line = output.split(/\r?\n/).find((candidate) => candidate.trim().startsWith("Prefix"));
  if (!line) {
    throw new Error(`Unable to parse prefix from output:\n${output}`);
  }
  return line.trim().split(/\s+/).at(-1) ?? "";
}

Deno.test("tufa/cli - parsed command names all have registered handlers", () => {
  const program = new Command();
  program.exitOverride();
  registerCmds(program, () => {});
  const dispatchedNames = leafCommandNames(program)
    .filter((name) => name !== "version")
    .map((name) => name.replaceAll(" ", "."))
    .sort();

  const selections = CLI_COMMAND_EXAMPLES.map(parseCommandSelection);
  const selectedNames = [...new Set(selections.map((selection) => selection.name))].sort();
  assertEquals(selectedNames, dispatchedNames);

  const handlerNames = [...createCmdHandlers().keys()].sort();
  assertEquals(handlerNames, dispatchedNames);
});

Deno.test("tufa/cli - credential import parses its default and explicit settlement deadline", () => {
  const defaults = parseCommandSelection(["vc", "import", "-n", "store"]);
  assertEquals(defaults.name, "vc.import");
  assertEquals(defaults.args.settlementTimeoutMs, undefined);
  for (const value of ["0.5", "1", "25.9", "12000"]) {
    const selected = parseCommandSelection([
      "vc",
      "import",
      "-n",
      "store",
      "--in",
      "bundle.cesr",
      "--settlement-timeout-ms",
      value,
    ]);
    assertEquals(selected.args.settlementTimeoutMs, value);
    assertEquals(selected.args.inPath, "bundle.cesr");
  }
});

Deno.test({
  name: "tufa/cli - invalid credential settlement deadlines fail before input or store I/O",
  permissions: { read: false, write: false },
  fn: async () => {
    // Denied filesystem access makes opening either the store or input a distinct failure.
    for (const value of ["0", "-1", "NaN", "Infinity", "-Infinity", "invalid"]) {
      const selected = parseCommandSelection([
        "vc",
        "import",
        "-n",
        "unopened",
        "--head-dir",
        "/unopened-import-store",
        "--in",
        "/unread-import.cesr",
        "--settlement-timeout-ms",
        value,
      ]);
      const handler = createCmdHandlers().get(selected.name)!;
      await assertRejects(
        () => run(() => handler(selected.args)),
        ValidationError,
        "--settlement-timeout-ms",
      );
    }
  },
});

Deno.test("tufa/cli - version command prints display version", async () => {
  const captured = await captureConsoleLog(() => run(() => tufa(["version"])));

  assertEquals(captured, [
    `tufa ${TUFA_DISPLAY_VERSION} (keri-ts ${KERI_DISPLAY_VERSION})`,
  ]);
});

Deno.test("tufa/cli - --version prints display version", async () => {
  const res = await runTufa(["--version"]);

  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertStringIncludes(
    res.stdout,
    `tufa ${TUFA_DISPLAY_VERSION} (keri-ts ${KERI_DISPLAY_VERSION})`,
  );
});

Deno.test("tufa/cli - --help advertises the Tufa-owned command tree", async () => {
  const res = await runTufa(["--help"]);
  const text = `${res.stdout}\n${res.stderr}`;

  assertEquals(res.code, 0, text);
  assertStringIncludes(text, "interact");
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

Deno.test("tufa/cli - interact help advertises the Tufa-owned interact surface", async () => {
  const res = await runTufa(["interact", "--help"]);
  const text = `${res.stdout}\n${res.stderr}`;

  assertEquals(res.code, 0, text);
  assertStringIncludes(text, "-n, --name <name>");
  assertStringIncludes(text, "-a, --alias <alias>");
  assertStringIncludes(text, "-d, --data <data>");
  assertStringIncludes(text, "--receipt-endpoint");
  assertStringIncludes(text, "-z, --authenticate");
  assertStringIncludes(text, "--code <code>");
  assertStringIncludes(text, "--code-time <time>");
});

Deno.test("tufa/cli - delegate confirm dispatches expected command args", () => {
  const confirm = parseCommandSelection([
    "delegate",
    "confirm",
    "-n",
    "store",
    "-a",
    "delegator",
    "-b",
    "base",
    "--compat",
    "--head-dir",
    "/tmp/tufa",
    "-p",
    "passcode",
    "--interact",
    "--auto",
    "-z",
    "--code",
    "Bwitness:123456",
    "--code-time",
    "2026-06-11T17:00:00.000Z",
  ]);

  assertEquals(confirm.name, "delegate.confirm");
  assertEquals(confirm.args, {
    name: "store",
    alias: "delegator",
    base: "base",
    compat: true,
    headDirPath: "/tmp/tufa",
    passcode: "passcode",
    interact: true,
    auto: true,
    authenticate: true,
    code: ["Bwitness:123456"],
    codeTime: "2026-06-11T17:00:00.000Z",
  });
});

Deno.test("tufa/cli - IPEX elapsed deadlines dispatch seconds", () => {
  const grant = parseCommandSelection([
    "ipex",
    "grant",
    "-n",
    "store",
    "-a",
    "issuer",
    "-r",
    "holder",
    "--said",
    "Ecredential",
    "--approval-timeout",
    "0",
  ]);
  assertEquals(grant.name, "ipex.grant");
  assertEquals(grant.args.approvalTimeoutSeconds, "0");

  const poll = parseCommandSelection([
    "ipex",
    "poll",
    "-n",
    "store",
    "-a",
    "holder",
    "--timeout",
    "3",
    "--gvrsn",
    "2.0",
  ]);
  assertEquals(poll.name, "ipex.poll");
  assertEquals(poll.args.timeout, "3");
  assertEquals(poll.args.gvrsn, "2.0");

  const join = parseCommandSelection([
    "ipex",
    "join",
    "-n",
    "store",
    "--approval-timeout",
    "5",
  ]);
  assertEquals(join.name, "ipex.join");
  assertEquals(join.args.approvalTimeoutSeconds, "5");
});

Deno.test("tufa/cli - DID Webs and DID KERI commands dispatch expected handlers", () => {
  const bind = parseCommandSelection([
    "dws",
    "bind",
    "-n",
    "store",
    "-a",
    "issuer",
    "--did",
    "did:webs:example.com:EAid",
    "--did",
    "did:keri:EAid",
  ]);
  assertEquals(bind.name, "dws.bind");
  assertEquals(bind.args.did, ["did:webs:example.com:EAid", "did:keri:EAid"]);

  const generate = parseCommandSelection([
    "dws",
    "generate",
    "-n",
    "store",
    "-a",
    "issuer",
    "--did",
    "did:webs:example.com:dws:EAid",
    "--output-dir",
    "/tmp/dws",
  ]);
  assertEquals(generate.name, "dws.generate");
  assertEquals(generate.args.outputDir, "/tmp/dws");

  const resolver = parseCommandSelection([
    "dws",
    "resolver",
    "-n",
    "store",
    "--port",
    "7676",
    "--static-files-dir",
    "/tmp/web",
    "--did-path",
    "dws",
    "--insecure-http",
  ]);
  assertEquals(resolver.name, "dws.resolver");
  assertEquals(resolver.args.port, 7676);
  assertEquals(resolver.args.insecureHttp, true);

  const dkr = parseCommandSelection([
    "dkr",
    "resolve",
    "-n",
    "store",
    "--did",
    "did:keri:EAid",
    "--oobi",
    "http://127.0.0.1:5642/oobi/EAid",
  ]);
  assertEquals(dkr.name, "dkr.resolve");
  assertEquals(dkr.args.oobi, ["http://127.0.0.1:5642/oobi/EAid"]);
});

Deno.test("tufa/cli - multisig approval deadlines preserve supplied seconds for validation", () => {
  const incept = parseCommandSelection([
    "multisig",
    "incept",
    "-n",
    "store",
    "-a",
    "alice",
    "-g",
    "group",
    "-f",
    "group.json",
    "--approval-timeout",
    "7",
  ]);
  assertEquals(incept.name, "multisig.incept");
  assertEquals(incept.args.approvalTimeoutSeconds, "7");

  const join = parseCommandSelection([
    "multisig",
    "join",
    "-n",
    "store",
    "--approval-timeout",
    "6",
  ]);
  assertEquals(join.name, "multisig.join");
  assertEquals(join.args.approvalTimeoutSeconds, "6");

  const rpy = parseCommandSelection([
    "multisig",
    "rpy",
    "-n",
    "store",
    "--eid",
    "Eendpoint",
    "--approval-timeout",
    "0",
  ]);
  assertEquals(rpy.name, "multisig.rpy");
  assertEquals(rpy.args.approvalTimeoutSeconds, "0");

  const mailboxPropose = parseCommandSelection([
    "mailbox",
    "add",
    "-n",
    "store",
    "-a",
    "group",
    "-w",
    "mailbox",
    "--multisig-mode",
    "propose",
  ]);
  assertEquals(mailboxPropose.name, "mailbox.add");
  assertEquals(mailboxPropose.args.multisigMode, "propose");

  const mailboxComplete = parseCommandSelection([
    "mailbox",
    "add",
    "-n",
    "store",
    "-a",
    "group",
    "-w",
    "mailbox",
    "--multisig-mode",
    "complete",
  ]);
  assertEquals(mailboxComplete.name, "mailbox.add");
  assertEquals(mailboxComplete.args.multisigMode, "complete");

  const endsPropose = parseCommandSelection([
    "ends",
    "add",
    "-n",
    "store",
    "-a",
    "group",
    "-r",
    "mailbox",
    "-e",
    "Eendpoint",
    "--multisig-mode",
    "propose",
  ]);
  assertEquals(endsPropose.name, "ends.add");
  assertEquals(endsPropose.args.multisigMode, "propose");

  const endsComplete = parseCommandSelection([
    "ends",
    "add",
    "-n",
    "store",
    "-a",
    "group",
    "-r",
    "mailbox",
    "-e",
    "Eendpoint",
    "--multisig-mode",
    "complete",
  ]);
  assertEquals(endsComplete.name, "ends.add");
  assertEquals(endsComplete.args.multisigMode, "complete");
});

Deno.test("tufa/cli - invalid mailbox multisig mode is rejected", async () => {
  await assertRejects(
    () =>
      run(() =>
        mailboxAddCommand({
          name: "store",
          alias: "group",
          mailbox: "mailbox",
          multisigMode: "invalid",
        })
      ),
    ValidationError,
    "--multisig-mode must be propose or complete",
  );
});

Deno.test("tufa/cli - interact reaches the real command body through the Tufa binary surface", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-cli-interact-" });
  const name = `tufa-cli-interact-${crypto.randomUUID()}`;
  const alias = "alice";

  const init = await runTufa([
    "init",
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

  const incept = await runTufa([
    "incept",
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--alias",
    alias,
    "--transferable",
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
  ]);
  assertEquals(
    incept.code,
    0,
    `stdout:\n${incept.stdout}\nstderr:\n${incept.stderr}`,
  );
  const prefix = extractPrefix(incept.stdout);

  const interact = await runTufa([
    "interact",
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--alias",
    alias,
    "--data",
    "{\"anchor\":\"acdc\"}",
  ]);
  assertEquals(
    interact.code,
    0,
    `stdout:\n${interact.stdout}\nstderr:\n${interact.stderr}`,
  );
  assertStringIncludes(interact.stdout, `Prefix  ${prefix}`);
  assertStringIncludes(interact.stdout, "New Sequence No.  1");
  assertStringIncludes(interact.stdout, "Public key 1");
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

Deno.test("tufa/cli - mailbox start rejects conflicting config and explicit startup material", async () => {
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

  await assertRejects(
    () =>
      run(() =>
        mailboxStartCommand({
          name: `mailbox-start-${crypto.randomUUID()}`,
          alias: "relay",
          headDirPath,
          configFile: configPath,
          url: "http://127.0.0.1:5632",
          datetime: "2026-04-06T12:05:00.000Z",
        })
      ),
    ValidationError,
    "conflicts with explicit --url/--datetime startup material",
  );
});

Deno.test("tufa/cli - --debug-error prints the AppError stack for handled command failures", async () => {
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

Deno.test("tufa/cli - verifier run accepts the grant child attachment genus", () => {
  const verifier = parseCommandSelection([
    "verifier",
    "run",
    "-n",
    "store",
    "--hook",
    "http://127.0.0.1:9923",
    "--gvrsn",
    "2.0",
  ]);
  assertEquals(verifier.name, "verifier.run");
  assertEquals(verifier.args.gvrsn, "2.0");
});

Deno.test("tufa/cli - debug and info diagnostics preserve credential JSON stdout", async () => {
  const head = await Deno.makeTempDir({ prefix: "tufa-logging-" });
  const store = ["--name", "logging", "--head-dir", head];
  try {
    const init = await runTufa(["init", ...store, "--nopasscode"]);
    assertEquals(init.code, 0, init.stderr);
    const incept = await runTufa(["incept", ...store, "--alias", "alice", "--transferable", "--toad", "0"]);
    assertEquals(incept.code, 0, incept.stderr);
    for (const level of ["debug", "info"]) {
      const result = await runTufa([
        "--loglevel",
        level,
        "vc",
        "registry",
        "incept",
        ...store,
        "--alias",
        "alice",
        "--registry-name",
        `registry-${level}`,
      ]);
      assertEquals(result.code, 0, result.stderr);
      const record = JSON.parse(result.stdout);
      assertEquals(record.name, `registry-${level}`);
      assertEquals(typeof record.registry, "string");
      assertEquals(record.issuer, extractPrefix(incept.stdout));
      assertEquals(result.stdout.trim().split("\n").length, 1);
      assertEquals(result.stderr.includes("Opening LMDB"), level === "debug");
    }
  } finally {
    await Deno.remove(head, { recursive: true });
  }
});

Deno.test("tufa/cli - local group credential authoring reports coordination separately from transport", async () => {
  const head = await Deno.makeTempDir({ prefix: "tufa-group-results-" });
  const name = "group-results";
  const store = ["--name", name, "--head-dir", head, "--alias", "team"];
  let groupPre = "";
  try {
    await run(function*() {
      const hby = yield* createHabery({ name, headDirPath: head, skipConfig: true });
      try {
        const member = hby.makeHab("member");
        groupPre = hby.makeGroupHab("team", member, [member.pre], [member.pre], undefined, {
          isith: "1",
          nsith: "1",
          toad: 0,
        }).hab.pre;
      } finally {
        yield* hby.close();
      }
    });
    const inception = await runTufa(["vc", "registry", "incept", ...store, "--registry-name", "registry"]);
    assertEquals(inception.code, 0, inception.stderr);
    const registry = JSON.parse(inception.stdout);
    assertEquals(registry.issuer, groupPre);
    assertEquals(registry.route, "/multisig/vcp");
    assertEquals(registry.status, "accept");
    assertEquals(registry.accepted, true);
    assertEquals(registry.messages, []);
    assertEquals(registry.deliveries, []);

    const schema = new Schemer({ sed: { type: "object" } });
    const schemaFile = `${head}/schema.json`;
    await Deno.writeFile(schemaFile, schema.raw);
    const creation = await runTufa([
      "vc",
      "create",
      ...store,
      "--registry-name",
      "registry",
      "--schema-file",
      schemaFile,
      "--data",
      "{}",
    ]);
    assertEquals(creation.code, 0, creation.stderr);
    const issued = JSON.parse(creation.stdout);
    assertEquals(issued.registry, registry.registry);
    assertEquals(issued.issuer, groupPre);
    assertEquals(issued.schema, schema.said);
    assertEquals(typeof issued.said, "string");
    assertEquals(typeof issued.tel, "string");
    assertEquals(issued.status, "accept");
    assertEquals(issued.route, "/multisig/iss");
    assertEquals(issued.telStatus, "accept");
    assertEquals(issued.saved, true);
    assertEquals(issued.messages, []);
    assertEquals(issued.deliveries, []);
  } finally {
    await Deno.remove(head, { recursive: true });
  }
});

Deno.test("lifecycle CLI preserves omitted file overrides and raw numeric syntax", () => {
  const incept = parseCommandSelection(["incept", "-n", "store", "-a", "alice", "--file", "options.json"]);
  for (const key of ["transferable", "estOnly", "wits", "data", "icount", "ncount", "toad"]) {
    assertEquals(incept.args[key], undefined, key);
  }
  const rotate = parseCommandSelection(["rotate", "-n", "store", "-a", "alice", "--file", "options.json"]);
  for (const key of ["witnesses", "cuts", "witnessAdd", "data", "nextCount", "nsith"]) {
    assertEquals(rotate.args[key], undefined, key);
  }
  const explicit = parseCommandSelection(["incept", "-n", "store", "-a", "alice", "--transferable", "--ncount", "0"]);
  assertEquals(explicit.args.transferable, true);
  assertEquals(explicit.args.ncount, "0");
  const malformed = parseCommandSelection(["rotate", "-n", "store", "-a", "alice", "--next-count", "1e2"]);
  assertEquals(malformed.args.nextCount, "1e2", "the command boundary must validate the original syntax");
});

Deno.test("multisig rotation preserves omitted file overrides", () => {
  const selection = parseCommandSelection([
    "multisig",
    "rotate",
    "-n",
    "store",
    "-g",
    "group",
    "--file",
    "rotate.json",
  ]);
  for (const key of ["witnesses", "cuts", "witnessAdd", "data", "smids", "rmids", "toad"]) {
    assertEquals(selection.args[key], undefined, key);
  }
  const join = parseCommandSelection(["multisig", "join", "-n", "store"]);
  assertEquals(join.args.approvalTimeoutSeconds, undefined);
});
