import { CtrDexV1, CtrDexV2 } from "./counter-codex.ts";

/**
 * Shared semantic counter families for structor/native-body helpers.
 *
 * These are grouped readability views over the counter codex, not another
 * authority for code ownership.
 */
export const AGGOR_LIST_CODES = new Set<string>([
  CtrDexV2.GenericGroup,
  CtrDexV2.BigGenericGroup,
  CtrDexV2.GenericListGroup,
  CtrDexV2.BigGenericListGroup,
]);

export const AGGOR_MAP_CODES = new Set<string>([
  CtrDexV2.MapBodyGroup,
  CtrDexV2.BigMapBodyGroup,
  CtrDexV2.GenericMapGroup,
  CtrDexV2.BigGenericMapGroup,
]);

export const AGGOR_CODES = new Set<string>([
  ...AGGOR_LIST_CODES,
  ...AGGOR_MAP_CODES,
]);

export const COMPACTOR_CODES = AGGOR_MAP_CODES;

export const SEALER_CODES = new Set<string>([
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

export const MEDIAR_CODES = new Set<string>([
  CtrDexV2.TypedMediaQuadruples,
  CtrDexV2.BigTypedMediaQuadruples,
]);

export const BLINDER_CODES = new Set<string>([
  CtrDexV2.BlindedStateQuadruples,
  CtrDexV2.BigBlindedStateQuadruples,
  CtrDexV2.BoundStateSextuples,
  CtrDexV2.BigBoundStateSextuples,
]);
