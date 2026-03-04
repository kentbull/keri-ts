import type { CesrBody, CesrMessage, Smellage } from "../core/types.ts";
import { DeserializeError, SerializeError } from "../core/errors.ts";
import { decode as decodeMsgpack, encode as encodeMsgpack } from "@msgpack/msgpack";
import { decode as decodeCbor } from "cbor-x/decode";
import { encode as encodeCbor } from "cbor-x/encode";
import { Aggor, isAggorCode } from "../primitives/aggor.ts";
import { Blinder, isBlinderCode } from "../primitives/blinder.ts";
import { Mediar, isMediarCode } from "../primitives/mediar.ts";
import {
  type CounterGroupLike,
  type GroupEntry,
  isCounterGroupLike,
  isPrimitiveTuple,
} from "../primitives/primitive.ts";
import { Sealer, isSealerCode } from "../primitives/sealer.ts";
import { type Kind, Protocols } from "../tables/versions.ts";

/**
 * Serializes a key event dictionary into raw bytes.
 * Complement of {@link parseSerder}.
 */
export function serializeBody(
  ked: Record<string, unknown>,
  kind: Kind,
): Uint8Array {
  if (kind === "JSON") {
    return new TextEncoder().encode(JSON.stringify(ked));
  }
  if (kind === "CBOR") {
    return new Uint8Array(encodeCbor(ked));
  }
  if (kind === "MGPK") {
    return new Uint8Array(encodeMsgpack(ked));
  }
  throw new SerializeError(`Unsupported serialization kind: ${kind}`);
}

function normalizeDecodedMap(
  value: unknown,
  kind: "JSON" | "CBOR" | "MGPK" | "CESR",
): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value instanceof Map) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of value.entries()) {
        if (typeof k !== "string") {
          throw new DeserializeError(`${kind} map key must be a string`);
        }
        out[k] = v;
      }
      return out;
    }
    return value as Record<string, unknown>;
  }
  throw new DeserializeError(`${kind} root must be a map/object`);
}

interface SerderInit {
  raw: Uint8Array;
  smellage: Smellage;
  ked: Record<string, unknown> | null;
  ilk: string | null;
  said: string | null;
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
function collectMessageGroups(message: Pick<CesrMessage, "attachments">): CounterGroupLike[] {
  const groups: CounterGroupLike[] = [];
  for (const attachment of message.attachments) {
    groups.push(attachment);
    collectNestedGroups(attachment.items, groups);
  }
  return groups;
}

/**
 * Base Serder body class.
 *
 * KERIpy substance: Serders carry raw serialized event bytes plus decoded KED
 * projections (`ilk`/`said`) and protocol/version metadata.
 */
export class Serder implements CesrBody {
  readonly raw: Uint8Array;
  readonly ked: Record<string, unknown> | null;
  readonly kind: CesrBody["kind"];
  readonly size: number;
  readonly proto: CesrBody["proto"];
  readonly pvrsn: CesrBody["pvrsn"];
  readonly gvrsn: CesrBody["gvrsn"];
  readonly ilk: string | null;
  readonly said: string | null;
  readonly native?: CesrBody["native"];

  constructor(init: SerderInit) {
    this.raw = init.raw;
    this.ked = init.ked;
    this.kind = init.smellage.kind;
    this.size = init.smellage.size;
    this.proto = init.smellage.proto;
    this.pvrsn = init.smellage.pvrsn;
    this.gvrsn = init.smellage.gvrsn;
    this.ilk = init.ilk;
    this.said = init.said;
  }

  /** True when this body belongs to KERI protocol domain. */
  get isKeri(): boolean {
    return this.proto === Protocols.keri;
  }

  /** True when this body belongs to ACDC protocol domain. */
  get isAcdc(): boolean {
    return this.proto === Protocols.acdc;
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
  constructor(init: SerderInit) {
    super(init);
    if (!this.isKeri) {
      throw new DeserializeError(
        `Expected KERI protocol serder, got ${this.proto}`,
      );
    }
  }
}

/** ACDC-protocol Serder subtype (`proto=ACDC`). */
export class SerderACDC extends Serder {
  constructor(init: SerderInit) {
    super(init);
    if (!this.isAcdc) {
      throw new DeserializeError(
        `Expected ACDC protocol serder, got ${this.proto}`,
      );
    }
  }
}

/**
 * Parse one raw Serder body and hydrate protocol-specific Serder subclasses.
 */
export function parseSerder(
  raw: Uint8Array,
  smellage: Smellage,
): Serder {
  const { proto, kind, pvrsn, gvrsn, size } = smellage;
  let ked: Record<string, unknown> | null = null;
  let ilk: string | null = null;
  let said: string | null = null;

  try {
    if (kind === "JSON") {
      const text = new TextDecoder().decode(raw);
      ked = JSON.parse(text) as Record<string, unknown>;
    } else if (kind === "MGPK") {
      ked = normalizeDecodedMap(decodeMsgpack(raw), kind);
    } else if (kind === "CBOR") {
      ked = normalizeDecodedMap(decodeCbor(raw), kind);
    }
    if (ked) {
      ilk = typeof ked.t === "string" ? ked.t : null;
      said = typeof ked.d === "string" ? ked.d : null;
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
    if (kind === "MGPK" || kind === "CBOR") {
      throw new DeserializeError(
        `Failed to decode ${kind} Serder: ${String(error)}`,
      );
    }
    throw error;
  }

  const init: SerderInit = {
    raw,
    smellage: { proto, kind, pvrsn, gvrsn, size },
    ked,
    ilk,
    said,
  };

  if (proto === Protocols.keri) {
    return new SerderKERI(init);
  }
  if (proto === Protocols.acdc) {
    return new SerderACDC(init);
  }
  return new Serder(init);
}
