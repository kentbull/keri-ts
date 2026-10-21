import { call, ensure, run, suspend } from "effection";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { createServer, type Socket } from "node:net";
import { abortable } from "../../../../src/app/runtime/abortable.ts";
import { collectBytes } from "../../../../src/app/transport/byte-source.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { TransportError } from "../../../../src/app/transport/transport-error.ts";

Deno.test("HTTP validates prepared requests before fetch", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = () => {
    requests++;
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const client = new FetchHttpClient();
  try {
    for (const url of ["not a URL", "file:///tmp/test", "https://user:pass@peer.test/"]) {
      await assertRejects(() => run(() => client.open(url)));
    }
    for (const init of [{ method: "bad method" }, { headers: { "bad header": "x" } }, { method: "GET" }]) {
      await assertRejects(() =>
        run(() =>
          client.open("https://peer.test/", {
            ...init,
            body: new Uint8Array([1]),
          })
        )
      );
    }
    assertEquals(requests, 0);
    const controller = new AbortController();
    const cancelled = new Error("already cancelled");
    controller.abort(cancelled);
    assertStrictEquals(
      await assertRejects(() =>
        run(() =>
          client.open("https://peer.test/", {
            signal: controller.signal,
          })
        )
      ),
      cancelled,
    );
    assertEquals(requests, 0);
    await run(() => client.open("https://peer.test/", { headers: { Authorization: "Bearer test" } }));
    assertEquals(requests, 1);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("finite HTTP responses finish cleanup before their bytes return", async () => {
  const original = globalThis.fetch;
  let signal: AbortSignal | undefined;
  globalThis.fetch = (input) => {
    signal = (input as Request).signal;
    return Promise.resolve(new Response("complete"));
  };
  try {
    await run(function*() {
      const response = yield* new FetchHttpClient().request("https://peer.test/");
      assertEquals(signal?.aborted, true);
      assertEquals(new TextDecoder().decode(response.body), "complete");
    });
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("HTTP consumer errors retain their identity outside transport classification", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = () => Promise.resolve(new Response(new Uint8Array([1])));
    const fault = new TypeError("consumer failed");
    assertStrictEquals(
      await assertRejects(() =>
        run(function*() {
          const response = yield* new FetchHttpClient().open("https://peer.test/");
          yield* call(async () => {
            for await (const _chunk of response.body()) throw fault;
          });
        })
      ),
      fault,
    );
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("native HTTP body EOF, truncation and manual redirects share one request owner", async () => {
  const sockets = new Set<Socket>();
  let mode = "delayed", requests = 0;
  const opened = Promise.withResolvers<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    socket.once("data", () => {
      requests++;
      if (mode === "delayed") {
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nx");
        opened.resolve(socket);
      } else if (mode === "truncated") socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nx");
      else socket.end("HTTP/1.1 307 Temporary Redirect\r\nLocation: /next\r\nContent-Length: 0\r\n\r\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const read = () =>
    run(function*() {
      const response = yield* new FetchHttpClient().request(url, { redirect: "manual" });
      return { status: response.status, bytes: response.body };
    });
  try {
    let complete = false;
    const pending = read().then((result) => {
      complete = true;
      return result;
    });
    const socket = await opened.promise;
    assertEquals(complete, false);
    socket.end("y");
    assertEquals((await pending).bytes, new Uint8Array([120, 121]));
    mode = "truncated";
    const failure = await assertRejects(read, TransportError);
    assertEquals(failure.cause instanceof Error, true);
    mode = "redirect";
    assertEquals((await read()).status, 307);
    assertEquals(requests, 3);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

for (const mode of ["headers", "unread", "blocked", "early", "external"] as const) {
  Deno.test(`native HTTP ${mode} cancellation releases its request before owner teardown`, async () => {
    const started = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      socket.once("close", () => sockets.delete(socket));
      socket.once("data", () => {
        socket.once("close", () => closed.resolve());
        if (mode === "headers") started.resolve();
        else socket.write("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nx");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    let consumerJoined = mode !== "blocked";
    let ownerClosed = false;
    const external = new AbortController();
    const reason = new Error("request canceled externally");
    const task = run(function*() {
      // Register a dependent owner before the request and consumer children, like runtime stores.
      yield* ensure(function*() {
        assertEquals(consumerJoined, true);
        ownerClosed = true;
      });
      const response = yield* new FetchHttpClient().open(url, { signal: external.signal });
      if (mode === "unread") {
        started.resolve();
        yield* suspend();
      } else {
        yield* abortable(async (signal) => {
          try {
            for await (const chunk of response.body(signal)) {
              assertEquals(chunk[0], 120);
              started.resolve();
              if (mode === "early") break;
            }
          } finally {
            consumerJoined = true;
          }
        });
      }
    });
    try {
      await started.promise;
      if (mode === "early") await task;
      else if (mode === "external") {
        external.abort(reason);
        assertStrictEquals(await assertRejects(() => task), reason);
      } else await task.halt();
      assertEquals(ownerClosed, true);
      await closed.promise;
    } finally {
      await task.halt();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}
