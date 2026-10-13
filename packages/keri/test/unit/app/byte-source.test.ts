// @file-test-lane app-fast-parallel

import { assertEquals, assertRejects } from "jsr:@std/assert";
import { ResourceLimitError } from "../../../../cesr/mod.ts";
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
});

Deno.test("transport budgets count backing buffers and finite collection closes overflowed sources", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(16).subarray(0, 1));
    },
  });
  await assertRejects(() => streamBytes(stream, { maxChunkBytes: 8 }).next(), ResourceLimitError);
  let closed = false;
  async function* chunks() {
    // Two small writes cross the aggregate budget without relying on a giant transport allocation.
    try {
      yield new Uint8Array(4);
      yield new Uint8Array(4);
    } finally {
      closed = true;
    }
  }
  await assertRejects(() => collectBytes(chunks(), 6), ResourceLimitError);
  assertEquals(closed, true);
});

Deno.test("CESR HTTP appends bounded attachment headers after streamed bodies for both media types", async () => {
  for (const type of ["application/cesr", "application/cesr+json"]) {
    const req = new Request("http://example.test", {
      method: "POST",
      headers: { "content-type": type, "CESR-ATTACHMENT": "-AAA" },
      body: new Uint8Array([1, 2]),
    });
    // The four ASCII attachment bytes follow the body, including for KERIpy's +json media type.
    assertEquals(await collectBytes(requestBytes(req), 6), new Uint8Array([1, 2, 45, 65, 65, 65]));
  }
  const req = new Request("http://example.test", {
    method: "POST",
    headers: { "content-type": "application/cesr", "CESR-ATTACHMENT": "-AAA" },
  });
  await assertRejects(() => collectBytes(requestBytes(req, { maxHeaderBytes: 3 }), 8), ResourceLimitError);
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
