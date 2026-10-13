import { assert, assertEquals } from "jsr:@std/assert";
import { CtrDexV1 } from "../../../src/tables/counter-codex.ts";
import { counterV1 } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import {
  buildNWaySplitPlans,
  genusVersionCounter,
  mutateTextStream,
  parseFrames,
  summarizeFrames,
  wrapperHeavyV2Stream,
} from "../../fixtures/parser-test-helpers.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";

/** Mutations may reject, but transport partitioning must never expose native/runtime failures. */
async function checkErrors(bytes: Uint8Array, boundaries: number[]): Promise<void> {
  try {
    await parseFrames(bytes, boundaries);
  } catch (error) {
    const allowed = [
      "ParserError",
      "ShortageError",
      "ColdStartError",
      "VersionError",
      "UnknownCodeError",
      "GroupSizeError",
      "DeserializeError",
      "SyntaxParseError",
      "SemanticInterpretationError",
    ];
    assert(error instanceof Error && allowed.includes(error.name), `Unexpected mutation failure: ${error}`);
  }
}

Deno.test(
  "deterministic N-way split fuzz (3-8 cuts) on wrapper-heavy stream preserves semantic summaries",
  async () => {
    const stream = wrapperHeavyV2Stream();
    const bytes = encode(stream);
    const baseline = summarizeFrames(await parseFrames(bytes));

    // Deterministic seeded split plans avoid flaky CI while still widening
    // boundary coverage beyond simple one/two-cut checks.
    const plans = buildNWaySplitPlans(bytes.length, 3, 8, 3, 0x20_26_03_01);
    for (const plan of plans) {
      const summary = summarizeFrames(await parseFrames(bytes, plan));
      assertEquals(summary, baseline);
    }
  },
);

Deno.test(
  "deterministic counter/count/selector mutations emit only known parser error classes",
  async () => {
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
        await checkErrors(bytes, [Math.max(1, Math.floor(bytes.length / 2))]);
      }
    }

    // The same error-taxonomy assertion also runs under
    // chunked feed patterns, not only contiguous ingestion.
    const stream = wrapperHeavyV2Stream();
    const bytes = encode(stream);
    const plans = buildNWaySplitPlans(bytes.length, 3, 8, 1, 0x0211_2026);
    for (const plan of plans) {
      await checkErrors(bytes, plan);
    }
  },
);
