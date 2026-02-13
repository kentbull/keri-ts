import {
  assertEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { annotate } from "../../src/annotate/annotator.ts";
import { denot } from "../../src/annotate/denot.ts";
import { annotateCli } from "../../src/annotate/cli.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import {
  COUNTER_SIZES_V1,
  COUNTER_SIZES_V2,
} from "../../src/tables/counter.tables.generated.ts";
import { decodeB64, intToB64 } from "../../src/core/bytes.ts";
import {
  KERIPY_NATIVE_V2_ICP_FIX_BODY,
  PARSIDE_GROUP_VECTORS,
} from "../fixtures/external-vectors.ts";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

function sigerToken(): string {
  return `A${"A".repeat(87)}`;
}

function counterV2(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V2.get(code);
  if (!sizage) throw new Error(`Unknown counter code ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
}

function counterV1(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V1.get(code);
  if (!sizage) throw new Error(`Unknown counter code ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
}

function v1ify(raw: string): string {
  const size = new TextEncoder().encode(raw).length;
  const sizeHex = size.toString(16).padStart(6, "0");
  return raw.replace("KERI10JSON000000_", `KERI10JSON${sizeHex}_`);
}

Deno.test("annotate + denot roundtrip for CESR text stream", () => {
  const ims = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${
    counterV2(CtrDexV2.ControllerIdxSigs, 1)
  }${sigerToken()}`;
  const annotated = annotate(ims);
  const restored = denot(annotated);
  assertEquals(TEXT_DECODER.decode(restored), ims);
});

Deno.test("annotate qb2 stream emits canonical annotated text", () => {
  const ims = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${
    counterV2(CtrDexV2.ControllerIdxSigs, 1)
  }${sigerToken()}`;
  const annotated = annotate(decodeB64(ims), { domainHint: "bny" });
  assertStringIncludes(annotated, "FixBodyGroup");
  assertStringIncludes(annotated, "ControllerIdxSigs");
  assertStringIncludes(annotated, "Indexer A");
});

Deno.test("annotateCli supports --in and --out", async () => {
  const ims = KERIPY_NATIVE_V2_ICP_FIX_BODY;
  const files = new Map<string, Uint8Array>([
    ["/virtual/in.cesr", TEXT_ENCODER.encode(ims)],
  ]);
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await annotateCli(
    ["--in", "/virtual/in.cesr", "--out", "/virtual/out.annotated"],
    {
      readFile: async (path: string) => {
        const file = files.get(path);
        if (!file) throw new Error(`missing file: ${path}`);
        return file;
      },
      writeTextFile: async (path: string, text: string) => {
        files.set(path, TEXT_ENCODER.encode(text));
      },
      readStdin: async () => new Uint8Array(0),
      writeStdout: async (text: string) => {
        stdout.push(text);
      },
      writeStderr: async (text: string) => {
        stderr.push(text);
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

Deno.test("annotate decodes v1 -V wrapped -C group without opaque fallback", () => {
  const body = v1ify('{"v":"KERI10JSON000000_","t":"rpy","d":"Eabc"}');
  const nested = PARSIDE_GROUP_VECTORS.nonTransReceiptCouples;
  const ims = `${body}${counterV1("-V", nested.length / 4)}${nested}`;
  const annotated = annotate(ims);
  assertStringIncludes(annotated, "AttachmentGroup");
  assertStringIncludes(annotated, "NonTransReceiptCouples");
  assertEquals(annotated.includes("opaque wrapper payload"), false);
});

Deno.test("annotate handles v1 wrapper carrying v2 -J generic list payload", () => {
  const body = v1ify('{"v":"KERI10JSON000000_","t":"rpy","d":"Eabc"}');
  const nestedV2List = "-JAB--FA";
  const ims = `${body}${counterV1("-V", nestedV2List.length / 4)}${nestedV2List}`;
  const annotated = annotate(ims);
  assertStringIncludes(annotated, "AttachmentGroup");
  assertStringIncludes(annotated, "GenericListGroup");
  assertStringIncludes(annotated, "opaque token");
});

Deno.test("annotate supports legacy v1 SadPathSig inside attachment wrapper", () => {
  const body = v1ify('{"v":"KERI10JSON000000_","t":"rpy","d":"Eabc"}');
  const nested = `-JAB6AABAAA-${PARSIDE_GROUP_VECTORS.transIdxSigGroups}`;
  const ims = `${body}${counterV1("-V", nested.length / 4)}${nested}`;
  const annotated = annotate(ims);
  assertStringIncludes(annotated, "SadPathSig");
  assertStringIncludes(annotated, "TransIdxSigGroups");
  assertEquals(annotated.includes("opaque wrapper payload"), false);
});

Deno.test("annotateCli --pretty pretty-prints JSON body", async () => {
  const ims = '{"v":"KERI10JSON00002e_","t":"rpy","d":"Eabc"}';
  const files = new Map<string, Uint8Array>([
    ["/virtual/in.cesr", TEXT_ENCODER.encode(ims)],
  ]);

  const exitCode = await annotateCli(
    ["--in", "/virtual/in.cesr", "--out", "/virtual/out.annotated", "--pretty"],
    {
      readFile: async (path: string) => files.get(path) ?? new Uint8Array(0),
      writeTextFile: async (path: string, text: string) => {
        files.set(path, TEXT_ENCODER.encode(text));
      },
      readStdin: async () => new Uint8Array(0),
      writeStdout: async () => {},
      writeStderr: async () => {},
    },
  );

  assertEquals(exitCode, 0);
  const out = TEXT_DECODER.decode(files.get("/virtual/out.annotated")!);
  assertStringIncludes(out, '\n  "v":');
  assertStringIncludes(out, "SERDER KERI JSON");
});
