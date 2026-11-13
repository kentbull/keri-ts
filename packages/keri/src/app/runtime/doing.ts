/**
 * Fixed-tock doers: a background loop is a pass that runs, then waits one tock on the runtime clock, as a HIO
 * `Doer` is re-run every `tock` (`hio/base/doing.py`) and KERIpy's Doist cycles at 0.03125 s. A loop never
 * sleeps for a variable time and is never woken early; work that arrives between tocks is seen on the next one.
 * The wait follows the pass, not a fixed rate, because a pass awaits network I/O.
 */
import type { Operation } from "npm:effection@^3.6.0";
import type { RuntimeClock } from "./runtime-clock.ts";
import { waitOnClock } from "./workflow-contract.ts";

/** One pass of a doer; `tock` counts passes from 0, so a doer can do heavier work on tock 0 and every Nth. */
export type DoerPass = (tock: number) => Operation<void>;

/**
 * How often a doer runs, in milliseconds, and how many tocks apart its full sweeps are. A host that must be
 * gentler (a browser wallet in a background tab, a mobile wallet on battery) supplies longer values.
 */
export interface DoerPacing {
  tockMs: number;
  sweepTocks: number;
}

/** Run `pass` forever: pass 0, wait `tockMs` on `clock`, pass 1, and so on. A thrown error ends the doer. */
export function* doEvery(clock: RuntimeClock, tockMs: number, pass: DoerPass): Operation<never> {
  for (let tock = 0;; tock++) {
    yield* pass(tock);
    yield* waitOnClock(clock, tockMs);
  }
}
