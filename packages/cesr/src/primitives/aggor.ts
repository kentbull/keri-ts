import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import { CtrDexV2 } from "../tables/counter-codex.ts";
import { parseCompactor } from "./compactor.ts";
import { parseCounter } from "./counter.ts";
import type { CounterGroupLike, GroupEntry } from "./primitive.ts";
import type { MapperField } from "./mapper.ts";
import { parseStructor, Structor } from "./structor.ts";

const AGGOR_LIST_CODES = new Set<string>([
  CtrDexV2.GenericGroup,
  CtrDexV2.BigGenericGroup,
  CtrDexV2.GenericListGroup,
  CtrDexV2.BigGenericListGroup,
]);

const AGGOR_MAP_CODES = new Set<string>([
  CtrDexV2.MapBodyGroup,
  CtrDexV2.BigMapBodyGroup,
  CtrDexV2.GenericMapGroup,
  CtrDexV2.BigGenericMapGroup,
]);

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
  return isAggorListCode(code) || isAggorMapCode(code);
}

interface AggorInit {
  structor: Structor;
  mapFields?: readonly MapperField[];
}

/**
 * Aggregate list/map structor primitive.
 *
 * KERIpy substance: `Aggor` represents counted aggregate list/map payload
 * groups and exposes either tuple/list items or semantic map fields.
 */
export class Aggor extends Structor {
  readonly kind: "list" | "map";
  readonly mapFields?: readonly MapperField[];

  constructor(init: AggorInit | Structor | ConstructorParameters<typeof Structor>[0]) {
    const payload = init instanceof Structor
      ? { structor: init }
      : "structor" in (init as AggorInit)
      ? (init as AggorInit)
      : { structor: new Structor(init as ConstructorParameters<typeof Structor>[0]) };

    super(payload.structor);
    if (!isAggorCode(this.code)) {
      throw new UnknownCodeError(
        `Expected aggregate list/map group code, got ${this.code}`,
      );
    }
    this.kind = isAggorMapCode(this.code) ? "map" : "list";
    this.mapFields = payload.mapFields;
  }

  /** Tuple/list payload items for aggregate-list families. */
  get listItems(): readonly GroupEntry[] | undefined {
    return this.kind === "list" ? this.items : undefined;
  }

  /** Hydrate from an already parsed counter-group node. */
  static override fromGroup(
    group: CounterGroupLike,
    sourceDomain: Extract<ColdCode, "txt" | "bny"> = "txt",
  ): Aggor {
    return new Aggor({ structor: Structor.fromGroup(group, sourceDomain) });
  }
}

/**
 * Parse aggregate attachment groups as list/map semantic containers.
 *
 * KERIpy substance: aggregate counters can represent generic lists or map-body
 * structures; this helper normalizes both into one discriminated result.
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

  const structor = parseStructor(
    input,
    version,
    cold,
    new Set([counter.code]),
    "aggregate list/map",
  );

  if (isAggorMapCode(structor.code)) {
    const map = parseCompactor(input, version, cold);
    return new Aggor({
      structor,
      mapFields: map.fields,
    });
  }

  if (isAggorListCode(structor.code)) {
    return new Aggor(structor);
  }
  throw new UnknownCodeError(`Expected aggregate list/map group code, got ${structor.code}`);
}
