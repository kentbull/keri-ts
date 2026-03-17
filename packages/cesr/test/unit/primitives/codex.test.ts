import { assertEquals } from "jsr:@std/assert";
import {
  BEXTER_CODES,
  CIGAR_CODES,
  CIPHER_X25519_ALL_CODES,
  DECIMAL_CODES,
  DECRYPTER_CODES,
  DIGEST_CODES,
  ENCRYPTER_CODES,
  ESCAPE_CODES,
  INDEXED_BOTH_SIG_CODES,
  INDEXED_CURRENT_SIG_CODES,
  INDEXED_SIG_CODES,
  INDEXER_CODES,
  isAttLabel,
  LABELER_CODES,
  NON_DIGEST_PREFIX_CODES,
  NON_TRANSFERABLE_PREFIX_CODES,
  NONCE_CODES,
  NUMBER_CODES,
  PREFIX_CODES,
  SALTER_CODES,
  SIGER_CODES,
  SIGNER_CODES,
  TAG_CODES,
  THOLDER_NUMERIC_CODES,
  THOLDER_WEIGHTED_CODES,
  TRAIT_TAGS,
  VERFER_CODES,
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
  assertEquals(ESCAPE_CODES.has("1AAO"), true);
  assertEquals(NONCE_CODES.has("1AAP"), true);
  assertEquals(NUMBER_CODES.has("M"), true);
  assertEquals(DECIMAL_CODES.has("4H"), true);
  assertEquals(TAG_CODES.has(KERIPY_CODE_VECTORS.taggerCodeIlk), true);
  assertEquals(BEXTER_CODES.has("4A"), true);
  assertEquals(LABELER_CODES.has("V"), true);
  assertEquals(PREFIX_CODES.has("D"), true);
  assertEquals(NON_TRANSFERABLE_PREFIX_CODES.has("B"), true);
  assertEquals(NON_DIGEST_PREFIX_CODES.has("1AAJ"), true);
  assertEquals(VERFER_CODES.has("1AAJ"), true);
  assertEquals(INDEXER_CODES.has("4z"), true);
  assertEquals(INDEXED_SIG_CODES.has("A"), true);
  assertEquals(INDEXED_CURRENT_SIG_CODES.has("B"), true);
  assertEquals(INDEXED_BOTH_SIG_CODES.has("A"), true);
  assertEquals(SIGER_CODES.has("3B"), true);
  assertEquals(SIGNER_CODES.has("A"), true);
  assertEquals(SALTER_CODES.has("0A"), true);
  assertEquals(SALTER_CODES.has("a"), false);
  assertEquals(ENCRYPTER_CODES.has("C"), true);
  assertEquals(DECRYPTER_CODES.has("O"), true);
  assertEquals(CIGAR_CODES.has("0B"), true);
  assertEquals(CIPHER_X25519_ALL_CODES.has("P"), true);
  assertEquals(THOLDER_NUMERIC_CODES.has("M"), true);
  assertEquals(THOLDER_WEIGHTED_CODES.has("4A"), true);
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
  assertEquals(
    KERIPY_COUNTER_VECTORS.v2ControllerIdxSigsCount1.startsWith("-K"),
    true,
  );
});
