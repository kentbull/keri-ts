export type KeriCodex = Readonly<Record<string, string>>;

export function codexValues<T extends KeriCodex>(codex: T): Set<string> {
  return new Set(Object.values(codex));
}

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
