import { assertEquals } from "jsr:@std/assert";
import {
  BexDex,
  DecDex,
  DigDex,
  EscapeDex,
  IdrDex,
  IdxBthSigDex,
  IdxCrtSigDex,
  IdxSigDex,
  LabelDex,
  MtrDex,
  NonceDex,
  NonTransDex,
  NumDex,
  PreDex,
  PreNonDigDex,
  TagDex,
  TexDex,
  TraitDex,
} from "../../../src/primitives/codex.ts";
import {
  BEXTER_CODES,
  CIGAR_CODES,
  CIPHER_X25519_ALL_CODES,
  DATER_CODES,
  DECRYPTER_CODES,
  DIGEST_CODES,
  ENCRYPTER_CODES,
  ILKER_CODES,
  INDEXED_BOTH_SIG_CODES,
  INDEXED_CURRENT_SIG_CODES,
  INDEXED_SIG_CODES,
  INDEXER_CODES,
  isAttLabel,
  LABELER_CODES,
  NON_DIGEST_PREFIX_CODES,
  NON_TRANSFERABLE_CODES,
  NONCE_CODES,
  NUMBER_CODES,
  PREFIX_CODES,
  SALTER_CODES,
  SEQNER_CODES,
  SIGER_CODES,
  SIGNER_CODES,
  TAG_CODES,
  THOLDER_NUMERIC_CODES,
  THOLDER_WEIGHTED_CODES,
  TRAIT_TAGS,
  VERFER_CODES,
  VERSER_CODES,
} from "../../../src/primitives/codex.ts";
import { KERIPY_COUNTER_VECTORS, KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";

function codesOf(codex: Readonly<Record<string, string>>): string[] {
  return Object.values(codex).sort();
}

Deno.test("codex: exposes KERIpy canonical parity names", () => {
  assertEquals(MtrDex.Ed25519_Seed, "A");
  assertEquals(MtrDex.ECDSA_256r1, "1AAJ");
  assertEquals(BexDex.StrB64_L0, "4A");
  assertEquals(TexDex.Bytes_L0, "4B");
  assertEquals(DecDex.Decimal_L0, "4H");
  assertEquals(DigDex.Blake3_256, "E");
  assertEquals(NonceDex.Empty, "1AAP");
  assertEquals(NumDex.Huge, "0A");
  assertEquals(TagDex.Tag10, "0O");
  assertEquals(TraitDex.EstOnly, "EO");
  assertEquals(TraitDex.DoNotDelegate, "DND");
  assertEquals(LabelDex.Label1, "V");
  assertEquals(EscapeDex.Escape, "1AAO");
  assertEquals(PreDex.Ed25519, "D");
  assertEquals(NonTransDex.Ed25519N, "B");
  assertEquals(PreNonDigDex.ECDSA_256r1, "1AAJ");
  assertEquals(IdrDex.TBD4, "4z");
  assertEquals(IdxSigDex.Ed25519_Sig, "A");
  assertEquals(IdxCrtSigDex.Ed25519_Crt_Sig, "B");
  assertEquals(IdxBthSigDex.Ed25519_Sig, "A");
});

Deno.test("codex: derived readability sets match canonical codex membership", () => {
  assertEquals([...BEXTER_CODES].sort(), codesOf(BexDex));
  assertEquals([...DIGEST_CODES].sort(), codesOf(DigDex));
  assertEquals([...NONCE_CODES].sort(), codesOf(NonceDex));
  assertEquals([...NUMBER_CODES].sort(), codesOf(NumDex));
  assertEquals([...TAG_CODES].sort(), codesOf(TagDex));
  assertEquals([...LABELER_CODES].sort(), codesOf(LabelDex));
  assertEquals([...PREFIX_CODES].sort(), codesOf(PreDex));
  assertEquals([...NON_TRANSFERABLE_CODES].sort(), codesOf(NonTransDex));
  assertEquals([...NON_DIGEST_PREFIX_CODES].sort(), codesOf(PreNonDigDex));
  assertEquals([...INDEXER_CODES].sort(), codesOf(IdrDex));
  assertEquals([...INDEXED_SIG_CODES].sort(), codesOf(IdxSigDex));
  assertEquals([...INDEXED_CURRENT_SIG_CODES].sort(), codesOf(IdxCrtSigDex));
  assertEquals([...INDEXED_BOTH_SIG_CODES].sort(), codesOf(IdxBthSigDex));
});

Deno.test("codex: keeps KERIpy-derived semantic helper behavior", () => {
  assertEquals(VERFER_CODES.has(MtrDex.ECDSA_256r1), true);
  assertEquals(SIGNER_CODES.has(MtrDex.Ed25519_Seed), true);
  assertEquals(DATER_CODES.has(MtrDex.DateTime), true);
  assertEquals(SEQNER_CODES.has(MtrDex.Salt_128), true);
  assertEquals(ILKER_CODES.has(MtrDex.Tag3), true);
  assertEquals(VERSER_CODES.has(MtrDex.Tag7), true);
  assertEquals(VERSER_CODES.has(MtrDex.Tag10), true);
  assertEquals(SALTER_CODES.has(MtrDex.Salt_128), true);
  assertEquals(SALTER_CODES.has(MtrDex.Salt_256), false);
  assertEquals(TRAIT_TAGS.has(TraitDex.EstOnly), true);
  assertEquals(ENCRYPTER_CODES.has(MtrDex.X25519), true);
  assertEquals(DECRYPTER_CODES.has(MtrDex.X25519_Private), true);
  assertEquals(CIGAR_CODES.has(MtrDex.Ed25519_Sig), true);
  assertEquals(CIGAR_CODES.has(MtrDex.Ed448_Sig), true);
  assertEquals(CIPHER_X25519_ALL_CODES.has(MtrDex.X25519_Cipher_Seed), true);
  assertEquals(SIGER_CODES.has(IdrDex.Ed448_Big_Crt_Sig), true);
  assertEquals(THOLDER_NUMERIC_CODES.has(NumDex.Short), true);
  assertEquals(THOLDER_WEIGHTED_CODES.has(BexDex.StrB64_L0), true);
});

Deno.test("codex: keeps attribute-label semantics and fixture linkage", () => {
  assertEquals(isAttLabel("field_name"), true);
  assertEquals(isAttLabel("9field"), false);
  assertEquals(isAttLabel(""), false);
  assertEquals(KERIPY_MATTER_VECTORS.ilker.startsWith("X"), true);
  assertEquals(
    KERIPY_COUNTER_VECTORS.v2ControllerIdxSigsCount1.startsWith("-K"),
    true,
  );
});
