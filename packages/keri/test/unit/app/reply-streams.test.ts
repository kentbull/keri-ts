import { ResourceAdmissionError, ResourceLimitError, ResourcePolicy } from "cesr-ts";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { ReplyStreams } from "../../../src/app/reply-streams.ts";

Deno.test("HTTP replay pulls one bounded chunk and closes its iterator on cancellation", async () => {
  const resources = new ResourcePolicy({ bytes: 5, streams: 2 });
  const replies = new ReplyStreams({ maxStreams: 1, maxMessageBytes: 3, maxChunkBytes: 2 }, resources);
  const other = new ReplyStreams({ maxMessageBytes: 3, maxChunkBytes: 2 }, resources);
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
        assertEquals(resources.used.bytes, 5, "credit outlives source cleanup");
        closed = true;
      }
    },
  };
  const body = replies.open(messages);
  let opened = false;
  assertThrows(
    () =>
      other.open({
        [Symbol.iterator]() {
          opened = true;
          return [][Symbol.iterator]();
        },
      }),
    ResourceAdmissionError,
    "busy",
  );
  assertEquals(opened, false);
  assertEquals(resources.used.bytes, 5);
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
  assertEquals(resources.used.bytes, 0);
  assertThrows(
    () =>
      other.open({
        [Symbol.iterator]() {
          throw new Error("source unavailable");
        },
      }),
    Error,
    "source unavailable",
  );
  assertEquals(resources.used.bytes, 0);
  for (const invalid of [undefined, {}]) {
    assertThrows(
      () => other.open({ [Symbol.iterator]: () => invalid } as unknown as Iterable<Uint8Array>),
      TypeError,
      "iterator",
    );
    assertEquals(resources.used.bytes, 0, "invalid caller iterators cannot retain admission");
  }
  assertThrows(
    () => new ReplyStreams({ maxMessageBytes: 6, maxChunkBytes: 1 }, resources).open([]),
    ResourceAdmissionError,
    "limit",
  );
  // Cancelling the first response returns its admission credit without advancing to event two.
  const next = other.open([]);
  assertEquals((await next.getReader().read()).done, true);
  assertEquals(resources.used.bytes, 0);
  replies.close();
  other.close();
});

Deno.test("reply cleanup failures propagate after all reservations and readers close", async () => {
  const resources = new ResourcePolicy();
  const replies = new ReplyStreams({}, resources);
  let closed = 0;
  const messages = {
    *[Symbol.iterator]() {
      try {
        yield Uint8Array.of(1);
      } finally {
        closed++;
        // deno-lint-ignore no-unsafe-finally -- exercise a storage cleanup failure during iterator.return().
        throw new Error("storage reader close failed");
      }
    },
  };
  const cancelled = replies.open(messages).getReader();
  await cancelled.read();
  await assertRejects(() => cancelled.cancel(), Error, "storage reader close failed");
  cancelled.releaseLock();
  assertEquals(resources.used.bytes, 0);
  const readers = [replies.open(messages).getReader(), replies.open(messages).getReader()];
  for (const reader of readers) await reader.read();
  const failure = assertThrows(() => replies.close(), AggregateError, "Reply shutdown failed");
  assertEquals(failure.errors.length, 2);
  assertEquals(closed, 3);
  assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
  for (const reader of readers) {
    await assertRejects(() => reader.read(), AggregateError, "Reply cleanup failed");
    reader.releaseLock();
  }
  replies.close();
});

Deno.test("runtime shutdown errors live replies and releases every replay iterator", async () => {
  const resources = new ResourcePolicy();
  const replies = new ReplyStreams({}, resources);
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
  assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
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
