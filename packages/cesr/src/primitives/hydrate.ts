import type { ColdCode } from "../core/types.ts";
import {
  CIGAR_CODES,
  DATER_CODES,
  DECIMAL_CODES,
  NONCE_CODES,
  SIGER_CODES,
} from "./codex.ts";
import { Cigar } from "./cigar.ts";
import { Dater } from "./dater.ts";
import { Decimer } from "./decimer.ts";
import { Indexer, type IndexerInit, parseIndexer } from "./indexer.ts";
import { Matter, type MatterInit, parseMatter } from "./matter.ts";
import { Noncer } from "./noncer.ts";
import { Siger } from "./siger.ts";

/**
 * Hydrate one low-level `Matter` into the narrowest safe primitive class.
 *
 * Maintainer rule:
 * this is intentionally conservative, not aggressive. Many CESR codes are
 * semantically overloaded across families (`0A`, `B`, `E`, tag/label codes,
 * numeric threshold codes, etc.), so generic callers should only get an
 * automatic narrowing when the code family is genuinely unambiguous.
 */
export function hydrateMatter(init: Matter | MatterInit): Matter {
  const matter = init instanceof Matter ? init : new Matter(init);

  if (DECIMAL_CODES.has(matter.code)) {
    return new Decimer(matter);
  }
  if (DATER_CODES.has(matter.code)) {
    return new Dater(matter);
  }
  if (CIGAR_CODES.has(matter.code)) {
    return new Cigar(matter);
  }
  if (NONCE_CODES.has(matter.code)) {
    return new Noncer(matter);
  }

  return matter;
}

/** Parse one text/binary matter token and hydrate it through `hydrateMatter()`. */
export function parseQualifiedMatter(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Matter {
  return hydrateMatter(parseMatter(input, cold));
}

/** Hydrate one low-level `Indexer` into the narrowest safe primitive class. */
export function hydrateIndexer(init: Indexer | IndexerInit): Indexer {
  const indexer = init instanceof Indexer ? init : new Indexer(init);

  if (SIGER_CODES.has(indexer.code)) {
    return new Siger(indexer);
  }

  return indexer;
}

/** Parse one text/binary indexer token and hydrate it through `hydrateIndexer()`. */
export function parseQualifiedIndexer(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Indexer {
  return hydrateIndexer(parseIndexer(input, cold));
}
