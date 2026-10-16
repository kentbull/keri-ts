import { assertEquals, assertRejects } from "jsr:@std/assert";
import { collectBytes, fileBytes, streamBytes } from "../../../src/app/byte-source.ts";
import { requestBytes } from "../../../src/app/cesr-http.ts";

Deno.test("transport reads wait for consumption and cancel on early return", async () => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array([pulls]));
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const source = streamBytes(stream);
  assertEquals(pulls, 0);
  assertEquals((await source.next()).value, new Uint8Array([1]));
  // Zero read-ahead makes an extra pull observable while the consumer holds its first chunk.
  await Promise.resolve();
  assertEquals(pulls, 1);
  await source.return(undefined);
  assertEquals(cancelled, true);
  assertEquals(stream.locked, false);
  const cleanup = new Error("transport cancel failed");
  let finish = (_error: Error) => {}, cancels = 0;
  const gate = new Promise<void>((_resolve, reject) => finish = reject);
  const failing = new ReadableStream<Uint8Array>({
    pull(current) {
      current.enqueue(Uint8Array.of(1));
    },
    cancel() {
      cancels++;
      return gate;
    },
  }, { highWaterMark: 0 });
  const owned = streamBytes(failing);
  await owned.next();
  let joined = false;
  const returning = owned.return(undefined).finally(() => joined = true);
  const rejected = assertRejects(() => returning);
  await Promise.resolve();
  assertEquals([joined, failing.locked, cancels], [false, true, 1]);
  finish(cleanup);
  assertEquals(await rejected, cleanup, "Early return must expose cleanup failure after joining it");
  assertEquals([joined, failing.locked, cancels], [true, false, 1]);
});

Deno.test("transport abort interrupts a pending read and releases its reader", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const controller = new AbortController();
  const source = streamBytes(stream, { signal: controller.signal });
  const read = source.next();
  // This source never supplies bytes: only cancellation can settle the pending read.
  controller.abort(new Error("stop"));
  await assertRejects(() => read, Error, "stop");
  assertEquals(cancelled, true);
  assertEquals(stream.locked, false);
  const primary = new Error("abort primary"), cleanup = new Error("abort cleanup");
  let cancels = 0;
  const broken = new ReadableStream<Uint8Array>({
    cancel() {
      cancels++;
      throw cleanup;
    },
  });
  const abort = new AbortController(), input = streamBytes(broken, { signal: abort.signal });
  const pending = input.next();
  const rejected = assertRejects(() => pending, AggregateError);
  abort.abort(primary);
  assertEquals((await rejected).errors, [primary, cleanup]);
  assertEquals([broken.locked, cancels], [false, 1], "Abort/finally share exactly one cancel and always unlock");
});

Deno.test("transport failures preserve identity and collection joins its source", async () => {
  const fault = new Error("native read fault");
  const errored = new ReadableStream<Uint8Array>({
    start(current) {
      current.error(fault);
    },
  });
  assertEquals(
    await assertRejects(() => streamBytes(errored).next()),
    fault,
    "Repeated native fault preserves identity",
  );
  assertEquals(errored.locked, false);
  let closed = false;
  async function* chunks() {
    // Collection preserves both chunks and closes the finite source.
    try {
      yield new Uint8Array(4);
      yield new Uint8Array(4);
    } finally {
      closed = true;
    }
  }
  assertEquals((await collectBytes(chunks())).length, 8);
  assertEquals(closed, true);
});

Deno.test("CESR HTTP appends attachment headers after streamed bodies for both media types", async () => {
  for (const type of ["application/cesr", "application/cesr+json"]) {
    const req = new Request("http://example.test", {
      method: "POST",
      headers: { "content-type": type, "CESR-ATTACHMENT": "-AAA" },
      body: new Uint8Array([1, 2]),
    });
    // The four ASCII attachment bytes follow the body, including for KERIpy's +json media type.
    assertEquals(await collectBytes(requestBytes(req)), new Uint8Array([1, 2, 45, 65, 65, 65]));
  }
});

Deno.test("file input yields fixed-size buffers and closes on early return", async () => {
  const path = await Deno.makeTempFile();
  try {
    await Deno.writeFile(path, new Uint8Array([1, 2, 3, 4, 5]));
    const source = fileBytes(path, { maxChunkBytes: 3 });
    assertEquals((await source.next()).value, new Uint8Array([1, 2, 3]));
    // Deno's resource sanitizer verifies that returning before EOF closes the file handle.
    await source.return(undefined);
  } finally {
    await Deno.remove(path);
  }
});
