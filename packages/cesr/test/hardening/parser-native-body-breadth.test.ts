import { assertEquals } from "jsr:@std/assert";
import { annotate } from "../../src/annotate/annotator.ts";
import { denot } from "../../src/annotate/denot.ts";
import { t } from "../../src/index.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
import { encode } from "../fixtures/stream-byte-fixtures.ts";
import {
  buildNestedMapBodyV2,
  parseEvents,
  parseFramesNoError,
  splitIntoThirds,
  summarizeFrames,
} from "./hardening-helpers.ts";

/**
 * P2 native-body breadth vectors (`V-P2-006`, `V-P2-007`).
 *
 * Focus:
 * - map-body tokenization/interpretation stability under chunk boundaries
 * - annotate/denot workflow preserving native-body semantic extraction
 */
Deno.test(
  "V-P2-006: invalid top-level MapBodyGroup still fails deterministically across chunk boundaries",
  () => {
    const mapBody = buildNestedMapBodyV2();
    const bytes = encode(mapBody);
    // This vector is intentionally *not* a full top-level message. The point
    // of the regression is that chunking must not turn an invalid top-level
    // native map corpus into a partially accepted frame.
    const events = parseEvents(bytes, splitIntoThirds(bytes));
    const frames = events.filter((event) => event.type === "frame");
    const errors = events.filter((event) => event.type === "error");

    assertEquals(frames.length, 0);
    assertEquals(errors.length, 1);
    assertEquals(
      ["DeserializeError", "UnknownCodeError"].includes(errors[0].error.name),
      true,
    );
  },
);

Deno.test(
  "V-P2-007: annotate/denot round-trip remains stable for native bodies with supported primitive labels",
  () => {
    // Two native frames keep the round-trip assertion focused on semantic
    // stability, not on preserving literal source-token formatting.
    const stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
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
