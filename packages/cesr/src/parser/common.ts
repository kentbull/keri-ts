import { CtrDexV2 } from "../tables/counter-codex.ts";
import type { Versionage } from "../tables/table-types.ts";

/** Default parser version context when no explicit selector is present. */
export const DEFAULT_GVRSN: Versionage = { major: 2, minor: 0 };

/** Counter code for stream or nested genus-version selector tokens. */
export const GENUS_VERSION_CODE = CtrDexV2.KERIACDCGenusVersion;

/** Counter names supported as frame starts in CESR-native domain. */
export const FRAME_STARTS = new Set([
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
export const FRAME_GROUPS = new Set([
  "BodyWithAttachmentGroup",
  "BigBodyWithAttachmentGroup",
]);

/** Non-native body counters whose payload is a texter-wrapped message body. */
export const WRAPPED_BODIES = new Set([
  "NonNativeBodyGroup",
  "BigNonNativeBodyGroup",
]);

/** Native body counters (fixed-field or map-body forms). */
export const NATIVE_BODIES = new Set([
  "FixBodyGroup",
  "BigFixBodyGroup",
  "MapBodyGroup",
  "BigMapBodyGroup",
]);

/** Generic counters whose payload contains one or more enclosed frames. */
export const FRAME_LISTS = new Set([
  "GenericGroup",
  "BigGenericGroup",
]);
