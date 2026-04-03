import { UnknownCodeError } from "../core/errors.ts";
import { Cigar } from "./cigar.ts";
import { MtrDex, SIGNER_CODES } from "./codex.ts";
import { Matter, type MatterInit } from "./matter.ts";
import { Siger } from "./siger.ts";
import {
  detachedSignatureCodeForSignerCode,
  indexedSignatureCodeForSignerCode,
  publicKeyForSignerCode,
  signerSeedSizeForCode,
  signRawForSignerCode,
  verferCodeForSignerCode,
} from "./signature-suite.ts";
import { Verfer } from "./verfer.ts";

export interface SignerInit extends MatterInit {
  transferable?: boolean;
}

export interface SignerRandomOptions {
  code?: string;
  transferable?: boolean;
}

export interface SignerSignOptions {
  index?: number;
  only?: boolean;
  ondex?: number | null;
}

function resolveTransferable(init: Matter | SignerInit): boolean {
  if (init instanceof Signer) {
    return init.transferable;
  }
  return "transferable" in init && typeof init.transferable === "boolean"
    ? init.transferable
    : true;
}

/**
 * Signing-seed primitive.
 *
 * KERIpy substance: Signer wraps private seed material, derives the associated
 * verifier, and owns suite-driven signature creation.
 */
export class Signer extends Matter {
  readonly transferable: boolean;
  readonly verfer: Verfer;

  constructor(init: Matter | SignerInit) {
    super(init);
    if (!SIGNER_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected signer seed code, got ${this.code}`,
      );
    }
    this.transferable = resolveTransferable(init);
    this.verfer = new Verfer({
      code: verferCodeForSignerCode(this.code, this.transferable),
      raw: publicKeyForSignerCode(this.code, this.raw),
    });
  }

  /** Raw seed bytes for signer key-derivation/instantiation. */
  get seed(): Uint8Array {
    return this.raw;
  }

  /** Create one explicit random signer seed for creator-style flows. */
  static random(
    { code = MtrDex.Ed25519_Seed, transferable = true }: SignerRandomOptions = {},
  ): Signer {
    const raw = crypto.getRandomValues(new Uint8Array(signerSeedSizeForCode(code)));
    return new Signer({ code, raw, transferable });
  }

  /**
   * Sign one message and return either a detached `Cigar` or indexed `Siger`.
   *
   * KERIpy correspondence:
   * - `index === undefined` returns a detached non-indexed signature
   * - otherwise the seed suite decides the emitted indexed signature code family
   */
  sign(
    ser: Uint8Array,
    { index, only = false, ondex }: SignerSignOptions = {},
  ): Cigar | Siger {
    const sig = signRawForSignerCode(this.code, this.raw, ser);
    if (index === undefined) {
      return new Cigar({
        code: detachedSignatureCodeForSignerCode(this.code),
        raw: sig,
      }, this.verfer);
    }

    const normalizedOndex = only ? undefined : ondex ?? index;
    return new Siger({
      code: indexedSignatureCodeForSignerCode(this.code, index, {
        only,
        ondex: normalizedOndex ?? undefined,
      }),
      raw: sig,
      index,
      ondex: normalizedOndex ?? undefined,
    }, this.verfer);
  }
}
