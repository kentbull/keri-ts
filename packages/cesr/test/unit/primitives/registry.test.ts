import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { parsePrimitiveFromText, supportedPrimitiveCodes } from "../../../src/primitives/registry.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("registry: parses KERIpy verifier vector token", () => {
  const token = parsePrimitiveFromText(
    txt(KERIPY_MATTER_VECTORS.verferEcdsaR1),
  );
  assertEquals(token.qb64, KERIPY_MATTER_VECTORS.verferEcdsaR1);
  assertEquals(token.code, "1AAJ");
  assertEquals(token.name, "ECDSA_256r1");
});

Deno.test("registry: supported codes include KERIpy baseline families", () => {
  const codes = supportedPrimitiveCodes();
  assertEquals(codes.includes("A"), true);
  assertEquals(codes.includes("E"), true);
});

Deno.test("registry: rejects malformed primitive text", () => {
  assertThrows(() => parsePrimitiveFromText(txt("?AAA")), UnknownCodeError);
});

Deno.test("primitive registry includes extended KERIpy codex entries", () => {
  const codes = supportedPrimitiveCodes();
  assert(codes.includes("b")); // Current GramHead
  assertEquals(codes.includes("0P"), false);
  assert(codes.includes("7AAF")); // HPKEBase_Cipher_Big_L0
  assert(codes.includes("9AAH")); // Decimal_Big_L2
  assert(codes.includes("1___")); // TBD testing code
  assert(codes.length > 100);
});
