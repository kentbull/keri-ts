import { Counter, CtrDexV1, CtrDexV2, type Versionage, Vrsn_1_0, Vrsn_2_0 } from "../../../cesr/mod.ts";
import { ValidationError } from "./errors.ts";

export type AttachmentCounterName =
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
