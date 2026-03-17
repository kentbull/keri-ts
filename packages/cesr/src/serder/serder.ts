import { decode as decodeMsgpack, encode as encodeMsgpack } from "@msgpack/msgpack";
import { b, t } from "../core/bytes.ts";
import { decodeKeriCbor, encodeKeriCbor } from "../core/cbor.ts";
import { DeserializeError, SerializeError } from "../core/errors.ts";
import type { CesrBody, CesrMessage, Smellage } from "../core/types.ts";
import { Aggor, isAggorCode } from "../primitives/aggor.ts";
import { Blinder, isBlinderCode } from "../primitives/blinder.ts";
import {
  DigDex,
  DIGEST_CODES,
  NON_DIGEST_PREFIX_CODES,
  NON_TRANSFERABLE_PREFIX_CODES,
  PREFIX_CODES,
} from "../primitives/codex.ts";
import { Diger } from "../primitives/diger.ts";
import { Matter } from "../primitives/matter.ts";
import { isMediarCode, Mediar } from "../primitives/mediar.ts";
import { Prefixer } from "../primitives/prefixer.ts";
import {
  type CounterGroupLike,
  type GroupEntry,
  isCounterGroupLike,
  isPrimitiveTuple,
} from "../primitives/primitive.ts";
import { Saider } from "../primitives/saider.ts";
import { isSealerCode, Sealer } from "../primitives/sealer.ts";
import { Verfer } from "../primitives/verfer.ts";
import type { Versionage } from "../tables/table-types.ts";
import { type Kind, Protocols, Vrsn_1_0, Vrsn_2_0 } from "../tables/versions.ts";
import type { Protocol } from "../tables/versions.ts";
import { dumpCesrNativeSad, parseCesrNativeKed } from "./native.ts";
import { smell, versify } from "./smell.ts";

type SadMap = Record<string, unknown>;
type SaidCodeMap = Record<string, string>;

interface FieldDom {
  alls: SadMap;
  opts?: SadMap;
  alts?: Record<string, string>;
  saids?: SaidCodeMap;
  strict?: boolean;
}

type FieldMap = Record<string, FieldDom>;
type ProtocolFieldMap = Record<string, FieldMap>;
type FieldRegistry = Record<Protocol, ProtocolFieldMap>;

function versionKey(version: Versionage): string {
  return `${version.major}.${version.minor}`;
}

function cloneDefault<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneDefault(entry)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, cloneDefault(v)]),
    ) as T;
  }
  return value;
}

function normalizeDecodedMap(
  value: unknown,
  kind: "JSON" | "CBOR" | "MGPK" | "CESR",
): SadMap {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value instanceof Map) {
      const out: SadMap = {};
      for (const [k, v] of value.entries()) {
        if (typeof k !== "string") {
          throw new DeserializeError(`${kind} map key must be a string`);
        }
        out[k] = v;
      }
      return out;
    }
    return value as SadMap;
  }
  throw new DeserializeError(`${kind} root must be a map/object`);
}

/**
 * Serialize one KERI/ACDC body using the requested wire kind.
 *
 * Mirrors KERIpy's `dumps()` helper: this is a format utility, not a `Serder`
 * instance method, so upper layers can size or saidify SADs before they have a
 * body object.
 */
export function dumps(
  ked: Record<string, unknown> | unknown[],
  kind: Kind,
): Uint8Array {
  if (kind === "JSON") {
    return b(JSON.stringify(ked));
  }
  if (kind === "MGPK") {
    return encodeMsgpack(ked);
  }
  if (kind === "CBOR") {
    return encodeKeriCbor(ked);
  }
  if (kind === "CESR") {
    if (!ked || typeof ked !== "object" || Array.isArray(ked)) {
      throw new SerializeError("CESR native body must be a map/object");
    }
    // Native emit is factored out so `Serder`, `Serdery`, and parser-native
    // hydration all share one CESR-native serialization contract.
    return dumpCesrNativeSad(ked as Record<string, unknown>);
  }
  throw new SerializeError(`Unsupported serialization kind: ${kind}`);
}

/**
 * Measure one versioned SAD and rewrite its embedded version string size.
 *
 * Mirrors KERIpy's `sizeify()` utility closely enough for local parity work:
 * callers provide a mutable SAD carrying a `v` field, optionally override the
 * serialization kind, and receive the updated raw bytes plus parsed version
 * metadata.
 */
export function sizeify(
  ked: Record<string, unknown>,
  kind?: Kind,
): {
  raw: Uint8Array;
  proto: Smellage["proto"];
  kind: Kind;
  ked: Record<string, unknown>;
  pvrsn: Smellage["pvrsn"];
  gvrsn: Smellage["gvrsn"];
} {
  if (typeof ked.v !== "string" || ked.v.length === 0) {
    throw new SerializeError("Missing or empty version string in SAD");
  }

  const { smellage } = (() => {
    try {
      return {
        smellage: parseVersionString(ked.v),
      };
    } catch (error) {
      throw new SerializeError(
        `Invalid version string in SAD: ${ked.v}`,
        undefined,
        error instanceof Error ? error.message : undefined,
      );
    }
  })();

  const actualKind = kind ?? smellage.kind;
  let raw = dumps(ked, actualKind);
  const size = raw.length;
  const vs = versify({
    proto: smellage.proto,
    pvrsn: smellage.pvrsn,
    gvrsn: smellage.gvrsn,
    kind: actualKind,
    size,
  });
  ked.v = vs;
  raw = dumps(ked, actualKind);

  if (raw.length !== size) {
    throw new SerializeError(`Malformed version string size for ${vs}`);
  }

  return {
    raw,
    proto: smellage.proto,
    kind: actualKind,
    ked,
    pvrsn: smellage.pvrsn,
    gvrsn: smellage.gvrsn,
  };
}

function parseVersionString(vs: string): Smellage {
  return smell(b(vs)).smellage;
}

function versionFields(
  entries: FieldMap,
): FieldMap {
  return Object.fromEntries(
    Object.entries(entries).map(([ilk, dom]) => [
      ilk,
      {
        alls: (dom as FieldDom).alls,
        opts: (dom as FieldDom).opts ?? {},
        alts: (dom as FieldDom).alts ?? {},
        saids: (dom as FieldDom).saids ?? {},
        strict: (dom as FieldDom).strict ?? true,
      },
    ]),
  );
}

const FIELDS: FieldRegistry = {
  [Protocols.keri]: {
    [versionKey(Vrsn_1_0)]: versionFields({
      icp: {
        alls: {
          v: "",
          t: "",
          d: "",
          i: "",
          s: "0",
          kt: "0",
          k: [],
          nt: "0",
          n: [],
          bt: "0",
          b: [],
          c: [],
          a: [],
        },
        saids: { d: DigDex.Blake3_256, i: DigDex.Blake3_256 },
      },
      rot: {
        alls: {
          v: "",
          t: "",
          d: "",
          i: "",
          s: "0",
          p: "",
          kt: "0",
          k: [],
          nt: "0",
          n: [],
          bt: "0",
          br: [],
          ba: [],
          a: [],
        },
        saids: { d: DigDex.Blake3_256 },
      },
      ixn: {
        alls: { v: "", t: "", d: "", i: "", s: "0", p: "", a: [] },
        saids: { d: DigDex.Blake3_256 },
      },
      dip: {
        alls: {
          v: "",
          t: "",
          d: "",
          i: "",
          s: "0",
          kt: "0",
          k: [],
          nt: "0",
          n: [],
          bt: "0",
          b: [],
          c: [],
          a: [],
          di: "",
        },
        saids: { d: DigDex.Blake3_256, i: DigDex.Blake3_256 },
      },
      drt: {
        alls: {
          v: "",
          t: "",
          d: "",
          i: "",
          s: "0",
          p: "",
          kt: "0",
          k: [],
          nt: "0",
          n: [],
          bt: "0",
          br: [],
          ba: [],
          a: [],
        },
        saids: { d: DigDex.Blake3_256 },
      },
      rct: { alls: { v: "", t: "", d: "", i: "", s: "0" } },
      qry: {
        alls: { v: "", t: "", d: "", dt: "", r: "", rr: "", q: {} },
        saids: { d: DigDex.Blake3_256 },
      },
      rpy: {
        alls: { v: "", t: "", d: "", dt: "", r: "", a: [] },
        saids: { d: DigDex.Blake3_256 },
      },
      pro: {
        alls: { v: "", t: "", d: "", dt: "", r: "", rr: "", q: {} },
        saids: { d: DigDex.Blake3_256 },
      },
      bar: {
        alls: { v: "", t: "", d: "", dt: "", r: "", a: [] },
        saids: { d: DigDex.Blake3_256 },
      },
      exn: {
        alls: { v: "", t: "", d: "", i: "", rp: "", p: "", dt: "", r: "", q: {}, a: [], e: {} },
        saids: { d: DigDex.Blake3_256 },
      },
      vcp: {
        alls: { v: "", t: "", d: "", i: "", ii: "", s: "0", c: [], bt: "0", b: [], n: "" },
        saids: { d: DigDex.Blake3_256, i: DigDex.Blake3_256 },
      },
      vrt: {
        alls: { v: "", t: "", d: "", i: "", p: "", s: "0", bt: "0", br: [], ba: [] },
        saids: { d: DigDex.Blake3_256 },
      },
      iss: {
        alls: { v: "", t: "", d: "", i: "", s: "0", ri: "", dt: "" },
        saids: { d: DigDex.Blake3_256 },
      },
      rev: {
        alls: { v: "", t: "", d: "", i: "", s: "0", ri: "", p: "", dt: "" },
        saids: { d: DigDex.Blake3_256 },
      },
      bis: {
        alls: { v: "", t: "", d: "", i: "", ii: "", s: "0", ra: {}, dt: "" },
        saids: { d: DigDex.Blake3_256 },
      },
      brv: {
        alls: { v: "", t: "", d: "", i: "", s: "0", p: "", ra: {}, dt: "" },
        saids: { d: DigDex.Blake3_256 },
      },
    }),
    [versionKey(Vrsn_2_0)]: versionFields({
      icp: {
        alls: {
          v: "",
          t: "",
          d: "",
          i: "",
          s: "0",
          kt: "0",
          k: [],
          nt: "0",
          n: [],
          bt: "0",
          b: [],
          c: [],
          a: [],
        },
        saids: { d: DigDex.Blake3_256, i: DigDex.Blake3_256 },
      },
      rot: {
        alls: {
          v: "",
          t: "",
          d: "",
          i: "",
          s: "0",
          p: "",
          kt: "0",
          k: [],
          nt: "0",
          n: [],
          bt: "0",
          br: [],
          ba: [],
          c: [],
          a: [],
        },
        saids: { d: DigDex.Blake3_256 },
      },
      ixn: {
        alls: { v: "", t: "", d: "", i: "", s: "0", p: "", a: [] },
        saids: { d: DigDex.Blake3_256 },
      },
      dip: {
        alls: {
          v: "",
          t: "",
          d: "",
          i: "",
          s: "0",
          kt: "0",
          k: [],
          nt: "0",
          n: [],
          bt: "0",
          b: [],
          c: [],
          a: [],
          di: "",
        },
        saids: { d: DigDex.Blake3_256, i: DigDex.Blake3_256 },
      },
      drt: {
        alls: {
          v: "",
          t: "",
          d: "",
          i: "",
          s: "0",
          p: "",
          kt: "0",
          k: [],
          nt: "0",
          n: [],
          bt: "0",
          br: [],
          ba: [],
          c: [],
          a: [],
        },
        saids: { d: DigDex.Blake3_256 },
      },
      rct: { alls: { v: "", t: "", d: "", i: "", s: "0" } },
      qry: {
        alls: { v: "", t: "", d: "", i: "", dt: "", r: "", rr: "", q: {} },
        saids: { d: DigDex.Blake3_256 },
      },
      rpy: {
        alls: { v: "", t: "", d: "", i: "", dt: "", r: "", a: {} },
        saids: { d: DigDex.Blake3_256 },
      },
      pro: {
        alls: { v: "", t: "", d: "", i: "", dt: "", r: "", rr: "", q: {} },
        saids: { d: DigDex.Blake3_256 },
      },
      bar: {
        alls: { v: "", t: "", d: "", i: "", dt: "", r: "", a: {} },
        saids: { d: DigDex.Blake3_256 },
      },
      xip: {
        alls: { v: "", t: "", d: "", u: "", i: "", ri: "", dt: "", r: "", q: {}, a: {} },
        saids: { d: DigDex.Blake3_256 },
      },
      exn: {
        alls: { v: "", t: "", d: "", i: "", ri: "", x: "", p: "", dt: "", r: "", q: {}, a: {} },
        saids: { d: DigDex.Blake3_256 },
      },
    }),
  },
  [Protocols.acdc]: {
    [versionKey(Vrsn_1_0)]: versionFields({
      "<none>": {
        alls: { v: "", d: "", u: "", i: "", ri: "", s: "", a: "", A: "", e: "", r: "" },
        opts: { u: "", ri: "", a: "", A: "", e: "", r: "" },
        alts: { a: "A", A: "a" },
        saids: { d: DigDex.Blake3_256 },
      },
      ace: {
        alls: { v: "", t: "", d: "", u: "", i: "", ri: "", s: "", a: "", A: "", e: "", r: "" },
        opts: { u: "", ri: "", a: "", A: "", e: "", r: "" },
        alts: { a: "A", A: "a" },
        saids: { d: DigDex.Blake3_256 },
        strict: false,
      },
    }),
    [versionKey(Vrsn_2_0)]: versionFields({
      "<none>": {
        alls: { v: "", d: "", u: "", i: "", rd: "", s: "", a: "", A: "", e: "", r: "" },
        opts: { u: "", rd: "", a: "", A: "", e: "", r: "" },
        alts: { a: "A", A: "a" },
        saids: { d: DigDex.Blake3_256 },
      },
      acm: {
        alls: { v: "", t: "", d: "", u: "", i: "", rd: "", s: "", a: "", A: "", e: "", r: "" },
        opts: { t: "", u: "", rd: "", a: "", A: "", e: "", r: "" },
        alts: { a: "A", A: "a" },
        saids: { d: DigDex.Blake3_256 },
      },
      ace: {
        alls: { v: "", t: "", d: "", u: "", i: "", ri: "", s: "", a: "", A: "", e: "", r: "" },
        opts: { u: "", ri: "", a: "", A: "", e: "", r: "" },
        alts: { a: "A", A: "a" },
        saids: { d: DigDex.Blake3_256 },
        strict: false,
      },
      act: {
        alls: { v: "", t: "", d: "", u: "", i: "", rd: "", s: "", a: "", e: "", r: "" },
        saids: { d: DigDex.Blake3_256 },
      },
      acg: {
        alls: { v: "", t: "", d: "", u: "", i: "", rd: "", s: "", A: "", e: "", r: "" },
        saids: { d: DigDex.Blake3_256 },
      },
      sch: {
        alls: { v: "", t: "", d: "", s: "" },
        saids: { d: DigDex.Blake3_256 },
      },
      att: {
        alls: { v: "", t: "", d: "", a: "" },
        saids: { d: DigDex.Blake3_256 },
      },
      agg: {
        alls: { v: "", t: "", d: "", A: "" },
        saids: { d: DigDex.Blake3_256 },
      },
      edg: {
        alls: { v: "", t: "", d: "", e: "" },
        saids: { d: DigDex.Blake3_256 },
      },
      rul: {
        alls: { v: "", t: "", d: "", r: "" },
        saids: { d: DigDex.Blake3_256 },
      },
      rip: {
        alls: { v: "", t: "", d: "", u: "", i: "", n: "", dt: "" },
        saids: { d: DigDex.Blake3_256 },
      },
      bup: {
        alls: { v: "", t: "", d: "", rd: "", n: "", p: "", dt: "", b: "" },
        saids: { d: DigDex.Blake3_256 },
      },
      upd: {
        alls: { v: "", t: "", d: "", rd: "", n: "", p: "", dt: "", td: "", ts: "" },
        saids: { d: DigDex.Blake3_256 },
      },
    }),
  },
};

interface SerderHydratedInit {
  raw: Uint8Array;
  smellage: Smellage;
  ked: SadMap | null;
  ilk: string | null;
  said: string | null;
}

export interface SerderRawInit {
  raw: Uint8Array;
  smellage?: Smellage;
  verify?: boolean;
}

export interface SerderSadInit {
  sad?: SadMap;
  makify?: boolean;
  verify?: boolean;
  proto?: Protocol;
  pvrsn?: Versionage;
  gvrsn?: Versionage | null;
  kind?: Kind;
  ilk?: string | null;
  saids?: SaidCodeMap;
  compactify?: boolean;
}

export type SerderInit = SerderHydratedInit | SerderRawInit | SerderSadInit;

function isHydratedInit(init: SerderInit): init is SerderHydratedInit {
  return "smellage" in init && "ked" in init && "ilk" in init && "said" in init;
}

function isRawInit(init: SerderInit): init is SerderRawInit {
  return "raw" in init && !isHydratedInit(init) && !("sad" in init);
}

function fieldMapKey(ilk: string | null): string {
  return ilk ?? "<none>";
}

function getFieldDom(
  registry: FieldRegistry,
  proto: Protocol,
  pvrsn: Versionage,
  ilk: string | null,
): FieldDom {
  const protoFields = registry[proto];
  if (!protoFields) {
    throw new SerializeError(`Invalid protocol=${proto}`);
  }
  const versionFields = protoFields[versionKey(pvrsn)];
  if (!versionFields) {
    throw new SerializeError(`Invalid version=${versionKey(pvrsn)} for protocol=${proto}`);
  }
  const fields = versionFields[fieldMapKey(ilk)];
  if (!fields) {
    throw new SerializeError(`Invalid packet type (ilk)=${String(ilk)} for protocol=${proto}`);
  }
  return fields;
}

function parseRawToKed(raw: Uint8Array, smellage: Smellage): {
  ked: SadMap | null;
  ilk: string | null;
  said: string | null;
} {
  const { kind } = smellage;
  let ked: SadMap | null = null;
  let ilk: string | null = null;
  let said: string | null = null;

  try {
    if (kind === "JSON") {
      ked = JSON.parse(t(raw)) as SadMap;
    } else if (kind === "MGPK") {
      ked = normalizeDecodedMap(decodeMsgpack(raw), kind);
    } else if (kind === "CBOR") {
      ked = normalizeDecodedMap(decodeKeriCbor(raw), kind);
    } else if (kind === "CESR") {
      // Native inhale is delegated to the shared helper layer because CESR
      // bodies are not self-describing through `smell()` the same way
      // JSON/CBOR/MGPK bodies are.
      const native = parseCesrNativeKed(raw, smellage);
      ked = native.ked;
      ilk = native.ilk;
      said = native.said;
    }
  } catch (error) {
    if (error instanceof DeserializeError) {
      throw new DeserializeError(
        `Failed to decode ${kind} Serder: ${String(error.message)}`,
      );
    }
    if (kind === "JSON" && error instanceof SyntaxError) {
      throw new DeserializeError(
        `Failed to decode JSON Serder: ${String(error)}`,
      );
    }
    throw new DeserializeError(
      `Failed to decode ${kind} Serder: ${String(error)}`,
    );
  }

  if (ked) {
    ilk = typeof ked.t === "string" ? ked.t : null;
    said = typeof ked.d === "string" ? ked.d : null;
  }

  return { ked, ilk, said };
}

function coerceMatterCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  try {
    return new Matter({ qb64: value }).code;
  } catch {
    return null;
  }
}

function shallowCloneSad(sad: SadMap): SadMap {
  return Object.fromEntries(Object.entries(sad).map(([k, v]) => [k, cloneDefault(v)]));
}

function normalizeSadWithFieldDom(
  sad: SadMap | undefined,
  fields: FieldDom,
): SadMap {
  const working = shallowCloneSad(sad ?? {});
  for (const [label, value] of Object.entries(fields.alls)) {
    if (!(label in working)) {
      working[label] = cloneDefault(value);
    }
  }

  const ordered: SadMap = {};
  for (const label of Object.keys(fields.alls)) {
    if (label in working) {
      ordered[label] = working[label];
    }
  }
  for (const [label, value] of Object.entries(working)) {
    if (!(label in ordered)) {
      ordered[label] = value;
    }
  }
  return ordered;
}

function resolveProtocolDefaults(
  ctor: typeof Serder,
  init: SerderSadInit,
): {
  sad: SadMap;
  proto: Protocol;
  pvrsn: Versionage;
  gvrsn: Versionage | null;
  kind: Kind;
  ilk: string | null;
  saids: SaidCodeMap;
} {
  const sad = shallowCloneSad(init.sad ?? {});
  let smelled: Smellage | null = null;
  if (typeof sad.v === "string" && sad.v.length > 0) {
    try {
      smelled = parseVersionString(sad.v);
    } catch {
      smelled = null;
    }
  }

  const proto = init.proto ?? smelled?.proto ?? ctor.Proto;
  const pvrsn = init.pvrsn ?? smelled?.pvrsn ?? ctor.PVrsn;
  const gvrsn = init.gvrsn ?? smelled?.gvrsn ?? (pvrsn.major >= 2 ? ctor.GVrsn : null);
  const kind = init.kind ?? smelled?.kind ?? ctor.Kind;

  const versionFields = ctor.Fields[proto]?.[versionKey(pvrsn)];
  if (!versionFields) {
    throw new SerializeError(`Invalid version=${versionKey(pvrsn)} for protocol=${proto}`);
  }
  const defaultIlk = Object.keys(versionFields)[0] ?? "<none>";
  const ilk = init.ilk ?? (typeof sad.t === "string" ? sad.t : null)
    ?? (defaultIlk === "<none>" ? null : defaultIlk);
  const fields = getFieldDom(ctor.Fields, proto, pvrsn, ilk);
  const normalized = normalizeSadWithFieldDom(sad, fields);
  if (ilk !== null) {
    normalized.t = ilk;
  }
  normalized.v = versify({ proto, pvrsn, gvrsn, kind, size: 0 });

  const saids: SaidCodeMap = { ...(fields.saids ?? {}) };
  for (const [label, code] of Object.entries(init.saids ?? {})) {
    saids[label] = code;
  }
  for (const label of Object.keys(saids)) {
    if (label in (init.saids ?? {})) {
      continue;
    }
    const valueCode = coerceMatterCode(normalized[label]);
    if (valueCode) {
      saids[label] = valueCode;
    }
  }

  return { sad: normalized, proto, pvrsn, gvrsn, kind, ilk, saids };
}

function collectNestedGroups(
  entries: readonly GroupEntry[],
  out: CounterGroupLike[],
): void {
  for (const entry of entries) {
    if (isPrimitiveTuple(entry)) {
      collectNestedGroups(entry, out);
      continue;
    }
    if (isCounterGroupLike(entry)) {
      out.push(entry);
      collectNestedGroups(entry.items, out);
    }
  }
}

/** Extract all top-level + nested counted groups from one parsed message. */
function collectMessageGroups(
  message: Pick<CesrMessage, "attachments">,
): CounterGroupLike[] {
  const groups: CounterGroupLike[] = [];
  for (const attachment of message.attachments) {
    groups.push(attachment);
    collectNestedGroups(attachment.items, groups);
  }
  return groups;
}

/**
 * Structured projection of parsed attachment counter-groups into structor families.
 *
 * `other` captures counted groups that are intentionally not one of the known
 * structor families (`Aggor`, `Sealer`, `Blinder`, `Mediar`).
 */
export interface SerderStructorProjection {
  aggor: Aggor[];
  sealer: Sealer[];
  blinder: Blinder[];
  mediar: Mediar[];
  other: CounterGroupLike[];
}

interface SerderStatic {
  Protocol: Protocol | null;
  Proto: Protocol;
  PVrsn: Versionage;
  GVrsn: Versionage | null;
  Kind: Kind;
  Fields: FieldRegistry;
}

/**
 * Base Serder body class.
 *
 * KERIpy substance: Serders own both halves of the message-body contract:
 * serialization (`sad` -> `raw`) and deserialization (`raw` -> `sad`) plus
 * verification of saidive fields against the serialized body bytes.
 */
export class Serder implements CesrBody {
  static readonly Protocol: Protocol | null = null;
  static readonly Proto: Protocol = Protocols.keri;
  static readonly PVrsn: Versionage = Vrsn_1_0;
  static readonly GVrsn: Versionage | null = Vrsn_2_0;
  static readonly Kind: Kind = "JSON";
  static readonly Fields: FieldRegistry = FIELDS;

  readonly raw: Uint8Array;
  readonly kind: CesrBody["kind"];
  readonly size: number;
  readonly proto: CesrBody["proto"];
  readonly pvrsn: CesrBody["pvrsn"];
  readonly gvrsn: CesrBody["gvrsn"];
  readonly ilk: string | null;
  readonly native?: CesrBody["native"];

  protected readonly _ked: SadMap | null;
  protected readonly _said: string | null;

  constructor(init: SerderInit = { makify: true }) {
    if (isHydratedInit(init)) {
      this.raw = init.raw;
      this.kind = init.smellage.kind;
      this.size = init.smellage.size;
      this.proto = init.smellage.proto;
      this.pvrsn = init.smellage.pvrsn;
      this.gvrsn = init.smellage.gvrsn;
      this.ilk = init.ilk;
      this._ked = init.ked;
      this._said = init.said;
      return;
    }

    if (isRawInit(init)) {
      const smellage = init.smellage ?? smell(init.raw).smellage;
      const raw = init.raw.length === smellage.size ? init.raw : init.raw.slice(0, smellage.size);
      const parsed = parseRawToKed(raw, smellage);
      this.raw = raw;
      this.kind = smellage.kind;
      this.size = smellage.size;
      this.proto = smellage.proto;
      this.pvrsn = smellage.pvrsn;
      this.gvrsn = smellage.gvrsn;
      this.ilk = parsed.ilk;
      this._ked = parsed.ked;
      this._said = parsed.said;
      if (init.verify ?? true) {
        this._verify();
      }
      return;
    }

    const ctor = this.constructor as typeof Serder & SerderStatic;
    const resolved = resolveProtocolDefaults(ctor, init);
    const fields = getFieldDom(ctor.Fields, resolved.proto, resolved.pvrsn, resolved.ilk);
    const normalized = normalizeSadWithFieldDom(resolved.sad, fields);
    if (resolved.ilk !== null) {
      normalized.t = resolved.ilk;
    }
    normalized.v = versify({
      proto: resolved.proto,
      pvrsn: resolved.pvrsn,
      gvrsn: resolved.gvrsn,
      kind: resolved.kind,
      size: 0,
    });

    const actual = init.makify ?? false
      ? Saider.saidifyFields(normalized, {
        kind: resolved.kind,
        saids: resolved.saids,
        digest: Diger.digest,
      })
      : (() => {
        const existing = shallowCloneSad(normalized);
        const { raw } = sizeify(existing, resolved.kind);
        return { sad: existing, raw, saiders: {} as Record<string, Saider> };
      })();
    const smellage = smell(actual.raw).smellage;

    this.raw = actual.raw;
    this.kind = smellage.kind;
    this.size = smellage.size;
    this.proto = smellage.proto;
    this.pvrsn = smellage.pvrsn;
    this.gvrsn = smellage.gvrsn;
    this.ilk = typeof actual.sad.t === "string" ? actual.sad.t : resolved.ilk;
    this._ked = actual.sad;
    this._said = typeof actual.sad.d === "string" ? actual.sad.d : null;

    if (init.verify ?? true) {
      this._verify();
    }
  }

  get ked(): SadMap | null {
    return this._ked;
  }

  get sad(): SadMap | null {
    return this._ked ? shallowCloneSad(this._ked) : null;
  }

  get verstr(): string | null {
    return this._ked && typeof this._ked.v === "string" ? this._ked.v : null;
  }

  get protocol(): Protocol {
    return this.proto;
  }

  get said(): string | null {
    if (
      this._ked
      && this.ilk !== null
      && Object.keys(
          getFieldDom(
            (this.constructor as typeof Serder & SerderStatic).Fields,
            this.proto,
            this.pvrsn,
            this.ilk,
          ).saids ?? {},
        ).length === 0
      && typeof this._ked.d === "string"
    ) {
      return this._ked.d;
    }
    return this._said;
  }

  get saidb(): Uint8Array | null {
    return this.said ? b(this.said) : null;
  }

  get stamp(): string | null {
    return this._ked && typeof this._ked.dt === "string" ? this._ked.dt : null;
  }

  /** True when this body belongs to KERI protocol domain. */
  get isKeri(): boolean {
    return this.proto === Protocols.keri;
  }

  /** True when this body belongs to ACDC protocol domain. */
  get isAcdc(): boolean {
    return this.proto === Protocols.acdc;
  }

  verify(): boolean {
    try {
      this._verify();
      return true;
    } catch {
      return false;
    }
  }

  protected _verify(): void {
    if (!this._ked) {
      throw new DeserializeError("Cannot verify Serder without decoded SAD.");
    }

    const ctor = this.constructor as typeof Serder & SerderStatic;
    if (ctor.Protocol && this.proto !== ctor.Protocol) {
      throw new DeserializeError(`Required protocol=${ctor.Protocol}, got ${this.proto}`);
    }

    const ked = this._ked;
    const fields = getFieldDom(ctor.Fields, this.proto, this.pvrsn, this.ilk);
    const currentKeys = Object.keys(ked);
    const allowedKeys = Object.keys(fields.alls);
    const extraKeys = currentKeys.filter((key) => !allowedKeys.includes(key));
    if (extraKeys.length > 0 && (fields.strict ?? true)) {
      throw new DeserializeError(`Unallowed extra field(s)=${extraKeys.join(",")}`);
    }

    const optional = new Set(Object.keys(fields.opts ?? {}));
    const required = allowedKeys.filter((key) => !optional.has(key));
    for (const label of required) {
      if (!(label in ked)) {
        throw new DeserializeError(`Missing required field=${label}`);
      }
    }

    const orderWithoutExtras = currentKeys.filter((key) => allowedKeys.includes(key));
    const expectedOrder = allowedKeys.filter((key) => key in ked);
    if (orderWithoutExtras.join("|") !== expectedOrder.join("|")) {
      throw new DeserializeError("Missing or out-of-order fields in SAD.");
    }

    for (const [label, alt] of Object.entries(fields.alts ?? {})) {
      if (label in ked && alt in ked) {
        throw new DeserializeError(
          `Unallowed alternate fields '${label}' and '${alt}' both present.`,
        );
      }
    }

    const saids: SaidCodeMap = { ...(fields.saids ?? {}) };
    for (const label of Object.keys(saids)) {
      const code = coerceMatterCode(ked[label]);
      if (code) {
        saids[label] = code;
      }
    }

    const working = shallowCloneSad(ked);
    const actual = Saider.saidifyFields(working, {
      kind: this.kind,
      saids,
      digest: Diger.digest,
    });

    if (t(actual.raw) !== t(this.raw)) {
      throw new DeserializeError("Invalid round trip of SAD against raw.");
    }

    const actualSmellage = smell(actual.raw).smellage;
    if (actualSmellage.proto !== this.proto) {
      throw new DeserializeError("Inconsistent protocol after verification.");
    }
    if (
      actualSmellage.pvrsn.major !== this.pvrsn.major
      || actualSmellage.pvrsn.minor !== this.pvrsn.minor
    ) {
      throw new DeserializeError("Inconsistent protocol version after verification.");
    }
    if (actualSmellage.kind !== this.kind) {
      throw new DeserializeError("Inconsistent serialization kind after verification.");
    }
    if (actualSmellage.size !== this.size || actual.raw.length !== this.size) {
      throw new DeserializeError("Inconsistent serialized size after verification.");
    }
    if (
      (actualSmellage.gvrsn?.major ?? -1) !== (this.gvrsn?.major ?? -1)
      || (actualSmellage.gvrsn?.minor ?? -1) !== (this.gvrsn?.minor ?? -1)
    ) {
      throw new DeserializeError("Inconsistent genus version after verification.");
    }
  }

  compare(said?: string | Uint8Array): boolean {
    if (!said || !this.saidb) {
      throw new DeserializeError("Uncomparable saids.");
    }
    const other = typeof said === "string" ? b(said) : said;
    return t(other) === t(this.saidb);
  }

  pretty(opts: { size?: number } = {}): string {
    const pretty = JSON.stringify(this._ked, null, 1);
    return opts.size ? pretty.slice(0, opts.size) : pretty;
  }

  /**
   * Project counted attachment groups into structor subclasses.
   *
   * This keeps Serder + attachment processing cohesive for consumers that
   * immediately need typed structor families after frame parsing.
   */
  projectStructors(
    message: Pick<CesrMessage, "attachments">,
  ): SerderStructorProjection {
    const groups = collectMessageGroups(message);
    const projection: SerderStructorProjection = {
      aggor: [],
      sealer: [],
      blinder: [],
      mediar: [],
      other: [],
    };

    for (const group of groups) {
      if (isSealerCode(group.code)) {
        projection.sealer.push(Sealer.fromGroup(group));
        continue;
      }
      if (isBlinderCode(group.code)) {
        projection.blinder.push(Blinder.fromGroup(group));
        continue;
      }
      if (isMediarCode(group.code)) {
        projection.mediar.push(Mediar.fromGroup(group));
        continue;
      }
      if (isAggorCode(group.code)) {
        projection.aggor.push(Aggor.fromGroup(group));
        continue;
      }
      projection.other.push(group);
    }
    return projection;
  }
}

/** KERI-protocol Serder subtype (`proto=KERI`). */
export class SerderKERI extends Serder {
  static override readonly Protocol: Protocol = Protocols.keri;
  static override readonly Proto: Protocol = Protocols.keri;

  constructor(init: SerderInit = { makify: true }) {
    super(init);
    if (!this.isKeri) {
      throw new DeserializeError(
        `Expected KERI protocol serder, got ${this.proto}`,
      );
    }
  }

  protected override _verify(): void {
    super._verify();

    const sad = this.ked;
    if (!sad) {
      throw new DeserializeError("Missing decoded KERI SAD.");
    }

    const allowedKeys = Object.keys(getFieldDom(FIELDS, this.proto, this.pvrsn, this.ilk).alls);
    const actualKeys = Object.keys(sad);
    if (allowedKeys.join("|") !== actualKeys.join("|")) {
      throw new DeserializeError(
        `Invalid top level field list. Expected ${allowedKeys.join(",")} got ${
          actualKeys.join(",")
        }.`,
      );
    }

    const pre = this.pre;
    if (pre && PREFIX_CODES.has(coerceMatterCode(pre) ?? "")) {
      const code = coerceMatterCode(pre)!;
      if (this.ilk === "dip" && !DIGEST_CODES.has(code)) {
        throw new DeserializeError(
          `Delegated inception requires digestive prefix code, got ${code}.`,
        );
      }
      if (this.ilk === "icp" || this.ilk === "dip") {
        if (NON_DIGEST_PREFIX_CODES.has(code)) {
          if (this.keys.length !== 1) {
            throw new DeserializeError(`Non-digestive prefix ${code} requires exactly one key.`);
          }
          if (this.ked?.kt !== "1") {
            throw new DeserializeError(
              `Non-digestive prefix ${code} requires signing threshold 1.`,
            );
          }
          if (pre !== this.keys[0]) {
            throw new DeserializeError(`Non-digestive prefix ${code} must equal the zeroth key.`);
          }
        }

        if (NON_TRANSFERABLE_PREFIX_CODES.has(code)) {
          if (this.ndigs.length > 0) {
            throw new DeserializeError(
              `Non-transferable prefix ${code} requires empty nxt digests.`,
            );
          }
          if (this.backs.length > 0) {
            throw new DeserializeError(`Non-transferable prefix ${code} requires no backers.`);
          }
          if (this.seals.length > 0) {
            throw new DeserializeError(`Non-transferable prefix ${code} requires no seals/data.`);
          }
        }
      }
    }

    if (this.ilk === "dip" && this.delpre) {
      const delCode = coerceMatterCode(this.delpre);
      if (!delCode || !PREFIX_CODES.has(delCode) || !DIGEST_CODES.has(delCode)) {
        throw new DeserializeError(`Invalid delegator/delegate prefix code=${String(delCode)}.`);
      }
    }
  }

  get estive(): boolean {
    return ["icp", "rot", "dip", "drt"].includes(this.ilk ?? "");
  }

  get pre(): string | null {
    return this.ked && typeof this.ked.i === "string" ? this.ked.i : null;
  }

  get preb(): Uint8Array | null {
    return this.pre ? b(this.pre) : null;
  }

  get sn(): number | null {
    return this.ked && this.ked.s !== undefined ? Number.parseInt(String(this.ked.s), 16) : null;
  }

  get snh(): string | null {
    return this.ked && typeof this.ked.s === "string" ? this.ked.s : null;
  }

  get seals(): unknown[] {
    return Array.isArray(this.ked?.a) ? [...this.ked.a] : [];
  }

  get traits(): string[] {
    return Array.isArray(this.ked?.c)
      ? this.ked.c.filter((value): value is string => typeof value === "string")
      : [];
  }

  get keys(): string[] {
    return Array.isArray(this.ked?.k)
      ? this.ked.k.filter((value): value is string => typeof value === "string")
      : [];
  }

  get verfers(): Verfer[] {
    return this.keys.map((key) => new Verfer({ qb64: key }));
  }

  get ndigs(): string[] {
    return Array.isArray(this.ked?.n)
      ? this.ked.n.filter((value): value is string => typeof value === "string")
      : [];
  }

  get ndigers(): Diger[] {
    return this.ndigs.map((dig) => new Diger({ qb64: dig }));
  }

  get bn(): number | null {
    return this.ked && this.ked.bt !== undefined ? Number.parseInt(String(this.ked.bt), 16) : null;
  }

  get backs(): string[] {
    return Array.isArray(this.ked?.b)
      ? this.ked.b.filter((value): value is string => typeof value === "string")
      : [];
  }

  get berfers(): Prefixer[] {
    return this.backs.map((back) => new Prefixer({ qb64: back }));
  }

  get prior(): string | null {
    return this.ked && typeof this.ked.p === "string" ? this.ked.p : null;
  }

  get priorb(): Uint8Array | null {
    return this.prior ? b(this.prior) : null;
  }

  get cuts(): string[] {
    return Array.isArray(this.ked?.br)
      ? this.ked.br.filter((value): value is string => typeof value === "string")
      : [];
  }

  get adds(): string[] {
    return Array.isArray(this.ked?.ba)
      ? this.ked.ba.filter((value): value is string => typeof value === "string")
      : [];
  }

  get delpre(): string | null {
    return this.ked && typeof this.ked.di === "string" ? this.ked.di : null;
  }

  get delpreb(): Uint8Array | null {
    return this.delpre ? b(this.delpre) : null;
  }

  get route(): string | null {
    return this.ked && typeof this.ked.r === "string" ? this.ked.r : null;
  }

  get uuid(): string | null {
    return this.ked && typeof this.ked.u === "string" ? this.ked.u : null;
  }

  get nonce(): string | null {
    return this.uuid;
  }
}

/** ACDC-protocol Serder subtype (`proto=ACDC`). */
export class SerderACDC extends Serder {
  static override readonly Protocol: Protocol = Protocols.acdc;
  static override readonly Proto: Protocol = Protocols.acdc;

  constructor(init: SerderInit = { makify: true }) {
    super(init);
    if (!this.isAcdc) {
      throw new DeserializeError(
        `Expected ACDC protocol serder, got ${this.proto}`,
      );
    }
  }

  protected override _verify(): void {
    super._verify();

    if (this.ilk === null || ["acm", "ace", "act", "acg", "rip"].includes(this.ilk)) {
      const issuer = this.issuer;
      if (!issuer) {
        throw new DeserializeError("Invalid issuer AID.");
      }
      const code = coerceMatterCode(issuer);
      if (!code || !PREFIX_CODES.has(code)) {
        throw new DeserializeError(`Invalid issuer AID code=${String(code)}.`);
      }
    }
  }

  get uuid(): string | null {
    return this.ked && typeof this.ked.u === "string" ? this.ked.u : null;
  }

  get uuidb(): Uint8Array | null {
    return this.uuid ? b(this.uuid) : null;
  }

  get issuer(): string | null {
    return this.ked && typeof this.ked.i === "string" ? this.ked.i : null;
  }

  get issuerb(): Uint8Array | null {
    return this.issuer ? b(this.issuer) : null;
  }

  get regid(): string | null {
    if (!this.ked) {
      return null;
    }
    if (this.pvrsn.major === 1) {
      return typeof this.ked.ri === "string" ? this.ked.ri : null;
    }
    return typeof this.ked.rd === "string" ? this.ked.rd : null;
  }

  get regidb(): Uint8Array | null {
    return this.regid ? b(this.regid) : null;
  }

  get schema(): unknown {
    return this.ked?.s;
  }

  get attrib(): unknown {
    return this.ked?.a;
  }

  get issuee(): string | null {
    const attrib = this.attrib;
    if (attrib && typeof attrib === "object" && !Array.isArray(attrib)) {
      const issuee = (attrib as SadMap).i;
      return typeof issuee === "string" ? issuee : null;
    }
    return null;
  }

  get issueeb(): Uint8Array | null {
    return this.issuee ? b(this.issuee) : null;
  }

  get aggreg(): unknown {
    return this.ked?.A;
  }

  get edge(): unknown {
    return this.ked?.e;
  }

  get rule(): unknown {
    return this.ked?.r;
  }
}

/**
 * Parse one raw Serder body and hydrate protocol-specific Serder subclasses.
 */
export function parseSerder(
  raw: Uint8Array,
  smellage: Smellage,
): Serder {
  const { ked, ilk, said } = parseRawToKed(raw, smellage);
  const init: SerderHydratedInit = {
    raw,
    smellage,
    ked,
    ilk,
    said,
  };

  if (smellage.proto === Protocols.keri) {
    return new SerderKERI(init);
  }
  if (smellage.proto === Protocols.acdc) {
    return new SerderACDC(init);
  }
  return new Serder(init);
}
