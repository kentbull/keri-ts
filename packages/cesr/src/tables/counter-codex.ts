import {
  COUNTER_CODE_NAMES_V1,
  COUNTER_CODE_NAMES_V2,
} from "./counter.tables.generated.ts";

type NameByCode = Record<string, string>;

function invertCodeNames<T extends NameByCode>(
  map: T,
): Record<T[keyof T], string> {
  const out: Record<string, string> = {};
  for (const [code, name] of Object.entries(map)) {
    out[name] = code;
  }
  return Object.freeze(out) as Record<T[keyof T], string>;
}

export type CounterCodeNameV1 =
  (typeof COUNTER_CODE_NAMES_V1)[keyof typeof COUNTER_CODE_NAMES_V1];
export type CounterCodeNameV2 =
  (typeof COUNTER_CODE_NAMES_V2)[keyof typeof COUNTER_CODE_NAMES_V2];

export const CtrDexV1 = invertCodeNames(COUNTER_CODE_NAMES_V1);
export const CtrDexV2 = invertCodeNames(COUNTER_CODE_NAMES_V2);
