import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import { COMPACTOR_CODES } from "../tables/counter-groups.ts";
import { type Mapper, parseMapperBody } from "./mapper.ts";

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
