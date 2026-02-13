export interface Sizage {
  hs: number;
  ss: number;
  xs: number;
  fs: number | null;
  ls: number;
}

export interface Cizage {
  hs: number;
  ss: number;
  fs: number;
}

export type VersionMajor = 1 | 2;
export type VersionMinor = number;

export interface Versionage {
  major: VersionMajor;
  minor: VersionMinor;
}
