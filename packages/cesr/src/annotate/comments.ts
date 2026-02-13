import {
  COUNTER_CODE_NAMES_V1,
  COUNTER_CODE_NAMES_V2,
} from "../tables/counter.tables.generated.ts";
import { MATTER_CODE_NAMES } from "../tables/matter.tables.generated.ts";
import type { Versionage } from "../tables/table-types.ts";

const NATIVE_FIELD_LABELS: Record<string, string> = Object.freeze({
  v: "version string",
  t: "ilk",
  d: "SAID",
  i: "AID prefix",
  s: "sequence number",
  p: "prior event digest",
  kt: "signing threshold",
  k: "current keys",
  nt: "next threshold",
  n: "next keys digest",
  bt: "witness threshold",
  b: "witness list",
  c: "traits/config",
  a: "anchors/data",
});

export function counterCodeName(code: string): string {
  const v2 = COUNTER_CODE_NAMES_V2[code as keyof typeof COUNTER_CODE_NAMES_V2];
  if (v2) return v2;
  const v1 = COUNTER_CODE_NAMES_V1[code as keyof typeof COUNTER_CODE_NAMES_V1];
  if (v1) return v1;
  return "Counter";
}

export function counterCodeNameForVersion(
  code: string,
  version: Versionage,
): string {
  if (version.major >= 2) {
    return COUNTER_CODE_NAMES_V2[code as keyof typeof COUNTER_CODE_NAMES_V2] ??
      "Counter";
  }
  return COUNTER_CODE_NAMES_V1[code as keyof typeof COUNTER_CODE_NAMES_V1] ??
    "Counter";
}

export function matterCodeName(code: string): string {
  return MATTER_CODE_NAMES[code as keyof typeof MATTER_CODE_NAMES] ?? "Matter";
}

export function nativeLabelName(label: string | null): string | null {
  if (!label) return null;
  return NATIVE_FIELD_LABELS[label] ?? label;
}
