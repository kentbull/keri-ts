/**
 * Key utility functions for constructing database keys
 *
 * These functions create composite keys used in LMDB databases
 * following KERIpy's key construction patterns.
 */

import { DatabaseKeyError, ValidationError } from "../../core/errors.ts";

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
  const preBytes = typeof pre === "string"
    ? new TextEncoder().encode(pre)
    : pre;
  const digBytes = typeof dig === "string"
    ? new TextEncoder().encode(dig)
    : dig;

  const result = new Uint8Array(preBytes.length + 1 + digBytes.length);
  result.set(preBytes, 0);
  result.set(new TextEncoder().encode("."), preBytes.length);
  result.set(digBytes, preBytes.length + 1);

  return result;
}

/**
 * Create an ordinal key: prefix.separator + 32-char hex ordinal
 *
 * @param pre - Prefix (string or Uint8Array)
 * @param sn - Sequence number or ordinal number
 * @param sep - Separator (default '.')
 * @returns Uint8Array key with separator and zero-padded hex ordinal
 */
export function onKey(
  pre: string | Uint8Array,
  sn: number,
  sep: string | Uint8Array = ".",
): Uint8Array {
  const preBytes = typeof pre === "string"
    ? new TextEncoder().encode(pre)
    : pre;
  const sepBytes = typeof sep === "string"
    ? new TextEncoder().encode(sep)
    : sep;

  // Format ordinal as 32-char hex, zero-padded
  const ordinalHex = sn.toString(16).padStart(32, "0");
  const ordinalBytes = new TextEncoder().encode(ordinalHex);

  const result = new Uint8Array(
    preBytes.length + sepBytes.length + ordinalBytes.length,
  );
  result.set(preBytes, 0);
  result.set(sepBytes, preBytes.length);
  result.set(ordinalBytes, preBytes.length + sepBytes.length);

  return result;
}

// Aliases for semantic clarity
export const snKey = onKey; // Sequence number key
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
  const preBytes = typeof pre === "string"
    ? new TextEncoder().encode(pre)
    : pre;
  const dtsBytes = new TextEncoder().encode(dts);

  const result = new Uint8Array(preBytes.length + 1 + dtsBytes.length);
  result.set(preBytes, 0);
  result.set(new TextEncoder().encode("|"), preBytes.length);
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
  const keyBytes = typeof key === "string"
    ? new TextEncoder().encode(key)
    : key;
  const sepBytes = typeof sep === "string"
    ? new TextEncoder().encode(sep)
    : sep;

  const sepStr = new TextDecoder().decode(sepBytes);
  const keyStr = new TextDecoder().decode(keyBytes);

  const parts = keyStr.split(sepStr);
  if (parts.length !== 2) {
    throw new ValidationError(
      `Key must split into exactly 2 parts, got ${parts.length}`,
      { key: keyStr, separator: sepStr, parts: parts.length },
    );
  }

  return [
    new TextEncoder().encode(parts[0]),
    new TextEncoder().encode(parts[1]),
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
  const suffixStr = new TextDecoder().decode(suffix);
  const ordinal = parseInt(suffixStr, 16);
  return [prefix, ordinal];
}

// Aliases
export const splitSnKey = splitKeyON;
export const splitFnKey = splitKeyON;
export const splitKeySN = splitKeyON;
export const splitKeyFN = splitKeyON;

/**
 * Split a datetime key and parse the datetime
 *
 * @param key - Datetime key to split (Uint8Array or string)
 * @returns Tuple of [prefix, datetime_string]
 */
export function splitKeyDT(key: Uint8Array | string): [Uint8Array, string] {
  const [prefix, suffix] = splitKey(key, "|");
  const datetimeStr = new TextDecoder().decode(suffix);
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
  const keyBytes = typeof key === "string"
    ? new TextEncoder().encode(key)
    : key;
  const sepBytes = typeof sep === "string"
    ? new TextEncoder().encode(sep)
    : sep;

  const ordinalHex = ion.toString(16).padStart(32, "0");
  const ordinalBytes = new TextEncoder().encode(ordinalHex);

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
  const iokeyBytes = typeof iokey === "string"
    ? new TextEncoder().encode(iokey)
    : iokey;
  const sepBytes = typeof sep === "string"
    ? new TextEncoder().encode(sep)
    : sep;

  const sepStr = new TextDecoder().decode(sepBytes);
  const iokeyStr = new TextDecoder().decode(iokeyBytes);

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

  return [new TextEncoder().encode(keyStr), ordinal];
}

// Constants
export const ProemSize = 32;
export const MaxProem = parseInt("f".repeat(ProemSize), 16);
export const MaxON = parseInt("f".repeat(32), 16);
export const SuffixSize = 32;
export const MaxSuffix = parseInt("f".repeat(SuffixSize), 16);
