import { assertEquals } from "jsr:@std/assert";
import { createParser } from "../../../src/parser/stream.ts";
import { CtrDexV1 } from "../../../src/tables/counter-codex.ts";
import { counterV1 } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import {
  assertNoUnexpectedErrorClasses,
  buildNWaySplitPlans,
  genusVersionCounter,
  mutateTextStream,
  parseFramesNoError,
  summarizeFrames,
  wrapperHeavyV2Stream,
} from "../../fixtures/parser-test-helpers.ts";
import { chunkByBoundaries, encode } from "../../fixtures/stream-byte-fixtures.ts";

Deno.test(
  "deterministic N-way split fuzz (3-8 cuts) on wrapper-heavy stream preserves semantic summaries",
  () => {
    const stream = wrapperHeavyV2Stream();
    const bytes = encode(stream);
    const baseline = summarizeFrames(parseFramesNoError(bytes));

    // Deterministic seeded split plans avoid flaky CI while still widening
    // boundary coverage beyond simple one/two-cut checks.
    const plans = buildNWaySplitPlans(bytes.length, 3, 8, 3, 0x20_26_03_01);
    for (const plan of plans) {
      const summary = summarizeFrames(parseFramesNoError(bytes, plan));
      assertEquals(summary, baseline);
    }
  },
);

Deno.test(
  "deterministic counter/count/selector mutations emit only known parser error classes",
  () => {
    // Corpus spans wrapper-heavy, mixed legacy/current, and explicit-selector
    // streams so mutation probes parser behavior across key state transitions.
    const baseCorpus = [
      wrapperHeavyV2Stream(),
      `${(counterV1(CtrDexV1.NonNativeBodyGroup, 1) + "MAAA")}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`,
      `${genusVersionCounter(1)}${(counterV1(CtrDexV1.NonNativeBodyGroup, 1) + "MAAA")}${
        genusVersionCounter(2)
      }${KERIPY_NATIVE_V2_ICP_FIX_BODY}`,
    ];

    for (const base of baseCorpus) {
      const variants = mutateTextStream(base, 0x0210_2026, 20);
      for (const mutated of variants) {
        const bytes = encode(mutated);
        const parser = createParser();
        const events = [
          ...parser.feed(
            bytes.slice(0, Math.max(1, Math.floor(bytes.length / 2))),
          ),
          ...parser.feed(
            bytes.slice(Math.max(1, Math.floor(bytes.length / 2))),
          ),
          ...parser.flush(),
        ];
        // This checks crash/error taxonomy only; accepted output is not a correctness oracle.
        assertNoUnexpectedErrorClasses(events);
      }
    }

    // The same error-taxonomy assertion also runs under
    // chunked feed patterns, not only contiguous ingestion.
    const stream = wrapperHeavyV2Stream();
    const bytes = encode(stream);
    const plans = buildNWaySplitPlans(bytes.length, 3, 8, 1, 0x0211_2026);
    for (const plan of plans) {
      const parser = createParser();
      const events = [];
      for (const chunk of chunkByBoundaries(bytes, plan)) {
        events.push(...parser.feed(chunk));
      }
      events.push(...parser.flush());
      assertNoUnexpectedErrorClasses(events);
    }
  },
);
