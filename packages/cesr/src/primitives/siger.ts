import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { Cigar } from "./cigar.ts";
import { IdrDex, MtrDex, SIGER_CODES } from "./codex.ts";
import { Indexer, type IndexerInit, parseIndexer } from "./indexer.ts";
import type { Verfer } from "./verfer.ts";

interface IndexedSignatureFamily {
  readonly both: string;
  readonly bigBoth: string;
  readonly currentOnly: string;
  readonly bigCurrentOnly: string;
}

/** Rebuild options for turning detached signature material into indexed signature material. */
export interface SigerFromCigarOptions {
  index: number;
  ondex?: number | null;
  only?: boolean;
  verfer?: Verfer;
}

/**
 * Indexed signature primitive with optional verifier association.
 *
 * KERIpy substance: `Siger` extends indexed signature material and carries
 * optional `verfer` linkage so verification context can travel with signature.
 */
export class Siger extends Indexer {
  readonly verfer?: Verfer;

  constructor(init: Indexer | IndexerInit, verfer?: Verfer) {
    super(init);
    if (!SIGER_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected indexed signature code, got ${this.code}`,
      );
    }
    this.verfer = verfer;
  }

  /** Rebuild indexed signature material from detached signature bytes plus verifier context. */
  static fromCigar(
    cigar: Cigar,
    { index, ondex, only = false, verfer = cigar.verfer }: SigerFromCigarOptions,
  ): Siger {
    if (!verfer) {
      throw new Error(
        "Cannot derive indexed signature code from detached signature without verifier context.",
      );
    }

    const normalizedOndex = only ? undefined : ondex ?? index;
    return new Siger(
      {
        code: Siger.indexedSignatureCodeForVerfer(
          verfer.code,
          index,
          {
            only,
            ondex: normalizedOndex ?? undefined,
          },
        ),
        raw: cigar.raw,
        index,
        ondex: normalizedOndex ?? undefined,
      },
      verfer,
    );
  }

  /** Resolve the indexed-signature family implied by one verifier suite. */
  private static indexedSignatureFamilyForVerfer(
    verferCode: string,
  ): IndexedSignatureFamily {
    switch (verferCode) {
      case MtrDex.Ed25519:
      case MtrDex.Ed25519N:
        return {
          both: IdrDex.Ed25519_Sig,
          bigBoth: IdrDex.Ed25519_Big_Sig,
          currentOnly: IdrDex.Ed25519_Crt_Sig,
          bigCurrentOnly: IdrDex.Ed25519_Big_Crt_Sig,
        };
      case MtrDex.ECDSA_256k1:
      case MtrDex.ECDSA_256k1N:
        return {
          both: IdrDex.ECDSA_256k1_Sig,
          bigBoth: IdrDex.ECDSA_256k1_Big_Sig,
          currentOnly: IdrDex.ECDSA_256k1_Crt_Sig,
          bigCurrentOnly: IdrDex.ECDSA_256k1_Big_Crt_Sig,
        };
      case MtrDex.ECDSA_256r1:
      case MtrDex.ECDSA_256r1N:
        return {
          both: IdrDex.ECDSA_256r1_Sig,
          bigBoth: IdrDex.ECDSA_256r1_Big_Sig,
          currentOnly: IdrDex.ECDSA_256r1_Crt_Sig,
          bigCurrentOnly: IdrDex.ECDSA_256r1_Big_Crt_Sig,
        };
      default:
        throw new UnknownCodeError(
          `Unsupported verifier code ${verferCode} for indexed signature material`,
        );
    }
  }

  /** Resolve the indexed-signature code emitted for one verifier suite and signature shape. */
  private static indexedSignatureCodeForVerfer(
    verferCode: string,
    index: number,
    {
      ondex,
      only = false,
    }: {
      ondex?: number;
      only?: boolean;
    } = {},
  ): string {
    const family = Siger.indexedSignatureFamilyForVerfer(verferCode);
    if (only) {
      return index <= 63 ? family.currentOnly : family.bigCurrentOnly;
    }

    const ondexValue = ondex ?? index;
    return ondexValue === index && index <= 63 ? family.both : family.bigBoth;
  }
}

/** Parse and hydrate `Siger` from txt or qb2 encoded bytes. */
export function parseSiger(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Siger {
  return new Siger(parseIndexer(input, cold));
}
