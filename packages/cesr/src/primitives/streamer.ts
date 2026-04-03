import { type ByteLike, normalizeByteLike } from "./byte-like.ts";

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
