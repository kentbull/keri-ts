import { Counter, CtrDexV1, CtrDexV2, NumberPrimitive, Seqner, type Versionage, Vrsn_1_0, Vrsn_2_0 } from "cesr-ts";
import { ValidationError } from "./errors.ts";

/**
 * Semantic attachment counter families used by KERI/TEL/ACDC message builders.
 *
 * The names intentionally track CESR counter codex names rather than local
 * storage names so callers choose protocol meaning first and let this module
 * choose the v1/v2 code family.
 */
export type AttachmentCounterName =
  | "ESSRPayloadGroup"
  | "AttachmentGroup"
  | "ControllerIdxSigs"
  | "WitnessIdxSigs"
  | "NonTransReceiptCouples"
  | "TransReceiptQuadruples"
  | "FirstSeenReplayCouples"
  | "TransIdxSigGroups"
  | "TransLastIdxSigGroups"
  | "SealSourceCouples"
  | "SealSourceTriples";

const MAX_SMALL_COUNTER_COUNT = 4095;

type VersionedSerder = Readonly<{
  pvrsn: Versionage;
  gvrsn?: Versionage | null;
}>;

/**
 * Resolve the attachment genus version for one live message envelope.
 *
 * Caller-requested `gvrsn` is a floor, nested/enclosed messages require v2,
 * and a serder's own `gvrsn`/`pvrsn` can raise the result. Stored replay bodies
 * retain their bytes while requiring attachments at least this recent.
 */
export function resolveAttachmentGvrsn(
  serder: VersionedSerder,
  gvrsn: Versionage = Vrsn_1_0,
  nested = false,
): Versionage {
  let resolved = gvrsn;
  if (nested && resolved.major < 2) {
    resolved = Vrsn_2_0;
  }

  const serderGvrsn = serder.gvrsn ?? serder.pvrsn;
  if (versionLess(resolved, serderGvrsn)) {
    resolved = serderGvrsn;
  }
  return resolved;
}

/**
 * Qualify a sequence or first-seen ordinal for an attachment of genus `gvrsn`.
 *
 * KERIpy `messagize` (`_v1seqner`/`_v2number`): v1 attachments carry the fixed-width
 * `0A` Seqner, v2 attachments the smallest automatic Number code (`MAAB` for 1),
 * whatever primitive the caller holds, so a freshly signed message and one rebuilt
 * from storage serialize to the same bytes. Hex strings are KERI `snh` ordinals.
 */
export function attachmentOrdinal(
  ordinal: NumberPrimitive | Seqner | string,
  gvrsn: Versionage,
): NumberPrimitive | Seqner {
  if (gvrsn.major === 1 && ordinal instanceof Seqner) return ordinal;
  const value = ordinal instanceof Seqner
    ? ordinal.sn
    : ordinal instanceof NumberPrimitive
    ? ordinal.num
    : hexOrdinal(ordinal);
  if (gvrsn.major >= 2) return NumberPrimitive.fromNum(value);
  if (value >= 1n << 128n) throw new ValidationError(`Ordinal ${value} exceeds the 16-byte v1 Seqner.`);
  const raw = new Uint8Array(16);
  for (let at = raw.length - 1, rest = value; at >= 0; at--, rest >>= 8n) raw[at] = Number(rest & 0xffn);
  return new Seqner({ code: "0A", raw });
}

function hexOrdinal(hex: string): bigint {
  if (!/^[0-9a-f]+$/i.test(hex)) throw new ValidationError(`Invalid hex ordinal ${hex}`);
  return BigInt(`0x${hex}`);
}

/** Build one bare attachment counter using the code family for `gvrsn`. */
export function attachmentCounterQb64b(
  name: AttachmentCounterName,
  count: number,
  gvrsn: Versionage = Vrsn_1_0,
): Uint8Array {
  validateCounterCount(name, count);
  return new Counter({
    code: codeFor(name, count, gvrsn),
    count,
    version: gvrsn,
  }).qb64b;
}

/**
 * Build a counter for a payload group, using item count for v1 and quadlet
 * payload length for v2.
 */
export function attachmentCounterPayloadQb64b(
  name: AttachmentCounterName,
  itemCount: number,
  payload: Uint8Array | readonly Uint8Array[],
  gvrsn: Versionage = Vrsn_1_0,
): Uint8Array {
  const payloadLength = payloadSize(payload);
  if (payloadLength % 4 !== 0) {
    throw new ValidationError(
      `Invalid ${name} payload size=${payloadLength}, nonintegral quadlets.`,
    );
  }
  const count = gvrsn.major >= 2 ? payloadLength / 4 : itemCount;
  return attachmentCounterQb64b(name, count, gvrsn);
}

/**
 * Wrap a payload with CESR enclosure framing for nested/body-with-attachment
 * groups.
 */
export function encloseAttachmentPayloadQb64b(
  name: AttachmentCounterName,
  payload: Uint8Array | readonly Uint8Array[],
  gvrsn: Versionage = Vrsn_2_0,
): Uint8Array {
  const raw = payload instanceof Uint8Array ? payload : concatPayload(payload);
  if (raw.length % 4 !== 0) {
    throw new ValidationError(
      `Invalid ${name} payload size=${raw.length}, nonintegral quadlets.`,
    );
  }
  return Counter.enclose({ qb64: raw, code: name, version: gvrsn });
}

/** Build the counter that prefixes one pathed material couple/group. */
export function pathedMaterialCounterQb64b(
  count: number,
  gvrsn: Versionage = Vrsn_1_0,
): Uint8Array {
  validateCounterCount("PathedMaterialGroup", count);
  return new Counter({
    code: codeFor("PathedMaterialCouples", count, gvrsn),
    count,
    version: gvrsn,
  }).qb64b;
}

/** Parse CLI/config `gvrsn` input into the supported CESR attachment versions. */
export function parseGvrsn(value: unknown): Versionage {
  if (value === undefined || value === null || value === "") {
    return Vrsn_1_0;
  }
  if (value === "1" || value === "1.0") {
    return Vrsn_1_0;
  }
  if (value === "2" || value === "2.0") {
    return Vrsn_2_0;
  }
  throw new ValidationError(
    `Invalid gvrsn "${String(value)}". Expected 1, 1.0, 2, or 2.0.`,
  );
}

function concatPayload(payload: readonly Uint8Array[]): Uint8Array {
  const total = payload.reduce((sum, current) => sum + current.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of payload) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function payloadSize(payload: Uint8Array | readonly Uint8Array[]): number {
  return payload instanceof Uint8Array ? payload.length : payload.reduce((total, current) => total + current.length, 0);
}

function codeFor(
  name: AttachmentCounterName | "PathedMaterialCouples",
  count: number,
  gvrsn: Versionage,
): string {
  const table = (gvrsn.major >= 2 ? CtrDexV2 : CtrDexV1) as Record<string, string>;
  const semanticName = count > MAX_SMALL_COUNTER_COUNT && table[`Big${name}`] ? `Big${name}` : name;
  const code = table[semanticName];
  if (!code) {
    throw new ValidationError(
      `Unsupported attachment counter ${name} for gvrsn ${gvrsn.major}.${gvrsn.minor}.`,
    );
  }
  return code;
}

function validateCounterCount(name: string, count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ValidationError(`Invalid ${name} counter count ${count}.`);
  }
}

function versionLess(left: Versionage, right: Versionage): boolean {
  return left.major < right.major || (left.major === right.major && left.minor < right.minor);
}
