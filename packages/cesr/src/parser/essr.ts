import { b, b64ToInt, byteString, decodeB64, encodeB64 } from "../core/bytes.ts";
import { DeserializeError, UnknownCodeError } from "../core/errors.ts";
import { MemoryPayloadSink, type OwnedPayload, type PayloadSink } from "../core/payload.ts";
import type { CesrDomain, EssrPayload } from "../core/types.ts";
import { TEXTER_CODES } from "../primitives/codex.ts";
import type { Counter } from "../primitives/counter.ts";
import { Texter } from "../primitives/texter.ts";
import { MATTER_SIZES } from "../tables/matter.tables.generated.ts";
import type { Versionage } from "../tables/table-types.ts";
import { Cursor } from "./cursor.ts";

/** Optional staging owned by the parser until a complete frame is delivered. */
export interface EssrOptions {
  /** Awaited writes supply backpressure; the sink must honor cancellation. */
  payloadSink?: (signal?: AbortSignal) => PayloadSink | Promise<PayloadSink>;
}

/** Texter headers are aligned whole quadlets/triplets in both Bytes code families. */
async function header(input: Cursor, domain: CesrDomain) {
  // One byte identifies the hard-code width without reading past a short token.
  const first = await input.peek(1);
  // The first binary sextet and first text character name the same Bytes family.
  const selector = domain === "txt" ? byteString(first) : encodeB64(first)[0];
  if (!"456789".includes(selector)) throw new UnknownCodeError("ESSR requires a Texter Bytes code", input.offset);
  // Small codes use 2 hard + 2 soft characters; big codes use 4 + 4.
  const hard = "456".includes(selector) ? 2 : 4;
  // Header sextets occur in equal hard/soft halves; qb2 uses three bytes per quadlet.
  const size = hard * (domain === "txt" ? 2 : 1.5);
  // Consume only the complete admitted header, leaving the payload queued.
  const bytes = await input.read(size);
  // Canonical header text supplies the same code and soft count in either domain.
  const text = domain === "txt" ? byteString(bytes) : encodeB64(bytes);
  // The hard part must name a Texter, not another variable-length Matter family.
  const code = text.slice(0, hard);
  if (!TEXTER_CODES.has(code)) throw new UnknownCodeError(`Expected Texter, got ${code}`, input.offset - size);
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new DeserializeError("Invalid Texter header", input.offset - size);
  // Soft count measures padded triplets; the code supplies the number of zero lead bytes.
  const count = b64ToInt(text.slice(hard));
  // Generated codex metadata owns the padding rule.
  const lead = MATTER_SIZES.get(code)!.ls;
  // Remove only qualification padding from the declared decoded byte length.
  const rawSize = count * 3 - lead;
  if (rawSize < 0) throw new DeserializeError("Texter lead exceeds its payload", input.offset);
  return { text, count, lead, rawSize };
}

/** Stream one validated token, optionally staging its canonical qualified text. */
async function* texter(
  input: Cursor,
  domain: CesrDomain,
  sink?: PayloadSink,
  remaining?: number,
): AsyncGenerator<Uint8Array, number> {
  const token = await header(input, domain);
  if (remaining !== undefined && token.rawSize > remaining) {
    throw new DeserializeError("ESSR token exceeds declared decoded payload size", input.offset);
  }
  // This scope prevents following attachment bytes from repairing an incomplete token.
  const payload = input.scope(token.count * (domain === "txt" ? 4 : 3));
  if (sink) await sink.write(b(token.text));
  // Leading zeros are removed once, from the first decoded block only.
  let lead = token.lead;
  while (!await payload.atEnd()) {
    // Aligned blocks need no text carry and never allocate the complete token.
    const bytes = await payload.read(Math.min(payload.remaining, domain === "txt" ? 32768 : 24576));
    // Canonical text is staged in either domain; alignment avoids interior base64 padding.
    const text = domain === "txt" ? byteString(bytes) : encodeB64(bytes);
    if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new DeserializeError("Invalid Texter base64 payload", input.offset);
    // Binary bytes already represent decoded triplets; text blocks need base64 decoding.
    const raw = domain === "txt" ? decodeB64(text) : bytes;
    for (let i = 0; i < lead; i++) {
      if (raw[i] !== 0) throw new DeserializeError("Nonzero Texter lead padding", input.offset);
    }
    if (sink) await sink.write(domain === "txt" ? bytes : b(text));
    // The yielded view excludes qualification padding and remains bounded by one block.
    const value = raw.subarray(lead);
    lead = 0;
    if (value.length) yield value;
  }
  payload.expectEnd();
  return token.rawSize;
}

/**
 * Reopen one owned wire stream as a non-owning concatenated raw-byte view.
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
      /** Revalidate token bounds while reopening decoded bytes without taking ownership. */
      async *open(signal?: AbortSignal) {
        // Each open owns an independent cursor and source lifetime.
        const input = new Cursor(wire.open(signal), { signal });
        // Track the advertised raw size without an item-size manifest.
        let decoded = 0;
        try {
          for (let item = 0; item < count; item++) {
            // yield* preserves backpressure through decoding instead of collecting a Texter.
            decoded += yield* texter(input, "txt", undefined, size - decoded);
          }
          if (decoded !== size || !await input.atEnd()) throw new DeserializeError("ESSR payload metadata mismatch");
        } finally {
          await input.close();
        }
      },
    },
    /** Both borrowed views share this sole storage owner. */
    discard: () => wire.discard(),
  };
}

/** One unfinished frame's ESSR staging owner; only the public yield transfers it. */
export class EssrWriter {
  /** Completed Texters across every ESSR group in this frame. */
  private count = 0;
  /** Sum of decoded bytes, excluding qualification padding. */
  private size = 0;

  /** Capture one unfinished stage and its resolved genus. */
  constructor(
    /** Unfinished storage owned by this writer until finish succeeds. */
    private readonly sink: PayloadSink,
    /** Resolved frame genus used as the default when replay constructs new counters. */
    private readonly gvrsn: Versionage,
  ) {}

  /** Append one group; v1 counts items and v2 bounds qualified payload bytes. */
  async read(input: Cursor, counter: Counter, gvrsn: Versionage, domain: CesrDomain): Promise<void> {
    // Genus controls whether the group count names bytes or logical items.
    const bounded = gvrsn.major === 2;
    // V2 must exhaust its own extent; v1 stops after exactly the declared item count.
    const body = bounded ? input.scope(counter.count * (domain === "txt" ? 4 : 3)) : input;
    // This counter is local to the group; this.count records exact frame metadata.
    let items = 0;
    while (bounded ? !await body.atEnd() : items < counter.count) {
      const token = texter(body, domain, this.sink);
      // The iterator return carries even a zero-length item's decoded byte count.
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
    const wire = await this.sink.finish();
    try {
      return essrPayload(wire, this.count, this.size, this.gvrsn);
    } catch (error) {
      // Sink ownership has transferred, but no qualified ESSR owner reached the parser yet.
      try {
        await wire.discard();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "ESSR finalization cleanup failed", { cause: error });
      }
      throw error;
    }
  }

  /** Abandon every parser-owned stage on malformed input, cancellation, or return. */
  abort(reason?: unknown): Promise<void> {
    return this.sink.abort(reason);
  }
}

/** Acquire actual staging only when a frame first encounters ESSR. */
export function essrFactory(
  options: EssrOptions,
  signal?: AbortSignal,
): (gvrsn: Versionage) => Promise<EssrWriter> {
  const payloadSink = options.payloadSink;
  return async (gvrsn) => {
    const sink = payloadSink ? await payloadSink(signal) : new MemoryPayloadSink(signal);
    return new EssrWriter(sink, gvrsn);
  };
}

/** Rehydrate one Texter at a time for per-item consumers. */
export async function* essrTexters(
  essr: EssrPayload,
  signal?: AbortSignal,
): AsyncGenerator<Texter> {
  const input = new Cursor(essr.wire.open(signal), { signal });
  let decoded = 0;
  try {
    for (let item = 0; item < essr.count; item++) {
      const token = await header(input, "txt");
      if (token.rawSize > essr.raw.size - decoded) {
        throw new DeserializeError("ESSR Texter exceeds declared payload size.");
      }
      const length = token.text.length + token.count * 4;
      const bytes = new Uint8Array(length);
      bytes.set(b(token.text));
      let offset = token.text.length;
      while (offset < length) {
        const chunk = await input.read(Math.min(32768, length - offset));
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const texter = new Texter({ qb64b: bytes });
      decoded += texter.raw.length;
      yield texter;
    }
    if (decoded !== essr.raw.size || !await input.atEnd()) {
      throw new DeserializeError("ESSR wire metadata does not match its contents.");
    }
  } finally {
    await input.close();
  }
}
