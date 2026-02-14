import { assertEquals } from "jsr:@std/assert";
import { createParser } from "../../src/core/parser-engine.ts";
import { decodeB64, intToB64 } from "../../src/core/bytes.ts";
import {
  COUNTER_SIZES_V1,
  COUNTER_SIZES_V2,
} from "../../src/tables/counter.tables.generated.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";

function encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function v1ify(raw: string): string {
  const size = new TextEncoder().encode(raw).length;
  const sizeHex = size.toString(16).padStart(6, "0");
  return raw.replace("KERI10JSON000000_", `KERI10JSON${sizeHex}_`);
}

function counterV1(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V1.get(code);
  if (!sizage) throw new Error(`Unknown v1 counter ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
}

function counterV2(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V2.get(code);
  if (!sizage) throw new Error(`Unknown v2 counter ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
}

function sigerToken(): string {
  return `A${"A".repeat(87)}`;
}

function chunkByBoundaries(
  input: Uint8Array,
  boundaries: number[],
): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (const end of boundaries) {
    chunks.push(input.slice(start, end));
    start = end;
  }
  chunks.push(input.slice(start));
  return chunks;
}

function summarizeFrames(input: Uint8Array, boundaries: number[]): string[] {
  const parser = createParser();
  const emissions = [];
  for (const chunk of chunkByBoundaries(input, boundaries)) {
    emissions.push(...parser.feed(chunk));
  }
  emissions.push(...parser.flush());

  const errors = emissions.filter((e) => e.type === "error");
  assertEquals(errors.length, 0);

  const frames = emissions.filter((e) => e.type === "frame");
  return frames.map((e) => {
    const frame = e.frame as {
      serder: {
        kind: string;
        ilk: string | null;
        said: string | null;
        native?: { bodyCode: string; fields: Array<unknown> };
      };
      attachments: Array<{ code: string; count: number }>;
    };
    const atts = frame.attachments.map((a) => `${a.code}:${a.count}`).join(",");
    const native = frame.serder.native
      ? `${frame.serder.native.bodyCode}:${frame.serder.native.fields.length}`
      : "none";
    return `${frame.serder.kind}|${frame.serder.ilk ?? ""}|${
      frame.serder.said ?? ""
    }|${native}|${atts}`;
  });
}

function assertSplitDeterminism(
  name: string,
  input: Uint8Array,
  secondSplitGrid = 18,
): void {
  const baseline = summarizeFrames(input, []);

  // Exhaustive single-split matrix
  for (let i = 1; i < input.length; i++) {
    assertEquals(summarizeFrames(input, [i]), baseline, `${name}: split=${i}`);
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
        summarizeFrames(input, [points[a], points[b]]),
        baseline,
        `${name}: split=${points[a]},${points[b]}`,
      );
    }
  }
}

Deno.test("chunk-fuzz matrix: v1 json frame with wrapped attachments", () => {
  const body = v1ify('{"v":"KERI10JSON000000_","t":"icp","d":"Eabc"}');
  const nested = `-AAB${sigerToken()}`;
  const frame = `${body}${counterV1("-V", nested.length / 4)}${nested}`;
  assertSplitDeterminism("v1-wrapped", encode(frame));
});

Deno.test("chunk-fuzz matrix: v2 native fix-body frame stream", () => {
  assertSplitDeterminism(
    "v2-native-fix",
    encode(KERIPY_NATIVE_V2_ICP_FIX_BODY),
  );
});

Deno.test("chunk-fuzz matrix: v2 BodyWithAttachmentGroup stream (txt + qb2)", () => {
  const nestedAttachment = `${
    counterV2(CtrDexV2.ControllerIdxSigs, 1)
  }${sigerToken()}`;
  const payload = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedAttachment}`;
  const wrapped = `${
    counterV2(
      CtrDexV2.BodyWithAttachmentGroup,
      payload.length / 4,
    )
  }${payload}`;

  const txtStream = wrapped;
  assertSplitDeterminism("v2-body-with-attachment-txt", encode(txtStream));
  assertSplitDeterminism(
    "v2-body-with-attachment-qb2",
    decodeB64(txtStream),
  );
});
