import { VersionError } from "../core/errors.ts";
import {
  COUNTER_CODE_NAMES_V1,
  COUNTER_CODE_NAMES_V2,
  COUNTER_SIZES_V1,
  COUNTER_SIZES_V2,
} from "./counter.tables.generated.ts";
import { CtrDexV1, CtrDexV2 } from "./counter-codex.ts";
import type { Cizage, VersionMajor, Versionage } from "./table-types.ts";

/**
 * Minor-version keyed registry for one major CESR version family.
 *
 * Why this is `minor -> single T` (not `minor -> T[]`):
 * each `(major, minor)` identifies one authoritative registry snapshot.
 * Multiple values per minor would introduce ordering/precedence ambiguity.
 *
 * Example (`T = CounterCodex`):
 * {
 *   0: { GenericGroup: "-A", AttachmentGroup: "-C" },
 *   1: { GenericGroup: "-A", AttachmentGroup: "-C", NewCode: "-d" }
 * }
 */
export type MinorVersionRegistry<T> = Readonly<Record<number, T>>;
/**
 * Major+minor keyed CESR registry model.
 *
 * There is one `MinorVersionRegistry<T>` branch per major version.
 *
 * Example (`T = CounterCodex`):
 * {
 *   1: { 0: { GenericGroup: "-T" } },
 *   2: { 0: { GenericGroup: "-A" }, 1: { GenericGroup: "-A", NewCode: "-d" } }
 * }
 */
export type VersionedRegistry<T> = Readonly<
  Record<VersionMajor, MinorVersionRegistry<T>>
>;

/**
 * Canonical codex shape: symbolic names mapped to CESR counter codes.
 *
 * Example:
 * {
 *   GenericGroup: "-A",
 *   AttachmentGroup: "-C"
 * }
 */
export type CounterCodex = Readonly<Record<string, string>>;

/**
 * Resolution result for a requested major/minor against a versioned registry.
 *
 * Example:
 * {
 *   value: { GenericGroup: "-A", AttachmentGroup: "-C" },
 *   resolvedMajor: 2,
 *   resolvedMinor: 1,
 *   latestMinor: 1
 * }
 */
export interface VersionedResolution<T> {
  value: T;
  resolvedMajor: VersionMajor;
  resolvedMinor: number;
  latestMinor: number;
}

/** Immutable helper for selecting only named codex entries. */
function pickCodexEntries(
  codex: CounterCodex,
  names: readonly string[],
): CounterCodex {
  const out: Record<string, string> = {};
  for (const name of names) {
    const code = codex[name];
    if (!code) {
      throw new Error(`Missing codex entry ${name}`);
    }
    out[name] = code;
  }
  return Object.freeze(out);
}

/** Immutable helper for dropping named codex entries from a codex projection. */
function omitCodexEntries(
  codex: CounterCodex,
  omittedNames: readonly string[],
): CounterCodex {
  const omitted = new Set(omittedNames);
  const out: Record<string, string> = {};
  for (const [name, code] of Object.entries(codex)) {
    if (!omitted.has(name)) {
      out[name] = code;
    }
  }
  return Object.freeze(out);
}

/** Return sorted supported minors for one major registry branch. */
function supportedMinors<T>(registry: MinorVersionRegistry<T>): number[] {
  return Object.keys(registry) // minor versions
    .map((minor) => Number(minor))
    .sort((a, b) => a - b);
}

/**
 * Resolve a major/minor request to the latest supported compatible minor.
 *
 * Semantics match KERIpy parser/codex selection:
 * - major must be supported
 * - requested minor must not exceed latest supported minor for that major
 * - selected value binds to latest supported minor for the major
 */
export function resolveVersionedRegistryValue<T>(
  registry: VersionedRegistry<T>,
  version: Versionage,
  label = "versioned registry",
): VersionedResolution<T> {
  const byMinor = registry[version.major];
  if (!byMinor) {
    throw new VersionError(
      `Unsupported ${label} major version ${version.major}`,
    );
  }

  const minors = supportedMinors(byMinor);
  if (minors.length === 0) {
    throw new VersionError(
      `No supported minors configured for ${label} major ${version.major}`,
    );
  }

  const latestMinor = minors[minors.length - 1] ?? 0;
  if (version.minor > latestMinor) {
    throw new VersionError(
      `Unsupported ${label} minor version ${version.major}.${version.minor}; latest supported is ${version.major}.${latestMinor}`,
    );
  }

  const value = byMinor[latestMinor];
  if (!value) {
    throw new VersionError(
      `Missing ${label} value for ${version.major}.${latestMinor}`,
    );
  }

  return {
    value,
    resolvedMajor: version.major,
    resolvedMinor: latestMinor,
    latestMinor,
  };
}

const CtrDex_1_0 = omitCodexEntries(CtrDexV1, [
  "SadPathSig",
  "SadPathSigGroup",
]);
const CtrDex_2_0 = Object.freeze({ ...CtrDexV2 });

const UniDex_1_0 = pickCodexEntries(CtrDex_1_0, [
  "GenericGroup",
  "BigGenericGroup",
  "BodyWithAttachmentGroup",
  "BigBodyWithAttachmentGroup",
  "AttachmentGroup",
  "BigAttachmentGroup",
  "NonNativeBodyGroup",
  "BigNonNativeBodyGroup",
  "KERIACDCGenusVersion",
]);
const UniDex_2_0 = pickCodexEntries(CtrDex_2_0, [
  "GenericGroup",
  "BigGenericGroup",
  "BodyWithAttachmentGroup",
  "BigBodyWithAttachmentGroup",
  "AttachmentGroup",
  "BigAttachmentGroup",
  "DatagramSegmentGroup",
  "BigDatagramSegmentGroup",
  "ESSRWrapperGroup",
  "BigESSRWrapperGroup",
  "FixBodyGroup",
  "BigFixBodyGroup",
  "MapBodyGroup",
  "BigMapBodyGroup",
  "NonNativeBodyGroup",
  "BigNonNativeBodyGroup",
  "GenericMapGroup",
  "BigGenericMapGroup",
  "GenericListGroup",
  "BigGenericListGroup",
  "KERIACDCGenusVersion",
]);

const SUDex_1_0 = pickCodexEntries(UniDex_1_0, [
  "GenericGroup",
  "BigGenericGroup",
  "BodyWithAttachmentGroup",
  "BigBodyWithAttachmentGroup",
  "AttachmentGroup",
  "BigAttachmentGroup",
]);
const SUDex_2_0 = pickCodexEntries(UniDex_2_0, [
  "GenericGroup",
  "BigGenericGroup",
  "BodyWithAttachmentGroup",
  "BigBodyWithAttachmentGroup",
  "AttachmentGroup",
  "BigAttachmentGroup",
]);

const MUDex_1_0 = pickCodexEntries(UniDex_1_0, [
  "NonNativeBodyGroup",
  "BigNonNativeBodyGroup",
]);
const MUDex_2_0 = pickCodexEntries(UniDex_2_0, [
  "DatagramSegmentGroup",
  "BigDatagramSegmentGroup",
  "ESSRWrapperGroup",
  "BigESSRWrapperGroup",
  "FixBodyGroup",
  "BigFixBodyGroup",
  "MapBodyGroup",
  "BigMapBodyGroup",
  "NonNativeBodyGroup",
  "BigNonNativeBodyGroup",
]);

/** Versioned counter codex registry analogous to KERIpy `Codes`. */
export const CtrDexByVersion: VersionedRegistry<CounterCodex> = Object.freeze({
  1: Object.freeze({ 0: CtrDex_1_0 }),
  2: Object.freeze({ 0: CtrDex_2_0 }),
});

/** Versioned universal codex registry analogous to KERIpy `UniDex`. */
export const UniDexByVersion: VersionedRegistry<CounterCodex> = Object.freeze({
  1: Object.freeze({ 0: UniDex_1_0 }),
  2: Object.freeze({ 0: UniDex_2_0 }),
});

/** Versioned special-universal codex registry analogous to KERIpy `SUDex`. */
export const SUDexByVersion: VersionedRegistry<CounterCodex> = Object.freeze({
  1: Object.freeze({ 0: SUDex_1_0 }),
  2: Object.freeze({ 0: SUDex_2_0 }),
});

/** Versioned message-universal codex registry analogous to KERIpy `MUDex`. */
export const MUDexByVersion: VersionedRegistry<CounterCodex> = Object.freeze({
  1: Object.freeze({ 0: MUDex_1_0 }),
  2: Object.freeze({ 0: MUDex_2_0 }),
});

/** Generated counter size tables indexed by major/minor for parser primitives. */
export const COUNTER_SIZE_TABLES_BY_VERSION: VersionedRegistry<
  ReadonlyMap<string, Cizage>
> = Object.freeze({
  1: Object.freeze({ 0: COUNTER_SIZES_V1 }),
  2: Object.freeze({ 0: COUNTER_SIZES_V2 }),
});

/** Generated code-name tables indexed by major/minor for annotation/comments. */
export const COUNTER_CODE_NAMES_BY_VERSION: VersionedRegistry<
  Readonly<Record<string, string>>
> = Object.freeze({
  1: Object.freeze({ 0: COUNTER_CODE_NAMES_V1 }),
  2: Object.freeze({ 0: COUNTER_CODE_NAMES_V2 }),
});

/** Explicit compatibility-only alias codes retained for interop continuity. */
export const LEGACY_COMPAT_COUNTER_CODES_BY_VERSION: VersionedRegistry<
  ReadonlySet<string>
> = Object.freeze({
  1: Object.freeze({
    0: new Set<string>([
      CtrDexV1.SadPathSig,
      CtrDexV1.SadPathSigGroup,
    ]),
  }),
  2: Object.freeze({
    0: new Set<string>(),
  }),
});

/** Resolve counter codex for a stream version using latest compatible minor. */
export function resolveCtrDex(version: Versionage): CounterCodex {
  return resolveVersionedRegistryValue(
    CtrDexByVersion,
    version,
    "counter codex",
  ).value;
}

/** Resolve universal codex for a stream version using latest compatible minor. */
export function resolveUniDex(version: Versionage): CounterCodex {
  return resolveVersionedRegistryValue(
    UniDexByVersion,
    version,
    "universal codex",
  ).value;
}

/** Resolve special-universal codex for a stream version. */
export function resolveSUDex(version: Versionage): CounterCodex {
  return resolveVersionedRegistryValue(
    SUDexByVersion,
    version,
    "special-universal codex",
  ).value;
}

/** Resolve message-universal codex for a stream version. */
export function resolveMUDex(version: Versionage): CounterCodex {
  return resolveVersionedRegistryValue(
    MUDexByVersion,
    version,
    "message-universal codex",
  ).value;
}

/** Resolve generated counter size table for a stream version. */
export function resolveCounterSizeTable(
  version: Versionage,
): ReadonlyMap<string, Cizage> {
  return resolveVersionedRegistryValue(
    COUNTER_SIZE_TABLES_BY_VERSION,
    version,
    "counter size table",
  ).value;
}

/** Resolve generated counter name table for a stream version. */
export function resolveCounterCodeNameTable(
  version: Versionage,
): Readonly<Record<string, string>> {
  return resolveVersionedRegistryValue(
    COUNTER_CODE_NAMES_BY_VERSION,
    version,
    "counter code-name table",
  ).value;
}
