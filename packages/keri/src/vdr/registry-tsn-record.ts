import { Diger, Prefixer } from "cesr-ts";
import { RegStateRecord } from "../core/records.ts";
import { timestampMicros } from "../time/mod.ts";

/** Require the entire qualified prefix, not a valid prefix followed by untrusted suffix bytes. */
export function qualifiedPrefix(value: unknown): value is string {
  try {
    return typeof value === "string" && new Prefixer({ qb64: value }).qb64 === value;
  } catch {
    return false;
  }
}

/** Validate unknown notice fields and return the existing record with every field required. */
export function registryRecord(data: unknown): Required<RegStateRecord> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (
    Object.keys(data).some((key) => !["vn", "i", "s", "d", "ii", "dt", "et", "bt", "b", "c"].includes(key))
    || !("i" in data) || !qualifiedPrefix(data.i) || !("ii" in data) || !qualifiedPrefix(data.ii)
    || !("s" in data) || typeof data.s !== "string" || !/^[0-9a-f]{1,14}$/i.test(data.s)
    || BigInt(`0x${data.s}`) > BigInt(Number.MAX_SAFE_INTEGER)
    || !("bt" in data) || typeof data.bt !== "string" || !/^[0-9a-f]{1,14}$/i.test(data.bt)
    || !("et" in data) || (data.et !== "vcp" && data.et !== "vrt")
    || !("dt" in data) || typeof data.dt !== "string" || timestampMicros(data.dt) === null
    || !("vn" in data) || !Array.isArray(data.vn) || data.vn.length !== 2
    || !("b" in data) || !Array.isArray(data.b) || !("c" in data) || !Array.isArray(data.c)
    || !("d" in data) || typeof data.d !== "string"
  ) return null;
  // Array.isArray erases item types; narrow untrusted elements before constructing owned projections.
  const version: unknown[] = data.vn, backers: unknown[] = data.b, config: unknown[] = data.c;
  const [major, minor] = version;
  if (
    typeof major !== "number" || !Number.isSafeInteger(major) || major < 0
    || typeof minor !== "number" || !Number.isSafeInteger(minor) || minor < 0
    || !backers.every(qualifiedPrefix) || !config.every((item) => typeof item === "string")
  ) return null;
  try {
    if (new Diger({ qb64: data.d }).qb64 !== data.d) return null;
  } catch {
    return null;
  }
  // Keep required-field types while constructing the existing record; these arrays are fresh owned copies.
  return Object.assign(new RegStateRecord(), {
    vn: [major, minor],
    i: data.i,
    s: data.s,
    d: data.d,
    ii: data.ii,
    dt: data.dt,
    et: data.et,
    bt: data.bt,
    b: [...backers],
    c: [...config],
  });
}
