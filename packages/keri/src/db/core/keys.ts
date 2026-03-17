/**
 * Key utility functions for constructing database keys
 *
 * These functions create composite keys used in LMDB databases
 * following KERIpy's key construction patterns.
 */

import { DatabaseKeyError, ValidationError } from "../../core/errors.ts";

import { b, t } from "../../../../cesr/mod.ts";
import { to32CharHex } from "../../../../cesr/src/core/bytes.ts";

/**
 * Create a digest key: prefix.digest
 *
 * @param pre - Prefix (string or Uint8Array)
 * @param dig - Digest (string or Uint8Array)
 * @returns Uint8Array key with separator '.'
 */
export function dgKey(
  pre: string | Uint8Array,
  dig: string | Uint8Array,
): Uint8Array {
  const preBytes = typeof pre === "string" ? b(pre) : pre;
  const digBytes = typeof dig === "string" ? b(dig) : dig;

  const result = new Uint8Array(preBytes.length + 1 + digBytes.length);
  result.set(preBytes, 0);
  result.set(b("."), preBytes.length);
  result.set(digBytes, preBytes.length + 1);

  return result;
}

/**
 * Create an ordinal key: top.separator + 32-char hex ordinal.
 * Example:
 * - "BB__prefix__Ha.00000000000000000000000000000001"
 *
 * @param top - top key (string or Uint8Array)
 * @param on - Ordinal number to be converted to 32 hex bytes
 * @param sep - Separator (default '.')
 * @returns Uint8Array key with separator and zero-padded hex ordinal
 */
export function onKey(
  top: string | Uint8Array,
  on: number,
  sep: string | Uint8Array = ".",
): Uint8Array {
  const topBytes = typeof top === "string" ? b(top) : top;
  const sepBytes = typeof sep === "string" ? b(sep) : sep;

  const ordinalBytes = b(to32CharHex(on));

  const result = new Uint8Array(
    topBytes.length + sepBytes.length + ordinalBytes.length,
  );
  result.set(topBytes, 0);
  result.set(sepBytes, topBytes.length);
  result.set(ordinalBytes, topBytes.length + sepBytes.length);

  return result;
}

/** Alias for ordinal keys used as sequence-number keys. */
export const snKey = onKey; // Sequence number key
/** Alias for ordinal keys used as first-seen-number keys. */
export const fnKey = onKey; // First seen number key

/**
 * Create a rotation index key: prefix.ridx
 *
 * @param pre - Prefix (string or Uint8Array)
 * @param ri - Rotation index (number)
 * @returns Uint8Array key with separator '.' and zero-padded hex rotation index
 */
export function riKey(pre: string | Uint8Array, ri: number): Uint8Array {
  return onKey(pre, ri, ".");
}

/**
 * Create a datetime key: prefix|datetime
 *
 * @param pre - Prefix (string or Uint8Array)
 * @param dts - Datetime string (ISO8601)
 * @returns Uint8Array key with separator '|'
 */
export function dtKey(pre: string | Uint8Array, dts: string): Uint8Array {
  const preBytes = typeof pre === "string" ? b(pre) : pre;
  const dtsBytes = b(dts);

  const result = new Uint8Array(preBytes.length + 1 + dtsBytes.length);
  result.set(preBytes, 0);
  result.set(b("|"), preBytes.length);
  result.set(dtsBytes, preBytes.length + 1);

  return result;
}

/**
 * Split a key at separator
 *
 * @param key - Key to split (Uint8Array or string)
 * @param sep - Separator (default '.')
 * @returns Tuple of [prefix, suffix]
 * @throws Error if key doesn't split into exactly 2 parts
 */
export function splitKey(
  key: Uint8Array | string,
  sep: string | Uint8Array = ".",
): [Uint8Array, Uint8Array] {
  const keyBytes = typeof key === "string" ? b(key) : key;
  const sepBytes = typeof sep === "string" ? b(sep) : sep;

  const sepStr = t(sepBytes);
  const keyStr = t(keyBytes);

  const splitAt = keyStr.lastIndexOf(sepStr);
  if (splitAt <= 0 || splitAt + sepStr.length >= keyStr.length) {
    throw new ValidationError(
      `Key must split into exactly 2 parts at rightmost separator`,
      { key: keyStr, separator: sepStr },
    );
  }

  return [
    b(keyStr.slice(0, splitAt)),
    b(keyStr.slice(splitAt + sepStr.length)),
  ];
}

/**
 * Split an ordinal key and parse the ordinal
 *
 * @param key - Ordinal key to split (Uint8Array or string)
 * @param sep - Separator (default '.')
 * @returns Tuple of [prefix, ordinal_number]
 */
export function splitKeyON(
  key: Uint8Array | string,
  sep: string | Uint8Array = ".",
): [Uint8Array, number] {
  const [prefix, suffix] = splitKey(key, sep);
  const suffixStr = t(suffix);
  const ordinal = parseInt(suffixStr, 16);
  return [prefix, ordinal];
}

/** Alias for splitting sequence-number keys into prefix + ordinal. */
export const splitSnKey = splitKeyON;
/** Alias for splitting first-seen-number keys into prefix + ordinal. */
export const splitFnKey = splitKeyON;
/** Legacy alias preserved for KERIpy-oriented naming parity. */
export const splitKeySN = splitKeyON;
/** Legacy alias preserved for KERIpy-oriented naming parity. */
export const splitKeyFN = splitKeyON;
/** Generic alias for splitting ordinal-suffixed keys. */
export const splitOnKey = splitKeyON;

/**
 * Split a datetime key and parse the datetime
 *
 * @param key - Datetime key to split (Uint8Array or string)
 * @returns Tuple of [prefix, datetime_string]
 */
export function splitKeyDT(key: Uint8Array | string): [Uint8Array, string] {
  const [prefix, suffix] = splitKey(key, "|");
  const datetimeStr = t(suffix);
  return [prefix, datetimeStr];
}

/**
 * Append insertion ordinal suffix to a key
 *
 * @param key - Apparent effective database key (Uint8Array or string)
 * @param ion - Insertion ordering ordinal
 * @param sep - Separator (default '.')
 * @returns Uint8Array with suffix: key + sep + 32-char hex ordinal
 */
export function suffix(
  key: Uint8Array | string,
  ion: number,
  sep: string | Uint8Array = ".",
): Uint8Array {
  const keyBytes = typeof key === "string" ? b(key) : key;
  const sepBytes = typeof sep === "string" ? b(sep) : sep;

  const ordinalHex = ion.toString(16).padStart(32, "0");
  const ordinalBytes = b(ordinalHex);

  const result = new Uint8Array(
    keyBytes.length + sepBytes.length + ordinalBytes.length,
  );
  result.set(keyBytes, 0);
  result.set(sepBytes, keyBytes.length);
  result.set(ordinalBytes, keyBytes.length + sepBytes.length);

  return result;
}

/**
 * Remove insertion ordinal suffix from a key
 *
 * @param iokey - Key with suffix (Uint8Array or string)
 * @param sep - Separator (default '.')
 * @returns Tuple of [key, ordinal_number]
 */
export function unsuffix(
  iokey: Uint8Array | string,
  sep: string | Uint8Array = ".",
): [Uint8Array, number] {
  const iokeyBytes = typeof iokey === "string" ? b(iokey) : iokey;
  const sepBytes = typeof sep === "string" ? b(sep) : sep;

  const sepStr = t(sepBytes);
  const iokeyStr = t(iokeyBytes);

  const lastSepIndex = iokeyStr.lastIndexOf(sepStr);
  if (lastSepIndex === -1) {
    throw new DatabaseKeyError(
      `No separator found in iokey`,
      { key: iokeyStr, separator: sepStr },
    );
  }

  const keyStr = iokeyStr.substring(0, lastSepIndex);
  const suffixStr = iokeyStr.substring(lastSepIndex + sepStr.length);
  const ordinal = parseInt(suffixStr, 16);

  return [b(keyStr), ordinal];
}

/** Hex width of IoDup/Dup ordering proems used in suffixed key helpers. */
export const ProemSize = 32;
/** Maximum ordinal representable within one fixed-width proem. */
export const MaxProem = parseInt("f".repeat(ProemSize), 16);
/** Maximum ordinal representable by the standard 32-hex `onKey()` suffix. */
export const MaxON = parseInt("f".repeat(32), 16);
/** Hex width of insertion-order suffixes appended by `suffix()`. */
export const SuffixSize = 32;
/** Maximum insertion-order suffix value representable by `suffix()`. */
export const MaxSuffix = parseInt("f".repeat(SuffixSize), 16);
