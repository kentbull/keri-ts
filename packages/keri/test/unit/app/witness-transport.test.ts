import { concatBytes } from "cesr-ts";
import { call, resource, run, spawn, suspend } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { once } from "node:events";
import { createConnection, createServer, type Socket } from "node:net";
import { abortable } from "../../../src/app/abortable.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { acceptedEventReplayMessage, createHabery, type Habery } from "../../../src/app/habbing.ts";
import { defaultRuntimeServices } from "../../../src/app/runtime-services.ts";
import { socketBytes } from "../../../src/app/socket-source.ts";
import { streamCesrTcpConversation } from "../../../src/app/tcp-conversation.ts";
import {
  openTcpConnection,
  sendCesrTcp,
  sendCesrTcpSocket,
  streamCesrTcp,
  writeCesrTcpSocket,
} from "../../../src/app/tcp-egress.ts";
import { Receiptor, sendWitnessMessage, WitnessReceiptor } from "../../../src/app/witnessing.ts";

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
        const services = defaultRuntimeServices;
        const wire = concatBytes(...hby.db.clonePreIter(controller.pre));
        // One request completes before the next complete event is sent.
        yield* sendWitnessMessage(
          controller,
          witness.pre,
          wire,
          "Bearer fixture",
          services,
        );
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

Deno.test("TCP witness sender owns its socket through cancellation and permits a later send", async () => {
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
      if (finish) socket.end(Uint8Array.of(11, 12));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP test address");
  const services = defaultRuntimeServices;
  try {
    await run(function*() {
      const hby = yield* createHabery({
        name: `tcp-send-${crypto.randomUUID()}`,
        temp: true,
        skipConfig: true,
      });
      try {
        const { witness, controller } = fixture(hby, "http://unused.test");
        hby.db.locs.rem([witness.pre, "http"]);
        hby.db.locs.pin([witness.pre, "tcp"], { url: `tcp://127.0.0.1:${address.port}` });
        const runtime = yield* createAgentRuntime(hby, { services });
        const wire = concatBytes(...hby.db.clonePreIter(controller.pre));
        const task = run(function*() {
          yield* sendWitnessMessage(controller, witness.pre, wire, undefined, runtime.services, runtime.reactor);
          continued = true;
        });
        try {
          yield* call(() => received.promise);
        } finally {
          yield* call(() => task.halt());
        }
        assertEquals(continued, false);
        finish = true;
        yield* sendWitnessMessage(controller, witness.pre, wire, undefined, runtime.services, runtime.reactor);
        assertEquals(connections, 2);
      } finally {
        yield* hby.close(true);
      }
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

Deno.test("TCP-only witness submission requires a verified persisted receipt, not socket drain", async () => {
  const sockets = new Set<Socket>();
  let reply: Uint8Array = new Uint8Array();
  let connections = 0;
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    connections++;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    socket.resume();
    socket.once("end", () => socket.end(reply));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `tcp://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: `tcp-receipts-${crypto.randomUUID()}`, temp: true, skipConfig: true });
      try {
        const { witness, controller } = fixture(hby, "http://unused.test");
        hby.db.locs.rem([witness.pre, "http"]);
        hby.db.locs.pin([witness.pre, "tcp"], { url });
        const runtime = yield* createAgentRuntime(hby);
        const submitter = new WitnessReceiptor(hby, { reactor: runtime.reactor, services: runtime.services });
        yield* call(() =>
          assertRejects(
            () =>
              run(() =>
                new Receiptor(hby, { reactor: runtime.reactor, services: runtime.services }).receipt(controller.pre)
              ),
            Error,
            "HTTP(S) receipt endpoint",
          )
        );
        assertEquals(connections, 0, "explicit endpoint receipting retains its HTTP-only contract");
        const { serder, message } = acceptedEventReplayMessage(hby, controller.pre, 0);
        const key = [controller.pre, serder.said!] as const;
        yield* sendWitnessMessage(controller, witness.pre, message, undefined, runtime.services, runtime.reactor);
        assertEquals(hby.db.wigs.get(key).length, 0, "generic drain makes no receipt success claim");
        yield* call(() => assertRejects(() => run(() => submitter.submit(controller.pre)), Error, "did not receipt"));
        const outsider = hby.makeHab("outsider", undefined, { transferable: false });
        reply = outsider.receipt(serder);
        yield* call(() => assertRejects(() => run(() => submitter.submit(controller.pre)), Error, "did not receipt"));
        assertEquals(hby.db.wigs.get(key).length, 0, "an unrelated valid signer is not an authorized witness");
        reply = witness.receipt(serder);
        // Hab.receipt records its own signature: remove that fixture effect before network intake.
        hby.db.wigs.rem(key);
        assertEquals(hby.db.wigs.get(key).length, 0);
        assertEquals(yield* submitter.submit(controller.pre), {
          witnesses: [witness.pre],
          statuses: { [witness.pre]: 200 },
        });
        assertEquals(hby.db.wigs.get(key).length, 1);

        const priorConnections = connections;
        yield* submitter.submit(controller.pre);
        assertEquals(connections, priorConnections, "verified persistence enables the existing convergence fast path");
        // A borrowed protocol processor remains usable after submission; receipt cleanup never closes its stores.
        yield* runtime.reactor.processEscrowsOnce();
        yield* runtime.close();
        controller.interact();
        const next = acceptedEventReplayMessage(hby, controller.pre, 1).serder;
        reply = witness.receipt(next);
        hby.db.wigs.rem([controller.pre, next.said!]);
        yield* new WitnessReceiptor(hby).submit(controller.pre);
        assertEquals(hby.db.wigs.get([controller.pre, next.said!]).length, 1);

        assertEquals(controller.kever?.sn, 1, "standalone processing retains the caller's Habery");
      } finally {
        yield* hby.close(true);
      }
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
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

Deno.test("TCP source pulls independent bounded fragments before EOF and preserves half-open output", async () => {
  const accepted = Promise.withResolvers<Socket>();
  const server = createServer({ allowHalfOpen: true, pauseOnConnect: true }, (socket) => accepted.resolve(socket));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const client = createConnection({
    port: (server.address() as { port: number }).port,
    host: "127.0.0.1",
    allowHalfOpen: true,
  });
  await once(client, "connect");
  const socket = await accepted.promise, controller = new AbortController();
  const source = socketBytes(socket, { signal: controller.signal, maxChunkBytes: 3 });
  const read = socket.read;
  let pulls = 0;
  socket.read = function(size) {
    if (size) pulls++;
    return read.call(this, size);
  };
  try {
    assertThrows(() => socketBytes(socket, { signal: controller.signal, maxChunkBytes: 0 }), RangeError);
    assertEquals(socket.listenerCount("readable"), 0, "construction/config refusal does not acquire input");
    assertEquals(pulls, 0);
    client.write(Uint8Array.of(1, 2, 3, 4, 5, 6, 7));
    const first = await source.next();
    assertEquals(first.done, false);
    assertEquals(first.value, Uint8Array.of(1, 2, 3));
    assertEquals(first.value!.buffer.byteLength, 3);
    assertEquals(socket.readableEnded, false, "short read completes before client EOF");
    assertEquals(pulls, 1, "no background pull runs while consumer owns the chunk");
    await assertRejects(() => socketBytes(socket, { signal: controller.signal }).next(), Error, "readable consumer");
    client.end();
    const remaining: number[] = [];
    for await (const bytes of source) {
      assertEquals(bytes.buffer.byteLength <= 3, true);
      remaining.push(...bytes); // The actual socket fixture contains seven bytes.
    }
    assertEquals(remaining, [4, 5, 6, 7]);
    assertEquals(first.value, Uint8Array.of(1, 2, 3), "later pulls do not reuse a yielded backing");
    assertEquals(socket.destroyed, false, "receive EOF leaves output with its connection owner");
    assertEquals(socket.listenerCount("readable"), 0);
    client.pause(); // A connection owner may have paused native input before handing it to the source.
    const response = socketBytes(client, { signal: controller.signal, maxChunkBytes: 3 });
    socket.end(Uint8Array.of(8, 9));
    assertEquals((await response.next()).value, Uint8Array.of(8, 9));
    assertEquals(client.readableFlowing, false, "resuming native input does not switch to flow/data consumption");
    assertEquals((await response.next()).done, true);
  } finally {
    controller.abort();
    await source.return?.();
    socket.read = read;
    socket.destroy();
    client.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

Deno.test("TCP source rejects overlapping pulls, errors and early close; abort and return join socket cleanup", async () => {
  for (const mode of ["abort", "return", "error", "close"] as const) {
    const accepted = Promise.withResolvers<Socket>();
    const server = createServer({ allowHalfOpen: true, pauseOnConnect: true }, (socket) => accepted.resolve(socket));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const client = createConnection({ port: (server.address() as { port: number }).port, host: "127.0.0.1" });
    await once(client, "connect");
    const socket = await accepted.promise, controller = new AbortController();
    const source = socketBytes(socket, { signal: controller.signal });
    const destroy = socket.destroy;
    try {
      const pending = source.next();
      await assertRejects(() => source.next(), Error, "Concurrent socket pull");
      const fault = new Error("TCP infrastructure fault");
      let returning: Promise<IteratorResult<Uint8Array>> | undefined;
      if (mode === "abort") {
        // Delay actual native destruction to prove source cancellation joins the close event.
        let closed = false;
        socket.destroy = function() {
          return this;
        };
        controller.abort(fault);
        returning = source.return!().then((result) => {
          closed = true;
          return result;
        });
        await Promise.resolve();
        assertEquals(closed, false);
        socket.destroy = destroy;
        socket.destroy();
      } else if (mode === "return") returning = source.return!();
      else if (mode === "error") socket.destroy(fault);
      else socket.destroy();
      const failure = await assertRejects(() => pending, Error);
      if (mode === "abort" || mode === "error") assertStrictEquals(failure, fault);
      if (mode === "close") assertEquals(failure.message, "TCP socket closed before receive EOF");
      await returning;
      assertEquals(socket.closed, true);
      assertEquals(socket.readableEnded, false, "local close never becomes successful receive EOF");
      assertEquals(socket.listenerCount("readable"), 0);
      assertEquals(socket.listenerCount("error"), 0);
    } finally {
      socket.destroy = destroy;
      socket.destroy();
      controller.abort();
      await source.return?.();
      client.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});

Deno.test("TCP conversation owns concurrent signed replies, directional failure and joined cancellation", async () => {
  await run(function*() {
    const receiving = yield* createHabery({
      name: `tcp-replies-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const producing = yield* createHabery({ name: `tcp-proof-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const sender = producing.makeHab("sender", undefined, { transferable: true });
    const timers: number[] = [];
    const runtime = yield* createAgentRuntime(receiving, {
      enableMailboxStore: true,
      services: {
        clock: {
          ...defaultRuntimeServices.clock,
          setTimeout(callback, ms) {
            timers.push(ms);
            return setTimeout(callback, ms);
          },
        },
      },
    });
    let mode = "drain", expectedSn = 0, received = 0, opened = 0;
    let peerEOF = Promise.withResolvers<void>();
    const peers = new Set<Socket>();
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      peers.add(socket);
      socket.on("error", () => {});
      socket.on("data", (bytes) => received += bytes.length);
      socket.once("end", () => peerEOF.resolve());
      const proof = acceptedEventReplayMessage(producing, sender.pre, expectedSn).message;
      if (mode === "deadline") {
        const activity = setInterval(() => socket.write(proof), 5);
        socket.once("close", () => clearInterval(activity));
        socket.write(proof);
      } else socket.end(proof);
      socket.once("close", () => peers.delete(socket));
    });
    try {
      yield* call(() => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)));
      const url = `tcp://127.0.0.1:${(server.address() as { port: number }).port}`;
      // The connection owns its intake and borrows only the protocol processor from the host.
      const replies = {
        reactor: runtime.reactor,
      };
      const options = { replies, clock: runtime.services.clock, connectTimeoutMs: 1000, drainTimeoutMs: 40 };
      const preAborted = new AbortController();
      const cancellation = new Error("cancel before socket acquisition");
      preAborted.abort(cancellation);
      assertStrictEquals(
        yield* call(() =>
          assertRejects(() =>
            run(() =>
              streamCesrTcpConversation(url, async function*() {
                opened++;
              }, { ...options, signal: preAborted.signal })
            )
          )
        ),
        cancellation,
      );
      assertEquals(opened, 0);
      assertEquals(peers.size, 0);
      for (mode of ["drain", "txFault", "cancel", "deadline", "rxFault"]) {
        peerEOF = Promise.withResolvers<void>();
        const verified = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
        const txReturning = Promise.withResolvers<void>(), rxReturning = Promise.withResolvers<void>();
        const txCleanup = Promise.withResolvers<void>(), rxCleanup = Promise.withResolvers<void>();
        let continued = false, eof = false;
        const fault = new Error("outgoing source infrastructure failure");
        const source = async function*(signal: AbortSignal) {
          try {
            yield Uint8Array.of(9);
            await new Promise<void>((resolve, reject) => {
              release.promise.then(resolve, reject);
              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            });
            if (mode === "txFault") throw fault;
            yield Uint8Array.of(8);
            eof = true;
          } finally {
            txReturning.resolve();
            if (mode === "cancel") await txCleanup.promise;
          }
        };
        runtime.reactor.exchanger.processEscrows = function*() {
          assertEquals(receiving.db.getKever(sender.pre)?.sn, expectedSn);
          verified.resolve();
          if (mode === "rxFault") throw fault;
          if (mode === "cancel") {
            yield* resource<void>(function*(provide) {
              try {
                yield* provide();
              } finally {
                rxReturning.resolve();
                yield* call(() => rxCleanup.promise);
              }
            });
            yield* suspend();
          }
        };
        const task = run(function*() {
          const result = yield* streamCesrTcpConversation(url, source, options);
          continued = true;
          return result;
        });
        // Bound every deliberately blocked peer/source fixture without keeping a timer after it resolves.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const promptly = <T>(pending: Promise<T>) =>
          Promise.race([
            pending,
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error("Conversation stalled")), 2000);
            }),
          ]).finally(() => clearTimeout(timer));
        try {
          yield* call(() => promptly(verified.promise));
          assertEquals(eof, false, "signed reply reaches durable state before outgoing EOF");
          assertEquals(continued, false);
          assertEquals(timers.filter((ms) => ms === 40).length, 0, "drain deadline starts at TX EOF");
          if (mode === "cancel") {
            let joined = false;
            const halted = task.halt().then(() => joined = true);
            yield* call(() => promptly(Promise.all([txReturning.promise, rxReturning.promise])));
            assertEquals(joined, false);
            txCleanup.resolve();
            yield* call(() => Promise.resolve());
            assertEquals(joined, false);
            rxCleanup.resolve();
            yield* call(() => halted);
            assertEquals(continued, false);
          } else {
            release.resolve();
            if (mode === "txFault" || mode === "rxFault") {
              assertStrictEquals(yield* call(() => assertRejects(() => Promise.resolve(task))), fault);
            } else if (mode === "deadline") {
              yield* call(() => assertRejects(() => Promise.resolve(task), Error, "drain deadline exceeded"));
              assertEquals(
                timers.filter((ms) => ms === 40).length,
                1,
                "reply activity cannot refresh the half-close deadline",
              );
            } else {
              const result = yield* call(() => Promise.resolve(task));
              assertEquals(result, {
                kind: "conversationDrained",
                transmission: { kind: "transmitted", bytes: 2 },
                receive: { kind: "eof", processedFrames: 1 },
              });
              yield* call(() => promptly(peerEOF.promise));
              assertEquals(received, 2, "peer RX EOF does not end local TX");
            }
          }
          assertEquals(
            runtime.cues.toArray().map((cue) =>
              cue.kin === "receipt"
                ? [cue.kin, cue.serder.pre, cue.serder.said]
                : cue.kin === "keyStateSaved"
                ? [cue.kin, cue.ksn.i, cue.ksn.d]
                : [cue.kin]
            ),
            [["receipt", sender.pre, sender.kever!.said], ["keyStateSaved", sender.pre, sender.kever!.said]],
          );
          runtime.cues.clear(); // Verified cues remain ordinary queued work after the conversation joins.
        } finally {
          clearTimeout(timer);
          release.resolve();
          txCleanup.resolve();
          rxCleanup.resolve();
          yield* call(() => task.halt());
        }
        timers.length = 0;
        sender.interact();
        expectedSn++;
      }
    } finally {
      for (const socket of peers) socket.destroy();
      yield* call(() =>
        new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      );
      yield* runtime.close();
      yield* producing.close();
      yield* receiving.close();
    }
  });
});

Deno.test("TCP streamed output stops pulling under socket pressure and joins source cleanup", async () => {
  const accepted = Promise.withResolvers<Socket>(), cleanup = Promise.withResolvers<void>();
  const returning = Promise.withResolvers<void>();
  const server = createServer({ allowHalfOpen: true, pauseOnConnect: true }, (socket) => {
    socket.on("error", () => {});
    accepted.resolve(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `tcp://127.0.0.1:${(server.address() as { port: number }).port}`;
  const services = defaultRuntimeServices;
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
  const task = run(function*() {
    yield* streamCesrTcp(url, source, { clock: services.clock });
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
    cleanup.resolve();
    await halt;
    assertEquals(continued, false);
  } finally {
    cleanup.resolve();
    await task.halt();
    socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

Deno.test("TCP output freezes its drain deadline and preserves source and cleanup failures", async () => {
  const sockets = new Set<Socket>();
  let received = 0, finish = false;
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    socket.on("data", (bytes) => received += bytes.length);
    socket.once("end", () => {
      if (finish) socket.end(Uint8Array.of(11, 12));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `tcp://127.0.0.1:${(server.address() as { port: number }).port}`;
  const services = defaultRuntimeServices;
  try {
    await assertRejects(
      () =>
        run(() =>
          streamCesrTcp(url, async function*() {
            await new Promise((resolve) => setTimeout(resolve, 30));
            yield Uint8Array.of(1, 2);
          }, { clock: services.clock, drainTimeoutMs: 10 })
        ),
      Error,
      "drain deadline",
    );
    assertEquals(received, 2, "active production outlives the later drain deadline");
    const fault = new Error("source cleanup infrastructure fault");
    let returned = 0;
    const failure = await assertRejects(
      () =>
        run(() =>
          streamCesrTcp(url, () => ({
            [Symbol.asyncIterator]() {
              return {
                next() {
                  return Promise.resolve({
                    done: false as const,
                    value: "invalid source chunk" as unknown as Uint8Array,
                  });
                },
                return() {
                  returned++;
                  return Promise.reject(fault);
                },
              };
            },
          }), { clock: services.clock, maxChunkBytes: 4 })
        ),
      AggregateError,
      "cleanup failed",
    );
    assertStrictEquals(failure.errors[1], fault);
    assertEquals(returned, 1);
    const openingFault = new Error("source factory infrastructure fault");
    assertStrictEquals(
      await assertRejects(() =>
        run(() =>
          streamCesrTcp(url, () => {
            throw openingFault;
          }, { clock: services.clock })
        )
      ),
      openingFault,
    );
    const faultyClock = {
      ...services.clock,
      setTimeout() {
        throw openingFault;
      },
    };
    const clockFailure = await assertRejects(() =>
      run(() =>
        sendCesrTcp(url, Uint8Array.of(1), {
          clock: faultyClock,
        })
      )
    );
    assertStrictEquals(clockFailure, openingFault);
    const emptyController = new AbortController();
    let emptyPulls = 0, emptyClosed = false;
    const emptySource = async function*() {
      const timer = setTimeout(() => emptyController.abort(openingFault), 0);
      try {
        // Finite even without the checkpoint: a regression cannot hang the entire test runner.
        while (emptyPulls < 65536) {
          emptyPulls++;
          yield new Uint8Array();
        }
      } finally {
        clearTimeout(timer);
        emptyClosed = true;
      }
    };
    const emptyFailure = await assertRejects(() =>
      run(() =>
        streamCesrTcp(url, emptySource, {
          clock: services.clock,
          signal: emptyController.signal,
          drainTimeoutMs: 100,
        })
      )
    );
    assertStrictEquals(emptyFailure, openingFault);
    assertEquals(emptyPulls > 0 && emptyPulls < 65536, true, "empty pulls allow timer cancellation before exhaustion");
    assertEquals(emptyClosed, true);
    for (const lateFailure of [undefined, new Error("late source cleanup failure")]) {
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
            // deno-lint-ignore no-unsafe-finally -- Intentionally model a late foreign cleanup failure.
            if (lateFailure) throw lateFailure;
          }
        }, { clock: services.clock })
      );
      try {
        await reading.promise;
        let halted = false;
        const halt = task.halt().then(() => halted = true);
        halt.catch(() => {});
        await returning.promise;
        assertEquals(halted, false, "a pending source read joins its cleanup");
        cleanup.resolve();
        if (lateFailure) assertStrictEquals(await assertRejects(() => halt), lateFailure);
        else await halt;
      } finally {
        cleanup.resolve();
        await task.halt().catch(() => {});
      }
    }
    finish = true;
    assertEquals(await run(() => sendCesrTcp(url, Uint8Array.of(3, 4), { clock: services.clock })), {
      kind: "transmitted",
      bytes: 2,
    });
    assertEquals(received, 4);
    assertEquals(
      await run(() =>
        streamCesrTcp(url, async function*() {
          for (let index = 0; index < 3; index++) yield Uint8Array.of(5, 6);
        }, { clock: services.clock })
      ),
      { kind: "transmitted", bytes: 6 },
    );
    assertEquals(received, 10);
    const borrowed = createConnection({ host: "127.0.0.1", port: (server.address() as { port: number }).port });
    try {
      await new Promise<void>((resolve) => borrowed.once("connect", resolve));
      for (let index = 0; index < 2; index++) {
        assertEquals(
          await run(() =>
            writeCesrTcpSocket(borrowed, async function*() {
              yield Uint8Array.of(7, 8);
            }, { clock: services.clock })
          ),
          { kind: "transmitted", bytes: 2 },
        );
        assertEquals(borrowed.writableEnded, false, "a reply cannot end the next frame's output direction");
      }
      let succeeded = false;
      await run(() => writeCesrTcpSocket(borrowed, () => Promise.reject(undefined), { clock: services.clock })).then(
        () => succeeded = true,
        (error) => assertEquals(error, undefined),
      );
      assertEquals(succeeded, false, "undefined source rejection cannot become transmitted success");
    } finally {
      borrowed.destroy();
      await new Promise<void>((resolve) => borrowed.closed ? resolve() : borrowed.once("close", resolve));
    }
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

Deno.test("TCP application composes raw duplex siblings over a real borrowed connection", async () => {
  const services = defaultRuntimeServices;
  const reply = Uint8Array.of(3, 4, 5);
  let closed = false;
  const incoming: number[] = [], outgoing: number[] = [];
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    socket.on("data", (chunk) => outgoing.push(...chunk));
    socket.once("end", () => socket.end(reply));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await run(function*() {
      const connection = yield* openTcpConnection(
        `tcp://127.0.0.1:${(server.address() as { port: number }).port}`,
      );
      const read = yield* spawn(() =>
        abortable(async (signal) => {
          try {
            for await (const bytes of socketBytes(connection.socket, { signal, maxChunkBytes: 4 })) {
              incoming.push(...bytes);
            }
          } finally {
            closed = true;
          }
        }, connection.signal)
      );
      const sent = yield* sendCesrTcpSocket(connection, async function*() {
        yield Uint8Array.of(1, 2);
      }, { clock: services.clock });
      yield* read;
      return sent;
    });
    assertEquals(result, { kind: "transmitted", bytes: 2 });
    assertEquals(incoming, [...reply]);
    assertEquals(outgoing, [1, 2]);
    assertEquals(closed, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
