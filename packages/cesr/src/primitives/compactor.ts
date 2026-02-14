import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import { CtrDexV2 } from "../tables/counter-codex.ts";
import { type Mapper, parseMapperBody } from "./mapper.ts";

const COMPACTOR_CODES = new Set([
  CtrDexV2.MapBodyGroup,
  CtrDexV2.BigMapBodyGroup,
  CtrDexV2.GenericMapGroup,
  CtrDexV2.BigGenericMapGroup,
]);

export function parseCompactor(
  input: Uint8Array,
  version: Versionage,
  cold: Extract<ColdCode, "txt" | "bny">,
): Mapper {
  const mapper = parseMapperBody(input, version, cold);
  if (!COMPACTOR_CODES.has(mapper.code)) {
    throw new UnknownCodeError(
      `Expected map compactor group code, got ${mapper.code}`,
    );
  }
  return mapper;
}
