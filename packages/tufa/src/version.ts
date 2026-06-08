/**
 * Template used by scripts/generate_versions.ts for package version modules.
 *
 * The generator token-replaces the string placeholders below, then formats and
 * compares the rendered output during version checks. Do not edit generated
 * `src/version.ts` files by hand; edit this template instead.
 */
/** Package semantic version copied from the owning package manifest. */
export const PACKAGE_VERSION = "0.9.0";
/** Optional build metadata stamp injected by release/CI workflows. */
export const BUILD_METADATA = "";
/** User-facing version string with build metadata appended when present. */
export const DISPLAY_VERSION = BUILD_METADATA
  ? `${PACKAGE_VERSION}+${BUILD_METADATA}`
  : PACKAGE_VERSION;
