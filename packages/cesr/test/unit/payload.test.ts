import { assertEquals, assertRejects } from "jsr:@std/assert";
import { collectPayload, type Payload } from "../../src/core/payload.ts";

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

Deno.test("payload cancellation reaches actual transport readers", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
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
