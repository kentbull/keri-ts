import {
  BEXTER_CODES,
  CIPHER_X25519_ALL_CODES,
  DECIMAL_CODES,
  DIGEST_CODES,
  ESCAPE_CODES,
  LABELER_CODES,
  NON_DIGEST_PREFIX_CODES,
  NON_TRANSFERABLE_PREFIX_CODES,
  NONCE_CODES,
  NUMBER_CODES,
  PREFIX_CODES,
  TAG_CODES,
  TEXTER_CODES,
} from "../tables/matter.codexes.generated.ts";
import {
  INDEXED_BOTH_SIG_CODES,
  INDEXED_CURRENT_SIG_CODES,
  INDEXED_SIG_CODES,
  INDEXER_CODES,
} from "../tables/indexer.codexes.generated.ts";
import {
  MATTER_CODE_NAMES,
  MATTER_CODES_BY_NAME,
} from "../tables/matter.tables.generated.ts";

function codesByName<const T extends readonly string[]>(
  ...names: T
): Set<string> {
  const codes = names.map((name) => {
    const code =
      MATTER_CODES_BY_NAME[name as keyof typeof MATTER_CODES_BY_NAME];
    if (!code) {
      throw new Error(`Missing matter code name=${name} in generated tables.`);
    }
    return code;
  });
  return new Set(codes);
}

function codesByNamePredicate(
  predicate: (name: string) => boolean,
): Set<string> {
  return new Set(
    Object.entries(MATTER_CODE_NAMES)
      .filter(([, name]) => predicate(name))
      .map(([code]) => code),
  );
}

export {
  BEXTER_CODES,
  CIPHER_X25519_ALL_CODES,
  DECIMAL_CODES,
  DIGEST_CODES,
  ESCAPE_CODES,
  INDEXED_BOTH_SIG_CODES,
  INDEXED_CURRENT_SIG_CODES,
  INDEXED_SIG_CODES,
  INDEXER_CODES,
  LABELER_CODES,
  NON_DIGEST_PREFIX_CODES,
  NON_TRANSFERABLE_PREFIX_CODES,
  NONCE_CODES,
  NUMBER_CODES,
  PREFIX_CODES,
  TAG_CODES,
  TEXTER_CODES,
};

export const VERFER_CODES = NON_DIGEST_PREFIX_CODES;
export const SIGER_CODES = INDEXED_SIG_CODES;
export const THOLDER_WEIGHTED_CODES = BEXTER_CODES;
export const THOLDER_NUMERIC_CODES = NUMBER_CODES;
export const THOLDER_CODES = new Set<string>([
  ...THOLDER_NUMERIC_CODES,
  ...THOLDER_WEIGHTED_CODES,
]);

export const SIGNER_CODES = codesByName(
  "Ed25519_Seed",
  "ECDSA_256k1_Seed",
  "ECDSA_256r1_Seed",
);

export const SALTER_CODES = codesByName("Salt_128");
export const ENCRYPTER_CODES = codesByName("X25519");
export const DECRYPTER_CODES = codesByName("X25519_Private");
export const CIGAR_CODES = codesByNamePredicate((name) =>
  name.endsWith("_Sig")
);

export const TRAIT_TAGS = new Set<string>([
  "EO",
  "DND",
  "RB",
  "NB",
  "NRB",
  "DID",
]);

export const VERSER_CODES = new Set<string>(["Y", "0O"]);
export const VERSER_PROTOCOLS = new Set<string>(["KERI", "ACDC"]);

/** KERI attribute-name validator used by Labeler semantic projection. */
export function isAttLabel(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
