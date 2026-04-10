import { DISPLAY_VERSION as KERI_DISPLAY_VERSION } from "keri-ts/runtime";
import { DISPLAY_VERSION as TUFA_DISPLAY_VERSION } from "./version.ts";

/** One-line CLI version string for the published Tufa artifact. */
export function tufaCliVersionLine(): string {
  return `tufa ${TUFA_DISPLAY_VERSION} (keri-ts ${KERI_DISPLAY_VERSION})`;
}
