import { DeserializeError, UnknownCodeError } from "../core/errors.ts";
import { type ByteLike, normalizeByteLike } from "./byte-like.ts";
import { Cipher } from "./cipher.ts";
import {
  CIPHER_X25519_ALL_QB64_CODES,
  CIPHER_X25519_FIXED_QB64_CODES,
  CIPHER_X25519_QB2_VARIABLE_CODES,
  CIPHER_X25519_VARIABLE_STREAM_CODES,
  DECRYPTER_CODES,
  MtrDex,
} from "./codex.ts";
import { Matter, type MatterInit } from "./matter.ts";
import { Salter } from "./salter.ts";
import { boxKeyPairFromEd25519Seed, boxPublicKeyFromPrivateKey, openSealedBox } from "./sealed-box.ts";
import { Signer } from "./signer.ts";
import { Streamer } from "./streamer.ts";

export interface DecrypterInit extends Omit<MatterInit, "raw" | "qb64b" | "qb64" | "qb2"> {
  raw?: Uint8Array | ArrayBufferView;
  qb64b?: Uint8Array | ArrayBufferView;
  qb64?: ByteLike;
  qb2?: Uint8Array | ArrayBufferView;
  code?: string;
  seed?: ByteLike;
}

export interface DecrypterDecryptOptions<T = unknown> {
  cipher?: Cipher;
  qb64?: ByteLike;
  qb2?: Uint8Array | ArrayBufferView;
  klas?: new(...args: any[]) => T;
  transferable?: boolean;
  bare?: boolean;
}

function normalizeMatterInit(init: Matter | DecrypterInit): Matter | MatterInit {
  if (init instanceof Matter) {
    return init;
  }

  const normalized: MatterInit = {
    code: init.code ?? MtrDex.X25519_Private,
  };

  if (init.raw) {
    normalized.raw = normalizeByteLike(init.raw);
    return normalized;
  }

  if (init.qb64b) {
    normalized.qb64b = normalizeByteLike(init.qb64b);
    return normalized;
  }

  if (init.qb64) {
    normalized.qb64b = normalizeByteLike(init.qb64);
    return normalized;
  }

  if (init.qb2) {
    normalized.qb2 = normalizeByteLike(init.qb2);
    return normalized;
  }

  if (!init.seed) {
    return normalized;
  }

  const signer = new Signer({ qb64b: normalizeByteLike(init.seed) });
  if (signer.code !== MtrDex.Ed25519_Seed) {
    throw new DeserializeError(
      `Unsupported signing seed derivation code = ${signer.code}.`,
    );
  }

  normalized.raw = boxKeyPairFromEd25519Seed(signer.raw).privateKey;
  return normalized;
}

function hydratePlaintext<T>(
  cipher: Cipher,
  plain: Uint8Array,
  klas: new(...args: any[]) => unknown,
  transferable: boolean,
): unknown {
  if (CIPHER_X25519_ALL_QB64_CODES.has(cipher.code)) {
    return new klas({ qb64b: plain, transferable });
  }
  if (CIPHER_X25519_QB2_VARIABLE_CODES.has(cipher.code)) {
    return new klas({ qb2: plain });
  }
  if (CIPHER_X25519_VARIABLE_STREAM_CODES.has(cipher.code)) {
    return new klas({ stream: plain });
  }
  throw new UnknownCodeError(`Unsupported cipher code = ${cipher.code}.`);
}

function defaultKlasForCipher(
  cipher: Cipher,
): new(...args: any[]) => unknown {
  if (cipher.code === MtrDex.X25519_Cipher_Salt) {
    return Salter;
  }
  if (cipher.code === MtrDex.X25519_Cipher_Seed) {
    return Signer;
  }
  if (CIPHER_X25519_VARIABLE_STREAM_CODES.has(cipher.code)) {
    return Streamer;
  }
  if (
    CIPHER_X25519_FIXED_QB64_CODES.has(cipher.code)
    || CIPHER_X25519_QB2_VARIABLE_CODES.has(cipher.code)
    || CIPHER_X25519_ALL_QB64_CODES.has(cipher.code)
  ) {
    throw new UnknownCodeError(
      `Unsupported cipher code = ${cipher.code} when klas is missing.`,
    );
  }
  throw new UnknownCodeError(`Unsupported cipher code = ${cipher.code}.`);
}

/**
 * Private-key decryption primitive for asymmetric envelope payloads.
 *
 * KERIpy substance: `Decrypter` owns the private X25519 material used to
 * recover CESR payloads from sealed-box ciphers, optionally deriving it from
 * an Ed25519 signing seed.
 */
export class Decrypter extends Matter {
  constructor(init: Matter | DecrypterInit = {}) {
    super(normalizeMatterInit(init));
    if (!DECRYPTER_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected decrypter key code, got ${this.code}`,
      );
    }
  }

  /**
   * Decrypt one cipher and rehydrate the plaintext into the requested class.
   */
  decrypt<T = unknown>(
    {
      cipher,
      qb64,
      qb2,
      klas,
      transferable = false,
      bare = false,
    }: DecrypterDecryptOptions<T> = {},
  ): T | Uint8Array {
    const hydrated = cipher
      ?? (qb64
        ? new Cipher({ qb64b: normalizeByteLike(qb64) })
        : qb2
        ? new Cipher({ qb2: normalizeByteLike(qb2) })
        : null);

    if (!hydrated) {
      throw new DeserializeError("Need one of cipher, qb64, or qb2.");
    }

    const plain = openSealedBox(
      hydrated.raw,
      boxPublicKeyFromPrivateKey(this.raw),
      this.raw,
    );

    if (bare) {
      return plain;
    }

    const effectiveKlas = klas ?? defaultKlasForCipher(hydrated);
    return hydratePlaintext(
      hydrated,
      plain,
      effectiveKlas,
      transferable,
    ) as T;
  }
}
