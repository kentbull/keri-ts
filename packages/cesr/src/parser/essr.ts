import { b, b64ToInt, byteString, decodeB64, encodeB64 } from "../core/bytes.ts";
import { DeserializeError, ResourceLimitError, UnknownCodeError } from "../core/errors.ts";
import { MemoryPayloadSink, type OwnedPayload, type PayloadSink } from "../core/payload.ts";
import type { CesrDomain, EssrPayload } from "../core/types.ts";
import { TEXTER_CODES } from "../primitives/codex.ts";
import type { Counter } from "../primitives/counter.ts";
import { Texter } from "../primitives/texter.ts";
import { MATTER_SIZES } from "../tables/matter.tables.generated.ts";
import type { Versionage } from "../tables/table-types.ts";
import { Cursor } from "./cursor.ts";

/** Finite logical-message budgets apply even when the sink writes to disk. */
export interface EssrOptions {
  /** Maximum concatenated decoded ESSR bytes in one owned tree; default 8 MiB. */
  maxEssrBytes?: number;
  /** Maximum Texters in one owned tree, including empty values; default 16,384. */
  maxEssrItems?: number;
  /**
   * Awaited writes supply backpressure; the sink must honor the supplied signal.
   * Finished open() readers must yield chunks with backing buffers of at most 1 MiB.
   */
  payloadSink?: (maxBytes: number, signal?: AbortSignal) => PayloadSink | Promise<PayloadSink>;
}

/** Remaining decoded bytes and item credit shared by an owned parent tree. */
export interface EssrBudget {
  /** Available decoded bytes, reserved before writing token content. */
  bytes: number;
  /** Available Texters, including zero-length values. */
  items: number;
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
  remaining: number,
  sink?: PayloadSink,
  admit?: (size: number) => void,
): AsyncGenerator<Uint8Array, number> {
  // Admission happens before pulling any declared payload bytes.
  const token = await header(input, domain);
  if (token.rawSize > remaining) throw new ResourceLimitError("ESSR exceeds decoded byte limit", input.offset);
  admit?.(token.rawSize);
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
      /** Revalidate token bounds while reopening decoded bytes without taking ownership. */
      async *open(signal?: AbortSignal) {
        // Each open owns an independent cursor and source lifetime.
        const input = new Cursor(wire.open(signal), { signal });
        // Track the advertised raw size without an item-size manifest.
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
    /** Both borrowed views share this sole storage owner. */
    discard: () => wire.discard(),
  };
}

/** One unfinished frame's ESSR staging owner; only the public yield transfers it. */
export class EssrWriter {
  /** Completed Texters across every ESSR group in this frame. */
  private count = 0;
  /** Sum of admitted decoded bytes, excluding qualification padding. */
  private size = 0;

  /** Capture one stage and the frame-wide budgets that all appended groups share. */
  constructor(
    /** Unfinished storage owned by this writer until finish succeeds. */
    private readonly sink: PayloadSink,
    /** Decoded-byte cap across this frame, independent of sink storage medium. */
    private readonly maxBytes: number,
    /** Item cap also bounds streams containing only empty Texters. */
    private readonly maxItems: number,
    /** Resolved frame genus used as the default when replay constructs new counters. */
    private readonly gvrsn: Versionage,
    /** Optional shared credit for every descendant of the pending parent. */
    private readonly budget?: EssrBudget,
  ) {}

  /** Append one group; v1 counts items and v2 bounds qualified payload bytes. */
  async read(input: Cursor, counter: Counter, gvrsn: Versionage, domain: CesrDomain): Promise<void> {
    // Genus controls whether the group count names bytes or logical items.
    const bounded = gvrsn.major === 2;
    // V2 must exhaust its own extent; v1 stops after exactly the declared item count.
    const body = bounded ? input.scope(counter.count * (domain === "txt" ? 4 : 3)) : input;
    // This counter is local to the group; this.count enforces the frame-wide policy.
    let items = 0;
    while (bounded ? !await body.atEnd() : items < counter.count) {
      if (this.count >= this.maxItems || this.budget?.items === 0) {
        throw new ResourceLimitError("ESSR exceeds item limit", input.offset);
      }
      // Fully validate this token while each awaited write supplies downstream credit.
      const token = texter(
        body,
        domain,
        Math.min(this.maxBytes - this.size, this.budget?.bytes ?? Infinity),
        this.sink,
        (size) => {
          if (this.budget) {
            this.budget.bytes -= size;
            this.budget.items--;
          }
        },
      );
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
export function essrFactory(
  options: EssrOptions,
  signal?: AbortSignal,
): (gvrsn: Versionage, budget?: EssrBudget) => Promise<EssrWriter> {
  // Decoded-byte and item limits constrain separate sources of retained work.
  const bytes = options.maxEssrBytes ?? 8 * 1024 ** 2;
  // Empty items consume headers even when they contribute no decoded bytes.
  const items = options.maxEssrItems ?? 16384;
  for (const value of [bytes, items]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError("ESSR limits must be non-negative safe integers");
    }
  }
  // Each item needs at most two lead bytes and an eight-character qualified header.
  const wireLimit = 4 * Math.ceil(bytes / 3) + 12 * items;
  if (!Number.isSafeInteger(wireLimit)) throw new RangeError("ESSR wire limit exceeds safe integer range");
  return async (gvrsn, budget) => {
    // A custom sink receives the same finite wire cap and operation cancellation signal.
    const sink = options.payloadSink
      ? await options.payloadSink(wireLimit, signal)
      : new MemoryPayloadSink(wireLimit, signal);
    return new EssrWriter(sink, bytes, items, gvrsn, budget);
  };
}

/** Rehydrate one explicitly bounded Texter at a time for per-item consumers. */
export async function* essrTexters(
  essr: EssrPayload,
  maxItemBytes: number,
  signal?: AbortSignal,
): AsyncGenerator<Texter> {
  if (!Number.isSafeInteger(maxItemBytes) || maxItemBytes < 0) throw new RangeError("Invalid ESSR item limit");
  const input = new Cursor(essr.wire.open(signal), { signal });
  let decoded = 0;
  try {
    for (let item = 0; item < essr.count; item++) {
      const token = await header(input, "txt");
      if (token.rawSize > maxItemBytes || token.rawSize > essr.raw.size - decoded) {
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
