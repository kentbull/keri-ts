import { assertEquals, assertRejects } from "jsr:@std/assert";
import { each, run } from "npm:effection@^3.6.0";
import { toEffectionFrames } from "../../effection.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { counterV2 } from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
import { encode } from "../fixtures/stream-byte-fixtures.ts";

/** One independently pinned native body in an exact one-frame enclosure. */
const frame = counterV2(CtrDexV2.BodyWithAttachmentGroup, KERIPY_NATIVE_V2_ICP_FIX_BODY.length / 4)
  + KERIPY_NATIVE_V2_ICP_FIX_BODY;

Deno.test("Effection frames: early consumer return closes input without pulling siblings", async () => {
  let pulls = 0;
  let closed = false;
  await run(function*() {
    const channel = yield* toEffectionFrames(async function*(signal) {
      try {
        pulls++;
        // Declare both children but deliver only the first before the next output credit.
        yield encode(counterV2(CtrDexV2.GenericGroup, frame.length / 2) + frame);
        signal.throwIfAborted();
        pulls++;
        yield encode(frame);
      } finally {
        closed = true;
      }
    });
    for (const result of yield* each(channel.frames)) {
      assertEquals(result.body.kind, "CESR");
      break;
    }
  });
  assertEquals(pulls, 1);
  assertEquals(closed, true);
});

Deno.test("Effection frames: halting a pending read joins source cleanup", async () => {
  // The test owns this notification; only the adapter's signal can release the blocked source.
  const started = Promise.withResolvers<void>();
  let closed = false;
  let aborted = false;
  let continued = false; // Cancellation must not resume the caller after a joined cleanup.
  const task = run(function*() {
    const channel = yield* toEffectionFrames(async function*(signal) {
      try {
        yield encode(frame.slice(0, 4));
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(signal.reason);
          }, { once: true });
          started.resolve();
        });
      } finally {
        closed = true;
      }
    });
    const subscription = yield* channel.frames;
    yield* subscription.next();
    continued = true;
  });
  await started.promise;
  await task.halt();
  assertEquals(aborted, true);
  assertEquals(continued, false);
  assertEquals(closed, true);
});

Deno.test("Effection frames: consumer failures close the source and subscriptions cannot fork it", async () => {
  let closed = false;
  await assertRejects(
    () =>
      run(function*() {
        const channel = yield* toEffectionFrames(async function*() {
          try {
            yield encode(frame);
          } finally {
            closed = true;
          }
        });
        const subscription = yield* channel.frames;
        assertEquals((yield* subscription.next()).done, false);
        // A second subscriber could steal bytes, so the production adapter rejects it.
        yield* channel.frames;
      }),
    Error,
    "already has a subscriber",
  );
  assertEquals(closed, true);
});
