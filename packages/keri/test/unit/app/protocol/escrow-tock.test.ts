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

Deno.test("escrowDo scans on tock 0, after a store write and on its idle cadence, and always waits one tock", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: crypto.randomUUID(),
      temp: true,
      skipConfig: true,
      bran: "TockPasscodeSecretABCD",
    });
    yield* ensure(() => hby.close(true));
    const protocol = createProtocolProcessor(hby), steps = stepClock();
    const costs = [0, 400, 0, 90];
    let passes = 0;
    protocol.processEscrowsOnce = function*() {
      steps.spend(costs[passes++] ?? 0); // a costly pass takes long on the clock the loop waits on
      yield* call(() => Promise.resolve());
    };
    const settle = () => call(() => new Promise<void>(resolve => setTimeout(resolve, 5)));
    const pacing = { tockMs: ESCROW_TOCK_MS, sweepTocks: 1920, idleTocks: 4 };
    const loop = yield* spawn(() => protocol.escrowDo(steps.clock, pacing));
    yield* settle();
    assertEquals(passes, 1, "tock 0 runs a pass");
    assertEquals(steps.waiting(), [ESCROW_TOCK_MS], "and waits one tock");
    for (let write = 1; write < costs.length; write++) {
      hby.db.oobis.pin([`http://tock.test/oobi/${write}`], { date: new Date(0).toISOString() } as never);
      steps.elapse(ESCROW_TOCK_MS);
      yield* settle();
      assertEquals(passes, write + 1, "a store write since the last pass runs the next tock's pass, whatever it cost");
      assertEquals(
        steps.waiting(),
        [ESCROW_TOCK_MS],
        "and the wait after it is the fixed tock, whatever the pass cost",
      );
    }
    const elapse = function*() {
      steps.elapse(ESCROW_TOCK_MS);
      yield* settle();
    };
    const before = passes;
    yield* elapse(); // tock 4 is the idle cadence
    assertEquals(passes, before + 1, "the idle cadence runs a pass for what only time releases");
    for (let tock = 5; tock < 8; tock++) yield* elapse();
    assertEquals(passes, before + 1, "tocks with no write in between run no pass");
    yield* elapse(); // tock 8
    assertEquals(passes, before + 2, "the next idle cadence is idleTocks later");
    yield* loop.halt();
  });
});
