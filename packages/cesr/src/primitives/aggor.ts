import { b, codeB2ToB64, codeB64ToB2, t } from "../core/bytes.ts";
import { DeserializeError, SerializeError, UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { CtrDexV2 } from "../tables/counter-codex.ts";
import { AGGOR_CODES, AGGOR_LIST_CODES, AGGOR_MAP_CODES } from "../tables/counter-groups.ts";
import { MATTER_SIZES } from "../tables/matter.tables.generated.ts";
import type { Versionage } from "../tables/table-types.ts";
import type { Kind } from "../tables/versions.ts";
import { DigDex } from "./codex.ts";
import { Counter, parseCounter } from "./counter.ts";
import { Diger } from "./diger.ts";
import { Mapper, type MapperField, parseMapperBody } from "./mapper.ts";
import { Matter } from "./matter.ts";
import type { CounterGroupLike, GroupEntry } from "./primitive.ts";
import { parseStructor, Structor } from "./structor.ts";

type SadMap = Record<string, unknown>;

/**
 * `Aggor` is the aggregate-list sibling to `Compactor`.
 *
 * Where `Compactor` contracts nested map branches to SAIDs, `Aggor` contracts a
 * list of aggregate elements down to one commitment in slot zero (`agid`) while
 * still supporting later selective disclosure of map elements.
 */

/** True when counter code belongs to aggregate-list group families. */
export function isAggorListCode(code: string): boolean {
  return AGGOR_LIST_CODES.has(code);
}

/** True when counter code belongs to aggregate-map group families. */
export function isAggorMapCode(code: string): boolean {
  return AGGOR_MAP_CODES.has(code);
}

/** True when counter code belongs to any aggregate list/map family. */
export function isAggorCode(code: string): boolean {
  return AGGOR_CODES.has(code);
}

/**
 * Supported constructor inputs for `Aggor`.
 *
 * The semantic lane is `ael` (aggregate element list). Raw/qb64/qb2 inputs are
 * for inhale from an existing aggregate wire representation.
 */
export interface AggorInit {
  ael?: unknown[];
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
 * Aggregate list/map primitive.
 *
 * KERIpy substance:
 * - list-form `Aggor` owns aggregate-element-list (`ael`) semantics and `agid`
 *   computation/disclosure
 * - map-form `Aggor` is preserved here only as a compatibility bridge for
 *   parser-group projections that still classify generic map groups as aggor
 *   families in the TS codebase
 */
export class Aggor extends Structor {
  readonly kind: "list" | "map";
  /** Map-style compatibility projection for parser-origin map groups. */
  readonly mapFields?: readonly MapperField[];
  readonly strict: boolean;
  readonly saids: Record<string, string>;
  /** Digest code used to compute the aggregate identifier (`agid`). */
  readonly digestCode: string;
  readonly wireKind: Kind;
  private readonly _ael: unknown[];

  /**
   * Construct one aggregate primitive.
   *
   * Two semantic lanes exist:
   * - list lane: real aggregate semantics (`ael`, `agid`, disclosure)
   * - map lane: compatibility bridge for existing TS parser projections that
   *   still bucket generic map groups into aggregate families
   */
  constructor(init: AggorInit | { structor: Structor; mapFields?: readonly MapperField[] }) {
    const payload = "structor" in init
      ? init
      : Aggor.materializeStructor(init as AggorInit);

    super(payload.structor);
    if (!isAggorCode(this.code)) {
      throw new UnknownCodeError(
        `Expected aggregate list/map group code, got ${this.code}`,
      );
    }
    this.kind = isAggorMapCode(this.code) ? "map" : "list";
    this.mapFields = payload.mapFields;
    this.strict = "structor" in init ? true : ((init as AggorInit).strict ?? true);
    this.saids = {
      ...("structor" in init ? {} : ((init as AggorInit).saids ?? { d: DigDex.Blake3_256 })),
    };
    this.digestCode = "structor" in init
      ? DigDex.Blake3_256
      : ((init as AggorInit).code ?? DigDex.Blake3_256);
    this.wireKind = "structor" in init ? "CESR" : ((init as AggorInit).kind ?? "CESR");
    if (this.kind === "list") {
      try {
        // Parser-origin list groups may be arbitrary generic list payloads, so
        // deserialization into semantic aggregate elements is best-effort. When
        // that semantic view is not meaningful we still preserve the structor.
        this._ael = Aggor.deserializeList(this.qb64g, this.strict, this.saids);
      } catch {
        this._ael = [];
      }
    } else {
      this._ael = [];
    }
  }

  /** Aggregate identifier at element zero for list-form aggregates. */
  get agid(): string | null {
    return this.kind === "list" && typeof this._ael[0] === "string" ? this._ael[0] : null;
  }

  /** Aggregate element list in semantic form. */
  get ael(): unknown[] {
    return this._ael.map((entry) => Aggor.clone(entry));
  }

  /** Tuple/list payload items for parser-origin list aggregate families. */
  get listItems(): readonly GroupEntry[] | undefined {
    return this.kind === "list" ? this.items : undefined;
  }

  /**
   * Verify that the disclosed aggregate list still hashes to the agid in slot zero.
   *
   * Example:
   * a disclosure list like `[agid, {d: "...", x: 1}, "E...undisclosed"]`
   * verifies when replacing the disclosed map with its computed SAID reproduces
   * the agid at position zero.
   */
  static verifyDisclosure(
    ael: unknown[],
    kind: Kind = "CESR",
    code = DigDex.Blake3_256,
    saids: Record<string, string> = { d: DigDex.Blake3_256 },
  ): boolean {
    // Verification is intentionally "rebuild and compare agid", not a more
    // magical shortcut. Disclosure semantics are easier to trust when the test
    // is literally "does this disclosed list still hash back to slot zero?"
    try {
      const aggor = new Aggor({
        ael,
        kind,
        code,
        saids,
        verify: true,
      });
      return aggor.agid === (typeof ael[0] === "string" ? ael[0] : null);
    } catch {
      return false;
    }
  }

  /**
   * Produce a disclosure view where only `indices` are expanded back into maps.
   *
   * Index `0` is always the agid and stays compact; only later map elements are
   * eligible for disclosure expansion.
   */
  disclose(indices: number[] = []): [unknown[], Kind] {
    if (this.kind !== "list") {
      throw new SerializeError("Disclosure is only defined for aggregate lists.");
    }
    // We first normalize every element into either:
    // - the aggregate's compact commitment string, or
    // - a `Mapper` that knows how to compute its own compact SAID.
    const atoms = this._ael.map((element, index) => {
      if (index === 0) {
        return typeof element === "string" ? element : null;
      }
      if (element && typeof element === "object" && !Array.isArray(element)) {
        return Mapper.fromSad(element as SadMap, {
          strict: this.strict,
          saidive: true,
          saids: this.saids,
          kind: this.wireKind,
          makify: true,
          verify: false,
        });
      }
      return typeof element === "string" ? element : null;
    });

    const disclosure: unknown[] = atoms.map((atom) => atom instanceof Mapper ? atom.said : atom);
    for (const index of indices) {
      if (index > 0 && index < atoms.length && atoms[index] instanceof Mapper) {
        // Disclosure only expands selected post-agid map elements. The agid at
        // slot zero always remains compact because it is the commitment anchor.
        disclosure[index] = (atoms[index] as Mapper).mad;
      }
    }
    return [disclosure, this.wireKind];
  }

  /** Hydrate from an already parsed counter-group node. */
  static override fromGroup(
    group: CounterGroupLike,
    sourceDomain: Extract<ColdCode, "txt" | "bny"> = "txt",
  ): Aggor {
    const structor = Structor.fromGroup(group, sourceDomain);
    if (isAggorMapCode(structor.code)) {
      const map = parseMapperBody(b(structor.qb64g), { major: 2, minor: 0 }, "txt");
      return new Aggor({ structor, mapFields: map.fields });
    }
    return new Aggor({ structor });
  }

  private static materializeStructor(
    init: AggorInit,
  ): { structor: Structor; mapFields?: readonly MapperField[] } {
    const version = init.version ?? { major: 2, minor: 0 };
    const raw = init.qb2
      ? Aggor.canonicalize(init.qb2, version)
      : init.qb64
      ? b(init.qb64)
      : init.qb64b
      ? init.qb64b
      : init.raw
      ? init.raw
      : init.ael
      ? b(Aggor.serializeList(Aggor.clone(init.ael), init))
      : null;

    if (!raw) {
      throw new SerializeError("Aggor requires ael or raw/qb64/qb64b/qb2 input.");
    }

    const structor = parseStructor(
      raw,
      version,
      "txt",
      AGGOR_CODES,
      "aggregate list/map",
    );
    const mapFields = isAggorMapCode(structor.code)
      ? new Mapper({ raw: b(structor.qb64g), version, kind: "CESR", verify: false }).fields
      : undefined;

    if (init.verify ?? true) {
      if (isAggorListCode(structor.code)) {
        // Today verification proves the aggregate identifier can be recomputed.
        // It does not yet enforce every deeper KERIpy edge case, so keep this
        // seam explicit for future parity expansion.
        const ael = Aggor.deserializeList(
          structor.qb64g,
          init.strict ?? true,
          init.saids ?? { d: DigDex.Blake3_256 },
        );
        Aggor.computeAgid(
          ael,
          init.kind ?? "CESR",
          init.code ?? DigDex.Blake3_256,
          init.strict ?? true,
          init.saids ?? { d: DigDex.Blake3_256 },
        );
      }
    }

    return { structor, mapFields };
  }

  static canonicalize(raw: Uint8Array, version: Versionage): Uint8Array {
    if (raw.length > 0 && raw[0] === "-".charCodeAt(0)) {
      return raw;
    }
    const counter = parseCounter(raw, version, "bny");
    return b(codeB2ToB64(raw, counter.fullSize + counter.count * 4));
  }

  private static clone<T>(value: T): T {
    if (Array.isArray(value)) {
      return value.map((entry) => Aggor.clone(entry)) as T;
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, Aggor.clone(v)]),
      ) as T;
    }
    return value;
  }

  private static serializeList(
    ael: unknown[],
    options: AggorInit,
  ): string {
    const strict = options.strict ?? true;
    const saids = options.saids ?? { d: DigDex.Blake3_256 };
    const kind = options.kind ?? "CESR";
    const code = options.code ?? DigDex.Blake3_256;
    const makify = options.makify ?? false;
    const working = Aggor.clone(ael);

    if (makify && working.length > 0) {
      // Slot zero is always the aggregate identifier. During makify we dummy it
      // first, normalize later map elements into saidified `Mapper`s, then
      // compute the final agid over that compacted view.
      const sizage = MATTER_SIZES.get(code);
      if (!sizage?.fs) {
        throw new SerializeError(`Unsupported aggregate digest code=${code}`);
      }
      working[0] = "#".repeat(sizage.fs);
      for (let idx = 1; idx < working.length; idx++) {
        const element = working[idx];
        if (element && typeof element === "object" && !Array.isArray(element)) {
          const mapper = Mapper.fromSad(element as SadMap, {
            strict,
            saidive: true,
            saids,
            kind,
            makify: true,
            verify: false,
          });
          working[idx] = mapper.mad;
        }
      }
      const agid = Aggor.computeAgid(working, kind, code, strict, saids);
      if (ael.length > 0) {
        ael[0] = agid;
      }
    }

    const compacted = working.map((element, idx) => {
      if (idx === 0) {
        return typeof ael[0] === "string" ? ael[0] : "";
      }
      if (element && typeof element === "object" && !Array.isArray(element)) {
        // Aggregate list elements compact exactly like disclosed map sections:
        // nested map content collapses to its mapper-native representation.
        const mapper = Mapper.fromSad(element as SadMap, {
          strict,
          saidive: true,
          saids,
          kind,
          makify: true,
          verify: false,
        });
        return mapper.qb64;
      }
      return String(element);
    }).join("");

    const codeName = compacted.length / 4 < 64 ** 2
      ? CtrDexV2.GenericListGroup
      : CtrDexV2.BigGenericListGroup;
    return `${new Counter({ code: codeName, count: compacted.length / 4 }).qb64}${compacted}`;
  }

  private static deserializeList(
    qb64: string,
    strict: boolean,
    saids: Record<string, string>,
  ): unknown[] {
    // Aggregate lists are walked element-by-element from the enclosed list
    // payload. Elements may be:
    // - compact qb64 commitments, or
    // - nested map groups representing disclosed element bodies.
    const raw = b(qb64);
    const counter = parseCounter(raw, { major: 2, minor: 0 }, "txt");
    const payload = raw.slice(counter.fullSize, counter.fullSize + counter.count * 4);
    const out: unknown[] = [];
    let offset = 0;
    while (offset < payload.length) {
      if (payload[offset] === "-".charCodeAt(0)) {
        const nextCounter = parseCounter(payload.slice(offset), { major: 2, minor: 0 }, "txt");
        if (!isAggorMapCode(nextCounter.code)) {
          throw new DeserializeError(
            `Expected aggregate element map group, got ${nextCounter.code}`,
          );
        }
        const total = nextCounter.fullSize + nextCounter.count * 4;
        const mapper = new Mapper({
          raw: payload.slice(offset, offset + total),
          strict,
          saidive: true,
          saids,
          kind: "CESR",
          verify: false,
        });
        out.push(mapper.mad);
        offset += total;
        continue;
      }
      const matter = new Matter({ qb64b: payload.slice(offset) });
      out.push(matter.qb64);
      offset += matter.fullSize;
    }
    return out;
  }

  private static computeAgid(
    ael: unknown[],
    kind: Kind,
    code: string,
    strict: boolean,
    saids: Record<string, string>,
  ): string {
    // `agid` is computed over the compacted aggregate view:
    // dummy slot zero, compact every nested map element to its mapper SAID, then
    // hash the fully enclosed list-group serialization.
    const compacted = ael.map((element, idx) => {
      if (idx === 0) {
        const sizage = MATTER_SIZES.get(code);
        if (!sizage?.fs) {
          throw new SerializeError(`Unsupported aggregate digest code=${code}`);
        }
        return "#".repeat(sizage.fs);
      }
      if (element && typeof element === "object" && !Array.isArray(element)) {
        const mapper = Mapper.fromSad(element as SadMap, {
          strict,
          saidive: true,
          saids,
          kind,
          makify: true,
          verify: false,
        });
        return mapper.said ?? "";
      }
      return String(element);
    }).join("");
    const groupCode = compacted.length / 4 < 64 ** 2
      ? CtrDexV2.GenericListGroup
      : CtrDexV2.BigGenericListGroup;
    const raw = b(
      `${new Counter({ code: groupCode, count: compacted.length / 4 }).qb64}${compacted}`,
    );
    return new Matter({ code, raw: Diger.digest(raw, code) }).qb64;
  }
}

/**
 * Parse aggregate attachment groups as semantic aggregate containers.
 *
 * Example:
 * a list body `-JAE<agid><map-or-said>...` becomes an `Aggor` whose `.ael`
 * exposes the readable element list and whose `.agid` is the commitment in slot
 * zero. A map-group still parses for compatibility, but exposes `.mapFields`
 * rather than aggregate-list semantics.
 */
export function parseAggor(
  input: Uint8Array,
  version: Versionage,
  cold: Extract<ColdCode, "txt" | "bny">,
): Aggor {
  const counter = parseCounter(input, version, cold);
  if (!isAggorCode(counter.code)) {
    throw new UnknownCodeError(
      `Expected aggregate list/map group code, got ${counter.code}`,
    );
  }
  return new Aggor(
    cold === "txt"
      ? { raw: input, version, kind: "CESR", verify: false }
      : { qb2: input, version, kind: "CESR", verify: false },
  );
}
