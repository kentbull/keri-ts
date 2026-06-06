// @file-test-lane interop-parity

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { join } from "jsr:@std/path";
import { denot } from "../../../../cesr/src/annotate/denot.ts";
import { decodeB64 } from "../../../../cesr/src/core/bytes.ts";
import { CtrDexV1, CtrDexV2 } from "../../../../cesr/src/tables/counter-codex.ts";
import { counterV1, counterV2, sigerToken } from "../../../../cesr/test/fixtures/counter-token-fixtures.ts";
import {
  KERIPY_NATIVE_V2_ICP_FIX_BODY,
  PARSIDE_GROUP_VECTORS,
} from "../../../../cesr/test/fixtures/external-vectors.ts";
import { v1ify } from "../../../../cesr/test/fixtures/versioned-body-fixtures.ts";
import { wrapperHeavyV2Stream } from "../../../../cesr/test/hardening/hardening-helpers.ts";
import { createInteropContext, requireSuccess, runCmd, runTufa, workspaceRoot } from "./interop-test-helpers.ts";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

async function writeTempInput(bytes: Uint8Array): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "annotate-interop-" });
  const path = join(dir, "in.cesr");
  await Deno.writeFile(path, bytes);
  return path;
}

async function runKliAnnotate(
  ctx: Awaited<ReturnType<typeof createInteropContext>>,
  bytes: Uint8Array,
): Promise<string> {
  const path = await writeTempInput(bytes);
  const binDir = ctx.kliCommand.slice(0, ctx.kliCommand.lastIndexOf("/"));
  const python = `${binDir}/python`;
  const script = [
    "from pathlib import Path",
    "from keri.core.annotating import annot",
    "import sys",
    "sys.stdout.write(annot(Path(sys.argv[1]).read_bytes()))",
  ].join("\n");
  const result = await requireSuccess(
    "KERIpy annot",
    runCmd(
      python,
      ["-c", script, path],
      ctx.env,
    ),
  );
  return result.stdout;
}

async function runTufaAnnotate(
  env: Record<string, string>,
  bytes: Uint8Array,
  args: readonly string[] = [],
): Promise<string> {
  const path = await writeTempInput(bytes);
  const result = await requireSuccess(
    `tufa annotate ${args.join(" ")}`,
    runTufa(["annotate", "--in", path, ...args], env, workspaceRoot()),
  );
  return result.stdout;
}

function expectLabels(output: string, labels: readonly string[]): void {
  for (const label of labels) {
    assertStringIncludes(output, label);
  }
}

Deno.test("KERIpy annot and tufa annotate cover native KERI event streams", async () => {
  const ctx = await createInteropContext();
  const bytes = TEXT_ENCODER.encode(KERIPY_NATIVE_V2_ICP_FIX_BODY);
  const [keripy, tufa] = await Promise.all([
    runKliAnnotate(ctx, bytes),
    runTufaAnnotate(ctx.env, bytes),
  ]);

  const labels = ["FixBodyGroup", "Blake3_256"];
  expectLabels(keripy, labels);
  expectLabels(tufa, labels);
  assertEquals(
    TEXT_DECODER.decode(denot(keripy)),
    KERIPY_NATIVE_V2_ICP_FIX_BODY,
    "KERIpy denot round-trip",
  );
  assertEquals(
    TEXT_DECODER.decode(denot(tufa)),
    KERIPY_NATIVE_V2_ICP_FIX_BODY,
    "tufa denot round-trip",
  );
});

Deno.test("tufa annotate covers broad CESR stream surfaces", async () => {
  const env = Deno.env.toObject();
  const sigs = `${counterV2(CtrDexV2.ControllerIdxSigs, 1)}${sigerToken()}`;
  const jsonRpy = "{\"v\":\"KERI10JSON00002e_\",\"t\":\"rpy\",\"d\":\"Eabc\"}";
  const v1Attachment = `${v1ify("{\"v\":\"KERI10JSON000000_\",\"t\":\"rpy\",\"d\":\"Eabc\"}")}${
    counterV1(
      CtrDexV1.AttachmentGroup,
      PARSIDE_GROUP_VECTORS.nonTransReceiptCouples.length / 4,
    )
  }${PARSIDE_GROUP_VECTORS.nonTransReceiptCouples}`;
  const opaqueNonNative = `${counterV2(CtrDexV2.NonNativeBodyGroup, 1)}MAAA`;

  const textCases = [
    {
      name: "native v2 ICP",
      stream: KERIPY_NATIVE_V2_ICP_FIX_BODY,
      labels: ["FixBodyGroup", "Blake3_256"],
    },
    {
      name: "native v2 ICP with signatures",
      stream: `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${sigs}`,
      labels: ["FixBodyGroup", "ControllerIdxSigs"],
    },
    {
      name: "JSON rpy",
      stream: jsonRpy,
      labels: ["SERDER KERI JSON", "rpy"],
    },
    {
      name: "wrapper-heavy stream",
      stream: wrapperHeavyV2Stream(),
      labels: ["GenericGroup", "BodyWithAttachmentGroup", "AttachmentGroup"],
    },
    {
      name: "v1 attachment wrapper",
      stream: v1Attachment,
      labels: ["AttachmentGroup", "NonTransReceiptCouples"],
    },
    {
      name: "opaque non-native body",
      stream: opaqueNonNative,
      labels: ["OPAQUE CESR body"],
      denotRoundTrip: false,
    },
  ] as const;

  for (const testCase of textCases) {
    const bytes = TEXT_ENCODER.encode(testCase.stream);
    const tufa = await runTufaAnnotate(env, bytes);
    expectLabels(tufa, testCase.labels);
    if (!("denotRoundTrip" in testCase) || testCase.denotRoundTrip !== false) {
      assertEquals(
        TEXT_DECODER.decode(denot(tufa)),
        testCase.stream,
        `${testCase.name}: tufa denot round-trip`,
      );
    }
  }

  const qb2Stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${sigs}`;
  const qb2Bytes = decodeB64(qb2Stream);
  const tufaQb2 = await runTufaAnnotate(env, qb2Bytes, ["--qb2"]);
  expectLabels(tufaQb2, ["FixBodyGroup", "ControllerIdxSigs"]);
});
