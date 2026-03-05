import { assertEquals } from "jsr:@std/assert";
import {
  BEXTER_CODES,
  DECIMAL_CODES,
  DIGEST_CODES,
  isAttLabel,
  LABELER_CODES,
  NONCE_CODES,
  NUMBER_CODES,
  TAG_CODES,
  TRAIT_TAGS,
  VERSER_CODES,
  VERSER_PROTOCOLS,
} from "../../../src/primitives/codex.ts";
import {
  KERIPY_CODE_VECTORS,
  KERIPY_COUNTER_VECTORS,
  KERIPY_MATTER_VECTORS,
} from "../../fixtures/keripy-primitive-vectors.ts";

Deno.test("codex: includes KERIpy-derived family codes", () => {
  assertEquals(DIGEST_CODES.has("E"), true);
  assertEquals(NONCE_CODES.has("1AAP"), true);
  assertEquals(NUMBER_CODES.has("M"), true);
  assertEquals(DECIMAL_CODES.has("4H"), true);
  assertEquals(TAG_CODES.has(KERIPY_CODE_VECTORS.taggerCodeIlk), true);
  assertEquals(BEXTER_CODES.has("4A"), true);
  assertEquals(LABELER_CODES.has("V"), true);
  assertEquals(VERSER_CODES.has("Y"), true);
  assertEquals(VERSER_PROTOCOLS.has("KERI"), true);
  assertEquals(TRAIT_TAGS.has("EO"), true);
});

Deno.test("codex: keeps attribute-label semantics", () => {
  assertEquals(isAttLabel("field_name"), true);
  assertEquals(isAttLabel("9field"), false);
  assertEquals(isAttLabel(""), false);
  // KERIpy vector references to ensure this suite stays linked to baseline fixtures.
  assertEquals(KERIPY_MATTER_VECTORS.ilker.startsWith("X"), true);
  assertEquals(KERIPY_COUNTER_VECTORS.v2ControllerIdxSigsCount1.startsWith("-K"), true);
});
