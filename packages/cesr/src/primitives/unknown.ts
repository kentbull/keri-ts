import { codeB64ToB2, encodeB64 } from "../core/bytes.ts";

export type PrimitiveDomain = "txt" | "bny";

/**
 * Lossless placeholder for unrecognized CESR units encountered during parse.
 *
 * In compat fallback paths we preserve unknown payload bytes as instances of
 * this class so roundtrip serialization can remain byte-accurate.
 */
export class UnknownPrimitive {
  readonly code: string;
  readonly qb64: string;
  readonly qb2: Uint8Array;
  readonly fullSize: number;
  readonly fullSizeB2: number;
  readonly raw: Uint8Array;
  readonly sourceDomain: PrimitiveDomain;

  constructor(
    qb64: string,
    qb2: Uint8Array,
    sourceDomain: PrimitiveDomain,
  ) {
    this.code = "?";
    this.qb64 = qb64;
    this.qb2 = qb2.slice();
    this.fullSize = qb64.length;
    this.fullSizeB2 = qb2.length;
    this.raw = qb2.slice();
    this.sourceDomain = sourceDomain;
  }

  /**
   * Build an unknown primitive directly from parser payload bytes.
   *
   * When `domain="txt"` and content is not valid base64, `qb2` intentionally
   * keeps the original bytes to remain lossless.
   */
  static fromPayload(
    payload: Uint8Array,
    domain: PrimitiveDomain,
  ): UnknownPrimitive {
    if (domain === "bny") {
      return new UnknownPrimitive(encodeB64(payload), payload, domain);
    }

    const qb64 = String.fromCharCode(...payload);
    let qb2: Uint8Array;
    try {
      qb2 = codeB64ToB2(qb64);
    } catch {
      // Keep unknown text tokens lossless even when not valid base64 quads.
      qb2 = payload.slice();
    }
    return new UnknownPrimitive(qb64, qb2, domain);
  }

  /** Equality by canonical text form used throughout primitive graph comparisons. */
  equals(other: { qb64: string }): boolean {
    return this.qb64 === other.qb64;
  }

  /** String coercion returns canonical qb64 text token. */
  toString(): string {
    return this.qb64;
  }
}
