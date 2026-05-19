// @file-test-lane interop-parity

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { join } from "jsr:@std/path";
import { denot } from "../../../../cesr/src/annotate/denot.ts";
import { decodeB64 } from "../../../../cesr/src/core/bytes.ts";
import {
  CtrDexV1,
  CtrDexV2,
} from "../../../../cesr/src/tables/counter-codex.ts";
import {
  counterV1,
  counterV2,
  sigerToken,
} from "../../../../cesr/test/fixtures/counter-token-fixtures.ts";
import {
  KERIPY_NATIVE_V2_ICP_FIX_BODY,
  PARSIDE_GROUP_VECTORS,
} from "../../../../cesr/test/fixtures/external-vectors.ts";
import { wrapperHeavyV2Stream } from "../../../../cesr/test/hardening/hardening-helpers.ts";
import { v1ify } from "../../../../cesr/test/fixtures/versioned-body-fixtures.ts";
import {
  createInteropContext,
  requireSuccess,
  resolvePythonCommand,
  runCmd,
  runTufa,
  workspaceRoot,
} from "./interop-test-helpers.ts";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

function keripyRepoRoot(): string {
  return join(workspaceRoot(), "../../python/keripy");
}

function localKliEnv(env: Record<string, string>): Record<string, string> {
  return {
    ...env,
    PYTHONPATH: [
      join(keripyRepoRoot(), "src"),
      env.PYTHONPATH ?? "",
    ].filter((item) => item.length > 0).join(":"),
  };
}

async function writeTempInput(bytes: Uint8Array): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "annotate-interop-" });
  const path = join(dir, "in.cesr");
  await Deno.writeFile(path, bytes);
  return path;
}

async function runKliAnnotate(
  ctx: Awaited<ReturnType<typeof createInteropContext>>,
  bytes: Uint8Array,
  args: readonly string[] = [],
): Promise<string> {
  const path = await writeTempInput(bytes);
  const python = await resolvePythonCommand(ctx.env, ctx.kliCommand);
  const result = await requireSuccess(
    `kli annotate ${args.join(" ")}`,
    runCmd(
      python,
      ["-m", "keri.cli.kli", "annotate", "--in", path, ...args],
      localKliEnv(ctx.env),
      keripyRepoRoot(),
    ),
  );
  return result.stdout;
}

async function runTufaAnnotate(
  ctx: Awaited<ReturnType<typeof createInteropContext>>,
  bytes: Uint8Array,
  args: readonly string[] = [],
): Promise<string> {
  const path = await writeTempInput(bytes);
  const result = await requireSuccess(
    `tufa annotate ${args.join(" ")}`,
    runTufa(["annotate", "--in", path, ...args], ctx.env, workspaceRoot()),
  );
  return result.stdout;
}

function expectLabels(output: string, labels: readonly string[]): void {
  for (const label of labels) {
    assertStringIncludes(output, label);
  }
}

Deno.test("kli annotate and tufa annotate cover the same CESR stream surfaces", async () => {
  const ctx = await createInteropContext();
  const sigs = `${counterV2(CtrDexV2.ControllerIdxSigs, 1)}${sigerToken()}`;
  const jsonRpy = '{"v":"KERI10JSON00002e_","t":"rpy","d":"Eabc"}';
  const v1Attachment = `${
    v1ify('{"v":"KERI10JSON000000_","t":"rpy","d":"Eabc"}')
  }${
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
    },
  ] as const;

  for (const testCase of textCases) {
    const bytes = TEXT_ENCODER.encode(testCase.stream);
    const [kli, tufa] = await Promise.all([
      runKliAnnotate(ctx, bytes),
      runTufaAnnotate(ctx, bytes),
    ]);

    expectLabels(kli, testCase.labels);
    expectLabels(tufa, testCase.labels);
    assertEquals(
      TEXT_DECODER.decode(denot(kli)),
      testCase.stream,
      `${testCase.name}: kli denot round-trip`,
    );
    assertEquals(
      TEXT_DECODER.decode(denot(tufa)),
      testCase.stream,
      `${testCase.name}: tufa denot round-trip`,
    );
  }

  const qb2Stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${sigs}`;
  const qb2Bytes = decodeB64(qb2Stream);
  const [kliQb2, tufaQb2] = await Promise.all([
    runKliAnnotate(ctx, qb2Bytes, ["--qb2"]),
    runTufaAnnotate(ctx, qb2Bytes, ["--qb2"]),
  ]);
  expectLabels(kliQb2, ["FixBodyGroup", "ControllerIdxSigs"]);
  expectLabels(tufaQb2, ["FixBodyGroup", "ControllerIdxSigs"]);
});
