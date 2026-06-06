/**
 * Source-owned hard-code size tables used by generated CESR lookup modules.
 *
 * KERIpy derives these ranges procedurally rather than listing them alongside
 * the generated size/name dictionaries. Keeping them here avoids embedding
 * static table literals inside the generator while preserving the public
 * generated-module exports.
 */

/** Hard-code byte counts for Matter derivation code prefixes. */
export const MATTER_HARDS = new Map<string, number>([
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => [c, 1] as [string, number]),
  ..."abcdefghijklmnopqrstuvwxyz".split("").map((c) => [c, 1] as [string, number]),
  ["0", 2],
  ["1", 4],
  ["2", 4],
  ["3", 4],
  ["4", 2],
  ["5", 2],
  ["6", 2],
  ["7", 4],
  ["8", 4],
  ["9", 4],
]);

/** Hard-code byte counts for Indexer derivation code prefixes. */
export const INDEXER_HARDS = new Map<string, number>([
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => [c, 1] as [string, number]),
  ..."abcdefghijklmnopqrstuvwxyz".split("").map((c) => [c, 1] as [string, number]),
  ["0", 2],
  ["1", 2],
  ["2", 2],
  ["3", 2],
  ["4", 2],
]);

/** Hard-code byte counts for Counter code prefixes. */
export const COUNTER_HARDS = new Map<string, number>([
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("").map((c) => [`-${c}`, 2] as [string, number]),
  ["--", 3],
  ["-_", 5],
]);
