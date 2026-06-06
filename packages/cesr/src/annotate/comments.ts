import { resolveCounterCodeNameTable } from "../tables/counter-version-registry.ts";
import { COUNTER_CODE_NAMES_V1, COUNTER_CODE_NAMES_V2 } from "../tables/counter.tables.generated.ts";
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

/** Resolve a human-readable counter name against either known counter table. */
export function counterCodeName(code: string): string {
  const v2 = COUNTER_CODE_NAMES_V2[code as keyof typeof COUNTER_CODE_NAMES_V2];
  if (v2) return v2;
  const v1 = COUNTER_CODE_NAMES_V1[code as keyof typeof COUNTER_CODE_NAMES_V1];
  if (v1) return v1;
  return "Counter";
}

/** Resolve a counter name against the registry selected for one protocol version. */
export function counterCodeNameForVersion(
  code: string,
  version: Versionage,
): string {
  const table = resolveCounterCodeNameTable(version);
  return table[code] ?? "Counter";
}

/** Resolve a human-readable matter name from the generated matter code table. */
export function matterCodeName(code: string): string {
  return MATTER_CODE_NAMES[code as keyof typeof MATTER_CODE_NAMES] ?? "Matter";
}

/** Expand well-known native field labels for annotation comments when available. */
export function nativeLabelName(label: string | null): string | null {
  if (!label) return null;
  return NATIVE_FIELD_LABELS[label] ?? label;
}
