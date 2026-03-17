import { codexValues, invertCodex } from "../tables/codex-utils.ts";
import {
  IdrDex,
  IdxBthSigDex,
  IdxCrtSigDex,
  IdxSigDex,
} from "../tables/indexer.codex.generated.ts";
import {
  BexDex,
  CiXAllQB64Dex,
  CiXDex,
  CiXFixQB64Dex,
  CiXVarDex,
  CiXVarQB2Dex,
  CiXVarQB64Dex,
  CiXVarStrmDex,
  DecDex,
  DigDex,
  EscapeDex,
  LabelDex,
  MtrDex,
  NonceDex,
  NonTransDex,
  NumDex,
  PreDex,
  PreNonDigDex,
  TagDex,
  TexDex,
} from "../tables/matter.codex.generated.ts";
import { TraitDex } from "../tables/trait.codex.generated.ts";
import { Protocols } from "../tables/versions.ts";

/**
 * Derived readability layer over the generated KERIpy-parity codex objects.
 *
 * Canonical names such as `MtrDex` and `IdrDex` are the primary source of
 * truth for the shared Matter/Indexer code spaces. Semantic families such as
 * `PreDex`, `DigDex`, `NonceDex`, and `IdxSigDex` are KERIpy-style subset
 * views over those same base codices, not separate versioned registries.
 *
 * The sets exported here are convenience views for primitive-family validation
 * and TS ergonomics. Counter codices are the separate genus/version-aware
 * layer; Matter and Indexer family subsets are not.
 */
export {
  BexDex,
  CiXAllQB64Dex,
  CiXDex,
  CiXFixQB64Dex,
  CiXVarDex,
  CiXVarQB2Dex,
  CiXVarQB64Dex,
  CiXVarStrmDex,
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
};

/**
 * Derived matter/indexer family views used by semantic primitive validators.
 *
 * Maintainer rule:
 * - generated codex objects such as `MtrDex`, `PreDex`, and `IdrDex` remain
 *   the authority
 * - these exported sets are readability helpers layered over that authority
 */
export const BEXTER_CODES = codexValues(BexDex);
export const TEXTER_CODES = codexValues(TexDex);
export const DECIMAL_CODES = codexValues(DecDex);
export const DIGEST_CODES = codexValues(DigDex);
export const NONCE_CODES = codexValues(NonceDex);
export const NUMBER_CODES = codexValues(NumDex);
export const TAG_CODES = codexValues(TagDex);
export const LABELER_CODES = codexValues(LabelDex);
export const PREFIX_CODES = codexValues(PreDex);
export const NON_TRANSFERABLE_PREFIX_CODES = codexValues(NonTransDex);
export const NON_DIGEST_PREFIX_CODES = codexValues(PreNonDigDex);
export const ESCAPE_CODES = codexValues(EscapeDex);

export const CIPHER_X25519_VARIABLE_STREAM_CODES = codexValues(CiXVarStrmDex);
export const CIPHER_X25519_QB64_VARIABLE_CODES = codexValues(CiXVarQB64Dex);
export const CIPHER_X25519_FIXED_QB64_CODES = codexValues(CiXFixQB64Dex);
export const CIPHER_X25519_ALL_QB64_CODES = codexValues(CiXAllQB64Dex);
export const CIPHER_X25519_ALL_VARIABLE_CODES = codexValues(CiXVarDex);
export const CIPHER_X25519_QB2_VARIABLE_CODES = codexValues(CiXVarQB2Dex);
export const CIPHER_X25519_ALL_CODES = codexValues(CiXDex);

export const INDEXER_CODES = codexValues(IdrDex);
export const INDEXED_SIG_CODES = codexValues(IdxSigDex);
export const INDEXED_CURRENT_SIG_CODES = codexValues(IdxCrtSigDex);
export const INDEXED_BOTH_SIG_CODES = codexValues(IdxBthSigDex);

export const VERFER_CODES = NON_DIGEST_PREFIX_CODES;
export const SIGER_CODES = INDEXED_SIG_CODES;
export const DATER_CODES = new Set<string>([MtrDex.DateTime]);
export const SEQNER_CODES = new Set<string>([MtrDex.Salt_128]);
export const ILKER_CODES = new Set<string>([MtrDex.Tag3]);
export const THOLDER_WEIGHTED_CODES = BEXTER_CODES;
export const THOLDER_NUMERIC_CODES = NUMBER_CODES;
export const THOLDER_CODES = new Set<string>([
  ...THOLDER_NUMERIC_CODES,
  ...THOLDER_WEIGHTED_CODES,
]);

export const SIGNER_CODES = new Set<string>([
  MtrDex.Ed25519_Seed,
  MtrDex.ECDSA_256k1_Seed,
  MtrDex.ECDSA_256r1_Seed,
]);

export const SALTER_CODES = new Set<string>([MtrDex.Salt_128]);
export const ENCRYPTER_CODES = new Set<string>([MtrDex.X25519]);
export const DECRYPTER_CODES = new Set<string>([MtrDex.X25519_Private]);
export const CIGAR_CODES = new Set<string>([
  MtrDex.Ed25519_Sig,
  MtrDex.ECDSA_256k1_Sig,
  MtrDex.ECDSA_256r1_Sig,
  MtrDex.Ed448_Sig,
]);

export const TRAIT_TAGS = new Set<string>([
  ...codexValues(TraitDex),
]);

export const VERSER_CODES = new Set<string>([MtrDex.Tag7, MtrDex.Tag10]);
export const VERSER_PROTOCOLS = new Set<string>(Object.values(Protocols));

const MATTER_CODEX_NAMES = invertCodex(MtrDex);

/** Project one matter code back to its generated codex member name. */
export function matterCodexName(code: string): string | undefined {
  return MATTER_CODEX_NAMES.get(
    code as (typeof MtrDex)[keyof typeof MtrDex],
  );
}

/** KERI attribute-name validator used by Labeler semantic projection. */
export function isAttLabel(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
