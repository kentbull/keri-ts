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
import type { CipherHydratable, CipherHydratableCtor } from "./primitive.ts";
import { Salter } from "./salter.ts";
import { boxKeyPairFromEd25519Seed, boxPublicKeyFromPrivateKey, openSealedBox } from "./sealed-box.ts";
import { Signer } from "./signer.ts";
import { Streamer } from "./streamer.ts";

/**
 * Supported constructor inputs for one private-key decrypter.
 *
 * Accepted forms mirror KERIpy's two entry points:
 * - provide already-qualified X25519 private box material directly
 * - provide an Ed25519 signer seed through `seed` and derive the matching
 *   X25519 private box key during construction
 */
export interface DecrypterInit extends Omit<MatterInit, "raw" | "qb64b" | "qb64" | "qb2"> {
  raw?: Uint8Array | ArrayBufferView;
  qb64b?: Uint8Array | ArrayBufferView;
  qb64?: ByteLike;
  qb2?: Uint8Array | ArrayBufferView;
  code?: string;
  seed?: ByteLike;
}

/**
 * Cipher inputs and hydration controls for `Decrypter.decrypt(...)`.
 *
 * Precedence mirrors KERIpy:
 * - explicit `cipher`
 * - otherwise parse `qb64`
 * - otherwise parse `qb2`
 *
 * `ctor` controls semantic plaintext rehydration; `bare` bypasses that and
 * returns plaintext bytes directly.
 */
export interface DecrypterDecryptOptions<
  T extends CipherHydratable = CipherHydratable,
> {
  cipher?: Cipher;
  qb64?: ByteLike;
  qb2?: Uint8Array | ArrayBufferView;
  ctor?: CipherHydratableCtor<T>;
  transferable?: boolean;
  bare?: boolean;
}

/** Normalize direct X25519 or derived-Ed25519 constructor forms into `Matter` input. */
function normalizeMatterInit(
  init: Matter | DecrypterInit,
): Matter | MatterInit {
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

function hydratePlaintext<T extends CipherHydratable>(
  cipher: Cipher,
  plain: Uint8Array,
  ctor: CipherHydratableCtor<T>,
  transferable: boolean,
): T {
  if (CIPHER_X25519_ALL_QB64_CODES.has(cipher.code)) {
    return new ctor({ qb64b: plain, transferable });
  }
  if (CIPHER_X25519_QB2_VARIABLE_CODES.has(cipher.code)) {
    return new ctor({ qb2: plain });
  }
  if (CIPHER_X25519_VARIABLE_STREAM_CODES.has(cipher.code)) {
    return new ctor({ stream: plain });
  }
  throw new UnknownCodeError(`Unsupported cipher code = ${cipher.code}.`);
}

/**
 * Resolve the default plaintext constructor implied by one cipher family.
 *
 * KERIpy correspondence:
 * - fixed salt/seed families default to `Salter` / `Signer`
 * - whole-stream families default to `Streamer`
 * - generic qb64/qb2 variable families still require the caller to say what
 *   semantic primitive should be rehydrated from the plaintext bytes
 */
function defaultCtorForCipher(
  cipher: Cipher,
): CipherHydratableCtor {
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
      `Unsupported cipher code = ${cipher.code} when ctor is missing.`,
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
  /**
   * Construct one X25519 private-key decrypter.
   *
   * Default code remains the KERIpy private-box family
   * `MtrDex.X25519_Private`.
   */
  constructor(init: Matter | DecrypterInit = {}) {
    super(normalizeMatterInit(init));
    if (!DECRYPTER_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected decrypter key code, got ${this.code}`,
      );
    }
  }

  /**
   * Decrypt one cipher and rehydrate the plaintext with the requested
   * constructor.
   *
   * Resolution rules:
   * - `cipher` wins when supplied
   * - otherwise `qb64` is parsed before `qb2`
   * - omitted `ctor` is only inferred for the KERIpy families that already
   *   name their semantic plaintext shape
   *
   * Output rules:
   * - `bare=true` returns plaintext bytes directly
   * - otherwise `transferable` is forwarded only to qb64-family primitive
   *   constructors such as `Signer`, matching the KERIpy init seam
   */
  decrypt<T extends CipherHydratable = CipherHydratable>(
    {
      cipher,
      qb64,
      qb2,
      ctor,
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

    const effectiveCtor = (ctor ?? defaultCtorForCipher(hydrated)) as CipherHydratableCtor<T>;
    return hydratePlaintext(
      hydrated,
      plain,
      effectiveCtor,
      transferable,
    );
  }
}
