import { call, ensure, run, spawn } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { createProtocolProcessor, ESCROW_TOCK_MS } from "../../../../src/app/protocol/protocol-processing.ts";
import type { RuntimeClock } from "../../../../src/app/runtime/runtime-clock.ts";

/** A clock whose timers fire only when the test says so. */
function stepClock() {
  const timers = new Map<number, { fire: () => void; ms: number }>();
  let id = 0, now = 0;
  const clock: RuntimeClock = {
    now: () => now,
    setTimeout: (fire: () => void, ms: number) => {
      timers.set(++id, { fire, ms });
      return id;
    },
    clearTimeout: (timer: unknown) => void timers.delete(timer as number),
  };
  return {
    clock,
    waiting: () => [...timers.values()].map(timer => timer.ms),
    spend(ms: number) {
      now += ms;
    },
    elapse(ms: number) {
      now += ms;
      const due = [...timers.entries()];
      timers.clear();
      for (const [, timer] of due) timer.fire();
    },
  };
}

Deno.test("escrowDo runs a pass every tock regardless of pass cost", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, bran: "TockPasscodeSecretABCD" });
    yield* ensure(() => hby.close(true));
    const protocol = createProtocolProcessor(hby), steps = stepClock();
    const costs = [0, 400, 0, 90];
    let passes = 0;
    protocol.processEscrowsOnce = function*() {
      steps.spend(costs[passes++]); // a costly pass takes long on the clock the loop waits on
      yield* call(() => Promise.resolve());
    };
    const loop = yield* spawn(() => protocol.escrowDo(steps.clock));
    yield* call(() => new Promise<void>(resolve => setTimeout(resolve, 5)));
    assertEquals(passes, 1);
    assertEquals(steps.waiting(), [ESCROW_TOCK_MS], "the wait after a pass is the fixed tock");
    for (const cost of costs.slice(1)) {
      steps.elapse(cost + ESCROW_TOCK_MS);
      yield* call(() => new Promise<void>(resolve => setTimeout(resolve, 5)));
      assertEquals(steps.waiting(), [ESCROW_TOCK_MS], "and it does not depend on what the pass cost");
    }
    assertEquals(passes, costs.length, "every cycle ran a full pass");
    yield* loop.halt();
  });
});
