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
): DerivedWitnessSet | null {
  if (!hasUniqueEntries(cuts) || !hasUniqueEntries(adds)) {
    return null;
  }

  const cutset = new Set(cuts);
  const witset = new Set(currentWits);
  for (const cut of cuts) {
    if (!witset.has(cut)) {
      return null;
    }
  }

  const addset = new Set(adds);
  for (const cut of cuts) {
    if (addset.has(cut)) {
      return null;
    }
  }

  for (const add of adds) {
    if (witset.has(add)) {
      return null;
    }
  }

  const next = currentWits.filter((wit) => !cutset.has(wit));
  next.push(...adds);
  if (!hasUniqueEntries(next)) {
    return null;
  }

  return {
    wits: next,
    cuts: [...cuts],
    adds: [...adds],
  };
}
