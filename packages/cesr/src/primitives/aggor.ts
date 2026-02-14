import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import { CtrDexV2 } from "../tables/counter-codex.ts";
import { parseAttachmentDispatch } from "../parser/group-dispatch.ts";
import { parseCompactor } from "./compactor.ts";
import { parseCounter } from "./counter.ts";
import type { MapperField } from "./mapper.ts";

const AGGOR_LIST_CODES = new Set([
  CtrDexV2.GenericGroup,
  CtrDexV2.BigGenericGroup,
  CtrDexV2.GenericListGroup,
  CtrDexV2.BigGenericListGroup,
]);

const AGGOR_MAP_CODES = new Set([
  CtrDexV2.MapBodyGroup,
  CtrDexV2.BigMapBodyGroup,
  CtrDexV2.GenericMapGroup,
  CtrDexV2.BigGenericMapGroup,
]);

export interface Aggor {
  code: string;
  count: number;
  kind: "list" | "map";
  listItems?: unknown[];
  mapFields?: MapperField[];
  consumed: number;
}

export function parseAggor(
  input: Uint8Array,
  version: Versionage,
  cold: Extract<ColdCode, "txt" | "bny">,
): Aggor {
  const counter = parseCounter(input, version, cold);
  if (AGGOR_MAP_CODES.has(counter.code)) {
    const map = parseCompactor(input, version, cold);
    return {
      code: map.code,
      count: map.count,
      kind: "map",
      mapFields: map.fields,
      consumed: cold === "bny" ? map.totalSizeB2 : map.totalSize,
    };
  }

  if (AGGOR_LIST_CODES.has(counter.code)) {
    const parsed = parseAttachmentDispatch(input, version, cold);
    return {
      code: parsed.group.code,
      count: parsed.group.count,
      kind: "list",
      listItems: parsed.group.items,
      consumed: parsed.consumed,
    };
  }

  throw new UnknownCodeError(
    `Expected aggregate list/map group code, got ${counter.code}`,
  );
}
