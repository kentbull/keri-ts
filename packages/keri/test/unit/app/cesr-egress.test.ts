import {
  b,
  concatBytes,
  Counter,
  decodeB64,
  parse,
  t,
  Texter,
} from "cesr-ts";
import type { CesrFrame } from "cesr-ts";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { createServer, type Socket } from "node:net";
import { call, run, suspend } from "npm:effection@^3.6.0";
import { KERIPY_V1_JSON_ICP_BODY as json } from "../../../../cesr/test/fixtures/external-vectors.ts";
import vectors from "../../../../cesr/test/fixtures/nested-vectors.json" with { type: "json" };
import { chunkBytes } from "../../../src/app/byte-source.ts";
import { attemptPostCesr, CesrHttpRefusal, postCesr, requestFrame } from "../../../src/app/cesr-egress.ts";
import { CESR_ATTACHMENT_HEADER } from "../../../src/app/cesr-http.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { HTTPMessenger } from "../../../src/app/http-messenger.ts";
import { HTTPQuery } from "../../../src/app/http-query.ts";
import { HTTPStreamMessenger } from "../../../src/app/http-stream-messenger.ts";
import { messengerFrom, streamMessengerFrom } from "../../../src/app/messengering.ts";
import { createProtocolProcessor } from "../../../src/app/protocol-processing.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { TCPMessenger } from "../../../src/app/tcp-messenger.ts";
import { TCPStreamMessenger } from "../../../src/app/tcp-stream-messenger.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";

import { sendCesrTcpFrame } from "../../../src/app/tcp-egress.ts";
import { TransportError } from "../../../src/app/transport-error.ts";
import { httpClient, type TestHttpResponder } from "../../support/http-client.ts";

/** One v2 enclosure around a v1 JSON body and two small ESSR fragments. */
function fixture(): Uint8Array {
  // Wrapping the non-native body keeps binary source qualification independent of its JSON bytes.
  const version = { major: 2, minor: 0 } as const;
  const body = Counter.enclose({
    code: "NonNativeBodyGroup",
    qb64: new Texter({ code: "4B", raw: b(json) }).qb64,
    version,
  });
  const essr = Counter.enclose({ code: "ESSRPayloadGroup", qb64: "4BABYWJj4BABeHl6", version });
  return concatBytes(
    Counter.makeGVC(version),
    Counter.enclose({ code: "BodyWithAttachmentGroup", qb64: t(body) + t(essr), version }),
  );
}

/** Return one fixture frame for a request-resource test. */
async function read(bytes: Uint8Array): Promise<CesrFrame> {
  // Only this test's finite fixture is collected; production readers request frames individually.
  const parser = parse(chunkBytes(bytes));
  try {
    const result = await parser.next();
    assertEquals(result.done, false);
    return result.value as CesrFrame;
  } finally {
    await parser.return(undefined);
  }
}

Deno.test("CESR cancellation preserves a late foreign fetch failure through joined cleanup", async () => {
  for (const failure of [new Error("late fetch I/O"), new DOMException("foreign abort", "AbortError")]) {
    const frame = await read(fixture());
    const ready = Promise.withResolvers<void>();
    let rejectFetch!: () => void;
    const task = run(function*() {
      yield* requestFrame(
        "https://peer.test/",
        frame,
        httpClient((_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init!.signal!.addEventListener("abort", () => rejectFetch = () => reject(failure), { once: true });
            ready.resolve();
          })
        ),
        {},
      );
    });
    try {
      await ready.promise;
      const stopped = Promise.resolve(task.halt());
      void stopped.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 0));
      rejectFetch();
      assertStrictEquals(await assertRejects(() => stopped), failure);
    } finally {
      rejectFetch?.();
      await task.halt().catch(() => {});
    }
  }
});
Deno.test("CESR cancellation preserves late success-body and diagnostic cleanup failures", async () => {
  for (const status of [200, 400]) {
    for (const failure of [new Error("response cleanup failed"), undefined]) {
      const frame = await read(fixture());
      const reading = Promise.withResolvers<void>();
      const cleanup = Promise.withResolvers<void>();
      const response = new Response(
        new ReadableStream<Uint8Array>({
          pull() {
            reading.resolve();
          },
          cancel() {
            return cleanup.promise;
          },
        }, { highWaterMark: 0 }),
        { status },
      );
      const transport = httpClient(() => Promise.resolve(response));
      const task = run(function*() {
        if (status === 200) {
          yield* postCesr("https://peer.test/", (signal) => chunkBytes(fixture(), { signal }), transport, {});
        } else yield* requestFrame("https://peer.test/", frame, transport, {});
      });
      try {
        await reading.promise;
        const stopped = Promise.resolve(task.halt());
        void stopped.catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 0));
        cleanup.reject(failure);
        let succeeded = false;
        await stopped.then(() => succeeded = true, (error) => assertStrictEquals(error, failure));
        assertEquals(succeeded, false, `HTTP ${status}: an undefined cleanup rejection is still a failure`);
      } finally {
        cleanup.resolve();
        await task.halt().catch(() => {});
      }
    }
  }
});
Deno.test("CESR egress waits for each request before consuming the next frame", async () => {
  // The first HTTP request controls whether the second parser output may be requested.
  const opened = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let pulls = 0;
  let requests = 0;
  let closed = false;
  const transport = httpClient(async (_url, init) => {
    // Ordinary POSTs carry the original signed body and detached text attachments.
    const bytes = new Uint8Array(await new Response(init!.body).arrayBuffer());
    const header = new Headers(init!.headers).get(CESR_ATTACHMENT_HEADER)!;
    const frame = await read(concatBytes(Counter.makeGVC({ major: 2, minor: 0 }), bytes, b(header)));

    assertEquals(concatBytes(...frame.essrs!.map((part) => part.raw)), b("abcxyz"));
    if (++requests === 1) {
      opened.resolve();
      await release.promise;
    }
    return new Response(null, { status: 204 });
  });
  const task = run(function*() {
    yield* postCesr(
      "https://peer.test/",
      async function*(signal) {
        try {
          pulls++;
          yield fixture();
          signal.throwIfAborted();
          pulls++;
          yield fixture();
        } finally {
          closed = true;
        }
      },
      transport,
      {},
    );
  });
  await Promise.race([opened.promise, task]);
  assertEquals(pulls, 1);
  release.resolve();
  await task;
  assertEquals([pulls, requests, closed], [2, 2, true]);
});
Deno.test("CESR header egress normalizes binary attachments for HTTP", async () => {
  // The source is binary v2 while the detached JSON body independently declares protocol v1.
  const wire = decodeB64(t(fixture()));
  let requests = 0;
  const transport = httpClient(async (_url, init) => {
    // Text qualification is mandatory in HTTP headers, including when input was qb2.
    const header = new Headers(init!.headers).get(CESR_ATTACHMENT_HEADER)!;
    assertEquals(/^[A-Za-z0-9_-]+$/.test(header), true);
    const body = new Uint8Array(await new Response(init!.body).arrayBuffer());
    // The peer's counter context is v2; the JSON body protocol does not select it.
    const frame = await read(concatBytes(Counter.makeGVC({ major: 2, minor: 0 }), body, b(header)));

    assertEquals(frame.body.pvrsn, { major: 1, minor: 0 });
    assertEquals(frame.gvrsn, { major: 2, minor: 0 });
    assertEquals(concatBytes(...frame.essrs!.map((part) => part.raw)), b("abcxyz"));
    requests++;
    return new Response(null, { status: 204 });
  });
  await run(function*() {
    yield* postCesr("https://peer.test/", (signal) => chunkBytes(wire, { signal }), transport, {});
  });
  assertEquals(requests, 1);
});
Deno.test("CESR request scope keeps successful responses live and cancels their unread tail", async () => {
  // A response remains readable until the consuming Operation finishes, then its resource closes.
  const frame = await read(fixture());
  let cancelled = false;
  await run(function*() {
    const response = yield* requestFrame(
      "https://peer.test/",
      frame,
      httpClient(() =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              /** One response byte proves headers returning did not prematurely abort the body. */
              start(controller) {
                controller.enqueue(Uint8Array.of(7));
              },
              /** Scope exit must close the otherwise unfinished peer response. */
              cancel() {
                cancelled = true;
              },
            }),
          ),
        )
      ),
      {},
    );
    const reader = response.body()[Symbol.asyncIterator]();
    assertEquals((yield* call(() => reader.next())).value, Uint8Array.of(7));
    assertEquals(cancelled, false);
  });
  assertEquals(cancelled, true);

  for (const failure of [new Error("response cleanup failed"), new DOMException("foreign cleanup", "AbortError")]) {
    const observed = await assertRejects(
      () =>
        run(() =>
          requestFrame(
            "https://peer.test/",
            frame,
            httpClient(() =>
              Promise.resolve(
                new Response(
                  new ReadableStream({
                    /** Foreign same-class abort and ordinary I/O cleanup failures retain identity. */
                    cancel() {
                      throw failure;
                    },
                  }),
                ),
              )
            ),
            {},
          )
        ),
    );
    assertStrictEquals(observed, failure);
  }
  let ownSignal: AbortSignal | undefined;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (request) => {
    await request.arrayBuffer();
    return new Response(
      new ReadableStream({
        /** Keep a real successful response body unread when the request scope returns. */
        start(controller) {
          controller.enqueue(Uint8Array.of(7));
        },
      }),
      { status: 202 },
    );
  });
  try {
    await run(function*() {
      const response = yield* requestFrame(
        `http://127.0.0.1:${server.addr.port}/`,
        frame,
        httpClient((url, init) => {
          ownSignal = init!.signal!;
          return fetch(url, init);
        }),
        {},
      );
      assertEquals(response.status, 202);
      assertEquals(ownSignal!.aborted, false, "successful headers keep the response live");
    });
    assertEquals(ownSignal!.aborted, true, "normal scope cleanup intentionally aborts its fetch");
  } finally {
    await server.shutdown();
  }
});
Deno.test("CESR failed-response diagnostics join asynchronous cancellation", async () => {
  const frame = await read(fixture());
  const reading = Promise.withResolvers<void>(), cancelling = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  const controller = new AbortController();
  let joined = false, calls = 0;
  const sending = run(() =>
    requestFrame(
      "https://peer.test/",
      frame,
      httpClient(() =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              /** Keep diagnostics pending until the request is cancelled. */
              pull() {
                reading.resolve();
              },
              /** The request scope must join this first asynchronous cancellation. */
              async cancel() {
                calls++;
                cancelling.resolve();
                await cleanup.promise;
                joined = true;
              },
            }, { highWaterMark: 0 }),
            { status: 500 },
          ),
        )
      ),
      { signal: controller.signal },
    )
  );
  let settled = false;
  const rejected = assertRejects(() => sending, Error).finally(() => settled = true);
  try {
    await reading.promise;
    controller.abort();
    await cancelling.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals([settled, joined], [false, false]);
  } finally {
    cleanup.resolve();
    await rejected;
  }
  assertEquals([calls, joined], [1, true]);
});
Deno.test("ordinary CESR delivery negotiates only the supported legacy header media", async () => {
  const frame = await read(fixture());
  const types: string[] = [];
  const transport = httpClient(async (_url, init) => {
    await new Response(init!.body).arrayBuffer();
    types.push(new Headers(init!.headers).get("Content-Type")!);
    return types.length === 1
      ? new Response("Unsupported content type", { status: 406 })
      : new Response(null, { status: 204 });
  });
  await run(function*() {
    yield* requestFrame("https://peer.test/", frame, transport);
  });
  assertEquals(types, ["application/cesr", "application/cesr+json"]);
});

Deno.test("halting CESR delivery closes input and never resumes the caller after payload cleanup", async () => {
  // A pending HTTP leaf supplies the cancellation boundary after the parser transfers one frame.
  const blocked = Promise.withResolvers<void>();
  let closed = false;
  let continued = false;
  const closing = Promise.withResolvers<void>(), cleanup = Promise.withResolvers<void>();
  const task = run(function*() {
    yield* postCesr(
      "https://peer.test/",
      async function*() {
        try {
          yield fixture();
        } finally {
          closing.resolve();
          await cleanup.promise;
          closed = true;
        }
      },
      httpClient((_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
          blocked.resolve();
        })
      ),
      {},
    );
    continued = true;
  });
  await blocked.promise;
  const halting = Promise.resolve(task.halt());
  try {
    await closing.promise;
    assertEquals([closed, continued], [false, false]);
  } finally {
    cleanup.resolve();
    await halting;
  }
  assertEquals(closed, true);
  assertEquals(continued, false);
});

Deno.test("CESR input cancellation also aborts the request consuming its delivered frame", async () => {
  const controller = new AbortController();
  const request = Promise.withResolvers<void>();
  let aborted = false;
  const transport = httpClient((_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      // The input is suspended during HTTP delivery; its cancellation still reaches this pending request.
      init!.signal!.addEventListener("abort", () => {
        aborted = true;
        reject(init!.signal!.reason);
      }, { once: true });
      request.resolve();
    })
  );
  const sending = run(function*() {
    yield* postCesr("https://peer.test/", (signal) => chunkBytes(fixture(), { signal }), transport, {
      signal: controller.signal,
    });
  });
  await request.promise;
  controller.abort();
  try {
    await assertRejects(() => sending);
    assertEquals(aborted, true);
  } finally {
    await sending.halt();
  }
});

Deno.test("external HTTP query cancellation stops an accepted EXN handler and joins response cleanup", async () => {
  for (const cleanupFailure of [undefined, new Error("late response cleanup failure")]) {
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const sender = hby.makeHab("sender"), protocol = createProtocolProcessor(hby);
      const serder = exchange("/cancel", {}, { sender: sender.pre })[0];
      const wire = sender.endorse(serder);
      const ready = Promise.withResolvers<void>(), controller = new AbortController();
      const reason = new Error("stop query handler");
      let closed = false, handlerClosed = false, resumed = false;
      protocol.exc.addHandler({
        resource: "/cancel",
        *handle() {
          try {
            ready.resolve();
            yield* suspend();
            resumed = true;
          } finally {
            handlerClosed = true;
          }
        },
      });
      const messenger = new HTTPQuery(
        protocol,
        httpClient(() =>
          Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(body) {
                  // A following body completes the first frame without closing the response.
                  body.enqueue(concatBytes(wire, wire));
                },
                cancel() {
                  closed = true;
                  if (cleanupFailure) throw cleanupFailure;
                },
              }),
            ),
          )
        ),
        systemClock,
      );
      const task = run(function*() {
        yield* messenger.query("https://peer.test/", fixture(), { signal: controller.signal });
        resumed = true;
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        yield* call(() =>
          Promise.race([
            ready.promise,
            task,
            new Promise<never>((_, reject) =>
              timer = setTimeout(() => reject(new Error("query handler not reached")), 1000)
            ),
          ])
        );
        clearTimeout(timer);
        assertEquals(protocol.exc.complete(serder.said!), true, "handler runs after accepted evidence commits");
        controller.abort(reason);
        const failure = yield* call(() =>
          assertRejects(() =>
            Promise.race([
              task,
              new Promise<never>((_, reject) =>
                timer = setTimeout(() => reject(new Error("query handler still active")), 1000)
              ),
            ])
          )
        );
        assertStrictEquals(failure, cleanupFailure ?? reason);
        assertEquals([closed, handlerClosed, resumed], [true, true, false]);
      } finally {
        clearTimeout(timer);
        yield* call(() => task.halt().catch(() => {}));
        yield* hby.close(true);
      }
    });
  }
});

Deno.test("HTTP query sends each valid frame before parsing a later malformed frame", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    let requests = 0;
    const messenger = new HTTPQuery(
      createProtocolProcessor(hby),
      httpClient(() => {
        requests++;
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
      systemClock,
    );
    try {
      yield* call(() =>
        assertRejects(() => run(() => messenger.query("https://peer.test/", concatBytes(fixture(), b("!")))))
      );
      assertEquals(requests, 1);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("CESR transport headers preserve authorization without replacing frame metadata", async () => {
  await run(function*() {
    yield* postCesr(
      "https://peer.test/",
      (signal) => chunkBytes(b(json), { signal }),
      httpClient((_url, init) => {
        const headers = new Headers(init?.headers);
        assertEquals(headers.get("Authorization"), "Bearer fixture");
        // Extra HTTP metadata cannot override the serializer's own attachment or routing fields.
        assertEquals(headers.get("Content-Type"), "application/cesr");
        assertEquals(headers.get("CESR-DESTINATION"), "actual-peer");
        assertEquals(headers.get("CESR-ATTACHMENT"), "-VAA");
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
      {
        destination: "actual-peer",
        headers: {
          Authorization: "Bearer fixture",
          "Content-Type": "text/plain",
          "CESR-DESTINATION": "stale-peer",
          "CESR-ATTACHMENT": "stale-attachment",
        },
      },
    );
  });
});
Deno.test("TCP frame output preserves nested body, genus, signatures and ESSR evidence", async () => {
  const frame = await read(b(vectors.rows.find((row) => row.name === "child-genus-selector")!.qb64));
  const child = frame.nests![0], payloadFrame = await read(fixture());
  child.essrs = payloadFrame.essrs;
  const sockets = new Set<Socket>(), received = Promise.withResolvers<CesrFrame>();
  let connections = 0;
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    const connection = ++connections;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    // This signed fixture is finite; the production writer never collects its source.
    const bytes = new Uint8Array(16384);
    let length = 0;
    socket.on("data", (part) => {
      bytes.set(part, length);
      length += part.length;
    });
    socket.once("end", async () => {
      try {
        if (connection === 1) received.resolve(await read(bytes.subarray(0, length)));
        socket.end();
      } catch (error) {
        received.reject(error);
        socket.destroy();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `tcp://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await run(() => sendCesrTcpFrame(url, frame, systemClock, { maxChunkBytes: 7 }));
    const roundtrip = await received.promise;
    {
      for (const [actual, expected] of [[roundtrip, frame], [roundtrip.nests![0], child]]) {
        assertEquals(actual.body.raw, expected.body.raw);
        assertEquals(actual.gvrsn, expected.gvrsn);
        assertEquals(actual.attachments.map((group) => group.raw), expected.attachments.map((group) => group.raw));
      }
      assertEquals(concatBytes(...roundtrip.nests![0].essrs!.map((part) => part.raw)), b("abcxyz"));
    }
    assertEquals(child.essrs, payloadFrame.essrs);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
Deno.test("transport attempt excludes identical typed errors from source, injected fetch, body and cleanup", async () => {
  for (
    const failure of [
      new CesrHttpRefusal("external failure", 503),
      new Error("foreign transport failure"),
      new TypeError("foreign TypeError"),
    ]
  ) {
    for (const origin of ["source", "fetch", "body", "cleanup", "peer"] as const) {
      let requests = 0;
      const transport = httpClient(async (_url, init) => {
        await new Response(init!.body).arrayBuffer();
        requests++;
        if (origin === "fetch") throw failure;
        if (origin === "body") {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(failure);
              },
            }),
          );
        }
        if (origin === "cleanup") return new Response(null, { status: 204 });
        return new Response("peer refusal", { status: 503 });
      });
      const send = () =>
        run(() =>
          attemptPostCesr(
            "https://peer.test/",
            async function*() {
              if (origin === "source") throw failure;
              try {
                yield fixture();
              } finally {
                // deno-lint-ignore no-unsafe-finally -- Preserve a source cleanup failure after successful HTTP I/O.
                if (origin === "cleanup") throw failure;
              }
            },
            transport,
            {},
          )
        );
      if (origin === "peer") {
        const result = await send();
        if (result.kind !== "refuse" || !(result.error instanceof CesrHttpRefusal)) {
          throw new Error("Expected peer refusal result");
        }
        assertEquals(result.error.status, 503);
      } else {
        assertStrictEquals(await assertRejects(send), failure);
        if (origin === "source") assertEquals(requests, 0);
      }
    }
  }
});
Deno.test("HTTP attempt reports peer refusal and preserves foreign transport failure with simultaneous abort", async () => {
  let transport = httpClient(async (_url, init) => {
    await new Response(init!.body).arrayBuffer();
    return new Response(null, { status: 204 });
  });
  const send = (signal?: AbortSignal) =>
    run(() =>
      attemptPostCesr("https://peer.test/", (signal) => chunkBytes(fixture(), { signal }), transport, {
        destination: "aid",
        signal,
      })
    );
  assertEquals(await send(), { kind: "complete" });
  transport = httpClient(async (_url, init) => {
    await new Response(init!.body).arrayBuffer();
    return new Response("peer refusal", { status: 503 });
  });
  assertEquals((await send()).kind, "refuse");

  const failure = new Error("foreign transport failure");
  const controller = new AbortController();
  transport = httpClient(() => {
    controller.abort();
    return Promise.reject(failure);
  });
  assertStrictEquals(
    await assertRejects(() => send(controller.signal)),
    failure,
  );
});

Deno.test("native HTTP completion drains the response and neither redirects nor replays failed sends", async () => {
  const sockets = new Set<Socket>();
  let mode = "delayed", requests = 0;
  const started = Promise.withResolvers<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    socket.once("data", () => {
      requests++;
      if (mode === "delayed") {
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nx");
        started.resolve(socket);
      } else if (mode === "truncated") {
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nx");
      } else if (mode === "chunked") {
        socket.end("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n2\r\nx");
      } else if (mode === "redirect") {
        socket.end(
          "HTTP/1.1 307 Temporary Redirect\r\nLocation: /redirect-target\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
      } else {
        socket.end("HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const messenger = new HTTPMessenger(url, new FetchHttpClient());
  const send = () => run(() => messenger.send(fixture()));
  try {
    let completed = false;
    const pending = send().then((result) => {
      completed = true;
      return result;
    });
    const socket = await started.promise;
    await new Promise((resolve) => setTimeout(resolve, 10));
    assertEquals(completed, false, "success headers and a partial body are not HTTP completion");
    socket.end("y");
    assertEquals(await pending, { kind: "complete" });
    assertEquals(requests, 1);
    for (mode of ["truncated", "chunked"]) {
      const failure = await assertRejects(send, TransportError, "response body failed");
      assertEquals(failure.cause instanceof Error, true, "the native body failure remains the cause");
    }
    for (mode of ["redirect", "refused"]) {
      const result = await send();
      assertEquals(result.kind, "refuse");
      if (result.kind === "refuse") assertEquals(result.error.status, mode === "redirect" ? 307 : 503);
    }
    assertEquals(requests, 5, "each call makes exactly one request, including redirects and truncation");
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  const failure = await assertRejects(send, TransportError, "HTTP request failed");
  assertEquals(failure.cause instanceof Error, true, "native connection refusal retains its cause");
  const cleanup = new Error("source cleanup failed after native connection refusal");
  const combined = await assertRejects(
    () =>
      run(() =>
        messenger.sendSource(async function*() {
          try {
            yield fixture();
          } finally {
            // deno-lint-ignore no-unsafe-finally -- Exercise a distinct failure while joining the source.
            throw cleanup;
          }
        })
      ),
    AggregateError,
    "delivery and source cleanup failed",
  );
  assertEquals(combined.errors.length, 2);
  assertEquals(combined.errors[0] instanceof TransportError, true);
  assertEquals(combined.errors[0].cause instanceof Error, true);
  assertStrictEquals(combined.errors[1], cleanup);
  assertStrictEquals(combined.cause, combined.errors[0]);
});

Deno.test("messenger construction selects concrete endpoints before I/O without identity preferences", () => {
  let requests = 0;
  const http = httpClient(() => {
    requests++;
    return new Response(null, { status: 204 });
  });
  for (
    const [urls, expected, ordinaryType, streamType] of [
      [
        { https: "https://peer.test/good", http: "http://peer.test/other", tcp: "tcp://localhost:1234" },
        "https://peer.test/good",
        HTTPMessenger,
        HTTPStreamMessenger,
      ],
      [
        { http: "http://peer.test/good", tcp: "tcp://localhost:1234" },
        "http://peer.test/good",
        HTTPMessenger,
        HTTPStreamMessenger,
      ],
      [{ tcp: "tcp://localhost:1234" }, "tcp://localhost:1234", TCPMessenger, TCPStreamMessenger],
    ] as const
  ) {
    const ordinary = messengerFrom("recipient", urls, http, systemClock);
    const stream = streamMessengerFrom("recipient", urls, fixture(), http, systemClock);
    assertEquals(ordinary instanceof ordinaryType, true);
    assertEquals(stream instanceof streamType, true);
    assertEquals([ordinary.url, stream.url], [expected, expected]);
  }
  for (const urls of [{}, { https: "http://peer.test/" }, { tcp: "tcp://localhost:0" }]) {
    assertThrows(() => messengerFrom("recipient", urls, http, systemClock));
    assertThrows(() => streamMessengerFrom("recipient", urls, fixture(), http, systemClock));
  }
  assertEquals(requests, 0);
});

Deno.test("ordinary factory sends ordered signed POSTs with destination and authentication", async () => {
  const requests: Array<{ method: string; body: Uint8Array; headers: Headers }> = [];
  const http = httpClient(async (url, init) => {
    assertEquals(url, "https://peer.test/good");
    requests.push({
      method: init!.method!,
      body: new Uint8Array(await new Response(init!.body).arrayBuffer()),
      headers: new Headers(init!.headers),
    });
    return new Response(null, { status: 204 });
  });
  const messenger = messengerFrom("provider", { https: "https://peer.test/good" }, http, systemClock, {
    Authorization: "witness-code",
  });
  if (!(messenger instanceof HTTPMessenger)) throw new Error("Expected ordinary HTTP messenger");
  const result = await run(() => messenger.send(concatBytes(fixture(), b(json))));
  assertEquals(result, { kind: "complete" });
  assertEquals(requests.map(request => request.method), ["POST", "POST"]);
  assertEquals(requests.map(request => request.body), [b(json), b(json)]);
  for (const request of requests) {
    assertEquals(request.headers.get("CESR-DESTINATION"), "provider");
    assertEquals(request.headers.get("Authorization"), "witness-code");
    assertEquals(request.headers.get("Content-Type"), "application/cesr");
  }
  const first = await read(concatBytes(
    Counter.makeGVC({ major: 2, minor: 0 }),
    requests[0].body,
    b(requests[0].headers.get(CESR_ATTACHMENT_HEADER)!),
  ));
  assertEquals(concatBytes(...first.essrs!.map(part => part.raw)), b("abcxyz"));
  const second = await read(concatBytes(
    Counter.makeGVC({ major: 2, minor: 0 }),
    requests[1].body,
    b(requests[1].headers.get(CESR_ATTACHMENT_HEADER)!),
  ));
  assertEquals(second.essrs?.length ?? 0, 0);
});

Deno.test("stream factory sends one exact binary PUT and returns owned response bytes without POST fallback", async () => {
  const payload = concatBytes(b(json), decodeB64(t(fixture())), decodeB64(t(fixture())));
  let requests = 0;
  const http = httpClient(async (url, init) => {
    requests++;
    assertEquals(url, "https://peer.test/good");
    assertEquals(init!.method, "PUT");
    assertEquals(init!.redirect, "manual");
    assertEquals(new Uint8Array(await new Response(init!.body).arrayBuffer()), payload);
    const headers = new Headers(init!.headers);
    assertEquals(headers.get("Content-Length"), String(payload.byteLength));
    assertEquals(headers.get("Content-Type"), "application/cesr");
    assertEquals(headers.get("CESR-DESTINATION"), "provider");
    assertEquals(headers.get("Authorization"), "witness-code");
    assertEquals(headers.has(CESR_ATTACHMENT_HEADER), false);
    return new Response("owned response", { status: requests === 1 ? 200 : 406 });
  });
  const messenger = streamMessengerFrom("provider", { https: "https://peer.test/good" }, payload, http, systemClock, {
    Authorization: "witness-code",
    "Content-Type": "incorrect",
    [CESR_ATTACHMENT_HEADER]: "incorrect",
  });
  if (!(messenger instanceof HTTPStreamMessenger)) throw new Error("Expected HTTP stream messenger");
  const accepted = await run(() => messenger.send());
  assertEquals([accepted.status, accepted.ok, t(accepted.body)], [200, true, "owned response"]);
  const refused = await run(() => messenger.send());
  assertEquals([refused.status, refused.ok, t(refused.body)], [406, false, "owned response"]);
  assertEquals(requests, 2, "one request per explicit send, including content-type refusal");
});

Deno.test("TCP stream factory admits its full payload and completes without waiting for remote EOF", async () => {
  const payload = concatBytes(fixture(), decodeB64(t(fixture())), b(json));
  const received = Promise.withResolvers<Uint8Array>();
  const sockets = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket);
    socket.on("error", () => {});
    const chunks: Uint8Array[] = [];
    socket.on("data", chunk => chunks.push(chunk.slice()));
    socket.once("end", () => received.resolve(concatBytes(...chunks)));
    // Leave the receiving side open. Delivery must not require this peer to end it.
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `tcp://127.0.0.1:${(server.address() as { port: number }).port}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const messenger = streamMessengerFrom("peer", { tcp: url }, payload, new FetchHttpClient(), systemClock);
    if (!(messenger instanceof TCPStreamMessenger)) throw new Error("Expected TCP stream messenger");
    const [, bytes] = await Promise.race([
      Promise.all([run(() => messenger.send({ maxChunkBytes: 7 })), received.promise]),
      new Promise<never>((_, reject) =>
        timer = setTimeout(() => reject(new Error("stream waited for peer EOF")), 2000)
      ),
    ]);
    assertEquals(bytes, payload);
    assertEquals([...sockets].every(socket => !socket.writableEnded), true);
  } finally {
    clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

Deno.test("native stream PUT cancellation joins request cleanup without POST fallback", async () => {
  const started = Promise.withResolvers<Socket>();
  const sockets = new Set<Socket>();
  let requests = 0;
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("data", bytes => {
      requests++;
      assertEquals(t(bytes).startsWith("PUT /stream HTTP/1.1"), true);
      socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nx");
      started.resolve(socket);
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/stream`;
  const messenger = streamMessengerFrom("provider", { http: url }, fixture(), new FetchHttpClient(), systemClock);
  const controller = new AbortController(), reason = new Error("cancel finite PUT");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const task = run(function*() {
    return yield* messenger.send({ signal: controller.signal });
  });
  try {
    const socket = await started.promise;
    const closed = new Promise<void>(resolve => socket.once("close", () => resolve()));
    controller.abort(reason);
    assertStrictEquals(await assertRejects(() => task), reason);
    await Promise.race([
      closed,
      new Promise<never>((_, reject) => timer = setTimeout(() => reject(new Error("PUT socket remained open")), 2000)),
    ]);
    assertEquals(requests, 1);
  } finally {
    clearTimeout(timer);
    await task.halt().catch(() => {});
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
