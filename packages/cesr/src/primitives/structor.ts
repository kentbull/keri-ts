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
import { b, codeB64ToB2, encodeB64, t } from "../core/bytes.ts";
import { UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { parseAttachmentDispatch } from "../parser/group-dispatch.ts";
import type { Versionage } from "../tables/table-types.ts";
import { CounterGroup } from "./counter.ts";
import type { Counter } from "./counter.ts";
import type { CounterGroupLike, GroupEntry } from "./primitive.ts";
import { isCounterGroupLike, isPrimitiveTuple } from "./primitive.ts";

type ParseDomain = Extract<ColdCode, "txt" | "bny">;

function toText(input: Uint8Array): string {
  return t(input);
}

function serializeEntryQb64(entry: GroupEntry): string {
  if (isPrimitiveTuple(entry)) {
    return entry.map((item) => serializeEntryQb64(item)).join("");
  }
  if (isCounterGroupLike(entry)) {
    return `${entry.qb64}${entry.items.map((item) => serializeEntryQb64(item)).join("")}`;
  }
  return entry.qb64;
}

function inferSerialized(
  group: CounterGroupLike,
  sourceDomain: ParseDomain,
): Uint8Array {
  const qb64 = `${group.qb64}${group.items.map((item) => serializeEntryQb64(item)).join("")}`;
  return sourceDomain === "txt" ? b(qb64) : codeB64ToB2(qb64);
}

/** Constructor payload for rebuilding a structor from an already parsed group. */
export interface StructorInit {
  group: CounterGroupLike;
  sourceDomain?: ParseDomain;
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
  readonly sourceDomain: ParseDomain;
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
      ?? inferSerialized(group, this.sourceDomain);
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
    sourceDomain: ParseDomain = "txt",
  ): Structor {
    return new Structor({ group, sourceDomain });
  }
}

/**
 * Parse one counted attachment group and hydrate it as `Structor`.
 *
 * Optional `allowedCodes` guard narrows acceptable group families for
 * subclass parsers (`Sealer`, `Blinder`, `Mediar`, `Aggor`).
 */
export function parseStructor(
  input: Uint8Array,
  version: Versionage,
  cold: ParseDomain,
  allowedCodes?: ReadonlySet<string>,
  expectedFamily = "structor",
): Structor {
  const parsed = parseAttachmentDispatch(input, version, cold);
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
