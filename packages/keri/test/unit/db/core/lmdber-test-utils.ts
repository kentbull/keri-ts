import { run } from "effection";
import { t } from "../../../../../cesr/mod.ts";
import type { LMDBer } from "../../../../src/db/core/lmdber.ts";
import { openLMDB } from "../../../../src/db/core/lmdber.ts";

/**
 * Helper function to make temporary LMDBer for a test.
 * @param label
 * @param fn
 */
export async function withTempLMDBer(
  label: string,
  fn: (lmdber: LMDBer) => void,
): Promise<void> {
  await run(function*() {
    const lmdber = yield* openLMDB({
      name: `${label}-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      fn(lmdber);
    } finally {
      yield* lmdber.close(true);
    }
  });
}

/**
 * Formats items in a human-readable way to support readable tests.
 * @param values bytearrays of values
 */
export function valuesAsText(values: Iterable<Uint8Array>): string[] {
  return [...values].map((value) => t(value));
}

/**
 * Formats items in a human-readable way to support readable tests.
 * @param items key/value byte arrays
 */
export function pairsAsText(
  items: Iterable<[Uint8Array, Uint8Array]>,
): string[] {
  return [...items].map(([key, value]) => `${t(key)}=${t(value)}`);
}

/**
 * Formats items in a human-readable way to support readable tests.
 * @param items key/value byte arrays and ordinal numbers
 */
export function onItemsAsText(
  items: Iterable<[Uint8Array, number, Uint8Array]>,
): string[] {
  return [...items].map(([key, on, value]) => `${t(key)}:${on}=${t(value)}`);
}
