import { assertEquals } from "jsr:@std/assert";
import { annotate } from "../../src/annotate/annotator.ts";
import { denot } from "../../src/annotate/denot.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import {
  buildNestedMapBodyV2,
  parseFramesNoError,
  splitIntoThirds,
  summarizeFrames,
} from "./hardening-helpers.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
import { encode } from "../fixtures/stream-byte-fixtures.ts";
import { t } from '../../src/index.ts'

/**
 * P2 native-body breadth vectors (`V-P2-006`, `V-P2-007`).
 *
 * Focus:
 * - map-body tokenization/interpretation stability under chunk boundaries
 * - annotate/denot workflow preserving native-body semantic extraction
 */
Deno.test(
  "V-P2-006: MapBodyGroup with multiple labels and nested values remains stable across chunk boundaries",
  () => {
    const mapBody = buildNestedMapBodyV2();
    const bytes = encode(mapBody);
    // Contract: chunking must not change map-body parse outcome.
    const frames = parseFramesNoError(bytes, splitIntoThirds(bytes));

    assertEquals(frames.length, 1);
    const frame = frames[0];
    if (frame.type !== "frame") {
      throw new Error("expected frame event");
    }

    assertEquals(frame.frame.body.kind, "CESR");
    assertEquals(frame.frame.body.native?.bodyCode, CtrDexV2.MapBodyGroup);
    assertEquals((frame.frame.body.native?.fields.length ?? 0) >= 3, true);
    assertEquals(
      frame.frame.body.native?.fields.some((field) => field.label !== null) ??
        false,
      true,
    );
  },
);

Deno.test(
  "V-P2-007: annotate/denot round-trip remains stable for native bodies with supported primitive labels",
  () => {
    // Two native frames keep the round-trip assertion focused on semantic
    // stability, not on preserving literal source-token formatting.
    const stream =
      `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
    const annotated = annotate(stream);
    const restored = t(denot(annotated));
    const originalSummary = summarizeFrames(parseFramesNoError(encode(stream)));
    const restoredSummary = summarizeFrames(
      parseFramesNoError(encode(restored)),
    );
    // Contract: annotate+denot must preserve parser-observable frame semantics.
    assertEquals(restoredSummary, originalSummary);
    assertEquals(restoredSummary.length, 2);
    assertEquals(restoredSummary[0].nativeBodyCode, CtrDexV2.FixBodyGroup);
    assertEquals(restoredSummary[1].nativeBodyCode, CtrDexV2.FixBodyGroup);
  },
);
