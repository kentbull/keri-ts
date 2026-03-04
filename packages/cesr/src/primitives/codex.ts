/**
 * Primitive codex subsets derived from KERIpy `coring.py` + `kering.py`.
 *
 * These sets intentionally model semantic families (digest, nonce, tag, label)
 * instead of relying on one-to-one code-name maps because several CESR codes
 * are valid in multiple semantic domains (for example `0A`).
 */
export const DIGEST_CODES = new Set<string>([
  "E",
  "F",
  "G",
  "H",
  "I",
  "0D",
  "0E",
  "0F",
  "0G",
]);

export const NONCE_CODES = new Set<string>([
  "1AAP", // Empty
  "0A", // Salt_128
  "a", // Salt_256
  ...DIGEST_CODES,
]);

export const NUMBER_CODES = new Set<string>([
  "M", // Short
  "0H", // Long
  "R", // Tall
  "N", // Big
  "S", // Large
  "T", // Great
  "0A", // Huge
  "U", // Vast
]);

export const DECIMAL_CODES = new Set<string>([
  "4H",
  "5H",
  "6H",
  "7AAH",
  "8AAH",
  "9AAH",
]);

export const TAG_CODES = new Set<string>([
  "0J", // Tag1
  "0K", // Tag2
  "X", // Tag3
  "1AAF", // Tag4
  "0L", // Tag5
  "0M", // Tag6
  "Y", // Tag7
  "1AAN", // Tag8
  "0N", // Tag9
  "0O", // Tag10
  "Z", // Tag11
]);

export const BEXTER_CODES = new Set<string>([
  "4A",
  "5A",
  "6A",
  "7AAA",
  "8AAA",
  "9AAA",
]);

export const TEXTER_CODES = new Set<string>([
  "4B",
  "5B",
  "6B",
  "7AAB",
  "8AAB",
  "9AAB",
]);

export const LABELER_CODES = new Set<string>([
  "1AAP", // Empty
  ...TAG_CODES,
  ...BEXTER_CODES,
  ...TEXTER_CODES,
  "V", // Label1
  "W", // Label2
]);

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
