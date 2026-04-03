import { DeserializeError, UnknownCodeError } from "../core/errors.ts";
import { normalizeByteLike } from "./byte-like.ts";
import { CiXDex } from "./codex.ts";
import { CIPHER_X25519_ALL_CODES, MtrDex } from "./codex.ts";
import { Decrypter } from "./decrypter.ts";
import { Matter, type MatterInit } from "./matter.ts";
import type { CipherHydratable, CipherHydratableCtor } from "./primitive.ts";

export interface CipherDecryptOptions<
  T extends CipherHydratable = CipherHydratable,
> {
  prikey?: string | Uint8Array | ArrayBufferView;
  seed?: string | Uint8Array | ArrayBufferView;
  ctor?: CipherHydratableCtor<T>;
  transferable?: boolean;
  bare?: boolean;
}

/** Map the KERIpy fixed cipher families to their expected raw sealed-box sizes. */
function expectedFixedCipherRawSize(code: string): number {
  return Matter.rawSizeForCode(code);
}

const FIXED_RAW_SIZES = new Map<string, number>([
  [
    MtrDex.X25519_Cipher_Seed,
    expectedFixedCipherRawSize(MtrDex.X25519_Cipher_Seed),
  ],
  [
    MtrDex.X25519_Cipher_Salt,
    expectedFixedCipherRawSize(MtrDex.X25519_Cipher_Salt),
  ],
]);

function inferFixedCipherCode(raw: Uint8Array): string {
  for (const [code, size] of FIXED_RAW_SIZES.entries()) {
    if (raw.length === size) {
      return code;
    }
  }
  throw new DeserializeError(
    `Unsupported fixed raw size ${raw.length} for X25519 cipher material.`,
  );
}

/**
 * Support KERIpy's convenience rule where fixed cipher families may be
 * inferred from raw ciphertext size when the caller omits `code`.
 */
function normalizeCipherInit(init: Matter | MatterInit): Matter | MatterInit {
  if (init instanceof Matter || !init.raw) {
    return init;
  }

  const normalized = {
    ...init,
    raw: init.raw.slice(),
  };

  if (!normalized.code) {
    normalized.code = inferFixedCipherCode(normalized.raw);
  }
  return normalized;
}

/**
 * Ciphertext primitive for encrypted secret payloads.
 *
 * KERIpy substance: cipher material carries sealed-box encrypted CESR payloads
 * while the cipher code preserves how the plaintext should be rehydrated.
 *
 * Construction rule:
 * - fixed salt/seed cipher families may infer `code` from raw size
 * - variable families still require the caller or parser to provide the
 *   correct derivation code explicitly
 */
export class Cipher extends Matter {
  static readonly Codex = CiXDex;
  static readonly Codes = Object.freeze({ ...CiXDex });

  constructor(init: Matter | MatterInit) {
    super(normalizeCipherInit(init));
    if (!CIPHER_X25519_ALL_CODES.has(this.code)) {
      throw new UnknownCodeError(`Expected cipher code, got ${this.code}`);
    }
  }

  /**
   * Recover plaintext from this cipher using either a box private key or seed.
   *
   * KERIpy parity:
   * - `prikey` or `seed` instantiates a `Decrypter`
   * - default plaintext constructor is inferred from the cipher family when
   *   possible
   *
   * Key-material rule:
   * - `prikey` is already-qualified X25519 private box material
   * - `seed` is an Ed25519 signer seed that is first converted into the
   *   corresponding X25519 private box key
   */
  decrypt<T extends CipherHydratable = CipherHydratable>(
    {
      prikey,
      seed,
      ctor,
      transferable = false,
      bare = false,
    }: CipherDecryptOptions<T> = {},
  ): T | Uint8Array {
    return new Decrypter({
      qb64: typeof prikey === "string" ? prikey : undefined,
      qb64b: prikey && typeof prikey !== "string"
        ? normalizeByteLike(prikey)
        : undefined,
      seed,
    }).decrypt({
      cipher: this,
      ctor,
      transferable,
      bare,
    });
  }
}
