import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { decodeB64 } from "../../src/core/bytes.ts";
import { UnknownCodeError } from "../../src/core/errors.ts";
import { parseAttachmentDispatch, parseAttachmentDispatchCompat } from "../../src/parser/group-dispatch.ts";
import { supportedPrimitiveCodes } from "../../src/primitives/registry.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import {
  COUNTER_CODE_NAMES_V1,
  COUNTER_SIZES_V1,
  COUNTER_SIZES_V2,
} from "../../src/tables/counter.tables.generated.ts";
import { counterV2, sigerToken, token } from "../fixtures/counter-token-fixtures.ts";
import { encode } from "../fixtures/stream-byte-fixtures.ts";

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
    throw new Error("No v2-only quadlet-group code found for version rejection tests");
  }
  return code;
}

Deno.test("primitive registry includes extended KERIpy codex entries", () => {
  const codes = supportedPrimitiveCodes();
  assert(codes.includes("0P")); // GramHeadNeck
  assert(codes.includes("7AAF")); // HPKEBase_Cipher_Big_L0
  assert(codes.includes("9AAH")); // Decimal_Big_L2
  assert(codes.includes("1___")); // TBD testing code
  assert(codes.length > 100);
});

Deno.test("dispatch parses v2 controller indexed signatures group", () => {
  const ims = `-KAB${sigerToken()}`;
  const parsed = parseAttachmentDispatch(encode(ims), {
    major: 2,
    minor: 0,
  }, "txt");
  assertEquals(parsed.group.name, "ControllerIdxSigs");
  assertEquals(parsed.group.count, 1);
  assertEquals(parsed.group.items.length, 1);
});

Deno.test("dispatch parses v2 trans indexed sig group", () => {
  const ims = `-XAB${token("B")}${token("M")}${token("E")}-KAB${sigerToken()}`;
  const parsed = parseAttachmentDispatch(encode(ims), {
    major: 2,
    minor: 0,
  }, "txt");
  assertEquals(parsed.group.name, "TransIdxSigGroups");
  assertEquals(parsed.group.count, 1);
  assertEquals(parsed.group.items.length, 1);
});

Deno.test("dispatch parses nested attachment wrapper", () => {
  const nested = `-KAB${sigerToken()}`;
  const ims = `${counterV2("-C", nested.length / 4)}${nested}`;
  const parsed = parseAttachmentDispatch(encode(ims), {
    major: 2,
    minor: 0,
  }, "txt");
  assertEquals(parsed.group.name, "AttachmentGroup");
  assertEquals(parsed.group.items.length, 1);
});

Deno.test("legacy v1 sad path aliases persist in generated tables", () => {
  assertEquals(COUNTER_CODE_NAMES_V1["-J"], "SadPathSig");
  assertEquals(COUNTER_CODE_NAMES_V1["-K"], "SadPathSigGroup");
  assert(COUNTER_SIZES_V1.has("-J"));
  assert(COUNTER_SIZES_V1.has("-K"));
  assert(COUNTER_SIZES_V2.has("-J"));
});

Deno.test("attachment dispatch rejects undeclared major versions in both modes", () => {
  const code = selectV2OnlyQuadletGroupCode();
  const ims = `${counterV2(code, 1)}AAAA`;

  for (const mode of ["strict", "compat"] as const) {
    assertThrows(
      () => parseAttachmentDispatchCompat(encode(ims), { major: 1, minor: 0 }, "txt", { mode }),
      UnknownCodeError,
    );
  }
});

Deno.test("malformed v1 signatures cannot be reinterpreted as a v2 GenericGroup", () => {
  // -A is ControllerIdxSigs in v1, but GenericGroup in v2.
  const malformed = "-AABzzzz";
  for (const mode of ["strict", "compat"] as const) {
    for (const domain of ["txt", "bny"] as const) {
      const input = domain === "txt" ? encode(malformed) : decodeB64(malformed);
      assertThrows(
        () => parseAttachmentDispatchCompat(input, { major: 1, minor: 0 }, domain, { mode }),
        UnknownCodeError,
      );
    }
  }
});
