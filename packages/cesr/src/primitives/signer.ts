import { UnknownCodeError } from "../core/errors.ts";
import { Cigar } from "./cigar.ts";
import { IdrDex, MtrDex, SIGNER_CODES } from "./codex.ts";
import { Matter, type MatterInit } from "./matter.ts";
import { Siger } from "./siger.ts";
import {
  publicKeyForSignerCode,
  signerSeedSizeForCode,
  signRawForSignerCode,
  verferCodeForSignerCode,
} from "./signature-suite.ts";
import { Verfer } from "./verfer.ts";

/** Construction options for one executable signer seed. */
export interface SignerInit extends MatterInit {
  transferable?: boolean;
}

/** Explicit factory options for `Signer.random(...)`. */
export interface SignerRandomOptions {
  code?: string;
  transferable?: boolean;
}

/** Signature-shape options for `Signer.sign(...)`. */
export interface SignerSignOptions {
  index?: number;
  only?: boolean;
  ondex?: number | null;
}

interface IndexedSignatureFamily {
  readonly both: string;
  readonly bigBoth: string;
  readonly currentOnly: string;
  readonly bigCurrentOnly: string;
}

/** Resolve the explicit signer transferability choice from the supported init forms. */
function resolveTransferable(init: Matter | SignerInit): boolean {
  if (init instanceof Signer) {
    return init.transferable;
  }
  if (init instanceof Matter) {
    return true;
  }
  return typeof init.transferable === "boolean" ? init.transferable : true;
}

/**
 * Signing-seed primitive.
 *
 * KERIpy substance: Signer wraps private seed material, derives the associated
 * verifier, and owns suite-driven signature creation.
 *
 * TypeScript difference:
 * - seed derivation codes do not themselves encode transferability, so
 *   `Signer` carries an explicit transferability choice rather than inheriting
 *   `Matter.transferable`
 */
export class Signer extends Matter {
  private readonly _transferable: boolean;
  /** Public verifier derived from this seed and the explicit transferability choice. */
  readonly verfer: Verfer;

  constructor(init: Matter | SignerInit) {
    super(init);
    if (!SIGNER_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected signer seed code, got ${this.code}`,
      );
    }
    this._transferable = resolveTransferable(init);
    this.verfer = new Verfer({
      code: verferCodeForSignerCode(this.code, this.transferable),
      raw: publicKeyForSignerCode(this.code, this.raw),
    });
  }

  /**
   * Explicit signer transferability override.
   *
   * Seed codes do not encode transferability, so `Signer` intentionally does
   * not inherit the generic `Matter.transferable` rule.
   */
  override get transferable(): boolean {
    return this._transferable;
  }

  /** Raw seed bytes for signer key-derivation/instantiation. */
  get seed(): Uint8Array {
    return this.raw;
  }

  /** Create one explicit random signer seed for creator-style flows. */
  static random(
    { code = MtrDex.Ed25519_Seed, transferable = true }: SignerRandomOptions = {},
  ): Signer {
    const raw = crypto.getRandomValues(
      new Uint8Array(signerSeedSizeForCode(code)),
    );
    return new Signer({ code, raw, transferable });
  }

  /** Resolve the detached-signature code emitted by this signer suite. */
  private detachedSignatureCode(): string {
    switch (this.code) {
      case MtrDex.Ed25519_Seed:
        return MtrDex.Ed25519_Sig;
      case MtrDex.ECDSA_256k1_Seed:
        return MtrDex.ECDSA_256k1_Sig;
      case MtrDex.ECDSA_256r1_Seed:
        return MtrDex.ECDSA_256r1_Sig;
      default:
        throw new UnknownCodeError(`Unsupported signer seed code ${this.code}`);
    }
  }

  /** Resolve the indexed-signature family emitted by this signer suite. */
  private indexedSignatureFamily(): IndexedSignatureFamily {
    switch (this.code) {
      case MtrDex.Ed25519_Seed:
        return {
          both: IdrDex.Ed25519_Sig,
          bigBoth: IdrDex.Ed25519_Big_Sig,
          currentOnly: IdrDex.Ed25519_Crt_Sig,
          bigCurrentOnly: IdrDex.Ed25519_Big_Crt_Sig,
        };
      case MtrDex.ECDSA_256k1_Seed:
        return {
          both: IdrDex.ECDSA_256k1_Sig,
          bigBoth: IdrDex.ECDSA_256k1_Big_Sig,
          currentOnly: IdrDex.ECDSA_256k1_Crt_Sig,
          bigCurrentOnly: IdrDex.ECDSA_256k1_Big_Crt_Sig,
        };
      case MtrDex.ECDSA_256r1_Seed:
        return {
          both: IdrDex.ECDSA_256r1_Sig,
          bigBoth: IdrDex.ECDSA_256r1_Big_Sig,
          currentOnly: IdrDex.ECDSA_256r1_Crt_Sig,
          bigCurrentOnly: IdrDex.ECDSA_256r1_Big_Crt_Sig,
        };
      default:
        throw new UnknownCodeError(`Unsupported signer seed code ${this.code}`);
    }
  }

  /**
   * Resolve the indexed-signature code emitted by this signer and signature shape.
   *
   * KERIpy correspondence:
   * - `only=true` selects the current-list-only family
   * - otherwise `ondex` defaults to `index`
   * - the small `both` family is valid only when `index === ondex <= 63`
   */
  private indexedSignatureCode(
    index: number,
    {
      ondex,
      only = false,
    }: {
      ondex?: number;
      only?: boolean;
    } = {},
  ): string {
    const family = this.indexedSignatureFamily();
    if (only) {
      return index <= 63 ? family.currentOnly : family.bigCurrentOnly;
    }

    const ondexValue = ondex ?? index;
    return ondexValue === index && index <= 63 ? family.both : family.bigBoth;
  }

  /**
   * Sign one message and return either a detached `Cigar` or indexed `Siger`.
   *
   * KERIpy correspondence:
   * - `index === undefined` returns a detached non-indexed signature
   * - otherwise the seed suite decides the emitted indexed signature code family
   * - `only=true` selects the current-list-only family and ignores any caller
   *   `ondex` override
   * - otherwise `ondex` defaults to `index`, preserving KERIpy's implicit
   *   same-index rule for ordinary indexed signatures
   */
  sign(
    ser: Uint8Array,
    { index, only = false, ondex }: SignerSignOptions = {},
  ): Cigar | Siger {
    const sig = signRawForSignerCode(this.code, this.raw, ser);
    if (index === undefined) {
      return new Cigar({
        code: this.detachedSignatureCode(),
        raw: sig,
      }, this.verfer);
    }

    const normalizedOndex = only ? undefined : ondex ?? index;
    return new Siger({
      code: this.indexedSignatureCode(index, {
        only,
        ondex: normalizedOndex ?? undefined,
      }),
      raw: sig,
      index,
      ondex: normalizedOndex ?? undefined,
    }, this.verfer);
  }
}
