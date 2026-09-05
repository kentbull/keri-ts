import { assertEquals } from "jsr:@std/assert";

Deno.test("tufa HTTP cancellation retains signal handlers until actual adapter drain joins", async () => {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", new URL("./fixtures/http-signal-child.ts", import.meta.url).pathname],
    stdin: "piped",
    stdout: "piped",
    stderr: "inherit",
  }).spawn();
  const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  const writer = child.stdin.getWriter();
  let buffered = "";
  const line = async () => {
    while (!buffered.includes("\n")) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`Child exited before expected boundary: ${buffered}`);
      buffered += chunk.value;
    }
    const index = buffered.indexOf("\n");
    const result = buffered.slice(0, index);
    buffered = buffered.slice(index + 1);
    return result;
  };
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch { /* exited */ }
  }, 15000);
  try {
    assertEquals(await line(), "READY");
    await writer.write(new Uint8Array([1]));
    let boundary = await line();
    if (boundary === "HALTED") boundary = await line();
    assertEquals(boundary, "DRAINING");
    child.kill("SIGTERM");
    assertEquals(await line(), "SIGNAL");
    child.kill("SIGINT");
    assertEquals(await line(), "SIGNAL");
    await writer.write(new Uint8Array([2]));
    assertEquals(await line(), "HALTED");
    assertEquals(await line(), "DONE");
    assertEquals((await child.status).code, 0);
  } finally {
    clearTimeout(timer);
    try {
      child.kill("SIGKILL");
    } catch { /* exited */ }
    await child.status;
    await writer.close().catch(() => {});
    writer.releaseLock();
    await reader.cancel();
    reader.releaseLock();
  }
});
