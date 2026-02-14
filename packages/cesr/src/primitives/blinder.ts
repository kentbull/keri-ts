import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import { CtrDexV2 } from "../tables/counter-codex.ts";
import { parseAttachmentDispatch } from "../parser/group-dispatch.ts";

const BLINDER_CODES = new Set([
  CtrDexV2.BlindedStateQuadruples,
  CtrDexV2.BigBlindedStateQuadruples,
  CtrDexV2.BoundStateSextuples,
  CtrDexV2.BigBoundStateSextuples,
]);

export interface Blinder {
  code: string;
  name: string;
  count: number;
  items: unknown[];
  raw: Uint8Array;
  consumed: number;
}

export function parseBlinder(
  input: Uint8Array,
  version: Versionage,
  cold: Extract<ColdCode, "txt" | "bny">,
): Blinder {
  const parsed = parseAttachmentDispatch(input, version, cold);
  if (!BLINDER_CODES.has(parsed.group.code)) {
    throw new UnknownCodeError(
      `Expected blinder group code, got ${parsed.group.code}`,
    );
  }
  return {
    code: parsed.group.code,
    name: parsed.group.name,
    count: parsed.group.count,
    items: parsed.group.items,
    raw: parsed.group.raw,
    consumed: parsed.consumed,
  };
}
