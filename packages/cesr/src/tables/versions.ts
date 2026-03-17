import type { Versionage } from "./table-types.ts";

/** Canonical KERI/ACDC protocol version constant for v1.0 surfaces. */
export const Vrsn_1_0: Versionage = { major: 1, minor: 0 };
/** Canonical KERI/ACDC protocol version constant for v2.0 surfaces. */
export const Vrsn_2_0: Versionage = { major: 2, minor: 0 };

/** Supported wire-kind literals used by serder and parser layers. */
export const Kinds = {
  json: "JSON",
  cbor: "CBOR",
  mgpk: "MGPK",
  cesr: "CESR",
} as const;

/** Supported protocol literals used by version strings and serders. */
export const Protocols = {
  keri: "KERI",
  acdc: "ACDC",
} as const;

/** Union of supported wire-kind literal values. */
export type Kind = (typeof Kinds)[keyof typeof Kinds];
/** Union of supported protocol literal values. */
export type Protocol = (typeof Protocols)[keyof typeof Protocols];
