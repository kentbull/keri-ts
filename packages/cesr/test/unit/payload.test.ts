import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { collectPayload, MemoryPayloadSink, type Payload } from "../../src/core/payload.ts";

Deno.test("payload memory sink copies writes into slabs independently of chunk count", async () => {
  const sink = new MemoryPayloadSink();
  const input = new Uint8Array(35000).fill(42);
  await sink.write(input);
  // Awaited writes take ownership of a copy, so the producer may reuse input.
  input.fill(17);
  await sink.write(input);
  const payload = await sink.finish();
  // Finishing transfers ownership; abort must not revoke the completed value.
  await sink.abort();
  assertEquals(payload.size, 70000);
  const first = await collectPayload(payload);
  assertEquals(first.subarray(0, 35000), new Uint8Array(35000).fill(42));
  assertEquals(first.subarray(35000), input);
  first.fill(0);
  assertEquals((await collectPayload(payload))[0], 42);
  const sizes: number[] = [];
  for await (const chunk of payload.open()) sizes.push(chunk.length);
  // Two arbitrary writes become fixed-size slabs, limiting per-chunk metadata.
  assertEquals(sizes, [65536, 4464]);
  await assertRejects(() => sink.write(input), Error, "finished");
  await assertRejects(() => sink.finish(), Error, "finished");
});

Deno.test("payload collection rejects size claims and closes the source on overrun", async () => {
  let opens = 0;
  let closes = 0;
  const payload: Payload = {
    size: 1,
    async *open() {
      opens++;
      try {
        // Deliberately lie about size to exercise the public collection boundary.
        yield new Uint8Array(2);
      } finally {
        closes++;
      }
    },
  };
  for (const size of [-1, NaN, Infinity, 1.5]) {
    await assertRejects(() => collectPayload({ size, open: payload.open }), RangeError, "Invalid payload size");
  }
  assertEquals(opens, 0, "Invalid declared extents must fail before source acquisition");
  await assertRejects(() => collectPayload(payload), RangeError, "declared size");
  assertEquals(closes, 1);
  await assertRejects(() => collectPayload({ size: 3, open: payload.open }), RangeError, "shorter");
  assertEquals(closes, 2);
});

Deno.test("payload cancellation releases unfinished memory and reaches owned readers", async () => {
  const controller = new AbortController();
  const sink = new MemoryPayloadSink(controller.signal);
  await sink.write(new Uint8Array(2));
  controller.abort(new Error("cancelled"));
  await assertRejects(() => sink.finish(), Error, "cancelled");
  await sink.abort();
  assertThrows(() => new MemoryPayloadSink(controller.signal), Error, "cancelled");
  let opened = false;
  const source: Payload = {
    size: 0,
    async *open() {
      opened = true;
    },
  };
  await assertRejects(() => collectPayload(source, controller.signal), Error, "cancelled");
  assertEquals(opened, false);

  const reading = new AbortController();
  const pending: Payload = {
    size: 1,
    async *open(signal) {
      // Model an owned source waiting for input; return() alone cannot wake it.
      await new Promise<void>((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
      });
      yield new Uint8Array(1);
    },
  };
  const collected = collectPayload(pending, reading.signal);
  reading.abort(new Error("reader cancelled"));
  await assertRejects(() => collected, Error, "reader cancelled");
});

Deno.test("payload zero-length content finishes and reopens", async () => {
  const sink = new MemoryPayloadSink();
  await sink.write(new Uint8Array());
  const payload = await sink.finish();
  assertEquals(await collectPayload(payload), new Uint8Array());
});

Deno.test("payload owner disposal invalidates memory readers and is idempotent", async () => {
  const sink = new MemoryPayloadSink();
  await sink.write(new Uint8Array([7]));
  const payload = await sink.finish();
  // Views cannot extend the owner's storage lifetime after explicit disposal.
  await payload.discard();
  await payload.discard();
  await assertRejects(() => collectPayload(payload), Error, "discarded");
});
