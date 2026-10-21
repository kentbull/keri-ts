/**
 * Cross-implementation CLI and mailbox interoperability tests.
 *
 * The mailbox handoff relies especially on the two mailbox scenarios in this
 * file:
 * - KLI mailbox operations against a Tufa mailbox host
 * - Tufa mailbox operations against the pinned KERIpy mailbox host
 *
 * The helper layer exists to keep those subprocess-heavy scenarios readable and
 * debuggable instead of burying the protocol assertions in process plumbing.
 */
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { createHabery } from "../../../src/app/identity/habbing.ts";
import { mailboxTopicKey, openMailboxerForHabery } from "../../../src/app/mailbox/mailboxing.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { assertExportParity } from "./interop-export-helpers.ts";
import {
  createInteropContext,
  extractLastNonEmptyLine,
  extractPrefix,
  extractRawSignature,
  inspectCompatHabery,
  packageRoot,
  randomPort,
  requireSuccess,
  runCmd,
  runCmdWithTimeout,
  runTufa,
  runTufaWithTimeout,
  spawnChild,
  waitForHealth,
  withStartedChild,
  workspaceRoot,
  writeAgentConfig,
} from "./interop-test-helpers.ts";

Deno.test("Interop: kli and tufa produce identical single-sig evidence with exact genus-specific KEL bytes", async () => {
  const ctx = await createInteropContext();
  const env = ctx.env;
  const kliCommand = ctx.kliCommand;
  const repoRoot = packageRoot();
  const base = `interop-${crypto.randomUUID().slice(0, 8)}`;
  const alias = "interop-aid";
  const passcode = "MyPasscodeARealSecret";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const kliName = `kli-${crypto.randomUUID().slice(0, 8)}`;
  const tufaName = `tufa-${crypto.randomUUID().slice(0, 8)}`;

  const kliInit = await runCmd(kliCommand, [
    "init",
    "--version",
    "1.0",
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

  const kliIncept = await runCmd(kliCommand, [
    "incept",
    "--version",
    "1.0",
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

  const kliExport = await runCmd(kliCommand, [
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

  await assertExportParity(
    ctx,
    { name: kliName, base, passcode, alias },
    tufaExport.stdout,
    kliExport.stdout,
  );
});

Deno.test("Interop: KLI verify fails on a rotated tufa key before query and succeeds after KLI query", async () => {
  const ctx = await createInteropContext();
  const base = `interop-rotate-${crypto.randomUUID().slice(0, 8)}`;
  const passcode = "MyPasscodeARealSecret";
  const salt = "0AAwMTIzNDU2Nzg5YWJjZGVm";
  const tufaHeadDir = await Deno.makeTempDir({
    prefix: "tufa-interop-rotate-",
  });
  const tufaRepoRoot = workspaceRoot();
  const tufaName = `tufa-rotate-${crypto.randomUUID().slice(0, 8)}`;
  const tufaAlias = "alice";
  const kliName = `kli-rotate-${crypto.randomUUID().slice(0, 8)}`;
  const kliAlias = "bob";
  const message = "interop rotate";
  const tufaPort = randomPort();
  const tufaAgentConfig = "alice-agent";
  const tufaOrigin = `http://127.0.0.1:${tufaPort}`;
  let rotatedSignature = "";
  const runTufaFromRoot = (args: string[]) =>
    runCmd(
      "deno",
      ["run", "--allow-all", "--unstable-ffi", "packages/tufa/mod.ts", ...args],
      ctx.env,
      tufaRepoRoot,
    );

  await requireSuccess(
    "tufa init",
    runTufaFromRoot(
      [
        "init",
        "--name",
        tufaName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--salt",
        salt,
      ],
    ),
  );
  const tufaIncept = await requireSuccess(
    "tufa incept",
    runTufaFromRoot(
      [
        "incept",
        "--name",
        tufaName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        tufaAlias,
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
    ),
  );
  const tufaPre = extractPrefix(tufaIncept.stdout);

  await requireSuccess(
    "tufa loc add",
    runTufaFromRoot(
      [
        "loc",
        "add",
        "--name",
        tufaName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        tufaAlias,
        "--url",
        tufaOrigin,
      ],
    ),
  );
  await requireSuccess(
    "tufa controller ends add",
    runTufaFromRoot(
      [
        "ends",
        "add",
        "--name",
        tufaName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        tufaAlias,
        "--role",
        "controller",
        "--eid",
        tufaPre,
      ],
    ),
  );
  await requireSuccess(
    "tufa mailbox ends add",
    runTufaFromRoot(
      [
        "ends",
        "add",
        "--name",
        tufaName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--alias",
        tufaAlias,
        "--role",
        "mailbox",
        "--eid",
        tufaPre,
      ],
    ),
  );

  await requireSuccess(
    "kli init",
    runCmd(ctx.kliCommand, [
      "init",
      "--version",
      "1.0",
      "--name",
      kliName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--salt",
      salt,
    ], ctx.env),
  );
  await requireSuccess(
    "kli incept",
    runCmd(ctx.kliCommand, [
      "incept",
      "--version",
      "1.0",
      "--name",
      kliName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--alias",
      kliAlias,
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
    ], ctx.env),
  );

  const startTufaAgent = () =>
    spawnChild(
      "deno",
      [
        "run",
        "--allow-all",
        "--unstable-ffi",
        "packages/tufa/mod.ts",
        "agent",
        "--name",
        tufaName,
        "--base",
        base,
        "--head-dir",
        tufaHeadDir,
        "--passcode",
        passcode,
        "--port",
        String(tufaPort),
        "--config-dir",
        tufaHeadDir,
        "--config-file",
        tufaAgentConfig,
      ],
      ctx.env,
      tufaRepoRoot,
    );

  await writeAgentConfig(
    tufaHeadDir,
    tufaAgentConfig,
    tufaAlias,
    tufaPort,
  );

  await withStartedChild(startTufaAgent(), tufaPort, async () => {
    await requireSuccess(
      "kli resolve tufa controller",
      runCmdWithTimeout(
        ctx.kliCommand,
        [
          "oobi",
          "resolve",
          "--version",
          "1.0",
          "--name",
          kliName,
          "--base",
          base,
          "--passcode",
          passcode,
          "--oobi",
          `${tufaOrigin}/oobi/${tufaPre}/controller`,
          "--oobi-alias",
          tufaAlias,
        ],
        ctx.env,
        20_000,
      ),
    );
    const mailboxAdd = await requireSuccess(
      "kli mailbox add tufa",
      runCmdWithTimeout(
        ctx.kliCommand,
        [
          "mailbox",
          "add",
          "--version",
          "1.0",
          "--name",
          kliName,
          "--base",
          base,
          "--passcode",
          passcode,
          "--alias",
          kliAlias,
          "--mailbox",
          tufaAlias,
        ],
        ctx.env,
        20_000,
      ),
    );
    assertStringIncludes(mailboxAdd.stdout, tufaPre);

    const initialSign = await requireSuccess(
      "tufa sign initial",
      runTufaFromRoot(
        [
          "sign",
          "--name",
          tufaName,
          "--base",
          base,
          "--head-dir",
          tufaHeadDir,
          "--passcode",
          passcode,
          "--alias",
          tufaAlias,
          "--text",
          message,
        ],
      ),
    );
    const initialVerify = await requireSuccess(
      "kli verify initial",
      runCmd(ctx.kliCommand, [
        "verify",
        "--name",
        kliName,
        "--base",
        base,
        "--passcode",
        passcode,
        "--prefix",
        tufaPre,
        "--text",
        message,
        "--signature",
        extractRawSignature(initialSign.stdout),
      ], ctx.env),
    );
    assertStringIncludes(initialVerify.stdout, "Signature 1 is valid.");

    await requireSuccess(
      "tufa rotate",
      runTufaFromRoot(
        [
          "rotate",
          "--name",
          tufaName,
          "--base",
          base,
          "--head-dir",
          tufaHeadDir,
          "--passcode",
          passcode,
          "--alias",
          tufaAlias,
        ],
      ),
    );

    const rotatedSign = await requireSuccess(
      "tufa sign rotated",
      runTufaFromRoot(
        [
          "sign",
          "--name",
          tufaName,
          "--base",
          base,
          "--head-dir",
          tufaHeadDir,
          "--passcode",
          passcode,
          "--alias",
          tufaAlias,
          "--text",
          message,
        ],
      ),
    );
    rotatedSignature = extractRawSignature(rotatedSign.stdout);

    const staleVerify = await runCmd(ctx.kliCommand, [
      "verify",
      "--name",
      kliName,
      "--base",
      base,
      "--passcode",
      passcode,
      "--prefix",
      tufaPre,
      "--text",
      message,
      "--signature",
      rotatedSignature,
    ], ctx.env);
    assertEquals(
      staleVerify.code === 0,
      false,
      `stdout:\n${staleVerify.stdout}\nstderr:\n${staleVerify.stderr}`,
    );
    assertStringIncludes(
      `${staleVerify.stdout}\n${staleVerify.stderr}`,
      "Signature 1 is invalid.",
    );
  });

  await withStartedChild(startTufaAgent(), tufaPort, async () => {
    const query = await requireSuccess(
      "kli query tufa controller",
      runCmdWithTimeout(
        ctx.kliCommand,
        [
          "query",
          "--version",
          "1.0",
          "--name",
          kliName,
          "--base",
          base,
          "--passcode",
          passcode,
          "--alias",
          kliAlias,
          "--prefix",
          tufaPre,
        ],
        ctx.env,
        20_000,
      ),
    );
    assertStringIncludes(query.stdout, "Checking for updates...");
    assertStringIncludes(query.stdout, `Identifier: ${tufaPre}`);
    assertStringIncludes(query.stdout, "Seq No:\t1");

    const refreshedVerify = await requireSuccess(
      "kli verify after query",
      runCmd(ctx.kliCommand, [
        "verify",
        "--name",
        kliName,
        "--base",
        base,
        "--passcode",
        passcode,
        "--prefix",
        tufaPre,
        "--text",
        message,
        "--signature",
        rotatedSignature,
      ], ctx.env),
    );
    assertStringIncludes(refreshedVerify.stdout, "Signature 1 is valid.");
  });
});
