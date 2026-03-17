import { blake2b, blake2s } from "npm:@noble/hashes@1.8.0/blake2";
import { blake3 } from "npm:@noble/hashes@1.8.0/blake3";
import { sha256, sha512 } from "npm:@noble/hashes@1.8.0/sha2";
import { sha3_256, sha3_512 } from "npm:@noble/hashes@1.8.0/sha3";
import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { DigDex, DIGEST_CODES, matterCodexName } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

interface DigerOptions {
  strict?: boolean;
}

type DigestFn = (ser: Uint8Array) => Uint8Array;

/**
 * Digest primitive family.
 *
 * KERIpy substance: `Diger` encapsulates self-addressing digest material and
 * optionally constrains codes to digest codex membership (`strict=true`).
 *
 * Maintainer note:
 * `DigDex` remains the canonical namespace of supported digest codes, but this
 * class is the runtime authority for "code -> hash implementation" dispatch.
 * Keep new digest algorithms centralized here so `Saider`, `Serder`, and app
 * flows do not grow their own private digest switches.
 */
export class Diger extends Matter {
  /** Shared KERIpy-style digest registry keyed by canonical `DigDex` values. */
  static readonly Digests = new Map<string, DigestFn>([
    [DigDex.Blake3_256, (ser) => blake3(ser)],
    [DigDex.Blake3_512, (ser) => blake3(ser, { dkLen: 64 })],
    [DigDex.Blake2b_256, (ser) => blake2b(ser, { dkLen: 32 })],
    [DigDex.Blake2b_512, (ser) => blake2b(ser, { dkLen: 64 })],
    [DigDex.Blake2s_256, (ser) => blake2s(ser, { dkLen: 32 })],
    [DigDex.SHA2_256, (ser) => sha256(ser)],
    [DigDex.SHA2_512, (ser) => sha512(ser)],
    [DigDex.SHA3_256, (ser) => sha3_256(ser)],
    [DigDex.SHA3_512, (ser) => sha3_512(ser)],
  ]);

  constructor(init: Matter | MatterInit, options: DigerOptions = {}) {
    super(init);
    if ((options.strict ?? true) && !DIGEST_CODES.has(this.code)) {
      throw new UnknownCodeError(`Expected digest code, got ${this.code}`);
    }
  }

  get digest(): Uint8Array {
    return this.raw;
  }

  get algorithm(): string {
    return matterCodexName(this.code) ?? "UnknownDigest";
  }

  /** Compute raw digest bytes for `ser` using the digest family selected by `code`. */
  static digest(ser: Uint8Array, code: string): Uint8Array {
    const digest = Diger.Digests.get(code);
    if (!digest) {
      throw new UnknownCodeError(`Unsupported digest code ${code}`);
    }
    return digest(ser);
  }

  verify(ser: Uint8Array): boolean {
    return Diger.compare(ser, this.code, this.raw);
  }

  /** Compare `ser` against either the instance digest or an override digest. */
  compare(ser: Uint8Array, dig?: Uint8Array): boolean {
    return Diger.compare(ser, this.code, dig ?? this.raw);
  }

  /** Constant-shape byte comparison helper used by higher-level SAID/serder verification. */
  static compare(ser: Uint8Array, code: string, dig: Uint8Array): boolean {
    const actual = Diger.digest(ser, code);
    if (actual.length !== dig.length) {
      return false;
    }
    for (let idx = 0; idx < actual.length; idx++) {
      if (actual[idx] !== dig[idx]) {
        return false;
      }
    }
    return true;
  }
}

/** Parse and hydrate `Diger` from txt/qb2 bytes. */
export function parseDiger(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Diger {
  return new Diger(parseMatter(input, cold));
}
