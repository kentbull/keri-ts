import { blake2b, blake2s } from "npm:@noble/hashes@1.8.0/blake2";
import { blake3 } from "npm:@noble/hashes@1.8.0/blake3";
import { sha256, sha512 } from "npm:@noble/hashes@1.8.0/sha2";
import { sha3_256, sha3_512 } from "npm:@noble/hashes@1.8.0/sha3";
import { bytesEqual } from "../core/bytes.ts";
import { UnknownCodeError } from "../core/errors.ts";
import type { CesrDomain } from "../core/types.ts";
import { DigDex, DIGEST_CODES, matterCodexName } from "./codex.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";

interface DigerOptions {
  strict?: boolean;
}

/** Incremental digest state; callers finalize once and destroy on every exit. */
export interface Digest {
  /** Absorb the next ordered bytes without retaining the input buffer. */
  update(bytes: Uint8Array): void;
  /** Finalize once and return digest bytes owned by the caller. */
  digest(): Uint8Array;
  /** Release internal state on success, failure, or abandoned iteration. */
  destroy(): void;
}

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
  static readonly Digests = new Map<string, () => Digest>([
    [DigDex.Blake3_256, () => blake3.create({})],
    [DigDex.Blake3_512, () => blake3.create({ dkLen: 64 })],
    [DigDex.Blake2b_256, () => blake2b.create({ dkLen: 32 })],
    [DigDex.Blake2b_512, () => blake2b.create({ dkLen: 64 })],
    [DigDex.Blake2s_256, () => blake2s.create({ dkLen: 32 })],
    [DigDex.SHA2_256, () => sha256.create()],
    [DigDex.SHA2_512, () => sha512.create()],
    [DigDex.SHA3_256, () => sha3_256.create()],
    [DigDex.SHA3_512, () => sha3_512.create()],
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

  /** Create incremental state from the same registry used for one-shot digests. */
  static hasher(code: string): Digest {
    // Keep algorithm selection identical for one-shot and incremental callers.
    const create = Diger.Digests.get(code);
    if (!create) throw new UnknownCodeError(`Unsupported digest code ${code}`);
    return create();
  }

  /** Compute raw digest bytes for `ser` using the digest family selected by `code`. */
  static digest(ser: Uint8Array, code: string): Uint8Array {
    // This operation owns the state through finalization and exceptional cleanup.
    const hash = Diger.hasher(code);
    try {
      hash.update(ser);
      return hash.digest();
    } finally {
      hash.destroy();
    }
  }

  /** Verify ordered fragments as one logical byte sequence without concatenation. */
  verifyChunks(chunks: Iterable<Uint8Array>): boolean {
    // This operation owns the state through finalization and exceptional cleanup.
    const hash = Diger.hasher(this.code);
    try {
      for (const chunk of chunks) hash.update(chunk);
      return bytesEqual(hash.digest(), this.raw);
    } finally {
      hash.destroy();
    }
  }

  /** Verify a reopenable payload stream while retaining only the hash state. */
  async verifyStream(chunks: AsyncIterable<Uint8Array>): Promise<boolean> {
    // This operation owns the state through finalization and exceptional cleanup.
    const hash = Diger.hasher(this.code);
    try {
      for await (const chunk of chunks) hash.update(chunk);
      return bytesEqual(hash.digest(), this.raw);
    } finally {
      // A source error or cancellation must release state just like successful verification.
      hash.destroy();
    }
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
  cold: CesrDomain,
): Diger {
  return new Diger(parseMatter(input, cold));
}
