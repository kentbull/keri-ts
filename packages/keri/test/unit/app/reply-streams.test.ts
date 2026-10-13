import { ResourceLimitError } from "cesr-ts";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { ReplyStreams } from "../../../src/app/reply-streams.ts";

Deno.test("HTTP replay pulls one bounded chunk and closes its iterator on cancellation", async () => {
  const replies = new ReplyStreams({ maxStreams: 1, maxChunkBytes: 2 });
  let events = 0;
  let closed = false;
  const messages = {
    *[Symbol.iterator]() {
      try {
        events++;
        yield Uint8Array.of(1, 2, 3);
        events++;
        yield Uint8Array.of(4);
      } finally {
        closed = true;
      }
    },
  };
  const body = replies.open(messages);
  // A Response may wait indefinitely before the client requests any bytes.
  await Promise.resolve();
  assertEquals(events, 0);
  assertThrows(() => replies.open([]), ResourceLimitError);
  const reader = body.getReader();
  assertEquals((await reader.read()).value, Uint8Array.of(1, 2));
  assertEquals(events, 1);
  assertEquals((await reader.read()).value, Uint8Array.of(3));
  assertEquals(events, 1);
  await reader.cancel();
  reader.releaseLock();
  assertEquals(closed, true);
  // Cancelling the first response returns its admission credit without advancing to event two.
  const next = replies.open([]);
  await next.cancel();
  replies.close();
});

Deno.test("runtime shutdown errors live replies and releases every replay iterator", async () => {
  const replies = new ReplyStreams();
  let closed = 0;
  const messages = {
    *[Symbol.iterator]() {
      try {
        yield Uint8Array.of(1);
        yield Uint8Array.of(2);
      } finally {
        closed++;
      }
    },
  };
  const readers = [replies.open(messages).getReader(), replies.open(messages).getReader()];
  for (const reader of readers) await reader.read();
  replies.close();
  assertEquals(closed, 2);
  for (const reader of readers) {
    await assertRejects(() => reader.read(), DOMException, "Runtime closed");
    reader.releaseLock();
  }
});

Deno.test("HTTP replay enforces its finite event limit before transferring bytes", async () => {
  const replies = new ReplyStreams({ maxMessageBytes: 2 });
  const reader = replies.open([Uint8Array.of(1, 2, 3)]).getReader();
  await assertRejects(() => reader.read(), ResourceLimitError, "Replay message");
  reader.releaseLock();
  replies.close();
});
