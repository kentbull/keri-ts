import { run } from "effection";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { abortable } from "../../../src/app/abortable.ts";

Deno.test("abortable joins cancelled I/O cleanup before its task halts", async () => {
  let signal!: AbortSignal;
  let release!: () => void;
  let started!: () => void;
  let cleaned = false;
  let continued = false;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const cleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  const task = run(function*() {
    yield* abortable(async (ownedSignal) => {
      signal = ownedSignal;
      started();
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      // A gated close models a file or transport that releases its resource asynchronously.
      await cleanup;
      cleaned = true;
    });
    continued = true;
  });
  await ready;
  let halted = false;
  const halt = task.halt().then(() => {
    halted = true;
  });
  await Promise.resolve();
  assertEquals(signal.aborted, true);
  assertEquals(halted, false);
  assertEquals(cleaned, false);
  release();
  await halt;
  assertEquals(cleaned, true);
  assertEquals(halted, true);
  assertEquals(continued, false);
});

Deno.test("abortable preserves the leaf result and failure and rejects an aborted upstream", async () => {
  const value = await run(() => abortable(() => Promise.resolve(42)));
  assertEquals(value, 42);
  await assertRejects(
    () => run(() => abortable(() => Promise.reject(new Error("leaf failed")))),
    Error,
    "leaf failed",
  );
  let started = false;
  const signal = AbortSignal.abort(new Error("upstream stopped"));
  await assertRejects(
    () =>
      run(function*() {
        // A cancelled request must not start another storage or network operation.
        return yield* abortable(() => {
          started = true;
          return Promise.resolve();
        }, signal);
      }),
    Error,
    "upstream stopped",
  );
  assertEquals(started, false);
});

Deno.test("abortable preserves foreign I/O failures while joining cancellation", async () => {
  for (const aggregate of [false, true]) {
    const ready = Promise.withResolvers<void>();
    const failure = new Error("I/O cleanup failed");
    const task = run(() =>
      abortable(async (signal) => {
        ready.resolve();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        throw aggregate ? new AggregateError([signal.reason, failure], "Read and cleanup failed") : failure;
      })
    );
    await ready.promise;
    assertStrictEquals(await assertRejects(() => task.halt()), failure);
  }
});

Deno.test("abortable suppresses its own abort reason after joining the leaf", async () => {
  const ready = Promise.withResolvers<void>();
  const task = run(() =>
    abortable(async (signal) => {
      ready.resolve();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      signal.throwIfAborted();
    })
  );
  await ready.promise;
  await task.halt();
});

Deno.test("abortable preserves already reported aggregate failures without duplicating them", async () => {
  const failure = new AggregateError([new Error("read failed"), new Error("close failed")], "I/O failed");
  assertStrictEquals(await assertRejects(() => run(() => abortable(() => Promise.reject(failure)))), failure);
});
