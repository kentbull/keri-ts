function hasUniqueEntries(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/** Return true when one witness/backer list contains no duplicate entries. */
export function hasUniqueWitnesses(wits: readonly string[]): boolean {
  return hasUniqueEntries(wits);
}

export interface DerivedWitnessSet {
  wits: string[];
  cuts: string[];
  adds: string[];
}

export type WitnessSetValidationReason =
  | "duplicateCuts"
  | "cutsNotSubsetOfWitnesses"
  | "duplicateAdds"
  | "intersectingCutsAndAdds"
  | "intersectingWitnessesAndAdds"
  | "invalidWitnessSet";

export type DerivedWitnessSetDecision =
  | { kind: "accept"; value: DerivedWitnessSet }
  | { kind: "reject"; reason: WitnessSetValidationReason };

/**
 * Derive the next ordered witness list from one rotation's cuts and adds.
 *
 * KERIpy correspondence:
 * - mirrors the ordered witness-set math used by `deriveBacks()` and
 *   `_processEscrowFindUnver()`
 *
 * Validation rules:
 * - cuts must be unique and all present in the current witness list
 * - adds must be unique and disjoint from both cuts and existing witnesses
 * - the resulting witness list must remain duplicate-free so indexed witness
 *   signatures keep one unambiguous position
 */
export function deriveRotatedWitnessSet(
  currentWits: readonly string[],
  cuts: readonly string[],
  adds: readonly string[],
): DerivedWitnessSetDecision {
  if (!hasUniqueEntries(cuts)) {
    return { kind: "reject", reason: "duplicateCuts" };
  }
  if (!hasUniqueEntries(adds)) {
    return { kind: "reject", reason: "duplicateAdds" };
  }

  const cutset = new Set(cuts);
  const witset = new Set(currentWits);
  for (const cut of cuts) {
    if (!witset.has(cut)) {
      return { kind: "reject", reason: "cutsNotSubsetOfWitnesses" };
    }
  }

  const addset = new Set(adds);
  for (const cut of cuts) {
    if (addset.has(cut)) {
      return { kind: "reject", reason: "intersectingCutsAndAdds" };
    }
  }

  for (const add of adds) {
    if (witset.has(add)) {
      return { kind: "reject", reason: "intersectingWitnessesAndAdds" };
    }
  }

  const next = currentWits.filter((wit) => !cutset.has(wit));
  next.push(...adds);
  if (!hasUniqueEntries(next)) {
    return { kind: "reject", reason: "invalidWitnessSet" };
  }

  return {
    kind: "accept",
    value: {
      wits: next,
      cuts: [...cuts],
      adds: [...adds],
    },
  };
}
