import { assertEquals } from "jsr:@std/assert";
import { decodeB64 } from "../../../src/core/bytes.ts";
import { parse } from "../../../src/parser/progressive.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV1, counterV2, groupV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import { chunkByBoundaries, encode } from "../../fixtures/stream-byte-fixtures.ts";
import { v1ify } from "../../fixtures/versioned-body-fixtures.ts";

/** Compare semantic frame order and leaves across producer partitions. */
async function summarizeFrames(input: Uint8Array, boundaries: number[]): Promise<string[]> {
  /** Yield small fixture chunks without a push-parser adapter. */
  async function* chunks() {
    yield* chunkByBoundaries(input, boundaries);
  }
  const summaries: string[] = [];
  for await (const frame of parse(chunks())) {
    const atts = frame.attachments.map((a) => `${a.code}:${a.count}`).join(",");
    summaries.push(`${frame.body.kind}|${frame.body.ilk ?? ""}|${frame.body.said ?? ""}|${atts}`);
  }
  return summaries;
}

/** Exercise every single split and a deterministic grid of two-split partitions. */
async function assertSplitDeterminism(
  name: string,
  input: Uint8Array,
  secondSplitGrid = 18,
): Promise<void> {
  const baseline = await summarizeFrames(input, []);

  // Exhaustive single-split matrix
  for (let i = 1; i < input.length; i++) {
    assertEquals(await summarizeFrames(input, [i]), baseline, `${name}: split=${i}`);
  }

  // Large two-split matrix on uniform grid
  const step = Math.max(1, Math.floor(input.length / secondSplitGrid));
  const points: number[] = [];
  for (let p = step; p < input.length; p += step) {
    points.push(p);
  }
  if (points[points.length - 1] !== input.length - 1) {
    points.push(input.length - 1);
  }

  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      assertEquals(
        await summarizeFrames(input, [points[a], points[b]]),
        baseline,
        `${name}: split=${points[a]},${points[b]}`,
      );
    }
  }
}

Deno.test("chunk-fuzz matrix: v1 json frame with wrapped attachments", async () => {
  const body = v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}");
  const nested = `-AAB${sigerToken()}`;
  const frame = `${body}${counterV1("-V", nested.length / 4)}${nested}`;
  await assertSplitDeterminism("v1-wrapped", encode(frame));
});

Deno.test("chunk-fuzz matrix: v2 native fix-body frame stream", async () => {
  await assertSplitDeterminism(
    "v2-native-fix",
    encode(KERIPY_NATIVE_V2_ICP_FIX_BODY),
  );
});

Deno.test("chunk-fuzz matrix: v2 BodyWithAttachmentGroup stream (txt + qb2)", async () => {
  const nestedAttachment = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
  const payload = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedAttachment}`;
  const wrapped = `${
    counterV2(
      CtrDexV2.BodyWithAttachmentGroup,
      payload.length / 4,
    )
  }${payload}`;

  const txtStream = wrapped;
  await assertSplitDeterminism("v2-body-with-attachment-txt", encode(txtStream));
  await assertSplitDeterminism(
    "v2-body-with-attachment-qb2",
    decodeB64(txtStream),
  );
});
