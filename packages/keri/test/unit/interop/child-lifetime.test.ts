import { assert, assertEquals } from "jsr:@std/assert";
import { spawnGuardedChild } from "../../support/child-lifetime.ts";

const MODULE_URL = new URL("../../support/child-lifetime.ts", import.meta.url).href;
const SLEEPER = ["-c", "echo $$; exec sleep 600"];

async function isAlive(pid: number): Promise<boolean> {
  return (await new Deno.Command("kill", { args: ["-0", String(pid)], stderr: "null" }).output()).success;
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function readFirstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("\n")) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel();
  return text.split("\n")[0].trim();
}

Deno.test("guarded child exits when its owning process is SIGKILLed", async () => {
  // The owner stands in for a test runtime that dies without running cleanup.
  const owner = new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      `import { spawnGuardedChild } from ${JSON.stringify(MODULE_URL)};
       const child = spawnGuardedChild("sh", { args: ${JSON.stringify(SLEEPER)}, stdout: "inherit" });
       await child.status;`,
    ],
    stdout: "piped",
    stderr: "inherit",
  }).spawn();
  const pid = Number(await readFirstLine(owner.stdout));
  assert(Number.isInteger(pid) && pid > 0, `expected sleeper pid, got ${pid}`);
  try {
    owner.kill("SIGKILL");
    await owner.status;
    assert(await waitForExit(pid, 5_000), `guarded child ${pid} outlived its SIGKILLed owner`);
  } finally {
    if (await isAlive(pid)) Deno.kill(pid, "SIGKILL");
  }
});

Deno.test("guarded child forwards SIGTERM and propagates exit codes", async () => {
  const sleeper = spawnGuardedChild("sh", { args: SLEEPER, stdout: "piped" });
  const pid = Number(await readFirstLine(sleeper.stdout));
  sleeper.kill("SIGTERM");
  assertEquals((await sleeper.status).code, 128 + 15);
  assert(await waitForExit(pid, 1_000), `guarded child ${pid} survived SIGTERM`);

  const exiting = spawnGuardedChild("sh", { args: ["-c", "exit 7"], stdout: "null" });
  assertEquals((await exiting.status).code, 7);
});

Deno.test("guarded child SIGKILL reaches the real child", async () => {
  // Killing only the guard would orphan the child with the owner's stdout pipe open.
  const sleeper = spawnGuardedChild("sh", { args: SLEEPER, stdout: "piped" });
  const pid = Number(await readFirstLine(sleeper.stdout));
  try {
    sleeper.kill("SIGKILL");
    assertEquals((await sleeper.status).code, 128 + 9);
    assert(await waitForExit(pid, 1_000), `guarded child ${pid} survived SIGKILL`);
  } finally {
    if (await isAlive(pid)) Deno.kill(pid, "SIGKILL");
  }
});
