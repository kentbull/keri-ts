import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import {
  parsePrimitiveFromText,
  supportedPrimitiveCodes,
} from "../../../src/primitives/registry.ts";
import {
  KERIPY_MATTER_VECTORS,
  KERIPY_MAIN_BASELINE,
} from "../../fixtures/keripy-primitive-vectors.ts";
import { txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("registry: parses KERIpy verifier vector token", () => {
  const token = parsePrimitiveFromText(txt(KERIPY_MATTER_VECTORS.verferEcdsaR1));
  assertEquals(token.qb64, KERIPY_MATTER_VECTORS.verferEcdsaR1);
  assertEquals(token.code, "1AAJ");
  assertEquals(token.name, "ECDSA_256r1");
});

Deno.test("registry: supported codes include KERIpy baseline families", () => {
  const codes = supportedPrimitiveCodes();
  assertEquals(codes.includes("A"), true);
  assertEquals(codes.includes("E"), true);
  assertEquals(KERIPY_MAIN_BASELINE.commit, "5a5597e8b7f7");
});

Deno.test("registry: rejects malformed primitive text", () => {
  assertThrows(() => parsePrimitiveFromText(txt("?AAA")), UnknownCodeError);
});
