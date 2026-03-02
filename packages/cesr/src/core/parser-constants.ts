import type { Counter } from "../primitives/counter.ts";
import { CtrDexV2 } from "../tables/counter-codex.ts";
import type { Versionage } from "../tables/table-types.ts";

/** Default parser version context when no explicit selector is present. */
export const DEFAULT_VERSION: Versionage = { major: 2, minor: 0 };

/** Native map-body counter codes that permit interleaved label parsing. */
export const MAP_BODY_CODES = new Set([
  CtrDexV2.MapBodyGroup,
  CtrDexV2.BigMapBodyGroup,
]);

/** Counter code for stream or nested genus-version selector tokens. */
export const GENUS_VERSION_CODE = CtrDexV2.KERIACDCGenusVersion;

const FRAME_BOUNDARY_COUNTER_NAMES = new Set([
  "BodyWithAttachmentGroup",
  "BigBodyWithAttachmentGroup",
  "NonNativeBodyGroup",
  "BigNonNativeBodyGroup",
  "FixBodyGroup",
  "BigFixBodyGroup",
  "MapBodyGroup",
  "BigMapBodyGroup",
  "GenericGroup",
  "BigGenericGroup",
  "KERIACDCGenusVersion",
]);

/** True when counter begins a top-level frame boundary domain. */
export function isFrameBoundaryCounter(counter: Counter): boolean {
  return FRAME_BOUNDARY_COUNTER_NAMES.has(counter.name);
}

/** Counter names supported as frame starts in CESR-native domain. */
export const FRAME_START_GROUP_NAMES = new Set([
  "BodyWithAttachmentGroup",
  "BigBodyWithAttachmentGroup",
  "NonNativeBodyGroup",
  "BigNonNativeBodyGroup",
  "FixBodyGroup",
  "BigFixBodyGroup",
  "MapBodyGroup",
  "BigMapBodyGroup",
  "GenericGroup",
  "BigGenericGroup",
]);

/** Wrapper counters whose payload encloses one full body+attachments frame. */
export const BODY_WITH_ATTACHMENT_GROUP_NAMES = new Set([
  "BodyWithAttachmentGroup",
  "BigBodyWithAttachmentGroup",
]);

/** Non-native body counters whose payload is a texter-wrapped message body. */
export const NON_NATIVE_BODY_GROUP_NAMES = new Set([
  "NonNativeBodyGroup",
  "BigNonNativeBodyGroup",
]);

/** Native body counters (fixed-field or map-body forms). */
export const NATIVE_BODY_GROUP_NAMES = new Set([
  "FixBodyGroup",
  "BigFixBodyGroup",
  "MapBodyGroup",
  "BigMapBodyGroup",
]);

/** Generic counters whose payload contains one or more enclosed frames. */
export const GENERIC_GROUP_NAMES = new Set([
  "GenericGroup",
  "BigGenericGroup",
]);

/** Domain-sensitive token size helper (qb64 vs qb2). */
export function tokenSize(
  token: { fullSize: number; fullSizeB2: number },
  cold: "txt" | "bny",
): number {
  return cold === "bny" ? token.fullSizeB2 : token.fullSize;
}

/** Domain-sensitive counter unit (quadlet count for txt, triplet count for bny). */
export function quadletUnit(cold: "txt" | "bny"): number {
  return cold === "bny" ? 3 : 4;
}

/** Attachment parsing domains supported by the parser. */
export function isAttachmentDomain(cold: string): cold is "txt" | "bny" {
  return cold === "txt" || cold === "bny";
}
