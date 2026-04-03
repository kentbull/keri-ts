import { type ByteLike, normalizeByteLike } from "./byte-like.ts";

/**
 * Constructor surface for one sniffable CESR stream holder.
 *
 * `verify` is retained for KERIpy vocabulary parity, but the current
 * TypeScript port does not yet implement stream sniffability verification on
 * construction.
 */
export interface StreamerInit {
  stream: ByteLike;
  verify?: boolean;
}

/**
 * Sniffable CESR stream holder.
 *
 * KERIpy substance: `Streamer` is the minimal primitive used when encryption
 * and decryption round-trip whole CESR streams instead of one qualified matter
 * instance.
 *
 * Current `keri-ts` scope:
 * - owns raw stream bytes only
 * - does not yet port KERIpy's `text` / `binary` / `texter` / `bexter`
 *   projection helpers or sniffability verification behavior
 */
export class Streamer {
  protected readonly _stream: Uint8Array;

  constructor({ stream }: StreamerInit) {
    this._stream = normalizeByteLike(stream);
  }

  /** Raw sniffable CESR stream bytes. */
  get stream(): Uint8Array {
    return this._stream.slice();
  }
}
