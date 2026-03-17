/** Shape shared by generated KERI codex objects (`name -> code`). */
export type KeriCodex = Readonly<Record<string, string>>;

/** Collect all codex code values as a set for validator membership checks. */
export function codexValues<T extends KeriCodex>(codex: T): Set<string> {
  return new Set(Object.values(codex));
}

/** Invert one generated codex to support `code -> name` projections. */
export function invertCodex<T extends KeriCodex>(
  codex: T,
): ReadonlyMap<T[keyof T], keyof T> {
  return new Map(
    Object.entries(codex).map(([name, code]) => [
      code as T[keyof T],
      name as keyof T,
    ]),
  );
}
