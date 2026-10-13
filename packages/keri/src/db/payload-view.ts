import type { Payload } from "cesr-ts";

/** A non-owning bounded range; reopening never retains its owner's full byte array. */
export function payloadRange(payload: Payload, offset: number): Payload {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > payload.size) {
    throw new RangeError("Invalid payload offset");
  }
  return {
    size: payload.size - offset,
    /** Reopen the source and skip chunks until the requested range begins. */
    async *open(signal?: AbortSignal) {
      let skip = offset;
      for await (const chunk of payload.open(signal)) {
        if (skip >= chunk.length) {
          skip -= chunk.length;
          continue;
        }
        yield chunk.subarray(skip);
        skip = 0;
      }
      if (skip) throw new Error("Payload ended before its declared offset");
    },
  };
}
