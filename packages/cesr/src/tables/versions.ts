import type { Versionage } from "./table-types.ts";

export const Vrsn_1_0: Versionage = { major: 1, minor: 0 };
export const Vrsn_2_0: Versionage = { major: 2, minor: 0 };

export const Kinds = {
  json: "JSON",
  cbor: "CBOR",
  mgpk: "MGPK",
  cesr: "CESR",
} as const;

export const Protocols = {
  keri: "KERI",
  acdc: "ACDC",
} as const;

export type Kind = (typeof Kinds)[keyof typeof Kinds];
export type Protocol = (typeof Protocols)[keyof typeof Protocols];
