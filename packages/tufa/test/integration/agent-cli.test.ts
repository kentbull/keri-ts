import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  packageRoot,
  reserveTcpPort,
  runTufa,
  type SpawnedChild,
  spawnTufa,
  stopChild,
  waitForHealth,
} from "../test-helpers.ts";

function inceptConfigPath(): string {
  return new URL(
    "../../../../samples/incept-config/single-sig-incept.json",
    import.meta.url,
  ).pathname;
}

async function startTufaAgent(
  args: string[],
  port: number,
): Promise<SpawnedChild> {
  const child = spawnTufa(args);

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

Deno.test("tufa/agent-cli - help advertises -p for port and -P for passcode", async () => {
  const help = await runTufa(["agent", "--help"]);
  const text = `${help.stdout}\n${help.stderr}`;
  assertEquals(help.code, 0, text);
  assertStringIncludes(text, "-P, --passcode <passcode>");
  assertStringIncludes(text, "-p, --port <port>");
});

Deno.test("tufa/agent-cli - starts unencrypted stores with -n before or after port flags", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-agent-unenc-" });
  const name = `agent-unenc-${crypto.randomUUID()}`;
  const alias = "test1";
  await initAndInceptStore({ name, headDirPath, alias });

  const firstPort = reserveTcpPort();
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

  const secondPort = reserveTcpPort();
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

Deno.test("tufa/agent-cli - reopens encrypted stores with -P and --passcode", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-agent-enc-" });
  const name = `agent-enc-${crypto.randomUUID()}`;
  const alias = "test1";
  const passcode = "MyPasscodeARealSecret";
  await initAndInceptStore({ name, headDirPath, alias, passcode });

  const firstPort = reserveTcpPort();
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

  const secondPort = reserveTcpPort();
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
