import { decode as decodeMsgpack, encode as encodeMsgpack } from "@msgpack/msgpack";
import { b, codeB2ToB64, codeB64ToB2, t } from "../../core/bytes.ts";
import { decodeKeriCbor, encodeKeriCbor } from "../../core/cbor.ts";
import { DeserializeError, SerializeError, ShortageError } from "../../core/errors.ts";
import type { CesrDomain } from "../../core/types.ts";
import { CtrDexV2 } from "../../tables/counter-codex.ts";
import { MATTER_SIZES } from "../../tables/matter.tables.generated.ts";
import type { Versionage } from "../../tables/table-types.ts";
import type { Kind } from "../../tables/versions.ts";
import { DigDex } from "../base/codex.ts";
import { Counter, parseCounter } from "../base/counter.ts";
import { Diger, parseDiger } from "../crypto/diger.ts";
import { Mapper, type MapperMap } from "./mapper.ts";

/** One aggregate-list element: either a compact qb64 commitment or a disclosed map. */
export type AggorElement = string | MapperMap;

/** Slot zero contains the aggregate identifier; later slots contain maps or their SAIDs. */
export type AggorList = AggorElement[];

/** Semantic or serialized input for an aggregate in its declared serialization kind. */
export interface AggorInit {
  ael?: AggorList;
  raw?: Uint8Array;
  qb64?: string;
  qb64b?: Uint8Array;
  qb2?: Uint8Array;
  version?: Versionage;
  code?: string;
  makify?: boolean;
  verify?: boolean;
  strict?: boolean;
  saids?: Record<string, string>;
  kind?: Kind;
}

/**
 * KERIpy aggregate-list semantics for CESR, JSON, CBOR, and MGPK.
 *
 * The AGID commits to the fully framed list with slot zero dummied and each
 * disclosed map replaced by its SAID. The visible serialization keeps those maps
 * expanded. Generic parser list/map groups belong to Structor, not Aggor.
 */
export class Aggor {
  /** Serialization format for the visible list and its commitment. */
  readonly kind: Kind;
  /** Require formal labels in disclosed CESR maps. */
  readonly strict: boolean;
  /** Ordered map SAID labels and default digest codes; the first is primary. */
  readonly saids: Record<string, string>;
  /** Digest code for the aggregate identifier, not a CESR counter code. */
  readonly code: string;
  /** Full enclosed CESR quadlet count, or null for other serialization kinds. */
  readonly count: number | null;
  /** Owned disclosed list, copied at construction and on access. */
  private readonly _ael: AggorList;
  /** Complete serialized list in the declared kind. */
  private readonly _raw: Uint8Array;

  /** Build or inhale one aggregate; verification never rewrites supplied commitments. */
  constructor(init: AggorInit = {}) {
    this.kind = init.kind ?? "CESR";
    this.strict = init.strict ?? true;
    this.saids = { ...(init.saids ?? { d: DigDex.Blake3_256 }) };
    this.code = init.code ?? DigDex.Blake3_256;
    const version = init.version ?? { major: 2, minor: 0 };
    const supplied = init.raw ?? init.qb64b ?? (init.qb64 === undefined ? undefined : b(init.qb64));

    if (init.ael !== undefined || (supplied === undefined && init.qb2 === undefined)) {
      this._ael = structuredClone(init.ael ?? []);
      if (init.makify && this._ael.length > 0) {
        this._ael[0] = this.computeAgid(true);
      }
      this._raw = this.serializeList(this._ael);
    } else {
      if (init.qb2 !== undefined && supplied === undefined && this.kind !== "CESR") {
        throw new DeserializeError(`Input qb2 is incompatible with kind=${this.kind}`);
      }
      let raw = supplied;
      if (raw === undefined) {
        const counter = parseCounter(init.qb2!, version, "bny");
        const size = counter.fullSizeB2 + counter.count * 3;
        if (init.qb2!.length < size) {
          throw new ShortageError(size, init.qb2!.length);
        }
        raw = b(codeB2ToB64(init.qb2!.slice(0, size), counter.fullSize + counter.count * 4));
      }
      if (this.kind === "CESR") {
        const counter = parseCounter(raw, version, "txt");
        const size = counter.fullSize + counter.count * 4;
        if (raw.length < size) {
          throw new ShortageError(size, raw.length);
        }
        raw = raw.slice(0, size);
      }
      this._raw = raw.slice();
      this._ael = this.deserializeList(this._raw, version);
    }

    this.count = this.kind === "CESR" ? this._raw.length / 4 : null;
    if (!init.makify && (init.verify ?? true) && this._ael.length > 0) {
      if (this.computeAgid(false) !== this.agid) {
        throw new DeserializeError("Aggregate identifier does not verify.");
      }
    }
  }

  /** Aggregate identifier at element zero, or null for an empty list. */
  get agid(): string | null {
    return typeof this._ael[0] === "string" ? this._ael[0] : null;
  }

  /** Copy of the disclosed semantic list. */
  get ael(): AggorList {
    return structuredClone(this._ael);
  }

  /** Complete serialization, including the list framing for the declared kind. */
  get raw(): Uint8Array {
    return this._raw.slice();
  }

  /** Byte alias for the complete serialized aggregate. */
  get qb64b(): Uint8Array {
    return this.raw;
  }

  /** Decode UTF-8 text strictly; binary serialization kinds may have no text projection. */
  get qb64(): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(this._raw);
  }

  /** CESR binary-domain serialization; unavailable for non-CESR kinds. */
  get qb2(): Uint8Array {
    if (this.kind !== "CESR") {
      throw new SerializeError(`Binary domain undefined for non-native kind=${this.kind}`);
    }
    return codeB64ToB2(this.qb64);
  }

  /** Complete serialized byte length, including list framing. */
  get size(): number {
    return this._raw.length;
  }

  /** Full CESR group length in the selected domain; reject non-CESR kinds. */
  byteCount(domain: CesrDomain = "txt"): number {
    if (this.count === null) {
      throw new SerializeError(`Byte count undefined for non-native kind=${this.kind}`);
    }
    return this.count * (domain === "txt" ? 4 : 3);
  }

  /** Verify both disclosed map SAIDs and the list commitment without rewriting either. */
  static verifyDisclosure(
    ael: AggorList,
    kind: Kind = "CESR",
    code = DigDex.Blake3_256,
    saids: Record<string, string> = { d: DigDex.Blake3_256 },
  ): boolean {
    try {
      return new Aggor({ ael, kind, code, saids }).agid === ael[0];
    } catch {
      return false;
    }
  }

  /** Compact every map except selected disclosed indices; preserve slot zero. */
  disclose(indices: number[] = []): [AggorList, Kind] {
    const ael = this._ael.map((element, index) => {
      if (typeof element === "string") return new Diger({ qb64: element }).qb64;
      const mapper = this.elementMapper(element, false);
      return indices.includes(index) ? mapper.mad : mapper.said!;
    });
    return [ael, this.kind];
  }

  /** Make or verify a disclosed map before using its primary SAID in the commitment. */
  private elementMapper(element: MapperMap, makify: boolean): Mapper {
    const mapper = Mapper.fromSad(element, {
      strict: this.strict,
      saidive: true,
      saids: this.saids,
      kind: this.kind,
      makify: true,
      verify: false,
    });
    if (!makify) {
      // Keep aggregate verification independent: these freshly saidified maps
      // must match the original claims before representing disclosed content.
      const computed = mapper.mad;
      for (const label of Object.keys(this.saids)) {
        if (label in element && element[label] !== computed[label]) {
          throw new DeserializeError(`Aggregate map SAID at ${label} does not verify.`);
        }
      }
    }
    return mapper;
  }

  /** Hash the format-specific compact list, optionally saidifying visible maps first. */
  private computeAgid(makify: boolean): string {
    const sizage = MATTER_SIZES.get(this.code);
    if (!sizage?.fs || typeof this._ael[0] !== "string") {
      throw new SerializeError("Aggregate requires a string at slot zero and a digest code.");
    }
    const compacted = this._ael.map((element, index) => {
      if (index === 0) return "#".repeat(sizage.fs!);
      if (typeof element === "string") return new Diger({ qb64: element }).qb64;
      if (!element || typeof element !== "object" || Array.isArray(element)) {
        throw new SerializeError(`Invalid aggregate element at index=${index}`);
      }
      const mapper = this.elementMapper(element, makify);
      if (makify) this._ael[index] = mapper.mad;
      return mapper.said;
    });
    return new Diger({ code: this.code, raw: Diger.digest(this.serializeList(compacted), this.code) }).qb64;
  }

  /** Serialize list framing in its own kind; only CESR concatenates qualified elements. */
  private serializeList(ael: readonly unknown[]): Uint8Array {
    switch (this.kind) {
      case "JSON":
        return b(JSON.stringify(ael));
      case "CBOR":
        return encodeKeriCbor(ael);
      case "MGPK":
        return encodeMsgpack(ael);
      case "CESR": {
        const body = ael.map((element) => {
          if (typeof element === "string") return element;
          if (element && typeof element === "object" && !Array.isArray(element)) {
            return Mapper.fromSad(element as MapperMap, { strict: this.strict, verify: false }).qb64;
          }
          throw new SerializeError("Invalid element while serializing aggregate.");
        }).join("");
        return Counter.enclose({ qb64: body, code: CtrDexV2.GenericListGroup });
      }
    }
  }

  /** Inhale one list; CESR permits only digest primitives and generic map groups. */
  private deserializeList(raw: Uint8Array, version: Versionage): AggorList {
    if (this.kind !== "CESR") {
      const ael: unknown = this.kind === "JSON"
        ? JSON.parse(t(raw))
        : this.kind === "CBOR"
        ? decodeKeriCbor(raw)
        : decodeMsgpack(raw);
      if (!Array.isArray(ael)) throw new DeserializeError("Expected an aggregate list.");
      return ael as AggorList;
    }
    const counter = parseCounter(raw, version, "txt");
    if (counter.code !== CtrDexV2.GenericListGroup && counter.code !== CtrDexV2.BigGenericListGroup) {
      throw new DeserializeError(`Expected aggregate list group, got ${counter.code}`);
    }
    const ael: AggorList = [];
    let offset = counter.fullSize;
    while (offset < raw.length) {
      if (raw[offset] === "-".charCodeAt(0)) {
        const next = parseCounter(raw.subarray(offset), version, "txt");
        if (next.code !== CtrDexV2.GenericMapGroup && next.code !== CtrDexV2.BigGenericMapGroup) {
          throw new DeserializeError(`Expected aggregate map element, got ${next.code}`);
        }
        const size = next.fullSize + next.count * 4;
        if (offset + size > raw.length) throw new DeserializeError("Aggregate map exceeds list boundary.");
        const mapper = new Mapper({
          raw: raw.slice(offset, offset + size),
          version,
          strict: this.strict,
          saids: this.saids,
          saidive: true,
          verify: false,
        });
        ael.push(mapper.mad);
        offset += size;
      } else {
        const diger = parseDiger(raw.subarray(offset), "txt");
        ael.push(diger.qb64);
        offset += diger.fullSize;
      }
    }
    return ael;
  }
}
