/** Matter table sizage entry: hard/soft/xtra/raw sizing semantics for one code. */
export interface Sizage {
  hs: number;
  ss: number;
  xs: number;
  fs: number | null;
  ls: number;
}

/** Counter table sizage entry for versioned counter headers. */
export interface Cizage {
  hs: number;
  ss: number;
  fs: number;
}

/** Indexer table sizage entry including other-index offset width. */
export interface Xizage {
  hs: number;
  ss: number;
  os: number;
  fs: number | null;
  ls: number;
}

/** Supported protocol major versions in handwritten CESR tables. */
export type VersionMajor = 1 | 2;
/** Minor version value carried through registry lookups and version tokens. */
export type VersionMinor = number;

/** Protocol version pair used across parser, serder, and registry seams. */
export interface Versionage {
  major: VersionMajor;
  minor: VersionMinor;
}
