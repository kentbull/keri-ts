import { concatBytes, ResourceLimitError } from "cesr-ts";
import { run } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { once } from "node:events";
import { createConnection, createServer, type Socket } from "node:net";
import { createHabery, type Habery } from "../../../src/app/habbing.ts";
import { socketBytes } from "../../../src/app/socket-source.ts";
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
        // One request is completed before the next complete event is admitted for delivery.
        yield* sendWitnessMessage(
          controller,
          witness.pre,
          concatBytes(...hby.db.clonePreIter(controller.pre)),
          "Bearer fixture",
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
    const response = socketBytes(client, { signal: controller.signal, maxChunkBytes: 3 });
    socket.end(Uint8Array.of(8, 9));
    assertEquals((await response.next()).value, Uint8Array.of(8, 9));
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
