import { concatBytes, ResourceAdmissionError, ResourceLimitError, ResourcePolicy } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { createServer, type Socket } from "node:net";
import { createHabery, type Habery } from "../../../src/app/habbing.ts";
import { defaultRuntimeServices } from "../../../src/app/runtime-services.ts";
import { sendCesrTcp, streamCesrTcp } from "../../../src/app/tcp-egress.ts";
import { Receiptor, sendWitnessMessage } from "../../../src/app/witnessing.ts";

/** Seed accepted local identifiers and the remote HTTP location used by witness transport. */
function fixture(hby: Habery, url: string) {
  const witness = hby.makeHab("witness", undefined, { transferable: false });
  const controller = hby.makeHab("controller", undefined, { wits: [witness.pre], toad: 1 });
  hby.db.locs.pin([witness.pre, "http"], { url });
  return { witness, controller };
}

Deno.test("witness delivery preserves authorization and retries the media type for each frame", async () => {
  const requests: Array<{ authorization: string | null; destination: string | null; type: string | null }> = [];
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, async (request) => {
    requests.push({
      authorization: request.headers.get("Authorization"),
      destination: request.headers.get("CESR-DESTINATION"),
      type: request.headers.get("Content-Type"),
    });
    await request.arrayBuffer(); // These local request fixtures contain two small KEL events.
    return request.headers.get("Content-Type") === "application/cesr"
      ? new Response("Unacceptable content type", { status: 406 })
      : new Response(null, { status: 204 });
  });
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: `witness-send-${crypto.randomUUID()}`, temp: true, skipConfig: true });
      try {
        const { witness, controller } = fixture(hby, `http://127.0.0.1:${server.addr.port}`);
        controller.interact();
        const services = { ...defaultRuntimeServices, resources: new ResourcePolicy({ streams: 1 }) };
        const wire = concatBytes(...hby.db.clonePreIter(controller.pre));
        const busy = services.resources.reserve({ streams: 1 });
        if (busy.kind !== "reserve") throw new Error("Expected free test capacity");
        try {
          yield* call(() =>
            assertRejects(
              () => run(() => sendWitnessMessage(controller, witness.pre, wire, "Bearer fixture", services)),
              ResourceAdmissionError,
              "busy",
            )
          );
          assertEquals(requests.length, 0);
        } finally {
          busy.reservation.release();
        }
        // One request is completed before the next complete event is admitted for delivery.
        yield* sendWitnessMessage(
          controller,
          witness.pre,
          wire,
          "Bearer fixture",
          services,
        );
        assertEquals(services.resources.used, { bytes: 0, streams: 0, decryptions: 0 });
        assertEquals(requests.length, 4);
        assertEquals(requests.map((request) => request.authorization), Array(4).fill("Bearer fixture"));
        assertEquals(requests.map((request) => request.destination), Array(4).fill(witness.pre));
        assertEquals(requests.map((request) => request.type), [
          "application/cesr",
          "application/cesr+json",
          "application/cesr",
          "application/cesr+json",
        ]);
      } finally {
        yield* hby.close(true);
      }
    });
  } finally {
    await server.shutdown();
  }
});

Deno.test("TCP witness admission owns its socket through cancellation and permits a later send", async () => {
  const received = Promise.withResolvers<void>();
  const sockets = new Set<Socket>();
  let connections = 0, finish = false, continued = false;
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    connections++;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    socket.on("data", () => {
      received.resolve();
    });
    socket.once("end", () => {
      if (finish) socket.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP test address");
  const services = { ...defaultRuntimeServices, resources: new ResourcePolicy({ streams: 1 }) };
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: `tcp-send-${crypto.randomUUID()}`, temp: true, skipConfig: true });
      try {
        const { witness, controller } = fixture(hby, "http://unused.test");
        hby.db.locs.rem([witness.pre, "http"]);
        hby.db.locs.pin([witness.pre, "tcp"], { url: `tcp://127.0.0.1:${address.port}` });
        const wire = concatBytes(...hby.db.clonePreIter(controller.pre));
        const busy = services.resources.reserve({ streams: 1 });
        if (busy.kind !== "reserve") throw new Error("Expected free test capacity");
        try {
          yield* call(() =>
            assertRejects(
              () => run(() => sendWitnessMessage(controller, witness.pre, wire, undefined, services)),
              ResourceAdmissionError,
              "busy",
            )
          );
        } finally {
          busy.reservation.release();
        }
        yield* call(() =>
          assertRejects(
            () =>
              run(() =>
                sendWitnessMessage(controller, witness.pre, wire, undefined, {
                  ...services,
                  resources: new ResourcePolicy({ bytes: 1 }),
                })
              ),
            ResourceAdmissionError,
            "limit",
          )
        );
        assertEquals(connections, 0, "refusal precedes socket acquisition");
        const task = run(function*() {
          yield* sendWitnessMessage(controller, witness.pre, wire, undefined, services);
          continued = true;
        });
        try {
          yield* call(() => received.promise);
          assertEquals(services.resources.used.streams, 1);
          assertEquals(services.resources.used.bytes, wire.buffer.byteLength + 2 * Math.min(65536, wire.byteLength));
        } finally {
          yield* call(() => task.halt());
        }
        assertEquals(continued, false);
        assertEquals(services.resources.used, { bytes: 0, streams: 0, decryptions: 0 });
        finish = true;
        yield* sendWitnessMessage(controller, witness.pre, wire, undefined, services);
        assertEquals(connections, 2);
        assertEquals(services.resources.used, { bytes: 0, streams: 0, decryptions: 0 });
      } finally {
        yield* hby.close(true);
      }
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

Deno.test("witness receipt collection rejects an oversized response and cancels its source", async () => {
  const cancelled = Promise.withResolvers<void>();
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, () =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(64 * 1024));
        },
        cancel() {
          cancelled.resolve();
        },
      }),
    ));
  try {
    await assertRejects(
      () =>
        run(function*() {
          const hby = yield* createHabery({
            name: `receipt-limit-${crypto.randomUUID()}`,
            temp: true,
            skipConfig: true,
          });
          try {
            const { controller } = fixture(hby, `http://127.0.0.1:${server.addr.port}`);
            // The finite receipt budget is checked while reading, before receipt parsing starts.
            yield* new Receiptor(hby).get(controller.pre);
          } finally {
            yield* hby.close(true);
          }
        }),
      ResourceLimitError,
      "Input exceeds",
    );
    await cancelled.promise;
  } finally {
    await server.shutdown();
  }
});

Deno.test("halting a receipt read closes the peer body without continuing its caller", async () => {
  const opened = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  let continued = false;
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.of(123)); // Deliver headers plus an unfinished body, then block.
          opened.resolve();
        },
        cancel() {
          cancelled.resolve();
        },
      }),
    ));
  const task = run(function*() {
    const hby = yield* createHabery({ name: `receipt-cancel-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const { controller } = fixture(hby, `http://127.0.0.1:${server.addr.port}`);
      yield* new Receiptor(hby).get(controller.pre);
      continued = true;
    } finally {
      yield* hby.close(true);
    }
  });
  try {
    await opened.promise;
    await task.halt();
    await cancelled.promise;
    assertEquals(continued, false);
  } finally {
    await task.halt();
    await server.shutdown();
  }
});

Deno.test("TCP streamed output stops pulling under socket pressure and joins source cleanup before credit release", async () => {
  const accepted = Promise.withResolvers<Socket>(), cleanup = Promise.withResolvers<void>();
  const returning = Promise.withResolvers<void>();
  const server = createServer({ allowHalfOpen: true, pauseOnConnect: true }, (socket) => {
    socket.on("error", () => {});
    accepted.resolve(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `tcp://127.0.0.1:${(server.address() as { port: number }).port}`;
  const services = { ...defaultRuntimeServices, resources: new ResourcePolicy({ streams: 1, bytes: 131072 }) };
  let pulls = 0, opened = 0, continued = false;
  const source = async function*(signal: AbortSignal) {
    opened++;
    try {
      for (let index = 0; index < 1024; index++) {
        signal.throwIfAborted();
        pulls++;
        yield new Uint8Array(65536);
      }
    } finally {
      returning.resolve();
      await cleanup.promise;
    }
  };
  const busy = services.resources.reserve({ streams: 1 });
  if (busy.kind !== "reserve") throw new Error("Expected free test capacity");
  try {
    await assertRejects(() => run(() => streamCesrTcp(url, source, { services })), ResourceAdmissionError, "busy");
    assertEquals(opened, 0, "admission precedes source acquisition");
  } finally {
    busy.reservation.release();
  }
  const task = run(function*() {
    yield* streamCesrTcp(url, source, { services });
    continued = true;
  });
  const socket = await accepted.promise;
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    assertEquals(pulls > 0 && pulls < 1024, true, "paused real receiver prevents whole-source prefetch");
    const stopped = pulls;
    await new Promise((resolve) => setTimeout(resolve, 50));
    assertEquals(pulls, stopped, "pressure stops source demand");
    let halted = false;
    const halt = task.halt().then(() => halted = true);
    await returning.promise;
    assertEquals(halted, false);
    assertEquals(services.resources.used, { streams: 1, bytes: 131072, decryptions: 0 });
    cleanup.resolve();
    await halt;
    assertEquals(continued, false);
    assertEquals(services.resources.used, { streams: 0, bytes: 0, decryptions: 0 });
  } finally {
    cleanup.resolve();
    await task.halt();
    socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

Deno.test("TCP output rejects oversized backing, freezes drain deadline and permits a later finite send", async () => {
  const sockets = new Set<Socket>();
  let received = 0, finish = false;
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    socket.on("data", (bytes) => received += bytes.length);
    socket.once("end", () => {
      if (finish) socket.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `tcp://127.0.0.1:${(server.address() as { port: number }).port}`;
  const services = { ...defaultRuntimeServices, resources: new ResourcePolicy({ streams: 1 }) };
  try {
    await assertRejects(
      () =>
        run(() =>
          streamCesrTcp(url, async function*() {
            yield new Uint8Array(100).subarray(0, 1);
          }, { services, maxChunkBytes: 4 })
        ),
      ResourceLimitError,
      "backing",
    );
    assertEquals(received, 0, "oversized backing is refused before socket write");
    await assertRejects(
      () =>
        run(() =>
          streamCesrTcp(url, async function*() {
            await new Promise((resolve) => setTimeout(resolve, 30));
            yield Uint8Array.of(1, 2);
          }, { services, drainTimeoutMs: 10 })
        ),
      Error,
      "drain deadline",
    );
    assertEquals(received, 2, "active production outlives the later drain deadline");
    assertEquals(services.resources.used, { streams: 0, bytes: 0, decryptions: 0 });
    const fault = new Error("source cleanup infrastructure fault");
    let returned = 0;
    const failure = await assertRejects(
      () =>
        run(() =>
          streamCesrTcp(url, () => ({
            [Symbol.asyncIterator]() {
              return {
                next() {
                  return Promise.resolve({ done: false as const, value: new Uint8Array(5) });
                },
                return() {
                  returned++;
                  return Promise.reject(fault);
                },
              };
            },
          }), { services, maxChunkBytes: 4 })
        ),
      AggregateError,
      "cleanup failed",
    );
    assertStrictEquals(failure.errors[1], fault);
    assertEquals(returned, 1);
    assertEquals(services.resources.used, { streams: 0, bytes: 0, decryptions: 0 });
    const openingFault = new Error("source factory infrastructure fault");
    assertStrictEquals(
      await assertRejects(() =>
        run(() =>
          streamCesrTcp(url, () => {
            throw openingFault;
          }, { services })
        )
      ),
      openingFault,
    );
    assertStrictEquals(
      await assertRejects(() =>
        run(() =>
          sendCesrTcp(url, Uint8Array.of(1), {
            services: {
              ...services,
              clock: {
                ...services.clock,
                setTimeout() {
                  throw openingFault;
                },
              },
            },
          })
        )
      ),
      openingFault,
    );
    assertEquals(services.resources.used, { streams: 0, bytes: 0, decryptions: 0 });
    const reading = Promise.withResolvers<void>(), returning = Promise.withResolvers<void>();
    const cleanup = Promise.withResolvers<void>();
    const task = run(() =>
      streamCesrTcp(url, async function*(signal) {
        try {
          await new Promise<never>((_, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            reading.resolve();
          });
        } finally {
          returning.resolve();
          await cleanup.promise;
        }
      }, { services })
    );
    try {
      await reading.promise;
      let halted = false;
      const halt = task.halt().then(() => halted = true);
      await returning.promise;
      assertEquals(halted, false, "a pending source read joins its cleanup");
      assertEquals(services.resources.used.streams, 1);
      cleanup.resolve();
      await halt;
      assertEquals(services.resources.used, { streams: 0, bytes: 0, decryptions: 0 });
    } finally {
      cleanup.resolve();
      await task.halt();
    }
    finish = true;
    assertEquals(await run(() => sendCesrTcp(url, Uint8Array.of(3, 4), { services })), {
      kind: "transmitted",
      bytes: 2,
    });
    assertEquals(received, 4);
    assertEquals(
      await run(() =>
        streamCesrTcp(url, async function*() {
          for (let index = 0; index < 3; index++) yield Uint8Array.of(5, 6);
        }, { services, maxChunkBytes: 2 })
      ),
      { kind: "transmitted", bytes: 6 },
    );
    assertEquals(received, 10);
    assertEquals(services.resources.used, { streams: 0, bytes: 0, decryptions: 0 });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
