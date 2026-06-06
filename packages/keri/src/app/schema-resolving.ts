/**
 * Schema reference parsing and cache lookup.
 *
 * Current support:
 * - bare schema SAID
 * - `sad:{said}` references
 * - HTTP(S) OOBI URLs that must be resolved by `Oobiery`
 *
 * DID URL dereferencing is intentionally represented but not implemented yet.
 */
import type { Schemer } from "../core/scheming.ts";
import type { Habery } from "./habbing.ts";

export type SchemaReference =
  | { kind: "bare"; said: string }
  | { kind: "sad"; said: string }
  | { kind: "oobi"; url: string; said?: string }
  | { kind: "did"; url: string };

/** Parse one schema reference into the supported resolver contract. */
export function parseSchemaReference(reference: string): SchemaReference {
  if (reference.startsWith("sad:")) {
    return { kind: "sad", said: reference.slice("sad:".length) };
  }
  if (reference.startsWith("did:")) {
    return { kind: "did", url: reference };
  }
  if (reference.startsWith("http://") || reference.startsWith("https://")) {
    const parsed = new URL(reference);
    const parts = parsed.pathname.split("/").filter((part) => part.length > 0);
    const oobiIndex = parts.lastIndexOf("oobi");
    const said = oobiIndex >= 0 && oobiIndex + 2 === parts.length ? parts[oobiIndex + 1] : undefined;
    return { kind: "oobi", url: reference, said };
  }
  return { kind: "bare", said: reference };
}

/** Resolve a schema reference only from the local schema cache. */
export function resolveCachedSchema(
  hby: Habery,
  reference: string,
): Schemer | null {
  const parsed = parseSchemaReference(reference);
  if (parsed.kind === "did") {
    return null;
  }
  if (parsed.kind === "oobi") {
    return parsed.said ? hby.db.schema.get(parsed.said) : null;
  }
  return hby.db.schema.get(parsed.said);
}
