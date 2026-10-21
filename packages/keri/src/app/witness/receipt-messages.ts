/** Exact v1 receipt encodings: endpoint proofs omit the attachment enclosure used for collected receipts. */
import { Cigar, concatBytes, Counter, CtrDexV1, parseBytes, type SerderKERI, type Siger } from "cesr-ts";
import { ValidationError } from "../../core/errors.ts";
import { envelopeFromFrame } from "../protocol/parsering.ts";

const KERI_V1 = Object.freeze({ major: 1, minor: 0 } as const);

/** Build one attached `rct` message carrying detached receipt material. */
export function buildDetachedReceiptMessage(serder: SerderKERI, { wigers = [], cigars = [] }: {
  wigers?: readonly Siger[];
  cigars?: readonly Cigar[];
}): Uint8Array {
  if (wigers.length === 0 && cigars.length === 0) {
    return serder.raw;
  }

  const attachments: Uint8Array[] = [];
  if (wigers.length > 0) {
    attachments.push(
      new Counter({
        code: CtrDexV1.WitnessIdxSigs,
        count: wigers.length,
        version: KERI_V1,
      }).qb64b,
      ...wigers.map((wiger) => wiger.qb64b),
    );
  }
  if (cigars.length > 0) {
    attachments.push(
      new Counter({
        code: CtrDexV1.NonTransReceiptCouples,
        count: cigars.length,
        version: KERI_V1,
      }).qb64b,
      ...cigars.flatMap((cigar) => {
        const verfer = cigar.verfer;
        if (!verfer) {
          throw new ValidationError(
            "Detached non-transferable receipt is missing verifier context.",
          );
        }
        return [verfer.qb64b, cigar.qb64b];
      }),
    );
  }
  const atc = concatBytes(...attachments);

  if (atc.length % 4 !== 0) {
    throw new ValidationError(
      "Witness receipt attachment group is not quadlet aligned.",
    );
  }

  return concatBytes(
    serder.raw,
    new Counter({
      code: CtrDexV1.AttachmentGroup,
      count: atc.length / 4,
      version: KERI_V1,
    }).qb64b,
    atc,
  );
}

/**
 * Build one KERIpy-style endpoint `rct` message without an attachment-group
 * wrapper.
 *
 * KERIpy's witness `/receipts` endpoints return `rct + counter + material`
 * directly. KLI's receiptor depends on that exact shape when it re-fans the
 * returned receipt material out to the other witnesses.
 */
export function buildEndpointDetachedReceiptMessage(serder: SerderKERI, { wigers = [], cigars = [] }: {
  wigers?: readonly Siger[];
  cigars?: readonly Cigar[];
}): Uint8Array {
  const parts: Uint8Array[] = [serder.raw];
  if (wigers.length > 0) {
    parts.push(
      new Counter({
        code: CtrDexV1.WitnessIdxSigs,
        count: wigers.length,
        version: KERI_V1,
      }).qb64b,
      ...wigers.map((wiger) => wiger.qb64b),
    );
  }
  if (cigars.length > 0) {
    parts.push(
      new Counter({
        code: CtrDexV1.NonTransReceiptCouples,
        count: cigars.length,
        version: KERI_V1,
      }).qb64b,
      ...cigars.flatMap((cigar) => {
        const verfer = cigar.verfer;
        if (!verfer) {
          throw new ValidationError(
            "Endpoint receipt couple is missing verifier context.",
          );
        }
        return [verfer.qb64b, cigar.qb64b];
      }),
    );
  }
  return concatBytes(...parts);
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
