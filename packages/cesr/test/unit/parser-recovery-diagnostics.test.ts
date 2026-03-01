import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { createParser } from "../../src/core/parser-engine.ts";
import type { RecoveryDiagnostic } from "../../src/core/recovery-diagnostics.ts";
import { intToB64 } from "../../src/core/bytes.ts";
import { UnknownCodeError } from "../../src/core/errors.ts";
import { parseAttachmentDispatchCompat } from "../../src/parser/group-dispatch.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import {
  COUNTER_CODE_NAMES_V1,
  COUNTER_SIZES_V2,
} from "../../src/tables/counter.tables.generated.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";

function encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function counterV2(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V2.get(code);
  if (!sizage) throw new Error(`Unknown v2 counter code ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
}

function sigerToken(): string {
  return `A${"A".repeat(87)}`;
}

function selectV2OnlyQuadletGroupCode(): string {
  const candidates = [
    CtrDexV2.ESSRWrapperGroup,
    CtrDexV2.BigESSRWrapperGroup,
    CtrDexV2.FixBodyGroup,
    CtrDexV2.BigFixBodyGroup,
    CtrDexV2.MapBodyGroup,
    CtrDexV2.BigMapBodyGroup,
    CtrDexV2.GenericMapGroup,
    CtrDexV2.BigGenericMapGroup,
    CtrDexV2.GenericListGroup,
    CtrDexV2.BigGenericListGroup,
  ];
  const code = candidates.find((value) => !(value in COUNTER_CODE_NAMES_V1));
  if (!code) {
    throw new Error("No v2-only quadlet-group code found for fallback tests");
  }
  return code;
}

Deno.test("recovery diagnostics: compat fallback emits accepted event and legacy callback once", () => {
  const code = selectV2OnlyQuadletGroupCode();
  const ims = `${counterV2(code, 1)}AAAA`;
  const diagnostics: RecoveryDiagnostic[] = [];
  const fallbackCalls: Array<{ from: number; to: number }> = [];

  const parsed = parseAttachmentDispatchCompat(
    encode(ims),
    { major: 1, minor: 0 },
    "txt",
    {
      mode: "compat",
      onRecoveryDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      onVersionFallback: (info) => {
        fallbackCalls.push({ from: info.from.major, to: info.to.major });
      },
    },
  );

  assertEquals(parsed.group.code, code);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].type, "version-fallback-accepted");
  if (diagnostics[0].type === "version-fallback-accepted") {
    assertEquals(diagnostics[0].from.major, 1);
    assertEquals(diagnostics[0].to.major, 2);
    assertEquals(diagnostics[0].domain, "txt");
  }
  assertEquals(fallbackCalls.length, 1);
  assertEquals(fallbackCalls[0].from, 1);
  assertEquals(fallbackCalls[0].to, 2);
});

Deno.test("recovery diagnostics: strict fallback emits rejected event", () => {
  const code = selectV2OnlyQuadletGroupCode();
  const ims = `${counterV2(code, 1)}AAAA`;
  const diagnostics: RecoveryDiagnostic[] = [];

  assertThrows(
    () =>
      parseAttachmentDispatchCompat(
        encode(ims),
        { major: 1, minor: 0 },
        "txt",
        {
          mode: "strict",
          onRecoveryDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        },
      ),
    UnknownCodeError,
  );

  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].type, "version-fallback-rejected");
  if (diagnostics[0].type === "version-fallback-rejected") {
    assertEquals(diagnostics[0].version.major, 1);
    assertEquals(diagnostics[0].domain, "txt");
    assertEquals(diagnostics[0].errorName, "UnknownCodeError");
  }
});

Deno.test("recovery diagnostics: compat wrapper tail preservation emits opaque-tail event", () => {
  const nested = `${counterV2(CtrDexV2.ControllerIdxSigs, 1)}${sigerToken()}`;
  const payload = `${nested}ABCD`;
  const wrappedAttachmentGroup = `${
    counterV2(CtrDexV2.AttachmentGroup, payload.length / 4)
  }${payload}`;
  const stream = `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${wrappedAttachmentGroup}`;
  const diagnostics: RecoveryDiagnostic[] = [];

  const parser = createParser({
    attachmentDispatchMode: "compat",
    onRecoveryDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  const events = [...parser.feed(encode(stream)), ...parser.flush()];
  const errors = events.filter((event) => event.type === "error");
  assertEquals(errors.length, 0);

  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].type, "wrapper-opaque-tail-preserved");
  if (diagnostics[0].type === "wrapper-opaque-tail-preserved") {
    assertEquals(diagnostics[0].wrapperCode, CtrDexV2.AttachmentGroup);
    assertEquals(diagnostics[0].opaqueItemCount, 1);
    assertEquals(diagnostics[0].domain, "txt");
  }
});

Deno.test("recovery diagnostics: parser non-shortage error emits reset event", () => {
  const diagnostics: RecoveryDiagnostic[] = [];
  const parser = createParser({
    onRecoveryDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  const malformed = `-HAB${sigerToken()}`;
  const first = parser.feed(encode(malformed));
  const firstErrors = first.filter((event) => event.type === "error");
  assertEquals(firstErrors.length, 1);

  const next = [...parser.feed(encode(KERIPY_NATIVE_V2_ICP_FIX_BODY)), ...parser.flush()];
  const nextErrors = next.filter((event) => event.type === "error");
  const nextFrames = next.filter((event) => event.type === "frame");
  assertEquals(nextErrors.length, 0);
  assertEquals(nextFrames.length, 1);

  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].type, "parser-error-reset");
  if (diagnostics[0].type === "parser-error-reset") {
    assertEquals(diagnostics[0].offset, 0);
    assert(
      diagnostics[0].errorName === "ColdStartError" ||
        diagnostics[0].errorName === "GroupSizeError",
    );
  }
});
