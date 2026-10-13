import { b, b64ToInt, byteString, decodeB64, encodeB64 } from "../core/bytes.ts";
import { DeserializeError, ResourceLimitError, UnknownCodeError } from "../core/errors.ts";
import { MemoryPayloadSink, type OwnedPayload, type PayloadSink } from "../core/payload.ts";
import type { CesrDomain, EssrPayload } from "../core/types.ts";
import { TEXTER_CODES } from "../primitives/codex.ts";
import type { Counter } from "../primitives/counter.ts";
import { MATTER_SIZES } from "../tables/matter.tables.generated.ts";
import type { Versionage } from "../tables/table-types.ts";
import { Cursor } from "./cursor.ts";

/** Finite logical-message budgets apply even when the sink writes to disk. */
export interface EssrOptions {
  /** Maximum concatenated decoded ESSR bytes in one frame; default 8 MiB. */
  maxEssrBytes?: number;
  /** Maximum Texters in one frame, including empty values; default 16,384. */
  maxEssrItems?: number;
  /**
   * Awaited writes supply backpressure; the sink must honor the supplied signal.
   * Finished open() readers must yield chunks with backing buffers of at most 1 MiB.
   */
  payloadSink?: (maxBytes: number, signal?: AbortSignal) => PayloadSink | Promise<PayloadSink>;
}

/** Texter headers are aligned whole quadlets/triplets in both Bytes code families. */
async function header(input: Cursor, domain: CesrDomain) {
  const first = await input.peek(1);
  const selector = domain === "txt" ? byteString(first) : encodeB64(first)[0];
  if (!"456789".includes(selector)) throw new UnknownCodeError("ESSR requires a Texter Bytes code", input.offset);
  // Small codes use 2 hard + 2 soft characters; big codes use 4 + 4.
  const hard = "456".includes(selector) ? 2 : 4;
  const size = hard * (domain === "txt" ? 2 : 1.5);
  const bytes = await input.read(size);
  const text = domain === "txt" ? byteString(bytes) : encodeB64(bytes);
  const code = text.slice(0, hard);
  if (!TEXTER_CODES.has(code)) throw new UnknownCodeError(`Expected Texter, got ${code}`, input.offset - size);
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new DeserializeError("Invalid Texter header", input.offset - size);
  const count = b64ToInt(text.slice(hard));
  const lead = MATTER_SIZES.get(code)!.ls;
  const rawSize = count * 3 - lead;
  if (rawSize < 0) throw new DeserializeError("Texter lead exceeds its payload", input.offset);
  return { text, count, lead, rawSize };
}

/** Stream one validated token, optionally staging its canonical qualified text. */
async function* texter(
  input: Cursor,
  domain: CesrDomain,
  remaining: number,
  sink?: PayloadSink,
): AsyncGenerator<Uint8Array, number> {
  const token = await header(input, domain);
  if (token.rawSize > remaining) throw new ResourceLimitError("ESSR exceeds decoded byte limit", input.offset);
  const payload = input.scope(token.count * (domain === "txt" ? 4 : 3));
  if (sink) await sink.write(b(token.text));
  let lead = token.lead;
  while (!await payload.atEnd()) {
    // Aligned blocks need no text carry and never allocate the complete token.
    const bytes = await payload.read(Math.min(payload.remaining, domain === "txt" ? 32768 : 24576));
    const text = domain === "txt" ? byteString(bytes) : encodeB64(bytes);
    if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new DeserializeError("Invalid Texter base64 payload", input.offset);
    const raw = domain === "txt" ? decodeB64(text) : bytes;
    for (let i = 0; i < lead; i++) {
      if (raw[i] !== 0) throw new DeserializeError("Nonzero Texter lead padding", input.offset);
    }
    if (sink) await sink.write(domain === "txt" ? bytes : b(text));
    const value = raw.subarray(lead);
    lead = 0;
    if (value.length) yield value;
  }
  payload.expectEnd();
  return token.rawSize;
}

/**
 * Reopen one owned wire stream as a non-owning concatenated raw-byte view.
 * Readers admit backing buffers up to 1 MiB, matching built-in memory/file sinks;
 * custom owners must obey that chunk contract even for short subarray views.
 */
export function essrPayload(wire: OwnedPayload, count: number, size: number, gvrsn: Versionage): EssrPayload {
  if (![count, size, wire.size].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new RangeError("Invalid ESSR payload metadata");
  }
  return {
    count,
    gvrsn,
    wire,
    raw: {
      size,
      async *open(signal?: AbortSignal) {
        const input = new Cursor(wire.open(signal), { signal });
        let decoded = 0;
        try {
          for (let item = 0; item < count; item++) {
            // yield* preserves backpressure through decoding instead of collecting a Texter.
            decoded += yield* texter(input, "txt", size - decoded);
          }
          if (decoded !== size || !await input.atEnd()) throw new DeserializeError("ESSR payload metadata mismatch");
        } finally {
          await input.close();
        }
      },
    },
    discard: () => wire.discard(),
  };
}

/** One unfinished frame's ESSR staging owner; only the public yield transfers it. */
export class EssrWriter {
  private count = 0;
  private size = 0;

  constructor(
    private readonly sink: PayloadSink,
    private readonly maxBytes: number,
    private readonly maxItems: number,
    private readonly gvrsn: Versionage,
  ) {}

  /** Append one group; v1 counts items and v2 bounds qualified payload bytes. */
  async read(input: Cursor, counter: Counter, gvrsn: Versionage, domain: CesrDomain): Promise<void> {
    const bounded = gvrsn.major === 2;
    const body = bounded ? input.scope(counter.count * (domain === "txt" ? 4 : 3)) : input;
    let items = 0;
    while (bounded ? !await body.atEnd() : items < counter.count) {
      if (this.count >= this.maxItems) throw new ResourceLimitError("ESSR exceeds item limit", input.offset);
      const token = texter(body, domain, this.maxBytes - this.size, this.sink);
      // The iterator return carries even a zero-length item's admitted byte count.
      let step = await token.next();
      while (!step.done) step = await token.next();
      this.size += step.value;
      this.count++;
      items++;
    }
    if (bounded) body.expectEnd();
  }

  /** Finish exactly once after all containing one-frame enclosures validate. */
  async finish(): Promise<EssrPayload> {
    return essrPayload(await this.sink.finish(), this.count, this.size, this.gvrsn);
  }

  /** Abandon every parser-owned stage on malformed input, cancellation, or return. */
  abort(reason?: unknown): Promise<void> {
    return this.sink.abort(reason);
  }
}

/** Validate budgets and derive a finite canonical-wire cap including empty item headers. */
export function essrFactory(options: EssrOptions, signal?: AbortSignal): (gvrsn: Versionage) => Promise<EssrWriter> {
  const bytes = options.maxEssrBytes ?? 8 * 1024 ** 2;
  const items = options.maxEssrItems ?? 16384;
  for (const value of [bytes, items]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError("ESSR limits must be non-negative safe integers");
    }
  }
  // Each item needs at most two lead bytes and an eight-character qualified header.
  const wireLimit = 4 * Math.ceil(bytes / 3) + 12 * items;
  if (!Number.isSafeInteger(wireLimit)) throw new RangeError("ESSR wire limit exceeds safe integer range");
  return async (gvrsn) => {
    const sink = options.payloadSink
      ? await options.payloadSink(wireLimit, signal)
      : new MemoryPayloadSink(wireLimit, signal);
    return new EssrWriter(sink, bytes, items, gvrsn);
  };
}
