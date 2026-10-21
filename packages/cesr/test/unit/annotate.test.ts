import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert";
import { annotate, annotateFrames } from "../../src/annotate/annotator.ts";
import { denot } from "../../src/annotate/denot.ts";
import { tephraCli } from "../../src/cli/main.ts";
import { concatBytes, decodeB64 } from "../../src/core/bytes.ts";
import { VersionError } from "../../src/core/errors.ts";
import { Counter } from "../../src/primitives/base/counter.ts";
import { Texter } from "../../src/primitives/values/texter.ts";
import { CtrDexV1, CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { counterV1, counterV2, groupV2, sigerToken } from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY, PARSIDE_GROUP_VECTORS } from "../fixtures/external-vectors.ts";
import { parseFrames, summarizeFrames } from "../fixtures/parser-test-helpers.ts";
import { encode } from "../fixtures/stream-byte-fixtures.ts";
import { v1ify } from "../fixtures/versioned-body-fixtures.ts";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

function genusVersionCounter(major: 1 | 2, minor = 0): string {
  return new TextDecoder().decode(Counter.makeGVC({ major, minor }));
}

Deno.test("annotate + denot roundtrip for CESR text stream", async () => {
  const ims = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${groupV2(CtrDexV2.ControllerIdxSigs, sigerToken())}`;
  const annotated = await annotate(ims);
  const restored = denot(annotated);
  assertEquals(TEXT_DECODER.decode(restored), ims);
});

Deno.test("annotate qb2 stream emits canonical annotated text", async () => {
  const ims = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${groupV2(CtrDexV2.ControllerIdxSigs, sigerToken())}`;
  const annotated = await annotate(decodeB64(ims));
  assertStringIncludes(annotated, "FixBodyGroup");
  assertStringIncludes(annotated, "ControllerIdxSigs");
  assertStringIncludes(annotated, "Indexer A");
});

Deno.test("tephra annotate supports --in and --out", async () => {
  const ims = KERIPY_NATIVE_V2_ICP_FIX_BODY;
  const files = new Map<string, Uint8Array>([
    ["/virtual/in.cesr", TEXT_ENCODER.encode(ims)],
  ]);
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await tephraCli(
    ["annotate", "--in", "/virtual/in.cesr", "--out", "/virtual/out.annotated"],
    {
      async *read(path?: string) {
        const file = path ? files.get(path) : new Uint8Array(0);
        if (!file) throw new Error(`missing file: ${path}`);
        yield file;
      },
      writeTextFile: (path: string, text: string) => {
        files.set(path, TEXT_ENCODER.encode(text));
        return Promise.resolve();
      },
      writeStdout: (text: string) => {
        stdout.push(text);
        return Promise.resolve();
      },
      writeStderr: (text: string) => {
        stderr.push(text);
        return Promise.resolve();
      },
    },
  );

  assertEquals(exitCode, 0);
  assertEquals(stdout.length, 0);
  assertEquals(stderr.length, 0);

  const outBytes = files.get("/virtual/out.annotated");
  if (!outBytes) throw new Error("missing output file");
  const annotated = TEXT_DECODER.decode(outBytes);
  assertStringIncludes(annotated, "FixBodyGroup");
  assertStringIncludes(annotated, "Blake3_256");
});

Deno.test("annotate decodes v1 -V wrapped -C group without opaque fallback", async () => {
  const body = v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"rpy\",\"d\":\"Eabc\"}");
  const nested = PARSIDE_GROUP_VECTORS.nonTransReceiptCouples;
  const ims = `${body}${counterV1("-V", nested.length / 4)}${nested}`;
  const annotated = await annotate(ims);
  assertStringIncludes(annotated, "AttachmentGroup");
  assertStringIncludes(annotated, "NonTransReceiptCouples");
  assertEquals(annotated.includes("opaque wrapper payload"), false);
});

Deno.test("annotate supports legacy v1 SadPathSig inside attachment wrapper", async () => {
  const body = v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"rpy\",\"d\":\"Eabc\"}");
  const nested = `-JAB6AABAAA-${PARSIDE_GROUP_VECTORS.transIdxSigGroups}`;
  const ims = `${body}${counterV1("-V", nested.length / 4)}${nested}`;
  const annotated = await annotate(ims);
  assertStringIncludes(annotated, "SadPathSig");
  assertStringIncludes(annotated, "TransIdxSigGroups");
  assertEquals(annotated.includes("opaque wrapper payload"), false);
});

Deno.test("annotate labels non-serder CESR fallback body as opaque (not SERDER)", async () => {
  const nonNativeV1 = `${counterV1(CtrDexV1.NonNativeBodyGroup, 1)}MAAA`;
  const enclosed = `${genusVersionCounter(1)}${nonNativeV1}`;
  const wrapped = `${counterV2(CtrDexV2.BodyWithAttachmentGroup, enclosed.length / 4)}${enclosed}`;
  const ims = `${wrapped}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;

  const annotated = await annotate(ims);
  assertStringIncludes(annotated, "OPAQUE CESR body (non-serder fallback");
  assertEquals(annotated.includes("SERDER KERI CESR"), false);
});

Deno.test("tephra annotate --pretty pretty-prints JSON body", async () => {
  const ims = "{\"v\":\"KERI10JSON00002e_\",\"t\":\"rpy\",\"d\":\"Eabc\"}";
  const files = new Map<string, Uint8Array>([
    ["/virtual/in.cesr", TEXT_ENCODER.encode(ims)],
  ]);

  const exitCode = await tephraCli(
    ["annotate", "--in", "/virtual/in.cesr", "--out", "/virtual/out.annotated", "--pretty"],
    {
      async *read(path?: string) {
        yield path ? files.get(path) ?? new Uint8Array(0) : new Uint8Array(0);
      },
      writeTextFile: (path: string, text: string) => {
        files.set(path, TEXT_ENCODER.encode(text));
        return Promise.resolve();
      },
      writeStdout: () => Promise.resolve(),
      writeStderr: () => Promise.resolve(),
    },
  );

  assertEquals(exitCode, 0);
  const out = TEXT_DECODER.decode(files.get("/virtual/out.annotated")!);
  assertStringIncludes(out, "\n  \"v\":");
  assertStringIncludes(out, "SERDER KERI JSON");
});

Deno.test("native fixture annotation preserves primitive categories without a parser sidecar", async () => {
  for (const input of [KERIPY_NATIVE_V2_ICP_FIX_BODY, decodeB64(KERIPY_NATIVE_V2_ICP_FIX_BODY)]) {
    const annotated = await annotate(input);
    for (const name of ["FixBodyGroup", "GenericListGroup", "Ed25519", "Blake3_256", "Short"]) {
      assertStringIncludes(annotated, name);
    }
    assertEquals(TEXT_DECODER.decode(denot(annotated)), KERIPY_NATIVE_V2_ICP_FIX_BODY);
  }
});

Deno.test("annotation validates both selector minor sextets and unsupported majors", () => {
  for (const countB64 of ["CAB", "CBA", "DAA"]) {
    const selector = new Counter({ code: CtrDexV2.KERIACDCGenusVersion, countB64 });
    assertThrows(() => annotate(selector.qb64 + KERIPY_NATIVE_V2_ICP_FIX_BODY), VersionError);
  }
});

Deno.test("annotation preserves non-native bodies and ESSR wire through nested enclosures", async () => {
  // A qualified JSON body makes the same complete fixture legal in both text and binary domains.
  const json = v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"rpy\",\"d\":\"Eabc\"}");
  for (const major of [1, 2] as const) {
    const version = { major, minor: 0 };
    const codes = major === 1 ? CtrDexV1 : CtrDexV2;
    /** Build counters with protocol-specific semantics chosen by each caller. */
    const count = (code: string, size: number) => new Counter({ code, count: size, version }).qb64;
    const bodyToken = new Texter({ raw: TEXT_ENCODER.encode(json), code: "4B" }).qb64;
    const body = count(codes.NonNativeBodyGroup, bodyToken.length / 4) + bodyToken;
    const payload = new Texter({ raw: TEXT_ENCODER.encode("one ESSR item"), code: "4B" }).qb64;
    // V1 counts Texter items; V2 counts their qualified text quadlets.
    const essr = count(codes.ESSRPayloadGroup, major === 1 ? 1 : payload.length / 4) + payload;
    const attachment = count(codes.AttachmentGroup, essr.length / 4) + essr;
    const framed = count(codes.BodyWithAttachmentGroup, (body.length + attachment.length) / 4) + body + attachment;
    const wire = genusVersionCounter(major) + count(codes.GenericGroup, framed.length / 4) + framed;
    for (const source of [TEXT_ENCODER.encode(wire), decodeB64(wire)]) {
      const annotated = await annotate(source);
      assertEquals(TEXT_DECODER.decode(denot(annotated)), wire);
      assertStringIncludes(annotated, "ESSRPayloadGroup");
      const [owned] = await annotateFrames(source);

      assertEquals(owned.frame.essrs?.length, 1);
      assertEquals(TEXT_DECODER.decode(concatBytes(...owned.frame.essrs!.map((part) => part.raw))), "one ESSR item");

      assertEquals(concatBytes(...owned.frame.essrs!.map((part) => part.qb64b)), TEXT_ENCODER.encode(payload));
    }
  }
});

Deno.test(
  "annotate/denot round-trip remains stable for native bodies with supported primitive labels",
  async () => {
    // Two native frames keep the round-trip assertion focused on semantic
    // stability, not on preserving literal source-token formatting.
    const stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
    const annotated = await annotate(stream);
    const restored = TEXT_DECODER.decode(denot(annotated));
    const originalSummary = summarizeFrames(await parseFrames(encode(stream)));
    const restoredSummary = summarizeFrames(
      await parseFrames(encode(restored)),
    );
    // Contract: annotate+denot must preserve parser-observable frame semantics.
    assertEquals(restoredSummary, originalSummary);
    assertEquals(restoredSummary.length, 2);
    assertEquals(restoredSummary[0].nativeBodyCode, CtrDexV2.FixBodyGroup);
    assertEquals(restoredSummary[1].nativeBodyCode, CtrDexV2.FixBodyGroup);
  },
);

Deno.test("annotation restores outer genus after a nested selector and honors later stream selectors", async () => {
  const json = v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"rpy\",\"d\":\"Eabc\"}");
  const token = new Texter({ raw: TEXT_ENCODER.encode(json), code: "4B" }).qb64;
  const v1Body = counterV1(CtrDexV1.NonNativeBodyGroup, token.length / 4) + token;
  // The inner v1 selector ends at the GenericGroup boundary; the following v2 native body uses outer context.
  const enclosed = genusVersionCounter(1) + v1Body;
  const wire = counterV2(CtrDexV2.GenericGroup, enclosed.length / 4) + enclosed + KERIPY_NATIVE_V2_ICP_FIX_BODY
    + genusVersionCounter(1) + v1Body + genusVersionCounter(2) + KERIPY_NATIVE_V2_ICP_FIX_BODY;
  assertEquals(TEXT_DECODER.decode(denot(await annotate(wire))), wire);
});
