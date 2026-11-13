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
export type DoerPass = (tock: number) => Operation<unknown>;

/**
 * How often a doer runs, in milliseconds, and how many tocks apart its full sweeps are. A host that must be
 * gentler (a browser wallet in a background tab, a mobile wallet on battery) supplies longer values.
 */
export interface DoerPacing {
  tockMs: number;
  sweepTocks: number;
  /**
   * For a doer that runs on store writes ({@link doEveryOnWrite}): tocks between passes when nothing was written.
   * {@link PROTOCOL_IDLE_TOCKS} when absent.
   */
  idleTocks?: number;
}

/** Milliseconds between passes of the protocol-facing background loops: KERIpy's Doist cycle, as the escrow loop uses. */
export const PROTOCOL_TOCK_MS = 31.25;
/** Tocks between full sweeps of a loop that has one: 1920 tocks of 31.25 ms is a minute. */
export const PROTOCOL_SWEEP_TOCKS = 1920;
/** Tocks between passes of a write-driven loop when the store did not change: 32 tocks of 31.25 ms is one second. */
export const PROTOCOL_IDLE_TOCKS = 32;
/** The production pacing of the protocol-facing background loops. */
export const PROTOCOL_PACING: Readonly<DoerPacing> = Object.freeze({
  tockMs: PROTOCOL_TOCK_MS,
  sweepTocks: PROTOCOL_SWEEP_TOCKS,
  idleTocks: PROTOCOL_IDLE_TOCKS,
});

/** Run `pass` forever: pass 0, wait `tockMs` on `clock`, pass 1, and so on. A thrown error ends the doer. */
export function* doEvery(clock: RuntimeClock, tockMs: number, pass: DoerPass): Operation<never> {
  for (let tock = 0;; tock++) {
    yield* pass(tock);
    yield* waitOnClock(clock, tockMs);
  }
}

/**
 * A fixed-tock doer for a loop whose work lives in store rows: pass 0, then a pass only on a tock after the
 * store's write counter moved (a pass's own writes included, so it repeats until the store is quiet),
 * after `busy()` says work is held in memory, or every `idleTocks`-th tock for what only time releases
 * (timeouts, retry delays). A tock with nothing new costs a counter read, which touches no store, and no table scan. Rows written by
 * another loop are seen on the next tock; time-driven work waits at most `idleTocks` tocks.
 */
export function* doEveryOnWrite(
  clock: RuntimeClock,
  pacing: Readonly<DoerPacing>,
  db: { readonly writeActivity: number },
  pass: DoerPass,
  busy: () => boolean = () => false,
): Operation<never> {
  const idle = pacing.idleTocks ?? PROTOCOL_IDLE_TOCKS;
  let seen = -1;
  for (let tock = 0;; tock++) {
    if (tock % idle === 0 || db.writeActivity !== seen || busy()) {
      try {
        yield* pass(tock);
      } finally {
        seen = db.writeActivity;
      }
    }
    yield* waitOnClock(clock, pacing.tockMs);
  }
}
