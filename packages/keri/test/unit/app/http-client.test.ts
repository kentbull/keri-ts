import { call, run, suspend } from "effection";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { createServer, type Socket } from "node:net";
import { collectBytes } from "../../../src/app/byte-source.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { TransportError } from "../../../src/app/transport-error.ts";

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
      await assertRejects(() => run(() => client.request(url)));
    }
    for (const init of [{ method: "bad method" }, { headers: { "bad header": "x" } }, { method: "GET" }]) {
      await assertRejects(() =>
        run(() =>
          client.request("https://peer.test/", {
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
          client.request("https://peer.test/", {
            signal: controller.signal,
          })
        )
      ),
      cancelled,
    );
    assertEquals(requests, 0);
    await run(() => client.request("https://peer.test/", { headers: { Authorization: "Bearer test" } }));
    assertEquals(requests, 1);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("HTTP scope joins late headers and closes their unread body once", async () => {
  const original = globalThis.fetch;
  const started = Promise.withResolvers<void>();
  let cancelled = 0;
  globalThis.fetch = (input) =>
    new Promise((resolve) => {
      const request = input as Request;
      request.signal.addEventListener("abort", () =>
        resolve(
          new Response(
            new ReadableStream({
              cancel() {
                cancelled++;
              },
            }),
          ),
        ), { once: true });
      started.resolve();
    });
  try {
    const task = run(() => new FetchHttpClient().request("https://peer.test/"));
    await started.promise;
    await task.halt();
    assertEquals(cancelled, 1);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("HTTP consumer cancellation interrupts its blocked read and joins native cleanup", async () => {
  const original = globalThis.fetch;
  const started = Promise.withResolvers<void>();
  const closing = Promise.withResolvers<void>();
  const cleaned = Promise.withResolvers<void>();
  let exits = false;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          pull() {
            started.resolve();
          },
          async cancel() {
            closing.resolve();
            await cleaned.promise;
          },
        }, { highWaterMark: 0 }),
      ),
    );
  try {
    const task = run(function*() {
      const response = yield* new FetchHttpClient().request("https://peer.test/");
      yield* call(function*() {
        const controller = new AbortController();
        try {
          yield* call(() => collectBytes(response.body(controller.signal)));
        } finally {
          controller.abort();
        }
      });
    });
    await started.promise;
    const stopped = Promise.resolve(task.halt()).finally(() => exits = true);
    await closing.promise;
    assertEquals(exits, false);
    cleaned.resolve();
    await stopped;
  } finally {
    cleaned.resolve();
    globalThis.fetch = original;
  }
});

Deno.test("HTTP body failures retain native cause without duplicating cancellation's repeated cause", async () => {
  const original = globalThis.fetch;
  const fault = new Error("broken response");
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(fault);
          },
        }),
      ),
    );
  try {
    const error = await assertRejects(() =>
      run(function*() {
        const response = yield* new FetchHttpClient().request("https://peer.test/");
        yield* call(() => collectBytes(response.body()));
      }), TransportError);
    assertStrictEquals(error.cause, fault);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("HTTP scope preserves unread-body cleanup failure and late foreign fetch failure", async () => {
  const original = globalThis.fetch;
  const cleanup = new Error("cleanup failed"), foreign = new DOMException("foreign", "AbortError");
  try {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              throw cleanup;
            },
          }),
        ),
      );
    assertStrictEquals(
      await assertRejects(() => run(() => new FetchHttpClient().request("https://peer.test/"))),
      cleanup,
    );
    const started = Promise.withResolvers<void>();
    globalThis.fetch = (input) =>
      new Promise((_resolve, reject) => {
        (input as Request).signal.addEventListener("abort", () => reject(foreign), { once: true });
        started.resolve();
      });
    const task = run(function*() {
      yield* new FetchHttpClient().request("https://peer.test/");
      yield* suspend();
    });
    await started.promise;
    const failure = await assertRejects(() => task.halt(), TransportError);
    assertStrictEquals(failure.cause, foreign);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("HTTP cleanup preserves undefined rejection and keeps consumer errors outside transport classification", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              return Promise.reject(undefined);
            },
          }),
        ),
      );
    let completed = false;
    await run(() => new FetchHttpClient().request("https://peer.test/")).then(
      () => completed = true,
      (error) => assertStrictEquals(error, undefined),
    );
    assertEquals(completed, false);
    globalThis.fetch = () => Promise.resolve(new Response(new Uint8Array([1])));
    const fault = new TypeError("consumer failed");
    assertStrictEquals(
      await assertRejects(() =>
        run(function*() {
          const response = yield* new FetchHttpClient().request("https://peer.test/");
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
      return { status: response.status, bytes: yield* call(() => collectBytes(response.body())) };
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
