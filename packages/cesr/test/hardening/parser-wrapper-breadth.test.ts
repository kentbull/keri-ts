import { assertEquals } from "jsr:@std/assert";
import { decodeB64 } from "../../src/core/bytes.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { encode } from "../fixtures/stream-byte-fixtures.ts";
import {
  assertTxtQb2Parity,
  parseFramesNoError,
  splitIntoThirds,
  summarizeFrames,
  wrapperHeavyV2Stream,
} from "./hardening-helpers.ts";

/**
 * P2 wrapper breadth vectors (`V-P2-003`, `V-P2-004`).
 *
 * These tests lock behavior around wrapper counter-size breadth and wrapper
 * boundary transitions, where parser regressions usually appear first during
 * refactors of counter handling and chunk continuation.
 */
Deno.test(
  "V-P2-003: mixed short and big wrapper counters in one top-level stream preserve txt/qb2 parity",
  () => {
    // Contract: same semantic frame extraction regardless of text/qb2 domain.
    const summary = assertTxtQb2Parity(wrapperHeavyV2Stream());
    // Fixture shape: six CESR-native frames emitted from mixed wrapper forms.
    assertEquals(summary.length, 6);
    // Four frames carry explicit attachment groups in this fixture.
    assertEquals(
      summary.filter((frame) => frame.attachments.length > 0).length,
      4,
    );
    // All extracted frames remain native `FixBodyGroup` payloads.
    assertEquals(
      summary.filter((frame) => frame.nativeBodyCode === CtrDexV2.FixBodyGroup)
        .length,
      6,
    );
  },
);

Deno.test(
  "V-P2-004: wrapper payload boundary ending immediately before next wrapper start remains split-deterministic",
  () => {
    const stream = wrapperHeavyV2Stream();
    const bytes = encode(stream);
    const base = summarizeFrames(parseFramesNoError(bytes));

    // Contract: exact payload-end => next-wrapper-start transition is stable
    // across deterministic chunk cuts.
    const firstCut = Math.max(1, Math.floor(bytes.length / 2));
    const secondCut = Math.max(
      firstCut + 1,
      Math.floor((bytes.length * 3) / 4),
    );
    const splitSummary = summarizeFrames(
      parseFramesNoError(bytes, [firstCut, secondCut]),
    );
    assertEquals(splitSummary, base);

    // Same boundary contract must hold on qb2/binary domain path.
    const qb2SplitSummary = summarizeFrames(
      parseFramesNoError(decodeB64(stream), splitIntoThirds(decodeB64(stream))),
    );
    const qb2Base = summarizeFrames(parseFramesNoError(decodeB64(stream)));
    assertEquals(qb2SplitSummary, qb2Base);
  },
);
