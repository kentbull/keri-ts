import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { ReplyStreams } from "../../../src/app/reply-streams.ts";

Deno.test("nonempty replies retain a primed event through cancellation or runtime close", async () => {
  const replies = new ReplyStreams();
  let events = 0, closed = 0, disposed = 0;
  const messages = {
    *[Symbol.iterator]() {
      try {
        yield new Uint8Array();
        events++;
        yield Uint8Array.of(1, 2, 3);
        events++;
        yield Uint8Array.of(4);
      } finally {
        closed++;
      }
    },
  };
  assertEquals(replies.openNonEmpty([], () => disposed++), null);
  assertEquals(disposed, 1);
  const first = replies.openNonEmpty(messages, () => disposed++)!;
  assertEquals(events, 1);
  const reader = first.getReader();
  assertEquals((await reader.read()).value, Uint8Array.of(1, 2, 3));
  assertEquals(events, 1, "Primed bytes are neither duplicated nor advanced past event one");
  await reader.cancel();
  reader.releaseLock();
  assertEquals([closed, disposed], [1, 2]);
  const pending = replies.openNonEmpty(messages)!;
  replies.close();
  const waiting = pending.getReader();
  await assertRejects(() => waiting.read(), DOMException, "Runtime closed");
  waiting.releaseLock();
  assertEquals([events, closed], [2, 2]);
  const next = new ReplyStreams();
  const fault = new Error("prime failed"), cleanup = new Error("prime disposal failed");
  const failure = assertThrows(() =>
    next.openNonEmpty({
      *[Symbol.iterator]() {
        throw fault;
      },
    }, () => {
      throw cleanup;
    }), AggregateError);
  assertEquals(failure.errors, [fault, cleanup]);
  assertEquals(
    assertThrows(() =>
      next.openNonEmpty({
        [Symbol.iterator]() {
          return {
            next: () => ({ done: true, value: undefined }),
            return() {
              throw cleanup;
            },
          };
        },
      })
    ),
    cleanup,
    "Empty-response cleanup failure must not become a successful null result",
  );
  const Stream = globalThis.ReadableStream;
  globalThis.ReadableStream = class {
    constructor() {
      throw fault;
    }
  } as unknown as typeof ReadableStream;
  try {
    assertEquals(assertThrows(() => next.openNonEmpty(messages)), fault);
  } finally {
    globalThis.ReadableStream = Stream;
  }
  assertEquals(closed, 3, "Failed stream publication disposes the primed owner");
  next.close();
});

Deno.test("HTTP replay pulls one message and closes its iterator on cancellation", async () => {
  const replies = new ReplyStreams();
  const other = new ReplyStreams();
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
  const reader = body.getReader();
  assertEquals((await reader.read()).value, Uint8Array.of(1, 2, 3));
  assertEquals(events, 1);
  await reader.cancel();
  reader.releaseLock();
  assertEquals(closed, true);
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
  for (const invalid of [undefined, {}]) {
    assertThrows(
      () => other.open({ [Symbol.iterator]: () => invalid } as unknown as Iterable<Uint8Array>),
      TypeError,
      "iterator",
    );
  }
  const next = other.open([]);
  assertEquals((await next.getReader().read()).done, true);
  replies.close();
  other.close();
});

Deno.test("reply cleanup failures propagate after all readers close", async () => {
  const replies = new ReplyStreams();
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
  const readers = [replies.open(messages).getReader(), replies.open(messages).getReader()];
  for (const reader of readers) await reader.read();
  const failure = assertThrows(() => replies.close(), AggregateError, "Reply shutdown failed");
  assertEquals(failure.errors.length, 2);
  assertEquals(closed, 3);
  for (const reader of readers) {
    await assertRejects(() => reader.read(), AggregateError, "Reply cleanup failed");
    reader.releaseLock();
  }
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

Deno.test("transferred response ownership survives until source cleanup even without a pull", async () => {
  const replies = new ReplyStreams(), order: string[] = [];
  const messages: Iterable<Uint8Array> = {
    [Symbol.iterator]() {
      return {
        next: () => ({ done: false, value: Uint8Array.of(1) }),
        return() {
          order.push("source");
          return { done: true, value: undefined };
        },
      };
    },
  };
  const stream = replies.open(messages, () => order.push("owner"));
  assertEquals(order, []);
  await stream.cancel();
  assertEquals(order, ["source", "owner"]);
  assertThrows(
    () =>
      replies.open({
        [Symbol.iterator]() {
          throw new Error("acquisition");
        },
      }, () => order.push("failed")),
    Error,
    "acquisition",
  );
  const failed = replies.open([], () => {
    throw new Error("owner cleanup failed");
  }).getReader();
  await assertRejects(() => failed.read(), Error, "owner cleanup failed");
  failed.releaseLock();
  replies.close();
  assertThrows(() => replies.open([], () => order.push("closed")), Error, "closed");
  assertEquals(order, ["source", "owner", "failed", "closed"]);
});
