import { run } from "effection";
import { assertEquals, assertRejects } from "jsr:@std/assert";
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
