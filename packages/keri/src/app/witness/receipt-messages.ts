/** Receipt framing follows the receipt body version; core serialization owns the counters. */
import { type Cigar, parseBytes, type SerderKERI, type Siger } from "cesr-ts";
import { ValidationError } from "../../core/errors.ts";
import { messagize } from "../../core/protocol-serialization.ts";
import { envelopeFromFrame } from "../protocol/parsering.ts";

/** Build a collected receipt with an attachment enclosure. Signatures cover the receipted event. */
export function buildDetachedReceiptMessage(serder: SerderKERI, { wigers = [], cigars = [] }: {
  wigers?: readonly Siger[];
  cigars?: readonly Cigar[];
}): Uint8Array {
  if (!wigers.length && !cigars.length) return serder.raw;
  return messagize(serder, { wigers, cigars, pipelined: true, gvrsn: serder.pvrsn });
}

/** Match KERIpy receipt endpoints: body plus receipt material without an attachment enclosure. */
export function buildEndpointDetachedReceiptMessage(serder: SerderKERI, { wigers = [], cigars = [] }: {
  wigers?: readonly Siger[];
  cigars?: readonly Cigar[];
}): Uint8Array {
  if (!wigers.length && !cigars.length) return serder.raw;
  return messagize(serder, { wigers, cigars, gvrsn: serder.pvrsn });
}

/** Build one attached `rct` message carrying witness indexed signatures. */
export function buildWitnessReceiptMessage(
  serder: SerderKERI,
  wigers: readonly Siger[],
): Uint8Array {
  return buildEndpointDetachedReceiptMessage(serder, { wigers });
}

/** Inspect one complete receipt; hydrated proof values have no asynchronous lifetime. */
export function inspectReceiptMessage(
  bytes: Uint8Array,
): { serder: SerderKERI; wigers: readonly Siger[]; cigars: readonly Cigar[] } {
  const frames = parseBytes(bytes);
  if (frames.length !== 1) throw new ValidationError("Expected one witness receipt message.");
  const envelope = envelopeFromFrame(frames[0], false);
  return { serder: envelope.serder, wigers: envelope.wigers, cigars: envelope.cigars };
}
