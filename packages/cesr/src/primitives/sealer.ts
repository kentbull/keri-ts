import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import { CtrDexV1, CtrDexV2 } from "../tables/counter-codex.ts";
import { parseAttachmentDispatch } from "../parser/group-dispatch.ts";

const SEALER_CODES = new Set([
  CtrDexV1.SealSourceCouples,
  CtrDexV1.SealSourceTriples,
  CtrDexV2.SealSourceCouples,
  CtrDexV2.BigSealSourceCouples,
  CtrDexV2.SealSourceTriples,
  CtrDexV2.BigSealSourceTriples,
  CtrDexV2.SealSourceLastSingles,
  CtrDexV2.BigSealSourceLastSingles,
  CtrDexV2.DigestSealSingles,
  CtrDexV2.BigDigestSealSingles,
  CtrDexV2.MerkleRootSealSingles,
  CtrDexV2.BigMerkleRootSealSingles,
  CtrDexV2.BackerRegistrarSealCouples,
  CtrDexV2.BigBackerRegistrarSealCouples,
  CtrDexV2.TypedDigestSealCouples,
  CtrDexV2.BigTypedDigestSealCouples,
]);

export interface Sealer {
  code: string;
  name: string;
  count: number;
  items: unknown[];
  raw: Uint8Array;
  consumed: number;
}

export function parseSealer(
  input: Uint8Array,
  version: Versionage,
  cold: Extract<ColdCode, "txt" | "bny">,
): Sealer {
  const parsed = parseAttachmentDispatch(input, version, cold);
  if (!SEALER_CODES.has(parsed.group.code)) {
    throw new UnknownCodeError(`Expected sealer group code, got ${parsed.group.code}`);
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
