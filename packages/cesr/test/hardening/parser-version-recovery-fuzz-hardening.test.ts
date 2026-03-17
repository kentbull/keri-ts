import { assertEquals } from "jsr:@std/assert";
import { createParser } from "../../src/core/parser-engine.ts";
import { CtrDexV1, CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { counterV1, counterV2, sigerToken } from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
import { chunkByBoundaries, encode } from "../fixtures/stream-byte-fixtures.ts";
import { minimalV1MgpkBody, v2ify } from "../fixtures/versioned-body-fixtures.ts";
import {
  assertNoUnexpectedErrorClasses,
  buildNWaySplitPlans,
  concatWithAno,
  genusVersionCounter,
  mutateTextStream,
  parseFramesNoError,
  splitIntoThirds,
  summarizeFrames,
  wrapperHeavyV2Stream,
  wrapQuadletGroupV2,
} from "./hardening-helpers.ts";

/**
 * P2 version-context, recovery, and fuzz breadth vectors
 * (`V-P2-009`, `010`, `013`, `016`, `020`, `021`).
 *
 * These vectors intentionally combine lifecycle and malformed-input scenarios
 * because regressions often cross boundaries between version scoping,
 * attachment continuation, and parser reset/error handling.
 */
function v1OpaqueNonNativeFrame(): string {
  // Minimal legacy implicit-v1 frame used as deterministic context anchor.
  return `${counterV1(CtrDexV1.NonNativeBodyGroup, 1)}MAAA`;
}

Deno.test(
  "V-P2-009: legacy implicit-v1 outer frame followed by explicit selector wrapper preserves per-frame version context",
  () => {
    // v1 wrapper intentionally carries explicit v2 selector + v2 body to lock
    // context transition behavior in mixed legacy/explicit streams.
    const v1WrapperPayload = `${genusVersionCounter(2)}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
    const explicitV2Wrapped = `${
      counterV1(CtrDexV1.GenericGroup, v1WrapperPayload.length / 4)
    }${v1WrapperPayload}`;
    const stream = `${v1OpaqueNonNativeFrame()}${explicitV2Wrapped}`;
    const frames = parseFramesNoError(
      encode(stream),
      splitIntoThirds(encode(stream)),
    );

    assertEquals(frames.length, 2);
    if (frames[0].type !== "frame" || frames[1].type !== "frame") {
      throw new Error("expected frame events");
    }
    assertEquals(frames[0].frame.body.pvrsn.major, 1);
    assertEquals(frames[1].frame.body.pvrsn.major, 2);
  },
);

Deno.test(
  "V-P2-010: selector inside attachment wrapper does not bleed into subsequent non-wrapper frame context",
  () => {
    // Contract: selector contained inside attachment wrapper scope must not
    // alter subsequent top-level frame version resolution.
    const nestedSelectorAttachment = wrapQuadletGroupV2(
      CtrDexV2.AttachmentGroup,
      `${genusVersionCounter(1)}${counterV1(CtrDexV1.ControllerIdxSigs, 1)}${sigerToken()}`,
    );
    const stream =
      `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedSelectorAttachment}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
    const frames = parseFramesNoError(encode(stream));

    assertEquals(frames.length, 2);
    if (frames[0].type !== "frame" || frames[1].type !== "frame") {
      throw new Error("expected frame events");
    }
    assertEquals(frames[0].frame.body.pvrsn.major, 2);
    assertEquals(frames[1].frame.body.pvrsn.major, 2);
    assertEquals(frames[1].frame.body.ilk, "icp");
  },
);

Deno.test(
  "V-P2-013: interleaved annotation bytes between heterogeneous domains and wrapper styles preserve ordering",
  () => {
    // JSON + CESR-wrapper + MGPK with `ano` separators exercises domain
    // transitions that commonly break if `ano` skipping becomes stateful/leaky.
    const json = encode(
      v2ify("{\"v\":\"KERI20JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}"),
    );
    const wrapped = encode(
      wrapQuadletGroupV2(
        CtrDexV2.BodyWithAttachmentGroup,
        `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${
          counterV2(CtrDexV2.ControllerIdxSigs, 1)
        }${sigerToken()}`,
      ),
    );
    const mgpk = minimalV1MgpkBody();
    const stream = concatWithAno([json, wrapped, mgpk], 3);
    const boundaries = [
      Math.floor(stream.length / 5),
      Math.floor((2 * stream.length) / 5),
      Math.floor((3 * stream.length) / 5),
      Math.floor((4 * stream.length) / 5),
    ];

    const summary = summarizeFrames(parseFramesNoError(stream, boundaries));
    assertEquals(summary.length, 3);
    assertEquals(summary.map((frame) => frame.kind), ["JSON", "CESR", "MGPK"]);
    assertEquals(summary[1].attachments, [`${CtrDexV2.ControllerIdxSigs}:1`]);
  },
);

Deno.test(
  "V-P2-016: repeated flush after error + reset + clean feed is idempotent in multi-frame stream",
  () => {
    const parser = createParser();
    // Malformed declared-count stream forces parser error/reset path.
    const malformed = `-HAB${`A${"A".repeat(87)}`}`;

    const first = parser.feed(encode(malformed));
    assertEquals(first.length, 1);
    assertEquals(first[0].type, "error");

    const flushAfterErrorA = parser.flush();
    const flushAfterErrorB = parser.flush();
    assertEquals(flushAfterErrorA.length, 0);
    assertEquals(flushAfterErrorB.length, 0);

    parser.reset();

    // After reset, lifecycle must return to normal deterministic extraction.
    const cleanStream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
    const fed = parser.feed(encode(cleanStream));
    const flushed = parser.flush();
    const flushedAgain = parser.flush();

    const frames = [...fed, ...flushed].filter((event) => event.type === "frame");
    const errors = [...fed, ...flushed].filter((event) => event.type === "error");
    assertEquals(errors.length, 0);
    assertEquals(frames.length, 2);
    assertEquals(flushedAgain.length, 0);
  },
);

Deno.test(
  "V-P2-020: deterministic N-way split fuzz (3-8 cuts) on wrapper-heavy stream preserves semantic summaries",
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
  "V-P2-021: mutation fuzz on counters/counts/selectors keeps parser crash-safe with bounded error classes",
  () => {
    // Corpus spans wrapper-heavy, mixed legacy/current, and explicit-selector
    // streams so mutation probes parser behavior across key state transitions.
    const baseCorpus = [
      wrapperHeavyV2Stream(),
      `${v1OpaqueNonNativeFrame()}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`,
      `${genusVersionCounter(1)}${v1OpaqueNonNativeFrame()}${
        genusVersionCounter(2)
      }${KERIPY_NATIVE_V2_ICP_FIX_BODY}`,
    ];

    for (const base of baseCorpus) {
      const variants = mutateTextStream(base, 0x0210_2026, 20);
      for (const mutated of variants) {
        const bytes = encode(mutated);
        const parser = createParser({ attachmentDispatchMode: "strict" });
        const events = [
          ...parser.feed(
            bytes.slice(0, Math.max(1, Math.floor(bytes.length / 2))),
          ),
          ...parser.feed(
            bytes.slice(Math.max(1, Math.floor(bytes.length / 2))),
          ),
          ...parser.flush(),
        ];
        // Contract: parser may fail, but only with known bounded error classes.
        assertNoUnexpectedErrorClasses(events);
      }
    }

    // Supplemental split path ensures the same bounded-error contract under
    // chunked feed patterns, not only contiguous ingestion.
    const stream = wrapperHeavyV2Stream();
    const bytes = encode(stream);
    const plans = buildNWaySplitPlans(bytes.length, 3, 8, 1, 0x0211_2026);
    for (const plan of plans) {
      const parser = createParser({ attachmentDispatchMode: "strict" });
      const events = [];
      for (const chunk of chunkByBoundaries(bytes, plan)) {
        events.push(...parser.feed(chunk));
      }
      events.push(...parser.flush());
      assertNoUnexpectedErrorClasses(events);
    }
  },
);
