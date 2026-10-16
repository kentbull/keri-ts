import {
  b,
  collectPayload,
  concatBytes,
  Counter,
  decodeB64,
  parse,
  ResourceAdmissionError,
  ResourcePolicy,
  t,
  Texter,
} from "cesr-ts";
import type { CesrFrame } from "cesr-ts";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { createServer, type Socket } from "node:net";
import { call, run, suspend } from "npm:effection@^3.6.0";
import { essrRaw } from "../../../../cesr/src/parser/essr.ts";
import { KERIPY_V1_JSON_ICP_BODY as json } from "../../../../cesr/test/fixtures/external-vectors.ts";
import vectors from "../../../../cesr/test/fixtures/nested-vectors.json" with { type: "json" };
import { chunkBytes } from "../../../src/app/byte-source.ts";
import { attemptPostCesr, CesrHttpRefusal, postCesr, requestFrame } from "../../../src/app/cesr-egress.ts";
import { CESR_ATTACHMENT_HEADER } from "../../../src/app/cesr-http.ts";
import { attemptPreparedCesrTarget } from "../../../src/app/forwarding.ts";
import { defaultRuntimeServices, type RuntimeServices } from "../../../src/app/runtime-services.ts";
import { sendCesrTcpFrame } from "../../../src/app/tcp-egress.ts";

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

/** Return one owned admitted fixture frame for a request-resource test. */
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

/** Retain the production clock while replacing only the HTTP boundary under test. */
function services(fetch: RuntimeServices["http"]["fetch"]): RuntimeServices {
  return { ...defaultRuntimeServices, http: { fetch } };
}
Deno.test("CESR cancellation preserves a late foreign fetch failure through joined credit release", async () => {
  for (const failure of [new Error("late fetch I/O"), new DOMException("foreign abort", "AbortError")]) {
    const frame = await read(fixture());
    const ready = Promise.withResolvers<void>();
    const resources = new ResourcePolicy({ streams: 1 });
    let rejectFetch!: () => void;
    const task = run(function*() {
      yield* requestFrame("https://peer.test/", frame, {
        services: {
          ...services((_url, init) =>
            new Promise<Response>((_resolve, reject) => {
              init!.signal!.addEventListener("abort", () => rejectFetch = () => reject(failure), { once: true });
              ready.resolve();
            })
          ),
          resources,
        },
      });
    });
    try {
      await ready.promise;
      const stopped = Promise.resolve(task.halt());
      void stopped.catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(resources.used.streams, 1, "pending fetch still owns HTTP credit");
      rejectFetch();
      assertStrictEquals(await assertRejects(() => stopped), failure);
      assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
    } finally {
      rejectFetch?.();
      await task.halt().catch(() => {});
    }
  }
});
Deno.test("CESR cancellation preserves late diagnostic cleanup failure", async () => {
  const frame = await read(fixture());
  const reading = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  const failure = new Error("diagnostic cleanup failed");
  const resources = new ResourcePolicy({ streams: 1 });
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull() {
        reading.resolve();
      },
      cancel() {
        return cleanup.promise;
      },
    }, { highWaterMark: 0 }),
    { status: 400 },
  );
  const task = run(() =>
    requestFrame("https://peer.test/", frame, {
      services: { ...services(() => Promise.resolve(response)), resources },
    })
  );
  try {
    await reading.promise;
    const stopped = Promise.resolve(task.halt());
    void stopped.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(resources.used.streams, 1);
    cleanup.reject(failure);
    assertStrictEquals(await assertRejects(() => stopped), failure);
    assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
  } finally {
    cleanup.resolve();
    await task.halt().catch(() => {});
  }
});
Deno.test("CESR egress waits for each request before consuming the next frame", async () => {
  // The first HTTP request controls whether the second parser output may be requested.
  const opened = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let pulls = 0;
  let requests = 0;
  let closed = false;
  const resources = new ResourcePolicy({ streams: 1 });
  const transport = {
    ...services(async (_url, init) => {
      // Reading a real platform request stream exercises the serializer and fetch body adapter together.
      const bytes = new Uint8Array(await new Response(init!.body).arrayBuffer());
      const frame = await read(bytes);

      assertEquals(await collectPayload(essrRaw(frame.essrs!)), b("abcxyz"));
      if (++requests === 1) {
        opened.resolve();
        await release.promise;
      }
      return new Response(null, { status: 204 });
    }),
    resources,
  };
  let acquisitions = 0;
  const source = (signal: AbortSignal) => {
    acquisitions++;
    return chunkBytes(fixture(), { signal });
  };
  const occupied = resources.reserve({ streams: 1 });
  if (occupied.kind !== "reserve") throw new Error("Expected free test capacity");
  try {
    await assertRejects(
      () => run(() => postCesr("https://peer.test/", source, { services: transport })),
      ResourceAdmissionError,
      "busy",
    );
  } finally {
    occupied.reservation.release();
  }
  await assertRejects(
    () =>
      run(() =>
        postCesr("https://peer.test/", source, {
          services: { ...transport, resources: new ResourcePolicy({ bytes: 1 }) },
        })
      ),
    ResourceAdmissionError,
    "limit",
  );
  assertEquals([acquisitions, requests], [2, 0], "request admission still precedes fetch after source parsing");
  const task = run(function*() {
    yield* postCesr("https://peer.test/", async function*(signal) {
      try {
        pulls++;
        yield fixture();
        signal.throwIfAborted();
        pulls++;
        yield fixture();
      } finally {
        closed = true;
      }
    }, {
      bodyMode: "body",
      services: transport,
    });
  });
  await opened.promise;
  assertEquals(pulls, 1);
  assertEquals(resources.used.streams, 1, "source and its request share one outgoing stream slot");
  release.resolve();
  await task;
  assertEquals([pulls, requests, closed], [2, 2, true]);
  assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
});
Deno.test("CESR header egress normalizes binary attachments for HTTP", async () => {
  // The source is binary v2 while the detached JSON body independently declares protocol v1.
  const wire = decodeB64(t(fixture()));
  let requests = 0;
  const transport = services(async (_url, init) => {
    // Text qualification is mandatory in HTTP headers, including when input was qb2.
    const header = new Headers(init!.headers).get(CESR_ATTACHMENT_HEADER)!;
    assertEquals(/^[A-Za-z0-9_-]+$/.test(header), true);
    const body = new Uint8Array(await new Response(init!.body).arrayBuffer());
    const frame = await read(concatBytes(body, b(header)));

    assertEquals(await collectPayload(essrRaw(frame.essrs!)), b("abcxyz"));
    requests++;
    return new Response(null, { status: 204 });
  });
  await run(function*() {
    yield* postCesr("https://peer.test/", (signal) => chunkBytes(wire, { signal }), { services: transport });
  });
  assertEquals(requests, 1);
});
Deno.test("CESR request scope keeps successful responses live and cancels their unread tail", async () => {
  // A response remains readable until the consuming Operation finishes, then its resource closes.
  const frame = await read(fixture());
  let cancelled = false;
  await run(function*() {
    const response = yield* requestFrame("https://peer.test/", frame, {
      services: services(() =>
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
    });
    const reader = response.body!.getReader();
    assertEquals((yield* call(() => reader.read())).value, Uint8Array.of(7));
    reader.releaseLock();
    assertEquals(cancelled, false);
  });
  assertEquals(cancelled, true);
  const resources = new ResourcePolicy();
  for (const failure of [new Error("response cleanup failed"), new DOMException("foreign cleanup", "AbortError")]) {
    const observed = await assertRejects(
      () =>
        run(() =>
          requestFrame("https://peer.test/", frame, {
            services: {
              ...services(() =>
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
              resources,
            },
          })
        ),
    );
    assertStrictEquals(observed, failure);
    assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
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
      const response = yield* requestFrame(`http://127.0.0.1:${server.addr.port}/`, frame, {
        services: {
          ...services((url, init) => {
            ownSignal = init!.signal!;
            return fetch(url, init);
          }),
          resources,
        },
      });
      assertEquals(response.status, 202);
      assertEquals(ownSignal!.aborted, false, "successful headers keep the response live");
    });
    assertEquals(ownSignal!.aborted, true, "normal scope cleanup intentionally aborts its fetch");
    assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
  } finally {
    await server.shutdown();
  }
});
Deno.test("CESR failed-response diagnostics cancel a tail beyond the finite budget", async () => {
  // An unbounded error response must not defeat otherwise bounded successful transport.
  const frame = await read(fixture());
  let cancelled = false;
  await assertRejects(
    () =>
      run(function*() {
        yield* requestFrame("https://peer.test/", frame, {
          maxErrorBytes: 4,
          services: services(() =>
            Promise.resolve(
              new Response(
                new ReadableStream({
                  /** Supply more diagnostic data than allowed, then leave the response open. */
                  start(controller) {
                    controller.enqueue(b("bad!ignored"));
                  },
                  /** The response tail is explicitly released after its admitted prefix is read. */
                  cancel() {
                    cancelled = true;
                  },
                }),
                { status: 500 },
              ),
            )
          ),
        });
      }),
    Error,
    "HTTP 500: bad!",
  );
  assertEquals(cancelled, true);
  const resources = new ResourcePolicy({ streams: 1 });
  const reading = Promise.withResolvers<void>(), cancelling = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  const controller = new AbortController();
  let joined = false, calls = 0;
  const sending = run(() =>
    requestFrame("https://peer.test/", frame, {
      signal: controller.signal,
      services: {
        ...services(() =>
          Promise.resolve(
            new Response(
              new ReadableStream({
                /** Suspend diagnostics so abort, rather than reaching the prefix cap, starts cancellation. */
                pull() {
                  reading.resolve();
                },
                /** Credit belongs to this first asynchronous cancellation until it finishes. */
                async cancel() {
                  calls++;
                  cancelling.resolve();
                  await cleanup.promise;
                  assertEquals(resources.used.streams, 1);
                  joined = true;
                },
              }, { highWaterMark: 0 }),
              { status: 500 },
            ),
          )
        ),
        resources,
      },
    })
  );
  let settled = false;
  const rejected = assertRejects(() => sending, Error).finally(() => settled = true);
  try {
    await reading.promise;
    controller.abort();
    await cancelling.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals([settled, joined, resources.used.streams], [false, false, 1]);
  } finally {
    cleanup.resolve();
    await rejected;
  }
  assertEquals([calls, joined, resources.used.streams, resources.used.bytes], [1, true, 0, 0]);
});
// Only detached-header requests have a second supported media type to negotiate.
for (const bodyMode of ["header", "body"] as const) {
  Deno.test(`CESR ${bodyMode} delivery handles a media-type rejection explicitly`, async () => {
    const frame = await read(fixture());
    const types: string[] = [];
    const transport = services(async (_url, init) => {
      // Consume the actual upload so its reader completes before the simulated peer replies.
      await new Response(init!.body).arrayBuffer();
      types.push(new Headers(init!.headers).get("Content-Type")!);
      return types.length === 1
        ? new Response("Unsupported content type", { status: 406 })
        : new Response(null, { status: 204 });
    });
    const sending = run(function*() {
      yield* requestFrame("https://peer.test/", frame, { bodyMode, services: transport });
    });
    if (bodyMode === "header") {
      await sending;
      assertEquals(types, ["application/cesr", "application/cesr+json"]);
    } else {
      // Body mode has no retry; exhausting the sole attempt must not report success.
      await assertRejects(() => sending, Error, "HTTP 406: Unsupported content type");
      assertEquals(types, ["application/cesr"]);
    }
  });
}

Deno.test("halting CESR delivery closes input and never resumes the caller after payload cleanup", async () => {
  // A pending HTTP leaf supplies the cancellation boundary after the parser transfers one frame.
  const blocked = Promise.withResolvers<void>();
  let closed = false;
  let continued = false;
  const resources = new ResourcePolicy({ streams: 1 });
  const closing = Promise.withResolvers<void>(), cleanup = Promise.withResolvers<void>();
  const task = run(function*() {
    yield* postCesr("https://peer.test/", async function*() {
      try {
        yield fixture();
      } finally {
        closing.resolve();
        await cleanup.promise;
        closed = true;
      }
    }, {
      services: {
        ...services((_url, init) =>
          new Promise((_resolve, reject) => {
            init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
            blocked.resolve();
          })
        ),
        resources,
      },
    });
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
  assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
});

Deno.test("CESR input cancellation also aborts the request consuming its delivered frame", async () => {
  const controller = new AbortController();
  const request = Promise.withResolvers<void>();
  let aborted = false;
  const transport = services((_url, init) =>
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
    yield* postCesr("https://peer.test/", (signal) => chunkBytes(fixture(), { signal }), {
      services: transport,
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

Deno.test("external HTTP input cancellation stops an active response consumer", async () => {
  for (const cleanupFailure of [undefined, new Error("late input cleanup failure")]) {
    const ready = Promise.withResolvers<void>(), controller = new AbortController();
    const reason = new Error("stop response consumer");
    let closed = false, resumed = false;
    const task = run(function*() {
      yield* postCesr("https://peer.test/", async function*() {
        try {
          yield fixture();
        } finally {
          closed = true;
          // deno-lint-ignore no-unsafe-finally -- A foreign cleanup failure must survive external abort.
          if (cleanupFailure) throw cleanupFailure;
        }
      }, {
        signal: controller.signal,
        services: services(() => Promise.resolve(new Response(null, { status: 204 }))),
      }, function*() {
        ready.resolve();
        yield* suspend();
        resumed = true;
      });
      resumed = true;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await ready.promise;
      controller.abort(reason);
      const failure = await assertRejects(() =>
        Promise.race([
          task,
          new Promise<never>((_, reject) =>
            timer = setTimeout(() => reject(new Error("response consumer still active")), 1000)
          ),
        ])
      );
      assertStrictEquals(failure, cleanupFailure ?? reason);
      assertEquals([closed, resumed], [true, false]);
    } finally {
      clearTimeout(timer);
      await task.halt().catch(() => {});
    }
  }
});

Deno.test("CESR transport headers preserve authorization without replacing frame metadata", async () => {
  await run(function*() {
    yield* postCesr("https://peer.test/", (signal) => chunkBytes(b(json), { signal }), {
      destination: "actual-peer",
      headers: {
        Authorization: "Bearer fixture",
        "Content-Type": "text/plain",
        "CESR-DESTINATION": "stale-peer",
        "CESR-ATTACHMENT": "stale-attachment",
      },
      services: services((_url, init) => {
        const headers = new Headers(init?.headers);
        assertEquals(headers.get("Authorization"), "Bearer fixture");
        // Extra HTTP metadata cannot override the serializer's own attachment or routing fields.
        assertEquals(headers.get("Content-Type"), "application/cesr");
        assertEquals(headers.get("CESR-DESTINATION"), "actual-peer");
        assertEquals(headers.get("CESR-ATTACHMENT"), "-VAA");
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    });
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
    const result = await run(() => sendCesrTcpFrame(url, frame, { maxChunkBytes: 7 }));
    assertEquals(result.kind, "transmitted");
    const roundtrip = await received.promise;
    {
      for (const [actual, expected] of [[roundtrip, frame], [roundtrip.nests![0], child]]) {
        assertEquals(actual.body.raw, expected.body.raw);
        assertEquals(actual.gvrsn, expected.gvrsn);
        assertEquals(actual.attachments.map((group) => group.raw), expected.attachments.map((group) => group.raw));
      }
      assertEquals(await collectPayload(essrRaw(roundtrip.nests![0].essrs!)), b("abcxyz"));
    }
    assertEquals(child.essrs, payloadFrame.essrs);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
Deno.test("transport attempt excludes identical typed errors from source, fetch and cleanup", async () => {
  for (
    const failure of [new CesrHttpRefusal("external failure", 503), new ResourceAdmissionError("foreign busy", "busy")]
  ) {
    for (const origin of ["source", "fetch", "cleanup", "peer"] as const) {
      const transport = services(async (_url, init) => {
        await new Response(init!.body).arrayBuffer();
        if (origin === "fetch") throw failure;
        if (origin === "cleanup") {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(16 * 1024));
              },
              cancel() {
                throw failure;
              },
            }),
            { status: 503 },
          );
        }
        return new Response("peer refusal", { status: 503 });
      });
      const send = () =>
        run(() =>
          attemptPostCesr("https://peer.test/", async function*() {
            if (origin === "source") throw failure;
            yield fixture();
          }, { bodyMode: "body", services: transport })
        );
      if (origin === "peer") {
        const result = await send();
        if (result.kind !== "refuse" || !(result.error instanceof CesrHttpRefusal)) {
          throw new Error("Expected peer refusal result");
        }
        assertEquals(result.error.status, 503);
      } else {
        assertStrictEquals(await assertRejects(send), failure);
      }
      assertEquals([transport.resources.used.bytes, transport.resources.used.streams], [0, 0]);
    }
  }
});
Deno.test("prepared attempt reports only its own joined admission refusal", async () => {
  const resources = new ResourcePolicy();
  let requests = 0;
  const transport = {
    ...services(async (_url, init) => {
      requests++;
      await new Response(init!.body).arrayBuffer();
      return new Response(null, { status: 204 });
    }),
    resources,
  };
  const target = {
    kind: "http" as const,
    url: "https://peer.test/",
    destination: "aid",
    message: fixture(),
    bodyMode: "body" as const,
  };
  const held = resources.reserve({ streams: resources.limits.streams });
  if (held.kind !== "reserve") throw new Error("Expected free stream capacity");
  assertEquals(await run(() => attemptPreparedCesrTarget(target, transport)), "busy");
  assertEquals(requests, 0);
  held.reservation.release();
  assertEquals(await run(() => attemptPreparedCesrTarget(target, transport)), "complete");
  transport.http = services(async (_url, init) => {
    await new Response(init!.body).arrayBuffer();
    return new Response("peer refusal", { status: 503 });
  }).http;
  assertEquals(await run(() => attemptPreparedCesrTarget(target, transport)), "refused");
  assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
  const failure = new ResourceAdmissionError("foreign transport busy", "busy");
  const controller = new AbortController();
  transport.http = {
    fetch() {
      controller.abort();
      return Promise.reject(failure);
    },
  };
  assertStrictEquals(
    await assertRejects(() => run(() => attemptPreparedCesrTarget(target, transport, controller.signal))),
    failure,
  );
  assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
});
