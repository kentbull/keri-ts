/**
 * An idle runtime wakes on its tock and reads no store: every loop that scans rows scans only on tock 0, after a
 * write, or on its slow idle cadence; the delivery loops look only at their in-memory queues.
 */
import { call, run, spawn } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { createAgentRuntime, runAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { PROTOCOL_IDLE_TOCKS, PROTOCOL_TOCK_MS } from "../../../../src/app/runtime/doing.ts";
import { FakeRuntimeHttpClient, ManualRuntimeClock } from "../../../support/runtime-fakes.ts";

/** Let every pending macrotask run, so a loop that is not waiting on the clock shows itself. */
const settle = () => call(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

/** Wait until the count has not moved for two checks 25 ms apart, so a slow host's tock-0 passes have finished. */
function* quiesce(reads: () => number) {
  let last = -1, stable = 0;
  for (let attempt = 0; attempt < 200 && stable < 2; attempt++) {
    yield* call(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
    const now = reads();
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
}

/** Count every read the store port serves, whatever table asks. */
function countReads(store: object): { reads: () => number } {
  let reads = 0;
  // deno-lint-ignore no-explicit-any
  const target = store as any;
  for (let proto = target; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (!/^(get|cnt|scan|seek|has|fetch)/.test(name) || typeof target[name] !== "function") continue;
      const original = target[name];
      target[name] = function(...args: unknown[]) {
        reads++;
        return original.apply(this, args);
      };
    }
  }
  return { reads: () => reads };
}

Deno.test("an idle runtime reads no store between its first tock and its idle sweep, and a write is seen on the next tock", async () => {
  await run(function*() {
    // A fixed boundary start keeps the tock grid aligned with the manual clock.
    const clock = new ManualRuntimeClock(0);
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, skipSignator: true });
    try {
      const runtime = yield* createAgentRuntime(hby, new FakeRuntimeHttpClient(), clock);
      const counter = countReads(hby.db.store);
      yield* spawn(() => runAgentRuntime(runtime, { pollMailbox: false }));
      yield* quiesce(counter.reads);
      const first = counter.reads();
      assert(first > 0, "tock 0 scans each store-driven loop once");
      for (let tock = 1; tock < PROTOCOL_IDLE_TOCKS - 1; tock++) {
        clock.advance(PROTOCOL_TOCK_MS);
        yield* settle();
      }
      yield* quiesce(counter.reads);
      assertEquals(counter.reads(), first, "idle tocks read no store");
      // A row written between tocks is scanned on the next tock, with no wake.
      hby.db.oobis.pin(["http://idle.test/oobi/Eunknown"], { date: new Date(0).toISOString() } as never);
      const written = counter.reads();
      clock.advance(PROTOCOL_TOCK_MS);
      yield* settle();
      assert(counter.reads() > written, "the write is seen on the next tock");
    } finally {
      yield* hby.close(true);
    }
  });
});
