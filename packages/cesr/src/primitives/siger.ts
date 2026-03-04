import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { Indexer, type IndexerInit, parseIndexer } from "./indexer.ts";
import type { Verfer } from "./verfer.ts";

const SIGER_CODES = new Set([
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "0A",
  "0B",
  "2A",
  "2B",
  "2C",
  "2D",
  "2E",
  "2F",
  "3A",
  "3B",
]);

/**
 * Indexed signature primitive with optional verifier association.
 *
 * KERIpy substance: `Siger` extends indexed signature material and carries
 * optional `verfer` linkage so verification context can travel with signature.
 */
export class Siger extends Indexer {
  readonly verfer?: Verfer;

  constructor(init: Indexer | IndexerInit, verfer?: Verfer) {
    const indexer = init instanceof Indexer ? init : new Indexer(init);
    super(indexer);
    if (!SIGER_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected indexed signature code, got ${this.code}`,
      );
    }
    this.verfer = verfer;
  }
}

/** Parse and hydrate `Siger` from txt or qb2 encoded bytes. */
export function parseSiger(
  input: Uint8Array,
  cold: Extract<ColdCode, "txt" | "bny">,
): Siger {
  return new Siger(parseIndexer(input, cold));
}
