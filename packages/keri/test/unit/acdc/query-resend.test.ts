/** The resend schedule of a group's unchanged threshold query: backoff to a cap, and a stop at the KRAM window. */
import { Vrsn_2_0 } from "cesr-ts";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { QUERY_RESEND_CAP_MS, QUERY_RESEND_MS, ThresholdQueryResend } from "../../../src/acdc/query-resend.ts";
import { query } from "../../../src/core/protocol-eventing.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";

const WINDOW_MS = 60_000;

/** An unsigned v2 query dated `at`; the schedule reads only its `dt`. */
function queryAt(at: number): Uint8Array {
  return query("/ipex/dhke", { x: "E" }, { pre: "D", pvrsn: Vrsn_2_0, stamp: makeNowIso8601(new Date(at)) }).raw;
}

/** Every instant, in whole seconds after `start`, the schedule says send, polled each second for `seconds`. */
function sends(resend: ThresholdQueryResend, start: number, seconds: number, window: number | null): number[] {
  const at: number[] = [];
  for (let second = 0; second <= seconds; second++) {
    const now = start + second * 1000;
    if (resend.ready(now) && resend.fresh(now, window)) {
      resend.sent(now, QUERY_RESEND_MS);
      at.push(second);
    }
  }
  return at;
}

Deno.test("the resend gap doubles from the base to the cap, and the unchanged query stops at the multi-key window", () => {
  const start = Date.parse("2026-01-01T00:00:00Z");
  const resend = new ThresholdQueryResend();
  assertEquals(resend.ready(start), false, "nothing to send before a query is frozen");
  resend.set(queryAt(start));
  // 1, 2, 4 then 8 s gaps: sends at 0, 1, 3, 7, 15, 23, 31, 39, 47, 55; the next, 63, is past the 60 s window.
  assertEquals(sends(resend, start, 300, WINDOW_MS), [0, 1, 3, 7, 15, 23, 31, 39, 47, 55]);
  assertEquals(QUERY_RESEND_CAP_MS, 8000);
});

Deno.test("a store that never ran KRAM has no window: the gap stays at the cap and the query is not abandoned", () => {
  const start = Date.parse("2026-01-01T00:00:00Z");
  const resend = new ThresholdQueryResend();
  resend.set(queryAt(start));
  const at = sends(resend, start, 300, null);
  assertEquals(at.slice(0, 6), [0, 1, 3, 7, 15, 23]);
  assert(at.at(-1)! > 280 && at.slice(4).every((second, i, all) => i === 0 || second - all[i - 1] === 8));
});

Deno.test("a new frozen query restarts the schedule from its own date", () => {
  const start = Date.parse("2026-01-01T00:00:00Z");
  const resend = new ThresholdQueryResend();
  resend.set(queryAt(start));
  sends(resend, start, 10, WINDOW_MS);
  resend.set(queryAt(start + 100_000));
  assertEquals(sends(resend, start + 100_000, 8, WINDOW_MS), [0, 1, 3, 7]);
  assertEquals(resend.fresh(start + 100_000 + 200_000, WINDOW_MS), false, "closed from the new date");
  assertThrows(() => resend.set(new Uint8Array([1, 2, 3])), Error);
});
