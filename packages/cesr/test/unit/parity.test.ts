import { assert, assertEquals } from "jsr:@std/assert";
import { parseAttachmentDispatch } from "../../src/parser/group-dispatch.ts";
import { supportedPrimitiveCodes } from "../../src/primitives/registry.ts";
import { MATTER_SIZES } from "../../src/tables/matter.tables.generated.ts";

function token(code: string): string {
  const sizage = MATTER_SIZES.get(code);
  if (!sizage || sizage.fs === null) {
    throw new Error(`Need fixed-size code for token, got ${code}`);
  }
  return code + "A".repeat(sizage.fs - code.length);
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
  const ims = `-KAB${token("A")}`;
  const parsed = parseAttachmentDispatch(new TextEncoder().encode(ims), {
    major: 2,
    minor: 0,
  }, "txt");
  assertEquals(parsed.group.name, "ControllerIdxSigs");
  assertEquals(parsed.group.count, 1);
  assertEquals(parsed.group.items.length, 1);
});

Deno.test("dispatch parses v2 trans indexed sig group", () => {
  const ims = `-XAB${token("B")}${token("M")}${token("E")}-KAB${token("A")}`;
  const parsed = parseAttachmentDispatch(new TextEncoder().encode(ims), {
    major: 2,
    minor: 0,
  }, "txt");
  assertEquals(parsed.group.name, "TransIdxSigGroups");
  assertEquals(parsed.group.count, 1);
  assertEquals(parsed.group.items.length, 1);
});

Deno.test("dispatch parses nested attachment wrapper", () => {
  const nested = `-KAB${token("A")}`;
  const ims = `-CAM${nested}`; // 12 quadlets of payload
  const parsed = parseAttachmentDispatch(new TextEncoder().encode(ims), {
    major: 2,
    minor: 0,
  }, "txt");
  assertEquals(parsed.group.name, "AttachmentGroup");
  assertEquals(parsed.group.items.length, 1);
});
