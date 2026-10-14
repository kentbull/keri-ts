import {
  b,
  collectPayload,
  concatBytes,
  Counter,
  decodeB64,
  discardFrame,
  essrPayload,
  MemoryPayloadSink,
  parse,
  ResourceAdmissionError,
  ResourcePolicy,
  t,
  Texter,
} from "cesr-ts";
import type { CesrFrame, OwnedPayload } from "cesr-ts";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { createServer, type Socket } from "node:net";
import { call, run } from "npm:effection@^3.6.0";
import { KERIPY_V1_JSON_ICP_BODY as json } from "../../../../cesr/test/fixtures/external-vectors.ts";
import vectors from "../../../../cesr/test/fixtures/nested-vectors.json" with { type: "json" };
import { chunkBytes } from "../../../src/app/byte-source.ts";
import { CesrHttpRefusal, postCesr, requestFrame } from "../../../src/app/cesr-egress.ts";
import { CESR_ATTACHMENT_HEADER } from "../../../src/app/cesr-http.ts";
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

Deno.test("CESR egress waits for each request and disposes each delivered payload", async () => {
  // The first HTTP request controls whether the second parser output may be requested.
  const opened = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let pulls = 0;
  let requests = 0;
  let discarded = 0;
  let closed = false;
  const resources = new ResourcePolicy({ streams: 1 });
  const transport = {
    ...services(async (_url, init) => {
      // Reading a real platform request stream exercises the serializer and fetch body adapter together.
      const bytes = new Uint8Array(await new Response(init!.body).arrayBuffer());
      const frame = await read(bytes);
      try {
        assertEquals(await collectPayload(frame.essr!.raw, 6), b("abcxyz"));
      } finally {
        await frame.essr?.discard();
      }
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
  assertEquals([acquisitions, requests], [0, 0], "source admission precedes acquisition and fetch");
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
      parse: {
        /** Count ownership releases, retaining the real bounded sink implementation. */
        payloadSink(limit, signal) {
          // This observer does not alter how the sink admits, stores, or opens payload bytes.
          const sink = new MemoryPayloadSink(limit, signal);
          return {
            /** Delegate admission and storage to the real sink. */
            write: (chunk) => sink.write(chunk),
            /** Roll back unfinished parser-owned work using the same real sink. */
            abort: () => sink.abort(),
            /** Wrap only the finished owner's disposal to observe the ownership transfer. */
            async finish() {
              // The finished owner remains readable until the sender releases this frame.
              const owner = await sink.finish();
              return {
                size: owner.size,
                open: (signal) => owner.open(signal),
                async discard() {
                  discarded++;
                  await owner.discard();
                },
              };
            },
          };
        },
      },
    });
  });
  await opened.promise;
  assertEquals(pulls, 1);
  assertEquals(discarded, 0);
  assertEquals(resources.used.streams, 1, "source and its request share one outgoing stream slot");
  assertEquals(resources.used.bytes > 9 * 1024 ** 2, true, "source, parsed tree and output copies coexist");
  release.resolve();
  await task;
  assertEquals([pulls, requests, discarded, closed], [2, 2, 2, true]);
  assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
});

Deno.test("CESR header egress normalizes binary attachments and bounds the header", async () => {
  // The source is binary v2 while the detached JSON body independently declares protocol v1.
  const wire = decodeB64(t(fixture()));
  let requests = 0;
  const transport = services(async (_url, init) => {
    // Text qualification is mandatory in HTTP headers, including when input was qb2.
    const header = new Headers(init!.headers).get(CESR_ATTACHMENT_HEADER)!;
    assertEquals(/^[A-Za-z0-9_-]+$/.test(header), true);
    const body = new Uint8Array(await new Response(init!.body).arrayBuffer());
    const frame = await read(concatBytes(body, b(header)));
    try {
      assertEquals(await collectPayload(frame.essr!.raw, 6), b("abcxyz"));
      requests++;
    } finally {
      await frame.essr?.discard();
    }
    return new Response(null, { status: 204 });
  });
  await run(function*() {
    yield* postCesr("https://peer.test/", (signal) => chunkBytes(wire, { signal }), { services: transport });
  });
  await assertRejects(
    () =>
      run(function*() {
        yield* postCesr("https://peer.test/", (signal) => chunkBytes(wire, { signal }), {
          services: transport,
          maxHeaderBytes: 4,
        });
      }),
    RangeError,
    "Payload exceeds collection limit",
  );
  assertEquals(requests, 1);
});

// Both finite header collection and streamed body uploads own their pending payload reads.
for (const bodyMode of ["header", "body"] as const) {
  Deno.test(`CESR ${bodyMode} request scope aborts and joins its blocked payload reader`, async () => {
    // This gate opens only after header preparation or fetch reaches the ESSR source.
    const blocked = Promise.withResolvers<void>();
    const frame = await read(fixture());
    await frame.essr?.discard();
    let closed = false;
    let continued = false;
    const resources = new ResourcePolicy({ streams: 1 });
    let reads = 0, requests = 0;
    const wire: OwnedPayload = {
      size: 8,
      /** Suspend a cooperative payload reader until its transport scope aborts. */
      async *open(signal) {
        reads++;
        try {
          yield b("4BAB");
          await new Promise<void>((_resolve, reject) => {
            signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
            blocked.resolve();
          });
          yield b("YWJj");
        } finally {
          assertEquals(resources.used.streams, 1, "reader cleanup still holds HTTP credit");
          closed = true;
        }
      },
      /** This fixture owns no external resource beyond its active reader. */
      discard: () => Promise.resolve(),
    };
    frame.essr = essrPayload(wire, 1, 3, { major: 2, minor: 0 });
    const transport = {
      ...services(async (_url, init) => {
        requests++;
        // The pending fetch joins its upload read when cancellation aborts the payload source.
        await new Response(init!.body).arrayBuffer();
        return new Response(null, { status: 204 });
      }),
      resources,
    };
    const tooSmall = { ...transport, resources: new ResourcePolicy({ bytes: 1 }) };
    await assertRejects(
      () => run(() => requestFrame("https://peer.test/", frame, { bodyMode, services: tooSmall })),
      ResourceAdmissionError,
      "limit",
    );
    assertEquals([reads, requests], [0, 0], "size refusal precedes payload reads and network acquisition");
    const task = run(function*() {
      yield* requestFrame("https://peer.test/", frame, {
        bodyMode,
        services: transport,
      });
      continued = true;
    });
    await blocked.promise;
    const before = [reads, requests];
    await assertRejects(
      () => run(() => requestFrame("https://peer.test/", frame, { bodyMode, services: transport })),
      ResourceAdmissionError,
      "busy",
    );
    assertEquals([reads, requests], before, "shared contention cannot open another payload or connection");
    await task.halt();
    assertEquals(closed, true);
    assertEquals(continued, false);
    assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
    await frame.essr.discard();
    frame.essr = undefined;
    await run(() =>
      requestFrame("https://peer.test/", frame, {
        bodyMode,
        services: {
          ...services(() => {
            assertEquals(resources.used.streams, 1, "capacity is reusable after joined cleanup");
            return Promise.resolve(new Response(null, { status: 204 }));
          }),
          resources,
        },
      })
    );
    assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
  });
}

Deno.test("CESR request scope keeps successful responses live and cancels their unread tail", async () => {
  // A response remains readable until the consuming Operation finishes, then its resource closes.
  const frame = await read(fixture());
  let cancelled = false;
  try {
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
    await assertRejects(
      () =>
        run(() =>
          requestFrame("https://peer.test/", frame, {
            services: {
              ...services(() =>
                Promise.resolve(
                  new Response(
                    new ReadableStream({
                      /** Unexpected transport cleanup failure propagates after releasing shared ownership. */
                      cancel() {
                        throw new Error("response cleanup failed");
                      },
                    }),
                  ),
                )
              ),
              resources,
            },
          })
        ),
      Error,
      "response cleanup failed",
    );
    assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
  } finally {
    await frame.essr?.discard();
  }
});

Deno.test("CESR failed-response diagnostics cancel a tail beyond the finite budget", async () => {
  // An unbounded error response must not defeat otherwise bounded successful transport.
  const frame = await read(fixture());
  let cancelled = false;
  try {
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
  } finally {
    await frame.essr?.discard();
  }
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
    try {
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
    } finally {
      await frame.essr?.discard();
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
        assertEquals(resources.used.streams, 1, "source cleanup retains its reservation");
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
    assertEquals([resources.used.streams, closed, continued], [1, false, false]);
  } finally {
    cleanup.resolve();
    await halting;
  }
  assertEquals(closed, true);
  assertEquals(continued, false);
  assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
});

Deno.test("CESR parser cancellation also aborts the request consuming its delivered frame", async () => {
  const controller = new AbortController();
  const request = Promise.withResolvers<void>();
  let aborted = false;
  const transport = services((_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      // The parser has handed ownership to HTTP; cancelling its option must still reach this pending request.
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
      parse: { signal: controller.signal },
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

Deno.test("TCP frame output admits before serialization and borrows nested owners through joined cancellation", async () => {
  const frame = await read(b(vectors.rows.find((row) => row.name === "child-genus-selector")!.qb64));
  const child = frame.nests![0], payloadFrame = await read(fixture());
  const original = payloadFrame.essr!;
  child.essr = essrPayload(original.wire as OwnedPayload, original.count, original.raw.size, child.gvrsn!);
  payloadFrame.essr = undefined; // The child now owns the same actual wire under its parsed genus.
  const wire = child.essr!.wire as OwnedPayload, originalOpen = wire.open, originalDiscard = wire.discard;
  const size = wire.size;
  let metadataReads = 0, discards = 0, reads = 0;
  Object.defineProperty(wire, "size", {
    get() {
      metadataReads++;
      return size;
    },
    configurable: true,
  });
  wire.open = function(signal) {
    reads++;
    return originalOpen.call(this, signal);
  };
  wire.discard = async function() {
    discards++;
    await originalDiscard.call(this);
  };
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
  const resources = new ResourcePolicy({ streams: 1 });
  const transport = { ...defaultRuntimeServices, resources };
  try {
    await assertRejects(
      () =>
        run(() =>
          sendCesrTcpFrame(url, frame, {
            services: { ...transport, resources: new ResourcePolicy({ bytes: 1 }) },
          })
        ),
      ResourceAdmissionError,
      "limit",
    );
    assertEquals([connections, metadataReads, reads], [0, 0, 0], "refusal precedes serializer metadata and I/O");
    const result = await run(() => sendCesrTcpFrame(url, frame, { services: transport, maxChunkBytes: 7 }));
    assertEquals(result.kind, "transmitted");
    const roundtrip = await received.promise;
    try {
      for (const [actual, expected] of [[roundtrip, frame], [roundtrip.nests![0], child]]) {
        assertEquals(actual.body.raw, expected.body.raw);
        assertEquals(actual.gvrsn, expected.gvrsn);
        assertEquals(actual.attachments.map((group) => group.raw), expected.attachments.map((group) => group.raw));
      }
      assertEquals(await collectPayload(roundtrip.nests![0].essr!.raw, 6), b("abcxyz"));
    } finally {
      await discardFrame(roundtrip);
    }
    assertStrictEquals(child.essr!.wire, wire, "the original payload owner remains with the caller");
    assertEquals(discards, 0);
    assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });

    const entered = Promise.withResolvers<void>(), returning = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    wire.open = async function*(signal) {
      try {
        yield b("4BAB");
        await new Promise<never>((_, reject) => {
          signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
          entered.resolve();
        });
      } finally {
        returning.resolve();
        await cleanup.promise;
        assertEquals(resources.used.streams, 1, "reader cleanup still owns transport credit");
      }
    };
    let continued = false;
    const task = run(function*() {
      yield* sendCesrTcpFrame(url, frame, { services: transport });
      continued = true;
    });
    try {
      await entered.promise;
      let halted = false;
      const halt = task.halt().then(() => halted = true);
      await returning.promise;
      assertEquals([halted, continued, discards], [false, false, 0]);
      assertStrictEquals(child.essr!.wire, wire);
      assertEquals(resources.used.bytes > 2 * 1024 ** 2, true);
      cleanup.resolve();
      await halt;
      assertEquals(continued, false);
      assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
    } finally {
      cleanup.resolve();
      await task.halt();
    }
  } finally {
    wire.open = originalOpen;
    await discardFrame(frame);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  assertEquals(discards, 1, "only the caller disposes its actual child owner");
});

Deno.test("HTTP refusal observation excludes identical errors from source, fetch and cleanup", async () => {
  const failure = new CesrHttpRefusal("external failure", 503);
  for (const origin of ["source", "fetch", "cleanup", "peer"] as const) {
    let observed: CesrHttpRefusal | undefined;
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
    const error = await assertRejects(() =>
      run(function*() {
        yield* postCesr("https://peer.test/", async function*() {
          if (origin === "source") throw failure;
          yield fixture();
        }, {
          bodyMode: "body",
          services: transport,
          onHttpRefusal: (refusal) => observed = refusal,
        });
      })
    );
    if (origin === "peer") {
      assertStrictEquals(error, observed);
      assertEquals(observed?.status, 503);
    } else {
      assertStrictEquals(error, failure);
      assertEquals(observed, undefined);
    }
    assertEquals([transport.resources.used.bytes, transport.resources.used.streams], [0, 0]);
  }
});
