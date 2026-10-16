import { Diger } from "cesr-ts";
import { type RegistrySealFields, VcStateRecord } from "../core/records.ts";
import { timestampMicros } from "../time/mod.ts";
import { qualifiedPrefix } from "./registry-tsn-record.ts";

/** Legacy storage ordinals are safe integers even though protocol numbers may be wider. */
function ordinal(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{1,14}$/i.test(value)
    && BigInt(`0x${value}`) <= BigInt(Number.MAX_SAFE_INTEGER);
}

/** Require the full qualified digest rather than accepting trailing bytes. */
function qualifiedDigest(value: unknown): value is string {
  try {
    return typeof value === "string" && new Diger({ qb64: value }).qb64 === value;
  } catch {
    return false;
  }
}

/** Accepted notice seals are either absent or complete, unlike raw TEL projections. */
type CredentialNotice = Required<VcStateRecord> & {
  ra: RegistrySealFields | { i?: never; s?: never; d?: never };
};

/** Validate unknown fields and construct an owned record without erasing its guarantees. */
export function credentialRecord(data: unknown): CredentialNotice | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (
    Object.keys(data).some((key) => !["vn", "i", "s", "d", "ri", "ra", "a", "dt", "et"].includes(key))
    || !("s" in data) || !ordinal(data.s)
    || !("et" in data) || (data.et !== "iss" && data.et !== "bis" && data.et !== "rev" && data.et !== "brv")
    || !("ri" in data) || !qualifiedPrefix(data.ri)
    || !("dt" in data) || typeof data.dt !== "string" || timestampMicros(data.dt) === null
    || !("i" in data) || !qualifiedDigest(data.i) || !("d" in data) || !qualifiedDigest(data.d)
    || !("vn" in data) || !Array.isArray(data.vn) || data.vn.length !== 2
    || !("a" in data) || !data.a || typeof data.a !== "object" || Array.isArray(data.a)
    || !("ra" in data) || !data.ra || typeof data.ra !== "object" || Array.isArray(data.ra)
  ) return null;
  const version: unknown[] = data.vn;
  const [major, minor] = version;
  const a = data.a, rawSeal = data.ra;
  if (
    typeof major !== "number" || !Number.isSafeInteger(major) || major < 0
    || typeof minor !== "number" || !Number.isSafeInteger(minor) || minor < 0
    || Object.keys(a).length !== 2 || !("s" in a) || typeof a.s !== "number"
    || !Number.isSafeInteger(a.s) || a.s < 0 || !("d" in a) || !qualifiedDigest(a.d)
  ) return null;
  let ra: CredentialNotice["ra"] = {};
  if (Object.keys(rawSeal).length) {
    if (
      Object.keys(rawSeal).length !== 3 || !("i" in rawSeal) || !qualifiedPrefix(rawSeal.i)
      || !("s" in rawSeal) || !ordinal(rawSeal.s) || !("d" in rawSeal) || !qualifiedDigest(rawSeal.d)
    ) return null;
    ra = { i: rawSeal.i, s: rawSeal.s, d: rawSeal.d };
  }
  return Object.assign(new VcStateRecord(), {
    vn: [major, minor],
    i: data.i,
    s: data.s,
    d: data.d,
    ri: data.ri,
    ra,
    a: { s: a.s, d: a.d },
    dt: data.dt,
    et: data.et,
  });
}
