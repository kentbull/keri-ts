import { bytesEqual } from "../core/bytes.ts";
import { DeserializeError, UnknownCodeError } from "../core/errors.ts";
import { type ByteLike, normalizeByteLike } from "./byte-like.ts";
import { Cipher } from "./cipher.ts";
import {
  CIPHER_X25519_ALL_QB64_CODES,
  CIPHER_X25519_QB2_VARIABLE_CODES,
  CIPHER_X25519_VARIABLE_STREAM_CODES,
  ENCRYPTER_CODES,
  MtrDex,
} from "./codex.ts";
import { Matter, type MatterInit } from "./matter.ts";
import { type CipherHydratable, isQualifiedPrimitive } from "./primitive.ts";
import { Salter } from "./salter.ts";
import { boxKeyPairFromEd25519Seed, boxPublicKeyFromEd25519Verfer, sealBox } from "./sealed-box.ts";
import { Signer } from "./signer.ts";
import { Streamer } from "./streamer.ts";
import { Verfer } from "./verfer.ts";

export interface EncrypterInit extends Omit<MatterInit, "raw" | "qb64b" | "qb64" | "qb2"> {
  raw?: Uint8Array | ArrayBufferView;
  qb64b?: Uint8Array | ArrayBufferView;
  qb64?: ByteLike;
  qb2?: Uint8Array | ArrayBufferView;
  code?: string;
  verkey?: ByteLike;
}

export interface EncrypterEncryptOptions {
  ser?: ByteLike;
  prim?: CipherHydratable;
  code?: string;
}

function normalizeMatterInit(init: Matter | EncrypterInit): Matter | MatterInit {
  if (init instanceof Matter) {
    return init;
  }

  const normalized: MatterInit = {
    code: init.code ?? MtrDex.X25519,
  };

  if (init.raw) {
    normalized.raw = normalizeByteLike(init.raw);
  } else if (init.verkey) {
    const verfer = new Verfer({ qb64b: normalizeByteLike(init.verkey) });
    if (
      verfer.code !== MtrDex.Ed25519
      && verfer.code !== MtrDex.Ed25519N
    ) {
      throw new DeserializeError(
        `Unsupported verkey derivation code = ${verfer.code}.`,
      );
    }
    normalized.raw = boxPublicKeyFromEd25519Verfer(verfer.raw);
  } else if (init.qb64b) {
    normalized.qb64b = normalizeByteLike(init.qb64b);
  } else if (init.qb64) {
    const qb64 = normalizeByteLike(init.qb64);
    normalized.qb64b = qb64;
  } else if (init.qb2) {
    normalized.qb2 = normalizeByteLike(init.qb2);
  }

  return normalized;
}

/**
 * Public-key encryption primitive for asymmetric envelope encryption.
 *
 * KERIpy substance: `Encrypter` owns the public X25519 material and can derive
 * it from Ed25519 verifier keys used by non-transferable/basic AIDs.
 */
export class Encrypter extends Matter {
  constructor(init: Matter | EncrypterInit) {
    super(normalizeMatterInit(init));
    if (!ENCRYPTER_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected encrypter key code, got ${this.code}`,
      );
    }
  }

  /**
   * Confirm whether the supplied Ed25519 seed maps to this X25519 public key.
   */
  verifySeed(seed: ByteLike): boolean {
    const signer = new Signer({ qb64b: normalizeByteLike(seed) });
    if (signer.code !== MtrDex.Ed25519_Seed) {
      return false;
    }
    return bytesEqual(boxKeyPairFromEd25519Seed(signer.raw).publicKey, this.raw);
  }

  /**
   * Encrypt raw or primitive plaintext into one CESR `Cipher`.
   *
   * KERIpy parity:
   * - `ser` wins when supplied
   * - otherwise one primitive is required
   * - omitted `code` defaults to stream-family `L0` only for raw `ser` input
   */
  encrypt({ ser, prim, code }: EncrypterEncryptOptions = {}): Cipher {
    let plaintext: Uint8Array | undefined = ser
      ? normalizeByteLike(ser)
      : undefined;
    let cipherCode = code;

    if (!plaintext) {
      if (!prim) {
        throw new DeserializeError(
          "Neither plaintext serialization nor primitive input was provided.",
        );
      }

      if (!cipherCode) {
        if (prim instanceof Salter) {
          cipherCode = MtrDex.X25519_Cipher_Salt;
        } else if (prim instanceof Signer) {
          cipherCode = MtrDex.X25519_Cipher_Seed;
        } else {
          throw new DeserializeError(
            `Unsupported primitive ${
              prim instanceof Streamer ? "streamer" : `with code = ${prim.code}`
            } when cipher code is missing.`,
          );
        }
      }

      if (CIPHER_X25519_ALL_QB64_CODES.has(cipherCode)) {
        if (!isQualifiedPrimitive(prim)) {
          throw new DeserializeError(
            `Invalid primitive cipher code = ${cipherCode} for stream primitive.`,
          );
        }
        plaintext = prim.qb64b;
      } else if (CIPHER_X25519_QB2_VARIABLE_CODES.has(cipherCode)) {
        if (!isQualifiedPrimitive(prim)) {
          throw new DeserializeError(
            `Invalid primitive cipher code = ${cipherCode} for stream primitive.`,
          );
        }
        plaintext = prim.qb2;
      } else if (CIPHER_X25519_VARIABLE_STREAM_CODES.has(cipherCode)) {
        if (!(prim instanceof Streamer)) {
          throw new DeserializeError(
            `Invalid primitive cipher code = ${cipherCode} for non-stream primitive.`,
          );
        }
        plaintext = prim.stream;
      } else {
        throw new UnknownCodeError(
          `Invalid primitive cipher code = ${cipherCode}.`,
        );
      }
    }

    if (!plaintext) {
      throw new DeserializeError("Missing plaintext serialization for encryption.");
    }

    return new Cipher({
      code: cipherCode ?? MtrDex.X25519_Cipher_L0,
      raw: sealBox(plaintext, this.raw),
    });
  }
}
