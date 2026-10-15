import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { GroupSizeError, ShortageError } from "../../../src/core/errors.ts";
import { Cursor } from "../../../src/parser/cursor.ts";

/** A finite source with separate backing buffers like transport-owned chunks. */
async function* source(...chunks: number[][]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield new Uint8Array(chunk);
}

/** Bound cancellation tests without leaving timeout handles behind. */
async function timely<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Cursor cancellation did not finish")), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

Deno.test("cursor: peeks and owned reads span every split without advancing on peek", async () => {
  const bytes = Uint8Array.from({ length: 16 }, (_, i) => i);
  // Include empty edge chunks and every point where a header can cross a segment.
  for (let split = 0; split <= bytes.length; split++) {
    const input = new Cursor(source([...bytes.slice(0, split)], [...bytes.slice(split)]));
    assertEquals(await input.peek(4), bytes.slice(0, 4));
    assertEquals(input.offset, 0);
    const first = await input.read(4);
    assertEquals(first, bytes.slice(0, 4));
    assertEquals(first.buffer.byteLength, 4);
    assertEquals(await input.read(12), bytes.slice(4));
    assertEquals(input.offset, 16);
    assertEquals(await input.atEnd(), true);
    await input.close();
  }
});

Deno.test("cursor: scopes share position and never consume already queued sibling bytes", async () => {
  const input = new Cursor(source([1, 2, 3, 4, 5]));
  const outer = input.scope(4);
  const inner = outer.scope(2);
  // Mutating an owned peek must not change queued bytes or the parent's later reads.
  const peek = await inner.peek(2);
  peek[0] = 99;
  assertEquals(await inner.read(2), new Uint8Array([1, 2]));
  inner.expectEnd();
  assertEquals(await inner.atEnd(), true);
  assertEquals(await inner.take(100), new Uint8Array());
  await assertRejects(() => inner.read(1), GroupSizeError);
  assertEquals(input.bufferedBytes, 3);
  assertThrows(() => outer.expectEnd(), GroupSizeError);
  assertEquals(await outer.read(2), new Uint8Array([3, 4]));
  outer.expectEnd();
  assertEquals(await input.read(1), new Uint8Array([5]));
  await assertRejects(() => inner.take(1), GroupSizeError);
  await input.close();
});

Deno.test("cursor: impossible child extents fail before any source pull", async () => {
  let pulls = 0;
  const input = new Cursor({
    [Symbol.asyncIterator]() {
      return {
        next() {
          pulls++;
          return new Promise<IteratorResult<Uint8Array>>(() => {});
        },
      };
    },
  });
  // An impossible extent must fail even though calling next would wait forever.
  const scope = input.scope(3);
  assertThrows(() => scope.scope(4), GroupSizeError);
  await assertRejects(() => scope.peek(4), GroupSizeError);
  await assertRejects(() => scope.read(4), GroupSizeError);
  assertEquals(await scope.scope(0).atEnd(), true);
  assertEquals(pulls, 0);
  await input.close();
});

Deno.test("cursor: premature EOF is a shortage, while root and exact scope ends are clean", async () => {
  const input = new Cursor(source([1, 2]));
  // The same physical EOF is clean for the root but truncates this declared enclosure.
  const scope = input.scope(4);
  const error = await assertRejects(() => scope.read(3), ShortageError);
  assertEquals([error.needed, error.available, error.offset], [3, 2, 0]);
  assertEquals(await scope.read(2), new Uint8Array([1, 2]));
  await assertRejects(() => scope.atEnd(), ShortageError);
  await assertRejects(() => scope.take(1), ShortageError);
  assertEquals(await input.atEnd(), true);
  assertEquals(await input.take(1), new Uint8Array());
  await input.close();
});

Deno.test("cursor: demand pulls one segment and releases consumed backing buffers", async () => {
  let pulls = 0;
  const chunkBytes = 1024;
  const input = new Cursor({
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < 1024; i++) {
        pulls++;
        yield new Uint8Array(chunkBytes).fill(i % 256);
      }
    },
  });
  // Transfer many chunks without collecting results; each completed write releases its segment.
  for (let i = 0; i < 1024; i++) {
    assertEquals(pulls, i);
    assertEquals(await input.peek(1), new Uint8Array([i % 256]));
    const chunk = await input.take(chunkBytes * 2);
    assertEquals(chunk.length, chunkBytes);
    assertEquals(input.bufferedBytes, 0);
    assertEquals(pulls, i + 1);
  }
  assertEquals(input.offset, 1024 ** 2);
  await input.close();
});

Deno.test("cursor: abort interrupts blocked next and closes an uncooperative source once", async () => {
  const controller = new AbortController();
  let nextStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    nextStarted = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let returns = 0;
  const generator = (async function*() {
    nextStarted();
    await gate;
    yield new Uint8Array([1]);
  })();
  const originalReturn = generator.return.bind(generator);
  generator.return = (value) => {
    returns++;
    return originalReturn(value);
  };
  const input = new Cursor(generator, { signal: controller.signal });
  const reason = new Error("cancel input");
  const reading = assertRejects(() => input.read(1), Error, reason.message);
  await started;
  controller.abort(reason);
  await timely(reading);
  await timely(input.close());
  await timely(input.close());
  assertEquals(returns, 1);
  // Release the test-owned source after proving cursor shutdown does not depend on it.
  release();
  await originalReturn();
});

Deno.test("cursor: cancellation targets only the pending read after completed pulls", async () => {
  const controller = new AbortController();
  // Complete many pulls before blocking, exercising replacement of the local cancellation waiter.
  let pulls = 0;
  let pending!: () => void;
  const blocked = new Promise<void>((resolve) => {
    pending = resolve;
  });
  const input = new Cursor({
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (pulls++ < 128) return Promise.resolve({ done: false as const, value: new Uint8Array([1]) });
          pending();
          return new Promise<IteratorResult<Uint8Array>>(() => {});
        },
        return() {
          return Promise.resolve({ done: true as const, value: undefined });
        },
      };
    },
  }, { signal: controller.signal });
  for (let i = 0; i < 128; i++) await input.read(1);
  const reading = assertRejects(() => input.read(1), Error, "finished pulls");
  await blocked;
  controller.abort(new Error("finished pulls"));
  await timely(reading);
  await timely(input.close());
});

Deno.test("cursor: explicit close interrupts a pending read and rejects concurrent scope reads", async () => {
  let returns = 0;
  let pulls = 0;
  const input = new Cursor({
    [Symbol.asyncIterator]() {
      return {
        next() {
          pulls++;
          return new Promise<IteratorResult<Uint8Array>>(() => {});
        },
        return() {
          returns++;
          return Promise.resolve({ done: true as const, value: undefined });
        },
      };
    },
  });
  // Parent and child use one position; close is allowed while a read owns that position.
  const child = input.scope(2);
  const reading = assertRejects(() => child.peek(1), DOMException, "Cursor closed");
  await assertRejects(() => input.read(1), Error, "concurrently");
  await timely(input.close());
  await timely(reading);
  assertEquals([pulls, returns], [1, 1]);
  await assertRejects(() => child.read(1), DOMException, "Cursor closed");
});

Deno.test("cursor: empty chunks, zero-size reads, and invalid extents do not fabricate input", async () => {
  // Empty transport chunks provide no EOF signal; only iterator exhaustion ends the root.
  const input = new Cursor(source([], [1], []));
  assertEquals(await input.read(0), new Uint8Array());
  assertEquals(await input.peek(0), new Uint8Array());
  assertEquals(await input.atEnd(), false);
  assertEquals(await input.read(1), new Uint8Array([1]));
  assertEquals(await input.atEnd(), true);
  assertThrows(() => input.scope(Number.MAX_SAFE_INTEGER), GroupSizeError);
  await assertRejects(() => input.read(-1), RangeError);
  await assertRejects(() => input.take(0), RangeError);
  await input.close();
});

Deno.test("cursor: empty producer work yields to cancellation without retaining timer or input", async () => {
  const controller = new AbortController();
  const reason = new Error("empty producer cancelled");
  let closed = false, pulls = 0;
  const input = new Cursor(
    (async function*() {
      try {
        while (true) {
          pulls++;
          yield new Uint8Array();
        }
      } finally {
        closed = true;
      }
    })(),
    { signal: controller.signal },
  );
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    assertStrictEquals(await timely(assertRejects(() => input.read(1))), reason);
    await input.close();
    assertEquals(closed, true);
    assertEquals(pulls > 0 && pulls <= 4096, true);
  } finally {
    clearTimeout(timer);
    await input.close();
  }
});

Deno.test("cursor: consumed-byte checkpoints span child scopes without changing their extent", async () => {
  const bytes = new Uint8Array(65536).fill(7);
  const input = new Cursor((async function*() {
    yield bytes;
  })());
  const child = input.scope(bytes.length);
  let timerRan = false;
  const timer = setTimeout(() => {
    timerRan = true;
  }, 0);
  try {
    assertEquals(await child.read(bytes.length), bytes);
    assertEquals(timerRan, true);
    assertEquals([child.remaining, input.offset], [0, bytes.length]);
  } finally {
    clearTimeout(timer);
    await input.close();
  }
});
