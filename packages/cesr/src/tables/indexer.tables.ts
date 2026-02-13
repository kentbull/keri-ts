import type { ColdCode } from "../core/types.ts";

export interface Xizage {
  hs: number;
  ss: number;
  os: number;
  fs: number | null;
  ls: number;
}

const INDEXER_HARDS_ENTRIES: Array<[string, number]> = [];
for (let i = 65; i < 65 + 26; i++) {
  INDEXER_HARDS_ENTRIES.push([String.fromCharCode(i), 1]);
}
for (let i = 97; i < 97 + 26; i++) {
  INDEXER_HARDS_ENTRIES.push([String.fromCharCode(i), 1]);
}
INDEXER_HARDS_ENTRIES.push(["0", 2], ["1", 2], ["2", 2], ["3", 2], ["4", 2]);

export const INDEXER_HARDS = new Map<string, number>(INDEXER_HARDS_ENTRIES);

export const INDEXER_SIZES = new Map<string, Xizage>([
  ["A", { hs: 1, ss: 1, os: 0, fs: 88, ls: 0 }],
  ["B", { hs: 1, ss: 1, os: 0, fs: 88, ls: 0 }],
  ["C", { hs: 1, ss: 1, os: 0, fs: 88, ls: 0 }],
  ["D", { hs: 1, ss: 1, os: 0, fs: 88, ls: 0 }],
  ["E", { hs: 1, ss: 1, os: 0, fs: 88, ls: 0 }],
  ["F", { hs: 1, ss: 1, os: 0, fs: 88, ls: 0 }],
  ["0A", { hs: 2, ss: 2, os: 1, fs: 156, ls: 0 }],
  ["0B", { hs: 2, ss: 2, os: 1, fs: 156, ls: 0 }],
  ["2A", { hs: 2, ss: 4, os: 2, fs: 92, ls: 0 }],
  ["2B", { hs: 2, ss: 4, os: 2, fs: 92, ls: 0 }],
  ["2C", { hs: 2, ss: 4, os: 2, fs: 92, ls: 0 }],
  ["2D", { hs: 2, ss: 4, os: 2, fs: 92, ls: 0 }],
  ["2E", { hs: 2, ss: 4, os: 2, fs: 92, ls: 0 }],
  ["2F", { hs: 2, ss: 4, os: 2, fs: 92, ls: 0 }],
  ["3A", { hs: 2, ss: 6, os: 3, fs: 160, ls: 0 }],
  ["3B", { hs: 2, ss: 6, os: 3, fs: 160, ls: 0 }],
  ["0z", { hs: 2, ss: 2, os: 0, fs: null, ls: 0 }],
  ["1z", { hs: 2, ss: 2, os: 1, fs: 76, ls: 1 }],
  ["4z", { hs: 2, ss: 6, os: 3, fs: 80, ls: 1 }],
]);

export type ParseDomain = Extract<ColdCode, "txt" | "bny">;
