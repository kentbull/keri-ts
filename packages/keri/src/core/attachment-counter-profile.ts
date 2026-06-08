import { Counter, CtrDexV1, CtrDexV2, type Versionage, Vrsn_1_0, Vrsn_2_0 } from "../../../cesr/mod.ts";
import { ValidationError } from "./errors.ts";

export const ATTACHMENT_COUNTER_PROFILES = [
  "legacy",
  "keripy-current",
] as const;

export type AttachmentCounterProfile = typeof ATTACHMENT_COUNTER_PROFILES[number];

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

const LEGACY_COUNTER_CODES: Record<AttachmentCounterName, string> = {
  AttachmentGroup: CtrDexV1.AttachmentGroup,
  ControllerIdxSigs: CtrDexV1.ControllerIdxSigs,
  WitnessIdxSigs: CtrDexV1.WitnessIdxSigs,
  NonTransReceiptCouples: CtrDexV1.NonTransReceiptCouples,
  TransReceiptQuadruples: CtrDexV1.TransReceiptQuadruples,
  FirstSeenReplayCouples: CtrDexV1.FirstSeenReplayCouples,
  TransIdxSigGroups: CtrDexV1.TransIdxSigGroups,
  TransLastIdxSigGroups: CtrDexV1.TransLastIdxSigGroups,
  SealSourceCouples: CtrDexV1.SealSourceCouples,
  SealSourceTriples: CtrDexV1.SealSourceTriples,
};

/*
 * KERIpy 1.2.x parses attachment counters for KERI10JSON events with gvrsn=2.
 * Keep this profile narrow: it is for direct KERIpy verifier presentation
 * streams, while local tufa/KLI witness and mailbox flows stay legacy.
 */
const KERIPY_CURRENT_COUNTER_CODES: Record<AttachmentCounterName, string> = {
  AttachmentGroup: CtrDexV2.AttachmentGroup,
  ControllerIdxSigs: CtrDexV2.ControllerIdxSigs,
  WitnessIdxSigs: CtrDexV2.WitnessIdxSigs,
  NonTransReceiptCouples: CtrDexV2.NonTransReceiptCouples,
  TransReceiptQuadruples: CtrDexV2.TransReceiptQuadruples,
  FirstSeenReplayCouples: CtrDexV2.FirstSeenReplayCouples,
  TransIdxSigGroups: CtrDexV2.TransIdxSigGroups,
  TransLastIdxSigGroups: CtrDexV2.TransLastIdxSigGroups,
  SealSourceCouples: CtrDexV2.SealSourceCouples,
  SealSourceTriples: CtrDexV2.SealSourceTriples,
};

export function normalizeAttachmentCounterProfile(
  value: unknown,
): AttachmentCounterProfile {
  if (value === undefined || value === null || value === "") {
    return "legacy";
  }
  if (value === "legacy" || value === "keripy-current") {
    return value;
  }
  throw new ValidationError(
    `Invalid counter profile "${String(value)}". Expected legacy or keripy-current.`,
  );
}

export function attachmentCounterQb64b(
  name: AttachmentCounterName,
  count: number,
  profile: AttachmentCounterProfile = "legacy",
): Uint8Array {
  validateCounterCount(name, count, profile);
  return new Counter({
    code: codeFor(name, profile),
    count,
    version: versionFor(profile),
  }).qb64b;
}

export function attachmentCounterPayloadQb64b(
  name: AttachmentCounterName,
  itemCount: number,
  payload: Uint8Array | readonly Uint8Array[],
  profile: AttachmentCounterProfile = "legacy",
): Uint8Array {
  const payloadLength = payload instanceof Uint8Array
    ? payload.length
    : payload.reduce((total, current) => total + current.length, 0);
  if (payloadLength % 4 !== 0) {
    throw new ValidationError(
      `Invalid ${name} payload size=${payloadLength}, nonintegral quadlets.`,
    );
  }
  return attachmentCounterQb64b(
    name,
    profile === "keripy-current" ? payloadLength / 4 : itemCount,
    profile,
  );
}

export function pathedMaterialCounterQb64b(
  count: number,
  profile: AttachmentCounterProfile = "legacy",
): Uint8Array {
  validateCounterCount("PathedMaterialGroup", count, profile);
  if (profile === "keripy-current") {
    return new Counter({
      code: CtrDexV2.PathedMaterialCouples,
      count,
      version: Vrsn_2_0,
    }).qb64b;
  }
  const code = count <= MAX_SMALL_COUNTER_COUNT ? CtrDexV1.PathedMaterialCouples : CtrDexV1.BigPathedMaterialCouples;
  return new Counter({ code, count, version: Vrsn_1_0 }).qb64b;
}

function codeFor(
  name: AttachmentCounterName,
  profile: AttachmentCounterProfile,
): string {
  return profile === "keripy-current" ? KERIPY_CURRENT_COUNTER_CODES[name] : LEGACY_COUNTER_CODES[name];
}

function versionFor(profile: AttachmentCounterProfile): Versionage {
  return profile === "keripy-current" ? Vrsn_2_0 : Vrsn_1_0;
}

function validateCounterCount(
  name: string,
  count: number,
  profile: AttachmentCounterProfile,
): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ValidationError(`Invalid ${name} counter count ${count}.`);
  }
  if (profile === "keripy-current" && count > MAX_SMALL_COUNTER_COUNT) {
    throw new ValidationError(
      `Counter profile keripy-current does not yet support big ${name} counts (${count}).`,
    );
  }
}
