// @file-test-lane runtime-slow

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { t } from "../../../../cesr/mod.ts";

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

type SpawnedChild = Deno.ChildProcess;

/** Resolve the package root so subprocesses always run the in-repo `tufa`. */
function packageRoot(): string {
  return new URL("../../../", import.meta.url).pathname;
}

/** Resolve the shared single-sig inception fixture used by these agent tests. */
function inceptConfigPath(): string {
  return new URL(
    "../../../../../samples/incept-config/single-sig-incept.json",
    import.meta.url,
  ).pathname;
}

/**
 * Run one subprocess and decode stdout/stderr into plain strings.
 *
 * These tests compare command behavior, so the helper keeps process launching
 * and byte decoding consistent across init/incept/agent invocations.
 */
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

/** Execute the local Deno-source `tufa` entrypoint from the package root. */
async function runTufa(args: string[]): Promise<CmdResult> {
  return await runCmd(
    "deno",
    ["run", "--allow-all", "--unstable-ffi", "mod.ts", ...args],
    packageRoot(),
  );
}

/**
 * Poll one spawned agent's `/health` endpoint until it is reachable.
 *
 * The startup contract for these tests is concrete host readiness, not merely
 * "process did not exit yet", so this helper waits on observable protocol
 * readiness before assertions continue.
 */
async function waitForHealth(port: number, attempts = 40): Promise<void> {
  const url = `http://127.0.0.1:${port}/health`;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await response.text();
        return;
      }
    } catch {
      // Keep polling until the child is ready or exits.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

/** Drain a child process's remaining output for startup-failure diagnostics. */
async function readChildOutput(child: SpawnedChild): Promise<string> {
  const [stdout, stderr] = await Promise.all([
    child.stdout ? new Response(child.stdout).text() : Promise.resolve(""),
    child.stderr ? new Response(child.stderr).text() : Promise.resolve(""),
  ]);
  return `${stdout}\n${stderr}`.trim();
}

/** Best-effort shutdown for one spawned `tufa agent` process. */
async function stopChild(child: SpawnedChild): Promise<string> {
  try {
    child.kill("SIGTERM");
  } catch {
    // The child may already be gone.
  }
  await child.status;
  return await readChildOutput(child);
}

/**
 * Start `tufa agent` and wait until the protocol host is actually serving.
 *
 * On startup failure this helper returns the child's buffered output inside the
 * thrown error so CLI regressions stay actionable instead of opaque timeouts.
 */
async function startTufaAgent(
  args: string[],
  port: number,
): Promise<SpawnedChild> {
  const child = new Deno.Command("deno", {
    args: ["run", "--allow-all", "--unstable-ffi", "mod.ts", ...args],
    cwd: packageRoot(),
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  try {
    await waitForHealth(port);
    return child;
  } catch (error) {
    const details = await stopChild(child);
    throw new Error(
      `Failed to start tufa agent on port ${port}: ${
        error instanceof Error ? error.message : String(error)
      }\n${details}`,
    );
  }
}

/**
 * Provision one store up to the point where `tufa agent` can reopen it.
 *
 * This intentionally exercises the same CLI path the user reported:
 * `init -> incept -> agent`, with either unencrypted or passcode-protected
 * keeper policy depending on the supplied test case.
 */
async function initAndInceptStore(
  {
    name,
    headDirPath,
    alias,
    passcode,
  }: {
    name: string;
    headDirPath: string;
    alias: string;
    passcode?: string;
  },
): Promise<void> {
  const salt = "0ADHFiisJ7FnfWkPl4YfX6AK";
  const initArgs = [
    "init",
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--salt",
    salt,
  ];
  if (passcode) {
    initArgs.push("--passcode", passcode);
  } else {
    initArgs.push("--nopasscode");
  }

  const init = await runTufa(initArgs);
  if (init.code !== 0) {
    throw new Error(`tufa init failed: ${init.stderr}\n${init.stdout}`);
  }

  const inceptArgs = [
    "incept",
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--alias",
    alias,
    "--file",
    inceptConfigPath(),
    "--transferable",
  ];
  if (passcode) {
    inceptArgs.push("--passcode", passcode);
  }

  const incept = await runTufa(inceptArgs);
  if (incept.code !== 0) {
    throw new Error(`tufa incept failed: ${incept.stderr}\n${incept.stdout}`);
  }
}

// @test-lane app-fast-parallel
Deno.test("CLI - agent help advertises -p for port and -P for passcode", async () => {
  const help = await runTufa(["agent", "--help"]);
  const text = `${help.stdout}\n${help.stderr}`;
  assertEquals(help.code, 0, text);
  assertStringIncludes(text, "-P, --passcode <passcode>");
  assertStringIncludes(text, "-p, --port <port>");
});

Deno.test("CLI - agent starts unencrypted stores with -n before or after port flags", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-agent-unenc-" });
  const name = `agent-unenc-${crypto.randomUUID()}`;
  const alias = "test1";
  await initAndInceptStore({ name, headDirPath, alias });

  const firstPort = 18110;
  const firstChild = await startTufaAgent(
    ["agent", "-n", name, "--head-dir", headDirPath, "-p", `${firstPort}`],
    firstPort,
  );
  try {
    const response = await fetch(`http://127.0.0.1:${firstPort}/health`);
    assertEquals(response.status, 200);
    assertEquals(await response.text(), "ok");
  } finally {
    await stopChild(firstChild);
  }

  const secondPort = 18111;
  const secondChild = await startTufaAgent(
    ["agent", "--port", `${secondPort}`, "-n", name, "--head-dir", headDirPath],
    secondPort,
  );
  try {
    const response = await fetch(`http://127.0.0.1:${secondPort}/health`);
    assertEquals(response.status, 200);
    assertEquals(await response.text(), "ok");
  } finally {
    await stopChild(secondChild);
  }
});

Deno.test("CLI - agent reopens encrypted stores with -P and --passcode", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-agent-enc-" });
  const name = `agent-enc-${crypto.randomUUID()}`;
  const alias = "test1";
  const passcode = "MyPasscodeARealSecret";
  await initAndInceptStore({ name, headDirPath, alias, passcode });

  const firstPort = 18120;
  const firstChild = await startTufaAgent(
    [
      "agent",
      "-n",
      name,
      "--head-dir",
      headDirPath,
      "-p",
      `${firstPort}`,
      "-P",
      passcode,
    ],
    firstPort,
  );
  try {
    const response = await fetch(`http://127.0.0.1:${firstPort}/health`);
    assertEquals(response.status, 200);
    assertEquals(await response.text(), "ok");
  } finally {
    await stopChild(firstChild);
  }

  const secondPort = 18121;
  const secondChild = await startTufaAgent(
    [
      "agent",
      "--port",
      `${secondPort}`,
      "-n",
      name,
      "--head-dir",
      headDirPath,
      "--passcode",
      passcode,
    ],
    secondPort,
  );
  try {
    const response = await fetch(`http://127.0.0.1:${secondPort}/health`);
    assertEquals(response.status, 200);
    assertEquals(await response.text(), "ok");
  } finally {
    await stopChild(secondChild);
  }
});
