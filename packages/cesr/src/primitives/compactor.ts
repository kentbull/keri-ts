import { DeserializeError, UnknownCodeError } from "../core/errors.ts";
import type { ColdCode } from "../core/types.ts";
import { COMPACTOR_CODES } from "../tables/counter-groups.ts";
import type { Versionage } from "../tables/table-types.ts";
import { Mapper, type MapperInit, parseMapperBody } from "./mapper.ts";

type SadMap = Record<string, unknown>;

/**
 * `Compactor` builds on `Mapper` by adding the recursive tree semantics needed
 * for ACDC-style compact/disclose behavior.
 *
 * Read the classes in this order:
 * 1. `Mapper` explains how one map becomes one native map-group.
 * 2. `Compactor` explains how a tree of saidive maps becomes compact leaves,
 *    compact branches, and partially re-expanded disclosure variants.
 */

/**
 * `Compactor` extends `MapperInit` with the option to eagerly run the compact /
 * expand lifecycle during construction.
 */
export interface CompactorInit extends MapperInit {
  compactify?: boolean;
}

/**
 * CESR-native compactable map primitive.
 *
 * Maintainer mental model:
 * a `Compactor` is a `Mapper` plus the tree-walking utilities needed to turn
 * nested saidive maps into their "most compact" branch form and then re-expand
 * them into readable partial-disclosure variants. `leaves` records the saidive
 * map nodes discovered during tracing; `partials` records staged re-expansions.
 */
export class Compactor extends Mapper {
  /** Leaf-path index populated by `trace()`: dotted path -> saidified leaf mapper. */
  leaves: Record<string, Mapper>;
  /** Partially re-expanded disclosure variants built by `expand()`. */
  partials: Record<string, Compactor> | null;

  /**
   * Construct one compactable map primitive.
   *
   * If `compactify=true` and the input starts from semantic `mad`, the
   * constructor eagerly runs the compact + expand lifecycle so callers
   * immediately get both the compact current state and readable partials.
   */
  constructor(init: CompactorInit = {}) {
    super({
      ...init,
      saidive: init.saidive ?? true,
      verify: init.verify ?? true,
    });
    if (!COMPACTOR_CODES.has(this.code)) {
      throw new UnknownCodeError(
        `Expected map compactor group code, got ${this.code}`,
      );
    }
    this.leaves = {};
    this.partials = null;
    if (init.mad && (init.compactify ?? false)) {
      this.compact();
      this.expand();
    }
  }

  /** Primary SAID of the current map state, if its configured saidive label is present. */
  override get said(): string | null {
    const label = Object.keys(this.saids)[0];
    const value = this._mad[label];
    return typeof value === "string" ? value : null;
  }

  /**
   * True when the current map is fully compacted.
   *
   * `true` means the root map itself is a leaf and its own saidive value is the
   * compact representation. `false` means there are leaves but at least one
   * branch is still expanded. `null` means the map tree has no saidive leaves.
   */
  get iscompact(): boolean | null {
    const paths = Object.keys(this.leaves);
    if (paths.length === 0) {
      return null;
    }
    return this.said !== null && "" in this.leaves;
  }

  /** Return the nested tail value located at dotted `path`, or `null` when absent. */
  getTail(path: string, mad: SadMap | null = null): unknown {
    let tail: unknown = mad ?? this._mad;
    const parts = path.split(".").slice(1);
    for (const part of parts) {
      if (!tail || typeof tail !== "object" || Array.isArray(tail) || !(part in (tail as SadMap))) {
        return null;
      }
      tail = (tail as SadMap)[part];
    }
    return tail;
  }

  /**
   * Return the enclosing map and tail label for dotted `path`.
   *
   * Example:
   * path `.a.address` => returns the map stored at `.a` plus tail `"address"`.
   * path `` (top level) => returns `[null, ""]`.
   */
  getMad(path: string, mad: SadMap | null = null): [SadMap | null, string | null] {
    let current = mad ?? this._mad;
    const parts = path.split(".");
    const tail = parts.at(-1) ?? null;
    const parents = parts.slice(1, -1);
    if (parts.length <= 1) {
      return [null, tail];
    }
    for (const part of parents) {
      const next = current[part];
      if (!next || typeof next !== "object" || Array.isArray(next)) {
        return [null, tail];
      }
      current = next as SadMap;
    }
    if (tail !== null && tail !== "" && !(tail in current)) {
      return [null, null];
    }
    return [current, tail];
  }

  /**
   * Walk the nested map tree and index every saidive leaf by dotted path.
   *
   * When `saidify=true`, each leaf map is first rebuilt as a `Mapper` with
   * `makify=true` so its leaf SAID is computed before the path is recorded.
   */
  trace(saidify = false): string[] {
    this.leaves = {};
    const paths = this._trace(this._mad, [], "", saidify);

    if (saidify && this.iscompact === false) {
      // When nested leaves have just been saidified, the top-level map's own
      // SAID must also be recomputed over that updated structure.
      const top = Mapper.fromSad(this._mad, {
        strict: this.strict,
        saidive: true,
        saids: this.saids,
        kind: this.kind,
        makify: true,
        verify: false,
      });
      this._mad = top.mad;
      this.raw = top.raw;
      this.fields = top.fields;
      this.code = top.code;
      this.count = top.count;
      this.fullSize = top.fullSize;
      this.fullSizeB2 = top.fullSizeB2;
      this.totalSize = top.totalSize;
      this.totalSizeB2 = top.totalSizeB2;
    }

    return paths;
  }

  /** Apply the most-compact branch reduction recursively until the root is compact or no leaves exist. */
  compact(): void {
    while (true) {
      const paths = this.trace(true);
      for (const path of paths) {
        const leafer = this.leaves[path];
        const [mad, tail] = this.getMad(path);
        if (mad && tail) {
          // Replacing a nested leaf map with its SAID is the actual "compaction"
          // step. `trace(true)` did the saidification; this step does the branch
          // contraction.
          mad[tail] = leafer.said;
        }
      }

      if (paths.length === 0 || this.iscompact) {
        break;
      }
    }

    const rebuilt = Mapper.fromSad(this._mad, {
      strict: this.strict,
      saidive: true,
      saids: this.saids,
      kind: this.kind,
      verify: false,
    });
    this._mad = rebuilt.mad;
    this.raw = rebuilt.raw;
    this.fields = rebuilt.fields;
    this.code = rebuilt.code;
    this.count = rebuilt.count;
    this.fullSize = rebuilt.fullSize;
    this.fullSizeB2 = rebuilt.fullSizeB2;
    this.totalSize = rebuilt.totalSize;
    this.totalSizeB2 = rebuilt.totalSizeB2;
  }

  /**
   * Build readable partial-disclosure variants by progressively re-expanding compact leaves.
   *
   * `greedy=true` mirrors KERIpy’s preferred order: expand deeper leaves first
   * so each staged variant reveals as much structure as possible per step.
   */
  expand(greedy = true): void {
    this.partials = {};
    let paths = Object.keys(this.leaves);
    if (greedy) {
      paths = [...paths].reverse();
    }

    const used: string[] = [];
    if (paths.includes("")) {
      const top = this.leaves[""];
      const partial = new Compactor({
        mad: top.mad,
        verify: false,
        saidive: false,
        strict: this.strict,
        kind: this.kind,
      });
      partial.trace(false);
      this.partials[""] = partial;
      used.push("");
    }

    const pmad = this.mad;
    while (true) {
      const unused = paths.filter((path) => !used.includes(path));
      if (unused.length === 0) {
        break;
      }

      let created = false;
      for (const path of unused) {
        const [mad, tail] = this.getMad(path, pmad);
        if (!mad || !tail) {
          continue;
        }
        // Replacing one compact SAID with the full leaf map is the inverse
        // operation of `compact()`. Repeating this step builds a staircase of
        // disclosure variants from compact to expanded.
        mad[tail] = this.leaves[path].mad;
        used.push(path);
        created = true;
      }

      if (created) {
        const partial = new Compactor({
          mad: pmad,
          verify: false,
          saidive: false,
          strict: this.strict,
          kind: this.kind,
        });
        const index = partial.trace(false);
        this.partials[index.join("|")] = partial;
      } else {
        break;
      }
    }
  }

  private _trace(
    mad: SadMap,
    paths: string[],
    path: string,
    saidify: boolean,
  ): string[] {
    // A map is a leaf when it has one of the configured saidive labels at this
    // level and no descendant map with its own saidive field. That is the key
    // mental model for every compact/disclose operation in this class.
    let isLeaf = Object.keys(this.saids).some((label) => label in mad);

    for (const [label, value] of Object.entries(mad)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (label in this.saids) {
          throw new DeserializeError(`Got nested map in said field label=${label}`);
        }
        if (this._hasSaid(value as SadMap)) {
          isLeaf = false;
          this._trace(value as SadMap, paths, `${path}.${label}`, saidify);
        }
      }
    }

    if (isLeaf) {
      paths.push(path);
      // Each leaf is normalized through plain `Mapper` so `Compactor` stays
      // focused on tree traversal and branch replacement rather than duplicating
      // base map serialization logic.
      const leafer = Mapper.fromSad(mad, {
        strict: this.strict,
        saidive: true,
        saids: this.saids,
        kind: this.kind,
        makify: true,
        verify: false,
      });
      if (saidify) {
        for (const label of Object.keys(this.saids)) {
          if (label in mad && leafer.mad[label] !== undefined) {
            mad[label] = leafer.mad[label];
          }
        }
      }
      this.leaves[path] = leafer;
    }

    return paths;
  }

  private _hasSaid(mad: SadMap): boolean {
    // This recursive predicate is deliberately separate from `_trace()` because
    // the leaf test is the hardest part of compactor reasoning; keeping it in
    // one helper makes future parity changes less error-prone.
    for (const [label, value] of Object.entries(mad)) {
      if (label in this.saids) {
        return true;
      }
      if (
        value && typeof value === "object" && !Array.isArray(value)
        && this._hasSaid(value as SadMap)
      ) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Parse one CESR-native map body/group and hydrate it as a `Compactor`.
 *
 * Example:
 * a native section like `-GAB0J_dE...0J_x-GA...` becomes a `Compactor` whose
 * `.mad` is the readable nested object and whose `.qb64` is the exact native
 * map-group bytes used on the wire.
 */
export function parseCompactor(
  input: Uint8Array,
  version: Versionage,
  cold: Extract<ColdCode, "txt" | "bny">,
): Compactor {
  const mapper = parseMapperBody(input, version, cold);
  if (!COMPACTOR_CODES.has(mapper.code)) {
    throw new UnknownCodeError(
      `Expected map compactor group code, got ${mapper.code}`,
    );
  }
  return new Compactor({
    ...(cold === "txt" ? { raw: mapper.raw } : { qb2: input }),
    version,
    kind: "CESR",
    verify: false,
  });
}
