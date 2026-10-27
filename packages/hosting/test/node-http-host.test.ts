import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { openDenoServerHost, openNodeServerHost } from "../src/host/http-server.ts";

for (const mode of ["failure", "foreign-abort", "owned-abort"] as const) {
  Deno.test(`Node HTTP host preserves late ${mode} provenance after headers`, async () => {
    const lifetime = new AbortController(), request = new AbortController();
    const listening = Promise.withResolvers<number>(), fail = Promise.withResolvers<void>();
    const fault = mode === "failure"
      ? new Error("late artifact read failed")
      : new DOMException("foreign body abort", "AbortError");
    const reported: unknown[] = [];
    const host = openNodeServerHost({
      port: 0,
      hostname: "127.0.0.1",
      signal: lifetime.signal,
      onListen: ({ port }) => listening.resolve(port),
      onError: (error) => {
        reported.push(error);
        return new Response(null, { status: 500 });
      },
    }, (inbound) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(Uint8Array.of(1));
            },
            async pull(controller) {
              await fail.promise;
              controller.error(mode === "owned-abort" ? inbound.signal.reason : fault);
            },
          }),
          { headers: { "Content-Length": "2" } },
        ),
      ));
    const client = Deno.createHttpClient({});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await fetch(`http://127.0.0.1:${await listening.promise}/`, { client, signal: request.signal });
      assertEquals(response.status, 200);
      if (mode !== "failure") lifetime.abort(new DOMException("host shutdown", "AbortError"));
      fail.resolve();
      await assertRejects(() =>
        Promise.race([
          response.arrayBuffer(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Failed body did not terminate")), 1000);
          }),
        ]), TypeError);
      assertEquals(reported.length, mode === "owned-abort" ? 0 : 1);
      if (mode !== "owned-abort") assertStrictEquals(reported[0], fault);
    } finally {
      clearTimeout(timer);
      fail.resolve();
      request.abort();
      host.close();
      lifetime.abort();
      await host.server.finished;
      client.close();
    }
  });
}

// Both platform close events precede asynchronous handler cleanup after a peer disconnects.
for (const [name, open] of [["Node", openNodeServerHost], ["Deno", openDenoServerHost]] as const) {
  Deno.test(`${name} HTTP host joins request cleanup after its socket closes`, async () => {
    const lifetime = new AbortController();
    const disconnected = new AbortController();
    const listening = Promise.withResolvers<number>();
    const entered = Promise.withResolvers<void>();
    const cancelling = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    const host = open({
      port: 0,
      hostname: "127.0.0.1",
      signal: lifetime.signal,
      onListen: ({ port }) => listening.resolve(port),
      onError: () => new Response(null, { status: 500 }),
    }, async (request) => {
      entered.resolve();
      // Simulate an owned parser/sink whose asynchronous cleanup outlives the disconnected socket.
      await new Promise<void>((resolve) => request.signal.addEventListener("abort", () => resolve(), { once: true }));
      cancelling.resolve();
      await cleanup.promise;
      return new Response(null, { status: 204 });
    });
    let finished = false;
    host.server.finished.then(() => {
      finished = true;
    });
    const client = Deno.createHttpClient({});
    let response: Promise<unknown> | undefined;
    try {
      const port = await listening.promise;
      response = fetch(`http://127.0.0.1:${port}/`, { client, signal: disconnected.signal }).catch(() => {});
      await entered.promise;
      host.close();
      lifetime.abort();
      disconnected.abort();
      await cancelling.promise;
      // A scheduling turn lets Node emit close; the owner must remain pending behind the cleanup gate.
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(finished, false);
      cleanup.resolve();
      await host.server.finished;
      assertEquals(finished, true);
    } finally {
      cleanup.resolve();
      disconnected.abort();
      lifetime.abort();
      await response;
      await host.server.finished;
      client.close();
    }
  });
}

Deno.test("Node HTTP host cancellation before listening closes the pending listener", async () => {
  const lifetime = new AbortController();
  let announced = false;
  const host = openNodeServerHost({
    port: 0,
    hostname: "127.0.0.1",
    signal: lifetime.signal,
    onListen: () => {
      announced = true;
    },
    onError: () => new Response(null, { status: 500 }),
  }, () => Promise.resolve(new Response(null, { status: 204 })));
  // No scheduling yield: exercise cancellation while Node's listen() is still pending.
  host.close();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      host.server.finished,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Pending listener was not closed")), 1000);
      }),
    ]);
    assertEquals(announced, false);
  } finally {
    clearTimeout(timer);
    // A second close also leaves a pre-fix failure unable to leak its listener into later tests.
    host.close();
    lifetime.abort();
    await host.server.finished;
  }
});
