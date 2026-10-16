/** Borrowed byte views of ordinary, ordered ESSR Texter values. */
import type { Payload } from "../core/payload.ts";
import type { Texter } from "../primitives/texter.ts";

/** Concatenate fragment content as one logical ciphertext stream. */
export function essrRaw(texters: readonly Texter[]): Payload {
  return {
    size: texters.reduce((size, texter) => size + texter.raw.length, 0),
    async *open(signal?: AbortSignal) {
      for (const texter of texters) {
        signal?.throwIfAborted();
        yield texter.raw;
      }
    },
  };
}

/** Preserve qualified token order and multiplicity for storage and replay. */
export function essrWire(texters: readonly Texter[]): Payload {
  return {
    size: texters.reduce((size, texter) => size + texter.qb64b.length, 0),
    async *open(signal?: AbortSignal) {
      for (const texter of texters) {
        signal?.throwIfAborted();
        yield texter.qb64b;
      }
    },
  };
}
