/**
 * Counted-group transport wrappers for CESR tuple/list families.
 *
 * This file ports the transport/enclosure half of KERIpy `Structor`.
 *
 * Boundary rule:
 * - `Structor` owns counted-group framing, grouped serialization, and parser
 *   reconstruction of enclosed payload items
 * - `structing.ts` owns semantic fixed-field seal/blind/media records
 * - `disclosure.ts` owns blind/unblind/commit workflow verbs
 *
 * If you are looking for the meaning of fields like `d`, `u`, `td`, or `mt`,
 * this is the wrong file. `Structor` only knows how many items are in a group
 * and how that enclosed group serializes.
 */
import { b, codeB64ToB2, concatBytes, encodeB64, t } from "../../core/bytes.ts";
import { UnknownCodeError } from "../../core/errors.ts";
import type { CesrDomain } from "../../core/types.ts";
import { parseStructingGroup } from "../../parser/attachments.ts";
import type { Versionage } from "../../tables/table-types.ts";
import { CounterGroup } from "../base/counter.ts";
import type { Counter } from "../base/counter.ts";
import { OpaqueSpan } from "../base/opaque.ts";
import type { CounterGroupLike, GroupEntry } from "../base/primitive.ts";
import { isCounterGroupLike, isGroupTuple } from "../base/primitive.ts";

function toText(input: Uint8Array): string {
  return t(input);
}

/** Serialize graph entries directly so opaque bytes survive in their source domain. */
function serializeEntry(entry: GroupEntry, domain: CesrDomain): Uint8Array {
  if (entry instanceof OpaqueSpan) {
    if (entry.domain === domain) return entry.raw;
    return domain === "txt" ? b(encodeB64(entry.raw)) : codeB64ToB2(t(entry.raw));
  }
  if (isGroupTuple(entry)) {
    return concatBytes(...entry.map((item) => serializeEntry(item, domain)));
  }
  const head = domain === "txt" ? entry.qb64b : entry.qb2;
  return isCounterGroupLike(entry)
    ? concatBytes(head, ...entry.items.map((item) => serializeEntry(item, domain)))
    : head;
}

/** Constructor payload for rebuilding a structor from an already parsed group. */
export interface StructorInit {
  group: CounterGroupLike;
  sourceDomain?: CesrDomain;
  consumed?: number;
  serialized?: Uint8Array;
}

/**
 * Group primitive base class for counted CESR tuple/list attachment structures.
 *
 * KERIpy substance: `Structor` models one counted-group unit where tuple/list
 * members are hydrated CESR primitives and serialization remains deterministic.
 *
 * TypeScript boundary:
 * - subclasses like `Sealer`, `Blinder`, and `Mediar` specialize transport
 *   families
 * - semantic fixed-field values remain plain records outside this class
 */
export class Structor extends CounterGroup {
  readonly sourceDomain: CesrDomain;
  readonly consumed: number;
  readonly serialized: Uint8Array;

  constructor(init: Structor | StructorInit) {
    if (init instanceof Structor) {
      super(init, init.raw, init.items);
      this.sourceDomain = init.sourceDomain;
      this.serialized = init.serialized.slice();
      this.consumed = init.consumed;
      return;
    }

    const group = init.group;
    super(group as unknown as Counter, group.raw, group.items);

    this.sourceDomain = init.sourceDomain ?? "txt";
    this.serialized = init.serialized?.slice()
      ?? serializeEntry(group, this.sourceDomain);
    this.consumed = init.consumed ?? this.serialized.length;
  }

  /** Semantic clan/tag alias for KERIpy parity terminology (`name` in TS). */
  get clan(): string {
    return this.name;
  }

  /** Fully enclosed group serialization in text domain (`counter + payload`). */
  get qb64g(): string {
    return this.sourceDomain === "txt"
      ? toText(this.serialized)
      : encodeB64(this.serialized);
  }

  /** Fully enclosed group serialization in binary domain (`counter + payload`). */
  get qb2g(): Uint8Array {
    return this.sourceDomain === "bny"
      ? this.serialized.slice()
      : codeB64ToB2(this.qb64g);
  }

  /** Deterministic value-equivalence over full enclosed qb64 text form. */
  equalsStructor(other: { qb64g: string }): boolean {
    return this.qb64g === other.qb64g;
  }

  /** Hydrate a generic structor from an already parsed counter group. */
  static fromGroup(
    group: CounterGroupLike,
    sourceDomain: CesrDomain = "txt",
  ): Structor {
    return new Structor({ group, sourceDomain });
  }
}

/**
 * Parse counted structing transport without granting its codes attachment admission.
 *
 * Optional `allowedCodes` guard narrows acceptable group families for
 * subclass parsers (`Sealer`, `Blinder`, `Mediar`).
 */
export function parseStructor(
  input: Uint8Array,
  version: Versionage,
  cold: CesrDomain,
  allowedCodes?: ReadonlySet<string>,
  expectedFamily = "structor",
): Structor {
  const parsed = parseStructingGroup(input, version, cold);
  if (allowedCodes && !allowedCodes.has(parsed.group.code)) {
    throw new UnknownCodeError(
      `Expected ${expectedFamily} group code, got ${parsed.group.code}`,
    );
  }
  return new Structor({
    group: parsed.group,
    sourceDomain: cold,
    consumed: parsed.consumed,
    serialized: input.slice(0, parsed.consumed),
  });
}
