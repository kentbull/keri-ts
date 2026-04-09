import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { t } from "../../../../cesr/mod.ts";

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

type SpawnedChild = Deno.ChildProcess;

function packageRoot(): string {
  return new URL("../../../../../", import.meta.url).pathname;
}

function extractPrefix(output: string): string {
  const line = output.split(/\r?\n/).find((line) => line.trim().startsWith("Prefix"));
  if (!line) {
    throw new Error(`Unable to parse prefix from output:\n${output}`);
  }
  return line.trim().split(/\s+/).at(-1) ?? "";
}

function extractRawSignature(output: string): string {
  const line = output.split(/\r?\n/).find((line) => /^\d+\.\s+/.test(line.trim()));
  if (!line) {
    throw new Error(`Unable to parse signature from output:\n${output}`);
  }
  return line.trim().replace(/^\d+\.\s+/, "");
}

async function runCmd(
  command: string,
  args: string[],
  cwd: string,
): Promise<CmdResult> {
  const out = await new Deno.Command(command, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();

  return {
    code: out.code,
    stdout: t(out.stdout),
    stderr: t(out.stderr),
  };
}

function spawnChild(
  command: string,
  args: string[],
  cwd: string,
): SpawnedChild {
  return new Deno.Command(command, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
}

async function runCmdWithTimeout(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<CmdResult> {
  const child = spawnChild(command, args, cwd);
  const stdoutPromise = child.stdout
    ? new Response(child.stdout).text()
    : Promise.resolve("");
  const stderrPromise = child.stderr
    ? new Response(child.stderr).text()
    : Promise.resolve("");

  const timeout = Symbol("timeout");
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const winner = await Promise.race([
    child.status,
    new Promise<symbol>((resolve) => {
      timeoutId = setTimeout(() => resolve(timeout), timeoutMs);
    }),
  ]);
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }

  if (winner === timeout) {
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
  return {
    code: (winner as Deno.CommandStatus).code,
    stdout,
    stderr,
  };
}

async function runTufa(args: string[]): Promise<CmdResult> {
  return await runCmd(
    "deno",
    ["run", "--allow-all", "--unstable-ffi", "packages/keri/mod.ts", ...args],
    packageRoot(),
  );
}

async function runTufaWithTimeout(
  args: string[],
  timeoutMs = 20_000,
): Promise<CmdResult> {
  return await runCmdWithTimeout(
    "deno",
    ["run", "--allow-all", "--unstable-ffi", "packages/keri/mod.ts", ...args],
    packageRoot(),
    timeoutMs,
  );
}

async function requireSuccess(
  label: string,
  resultPromise: Promise<CmdResult>,
): Promise<CmdResult> {
  const result = await resultPromise;
  if (result.code !== 0) {
    throw new Error(`${label} failed: ${result.stderr}\n${result.stdout}`);
  }
  return result;
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + 15_000;
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

async function readChildOutput(child: SpawnedChild): Promise<string> {
  const [stdout, stderr] = await Promise.all([
    child.stdout ? new Response(child.stdout).text() : Promise.resolve(""),
    child.stderr ? new Response(child.stderr).text() : Promise.resolve(""),
  ]);
  return `${stdout}\n${stderr}`.trim();
}

async function stopChild(child: SpawnedChild): Promise<string> {
  try {
    child.kill("SIGTERM");
  } catch {
    // Child may already be gone.
  }
  await child.status.catch(() => undefined);
  return await readChildOutput(child);
}

async function withStartedChild<T>(
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

function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 20000);
}

Deno.test("CLI integration - stale tufa verify fails before query and succeeds after query following rotate", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-query-rotate-" });
  const aliceName = `alice-${crypto.randomUUID()}`;
  const bobName = `bob-${crypto.randomUUID()}`;
  const aliceAlias = "alice";
  const bobAlias = "bob";
  const message = "query after rotate";
  const alicePort = randomPort();
  const aliceOrigin = `http://127.0.0.1:${alicePort}`;
  let rotatedSignature = "";

  await requireSuccess(
    "alice init",
    runTufa([
      "init",
      "--name",
      aliceName,
      "--head-dir",
      headDirPath,
      "--nopasscode",
    ]),
  );
  const aliceIncept = await requireSuccess(
    "alice incept",
    runTufa([
      "incept",
      "--name",
      aliceName,
      "--head-dir",
      headDirPath,
      "--alias",
      aliceAlias,
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
    ]),
  );
  const alicePre = extractPrefix(aliceIncept.stdout);

  await requireSuccess(
    "alice loc add",
    runTufa([
      "loc",
      "add",
      "--name",
      aliceName,
      "--head-dir",
      headDirPath,
      "--alias",
      aliceAlias,
      "--url",
      aliceOrigin,
    ]),
  );
  await requireSuccess(
    "alice controller ends add",
    runTufa([
      "ends",
      "add",
      "--name",
      aliceName,
      "--head-dir",
      headDirPath,
      "--alias",
      aliceAlias,
      "--role",
      "controller",
      "--eid",
      alicePre,
    ]),
  );
  await requireSuccess(
    "alice mailbox ends add",
    runTufa([
      "ends",
      "add",
      "--name",
      aliceName,
      "--head-dir",
      headDirPath,
      "--alias",
      aliceAlias,
      "--role",
      "mailbox",
      "--eid",
      alicePre,
    ]),
  );

  await requireSuccess(
    "bob init",
    runTufa([
      "init",
      "--name",
      bobName,
      "--head-dir",
      headDirPath,
      "--nopasscode",
    ]),
  );
  await requireSuccess(
    "bob incept",
    runTufa([
      "incept",
      "--name",
      bobName,
      "--head-dir",
      headDirPath,
      "--alias",
      bobAlias,
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
    ]),
  );

  const startAliceAgent = () =>
    spawnChild(
      "deno",
      [
        "run",
        "--allow-all",
        "--unstable-ffi",
        "packages/keri/mod.ts",
        "agent",
        "--name",
        aliceName,
        "--head-dir",
        headDirPath,
        "--port",
        String(alicePort),
      ],
      packageRoot(),
    );

  await withStartedChild(startAliceAgent(), alicePort, async () => {
    await requireSuccess(
      "bob resolve alice controller oobi",
      runTufaWithTimeout([
        "oobi",
        "resolve",
        "--name",
        bobName,
        "--head-dir",
        headDirPath,
        "--url",
        `${aliceOrigin}/oobi/${alicePre}/controller`,
        "--oobi-alias",
        aliceAlias,
      ]),
    );
    const mailboxAdd = await requireSuccess(
      "bob mailbox add alice",
      runTufaWithTimeout([
        "mailbox",
        "add",
        "--name",
        bobName,
        "--head-dir",
        headDirPath,
        "--alias",
        bobAlias,
        "--mailbox",
        aliceAlias,
      ]),
    );
    assertStringIncludes(mailboxAdd.stdout, alicePre);

    const initialSign = await requireSuccess(
      "alice sign initial",
      runTufa([
        "sign",
        "--name",
        aliceName,
        "--head-dir",
        headDirPath,
        "--alias",
        aliceAlias,
        "--text",
        message,
      ]),
    );
    const initialSignature = extractRawSignature(initialSign.stdout);
    const initialVerify = await requireSuccess(
      "bob verify initial",
      runTufa([
        "verify",
        "--name",
        bobName,
        "--head-dir",
        headDirPath,
        "--prefix",
        alicePre,
        "--text",
        message,
        "--signature",
        initialSignature,
      ]),
    );
    assertStringIncludes(initialVerify.stdout, "Signature 1 is valid.");

    await requireSuccess(
      "alice rotate",
      runTufa([
        "rotate",
        "--name",
        aliceName,
        "--head-dir",
        headDirPath,
        "--alias",
        aliceAlias,
      ]),
    );

    const rotatedSign = await requireSuccess(
      "alice sign rotated",
      runTufa([
        "sign",
        "--name",
        aliceName,
        "--head-dir",
        headDirPath,
        "--alias",
        aliceAlias,
        "--text",
        message,
      ]),
    );
    rotatedSignature = extractRawSignature(rotatedSign.stdout);

    const staleVerify = await runTufa([
      "verify",
      "--name",
      bobName,
      "--head-dir",
      headDirPath,
      "--prefix",
      alicePre,
      "--text",
      message,
      "--signature",
      rotatedSignature,
    ]);
    assertEquals(
      staleVerify.code === 0,
      false,
      `stdout:\n${staleVerify.stdout}\nstderr:\n${staleVerify.stderr}`,
    );
    assertStringIncludes(staleVerify.stderr, "Signature 1 is invalid.");
  });

  await withStartedChild(startAliceAgent(), alicePort, async () => {
    const query = await requireSuccess(
      "bob query alice",
      runTufaWithTimeout([
        "query",
        "--name",
        bobName,
        "--head-dir",
        headDirPath,
        "--alias",
        bobAlias,
        "--prefix",
        alicePre,
      ]),
    );
    assertStringIncludes(query.stdout, "Checking for updates...");
    assertStringIncludes(query.stdout, `Identifier: ${alicePre}`);
    assertStringIncludes(query.stdout, "Seq No:\t1");

    const refreshedVerify = await requireSuccess(
      "bob verify rotated after query",
      runTufa([
        "verify",
        "--name",
        bobName,
        "--head-dir",
        headDirPath,
        "--prefix",
        alicePre,
        "--text",
        message,
        "--signature",
        rotatedSignature,
      ]),
    );
    assertStringIncludes(refreshedVerify.stdout, "Signature 1 is valid.");
  });
});
