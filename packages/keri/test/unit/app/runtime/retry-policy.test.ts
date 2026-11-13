import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { DeliveryOutbox } from "../../../../src/app/runtime/delivery-outbox.ts";
import { DEFAULT_RETRY_POLICY, RetryBackoff } from "../../../../src/app/runtime/retry-backoff.ts";
import type { RuntimeClock } from "../../../../src/app/runtime/runtime-clock.ts";

const clock = { now: () => 0 } as RuntimeClock;

Deno.test("RetryBackoff doubles from the supplied base up to the supplied cap, and defaults to production delays", () => {
  const short = new RetryBackoff({ baseMs: 10, maxMs: 25, boundMs: 100 });
  const delays: number[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    short.failed(0, new Error("down"));
    delays.push([...Array(100).keys()].find(ms => short.due(ms)) ?? -1);
  }
  assertEquals(delays, [10, 20, 25, 25]);
  const standard = new RetryBackoff();
  standard.failed(0, new Error("down"));
  assertEquals(standard.due(DEFAULT_RETRY_POLICY.baseMs - 1), false);
  assertEquals(standard.due(DEFAULT_RETRY_POLICY.baseMs), true);
});

Deno.test("a DeliveryOutbox retries after the supplied base delay", async () => {
  let delivered = 0, failing = true, now = 0;
  const ticking = { now: () => now } as RuntimeClock;
  const transport = {
    *deliver() {
      if (failing) throw new Error("offline", { cause: new Error("refused") });
      delivered++;
      return ["http://peer/"];
    },
  };
  await run(function*() {
    const outbox = new DeliveryOutbox({ baseMs: 10, maxMs: 40, boundMs: 1000 });
    outbox.enqueue({ src: "a", dest: "b", msg: new Uint8Array([1]) });
    assertEquals(yield* outbox.drain(transport, ticking), false);
    assertEquals(outbox.failure, { attempts: 1, reason: "offline <- refused", retryAt: new Date(10).toISOString() });
    failing = false;
    now = 9;
    assertEquals(yield* outbox.drain(transport, ticking), false, "not due before the supplied delay");
    now = 10;
    assertEquals(yield* outbox.drain(transport, ticking), true);
    assertEquals(delivered, 1);
    assertEquals(outbox.failure, null);
  });
  void clock;
});
