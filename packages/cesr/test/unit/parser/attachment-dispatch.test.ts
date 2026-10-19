import { assertEquals, assertThrows } from "jsr:@std/assert";
import { decodeB64 } from "../../../src/core/bytes.ts";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parseAttachmentGroup } from "../../../src/parser/attachments.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { COUNTER_CODE_NAMES_V1 } from "../../../src/tables/counter.tables.generated.ts";
import { counterV2, sigerToken, token } from "../../fixtures/counter-token-fixtures.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";

/** Choose a v2-only counter so selected-v1 rejection cannot pass by code overlap. */
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

Deno.test("dispatch parses v2 controller indexed signatures group", () => {
  const ims = `-KAW${sigerToken()}`;
  const parsed = parseAttachmentGroup(encode(ims), {
    major: 2,
    minor: 0,
  }, "txt");
  assertEquals(parsed.group.name, "ControllerIdxSigs");
  assertEquals(parsed.group.count, (ims.length - 4) / 4);
  assertEquals(parsed.group.items.length, 1);
});

Deno.test("dispatch parses v2 trans indexed sig group", () => {
  const payload = `${token("B")}${token("0A")}${token("E")}-KAW${sigerToken()}`;
  const ims = `${counterV2("-X", payload.length / 4)}${payload}`;
  const parsed = parseAttachmentGroup(encode(ims), {
    major: 2,
    minor: 0,
  }, "txt");
  assertEquals(parsed.group.name, "TransIdxSigGroups");
  assertEquals(parsed.group.count, (ims.length - 4) / 4);
  assertEquals(parsed.group.items.length, 1);
});

Deno.test("dispatch parses nested attachment wrapper", () => {
  const nested = `-KAW${sigerToken()}`;
  const ims = `${counterV2("-C", nested.length / 4)}${nested}`;
  const parsed = parseAttachmentGroup(encode(ims), {
    major: 2,
    minor: 0,
  }, "txt");
  assertEquals(parsed.group.name, "AttachmentGroup");
  assertEquals(parsed.group.items.length, 1);
});

Deno.test("attachment dispatch rejects counter codes outside the selected genus", () => {
  const code = selectV2OnlyQuadletGroupCode();
  const ims = `${counterV2(code, 1)}AAAA`;

  assertThrows(
    () => parseAttachmentGroup(encode(ims), { major: 1, minor: 0 }, "txt"),
    UnknownCodeError,
  );
});

Deno.test("malformed v1 signatures cannot be reinterpreted as a v2 GenericGroup", () => {
  // -A is ControllerIdxSigs in v1, but GenericGroup in v2.
  const malformed = "-AABzzzz";
  for (const domain of ["txt", "bny"] as const) {
    const input = domain === "txt" ? encode(malformed) : decodeB64(malformed);
    assertThrows(
      () => parseAttachmentGroup(input, { major: 1, minor: 0 }, domain),
      UnknownCodeError,
    );
  }
});
