import { assert, assertEquals } from "jsr:@std/assert";
import { createParser } from "../../src/core/parser-engine.ts";
import type { RecoveryDiagnostic } from "../../src/core/recovery-diagnostics.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { counterV2, sigerToken } from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";
import { encode } from "../fixtures/stream-byte-fixtures.ts";

Deno.test("recovery diagnostics: compat wrapper tail preservation emits opaque-tail event", () => {
  const nested = `${counterV2(CtrDexV2.ControllerIdxSigs, 1)}${sigerToken()}`;
  const payload = `${nested}ABCD`;
  const wrappedAttachmentGroup = `${counterV2(CtrDexV2.AttachmentGroup, payload.length / 4)}${payload}`;
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

  const next = [
    ...parser.feed(encode(KERIPY_NATIVE_V2_ICP_FIX_BODY)),
    ...parser.flush(),
  ];
  const nextErrors = next.filter((event) => event.type === "error");
  const nextFrames = next.filter((event) => event.type === "frame");
  assertEquals(nextErrors.length, 0);
  assertEquals(nextFrames.length, 1);

  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].type, "parser-error-reset");
  if (diagnostics[0].type === "parser-error-reset") {
    assertEquals(diagnostics[0].offset, 0);
    assert(
      diagnostics[0].errorName === "ColdStartError"
        || diagnostics[0].errorName === "GroupSizeError",
    );
  }
});
