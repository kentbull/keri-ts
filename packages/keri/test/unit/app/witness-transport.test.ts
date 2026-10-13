import { concatBytes, ResourceLimitError } from "cesr-ts";
import { run } from "effection";
import { assertEquals, assertRejects } from "jsr:@std/assert";
import { createHabery, type Habery } from "../../../src/app/habbing.ts";
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
