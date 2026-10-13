import { assertEquals } from "jsr:@std/assert";
import { decodeB64 } from "../../../src/core/bytes.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV2, groupV2, sigerToken, token } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import {
  assertTxtQb2Parity,
  parseFrames,
  splitIntoThirds,
  summarizeFrames,
  wrapperHeavyV2Stream,
  wrapQuadletGroupV2,
} from "../../fixtures/parser-test-helpers.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";

Deno.test(
  "big BodyWithAttachmentGroup counter with opaque body and twenty signatures preserves txt/qb2 parity",
  async () => {
    const opaqueMatter = token("1AAE");
    const bigOpaqueBody = `${counterV2(CtrDexV2.NonNativeBodyGroup, opaqueMatter.length / 4)}${opaqueMatter}${
      counterV2(CtrDexV2.ControllerIdxSigs, 20 * sigerToken().length / 4)
    }${Array.from({ length: 20 }, () => sigerToken()).join("")}`;
    const wrapped = wrapQuadletGroupV2(
      CtrDexV2.BigBodyWithAttachmentGroup,
      bigOpaqueBody,
    );

    const txtSummary = summarizeFrames(await parseFrames(encode(wrapped)));
    const qb2Summary = summarizeFrames(await parseFrames(decodeB64(wrapped)));
    assertEquals(qb2Summary, txtSummary);
    assertEquals(txtSummary.length, 1);
    assertEquals(txtSummary[0].kind, "CESR");
    assertEquals(txtSummary[0].ilk, "");
    assertEquals(txtSummary[0].attachments, [
      `${CtrDexV2.ControllerIdxSigs}:440`,
    ]);
  },
);

Deno.test(
  "deep nested GenericGroup chain with mixed wrapper children remains split-deterministic",
  async () => {
    const nestedSigGroup = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
    const wrappedBody = wrapQuadletGroupV2(
      CtrDexV2.BodyWithAttachmentGroup,
      `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedSigGroup}`,
    );
    const nonNative = `${counterV2(CtrDexV2.NonNativeBodyGroup, 1)}MAAA`;

    const g5 = wrapQuadletGroupV2(
      CtrDexV2.GenericGroup,
      `${wrappedBody}${nonNative}`,
    );
    const g4 = wrapQuadletGroupV2(
      CtrDexV2.GenericGroup,
      `${g5}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`,
    );
    const g3 = wrapQuadletGroupV2(CtrDexV2.GenericGroup, `${g4}${wrappedBody}`);
    const g2 = wrapQuadletGroupV2(CtrDexV2.GenericGroup, `${g3}${nonNative}`);
    const g1 = wrapQuadletGroupV2(
      CtrDexV2.GenericGroup,
      `${g2}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`,
    );
    const input = encode(g1);

    const baseline = summarizeFrames(await parseFrames(input));
    const split = summarizeFrames(
      await parseFrames(input, splitIntoThirds(input)),
    );
    assertEquals(split, baseline);

    assertEquals(baseline.length, 6);
    assertEquals(
      baseline.filter((frame) => frame.attachments.includes(`${CtrDexV2.ControllerIdxSigs}:22`))
        .length,
      2,
    );
    assertEquals(baseline.filter((frame) => frame.ilk === "").length, 2);
    assertEquals(
      baseline.filter((frame) =>
        frame.said
          === "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN"
      ).length,
      4,
    );
  },
);

Deno.test(
  "same semantic wrapper-heavy corpus preserves txt/qb2 summary and metadata parity",
  async () => {
    const nestedAttachment = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken().repeat(2));
    const wrapped = wrapQuadletGroupV2(
      CtrDexV2.BodyWithAttachmentGroup,
      `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedAttachment}`,
    );
    const generic = wrapQuadletGroupV2(
      CtrDexV2.GenericGroup,
      `${wrapped}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`,
    );
    const corpus = `${generic}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;

    const txtInput = encode(corpus);
    const qb2Input = decodeB64(corpus);
    const txtSummary = summarizeFrames(
      await parseFrames(txtInput, splitIntoThirds(txtInput)),
    );
    const qb2Summary = summarizeFrames(
      await parseFrames(qb2Input, splitIntoThirds(qb2Input)),
    );

    assertEquals(qb2Summary, txtSummary);
    assertEquals(txtSummary.length, 3);
    assertEquals(txtSummary[0].attachments, [
      `${CtrDexV2.ControllerIdxSigs}:44`,
    ]);
  },
);

Deno.test(
  "mixed short and big wrapper counters in one top-level stream preserve txt/qb2 parity",
  async () => {
    // Contract: same semantic frame extraction regardless of text/qb2 domain.
    const summary = await assertTxtQb2Parity(wrapperHeavyV2Stream());
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
  "wrapper payload boundary ending immediately before next wrapper start remains split-deterministic",
  async () => {
    const stream = wrapperHeavyV2Stream();
    const bytes = encode(stream);
    const base = summarizeFrames(await parseFrames(bytes));

    // Contract: exact payload-end => next-wrapper-start transition is stable
    // across deterministic chunk cuts.
    const firstCut = Math.max(1, Math.floor(bytes.length / 2));
    const secondCut = Math.max(
      firstCut + 1,
      Math.floor((bytes.length * 3) / 4),
    );
    const splitSummary = summarizeFrames(
      await parseFrames(bytes, [firstCut, secondCut]),
    );
    assertEquals(splitSummary, base);

    // Same boundary contract must hold on qb2/binary domain path.
    const qb2SplitSummary = summarizeFrames(
      await parseFrames(decodeB64(stream), splitIntoThirds(decodeB64(stream))),
    );
    const qb2Base = summarizeFrames(await parseFrames(decodeB64(stream)));
    assertEquals(qb2SplitSummary, qb2Base);
  },
);
