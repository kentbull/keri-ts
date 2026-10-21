import { DeserializeError, UnknownCodeError } from "../../core/errors.ts";
import type { CesrDomain } from "../../core/types.ts";
import { COMPACTOR_CODES } from "../../tables/counter-groups.ts";
import type { Versionage } from "../../tables/table-types.ts";
import { Mapper, type MapperInit, type MapperMap, type MapperValue, parseMapperBody } from "./mapper.ts";
import { makePather } from "./pather.ts";

type SadMap = MapperMap;

/**
 * `Compactor` builds on `Mapper` by adding the recursive tree semantics needed
 * for ACDC-style compact/disclose behavior.
 *
 * Read the classes in this order:
 * 1. `Mapper` explains how one map becomes one native map-group.
 * 2. `Compactor` explains how a tree of saidive maps becomes compact leaves,
 *    compact branches, and partially re-expanded disclosure variants.
 *
 * Boundary rule:
 * - this is the hierarchical map-disclosure mechanism
 * - it is not the same thing as fixed-field blinded disclosure in
 *   `disclosure.ts`
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
  /** Exact label paths keep dotted labels distinct from nested labels during disclosure. */
  private readonly leafPaths = new Map<string, { path: readonly string[]; mapper: Mapper }>();

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

  /** Expanded disclosures carry compact claims; retain wire checks without flat-map rehashing. */
  protected override verifySaidClaims(): void {
    // Compactor constructs disclosure variants, not authenticated maps. Serder
    // verifies compact credential commitments; Aggor verifies its visible maps.
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
    return Boolean(this.said) && Object.hasOwn(this.leaves, "");
  }

  /** Return the nested tail value located at dotted `path`, or `null` when absent. */
  getTail(path: string | readonly string[], mad: SadMap | null = null): MapperValue | null {
    let tail: MapperValue = mad ?? this._mad;
    const parts = typeof path === "string" ? path.split(".").slice(1) : path;
    for (const part of parts) {
      if (
        !tail || typeof tail !== "object" || Array.isArray(tail)
        || !Object.hasOwn(tail, part)
      ) {
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
  getMad(
    path: string | readonly string[],
    mad: SadMap | null = null,
  ): [SadMap | null, string | null] {
    const parts = typeof path === "string" ? path.split(".").slice(1) : [...path];
    if (!parts.length) return [null, ""];
    const tail = parts.pop()!;
    const parent = this.getTail(parts, mad);
    if (!parent || typeof parent !== "object" || Array.isArray(parent)) return [null, tail];
    return Object.hasOwn(parent, tail) ? [parent, tail] : [null, null];
  }

  /**
   * Walk the nested map tree and index every saidive leaf by dotted path.
   *
   * When `saidify=true`, each leaf map is first rebuilt as a `Mapper` with
   * `makify=true` so its leaf SAID is computed before the path is recorded.
   */
  trace(saidify = false): string[] {
    const paths = this._trace(this._mad, [], [], saidify);

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

  /**
   * Cache canonical leaves and compact every saidive branch. Optional SAD paths
   * restore one disclosure closure, with ancestors before descendants. A trailing
   * separator selects a whole subtree; numeric components select field ordinals.
   * Targeted calls consume the expanded input; use a fresh instance for another.
   */
  compact(paths: Iterable<string> | null = null, root: string | null = null): void {
    let disclosure: string[] | null = null;
    const marks = new Map<string, readonly string[]>();
    if (paths !== null) {
      if (typeof paths === "string" || typeof paths?.[Symbol.iterator] !== "function") {
        throw new DeserializeError("Disclosure paths must be an iterable of strings");
      }
      if (root !== null && typeof root !== "string") throw new DeserializeError("Invalid disclosure root");
      if (this.iscompact) throw new DeserializeError("Cannot disclose from compact mapping");
      disclosure = [...paths];
      let matched = false;
      for (const path of disclosure) {
        if (typeof path !== "string") throw new DeserializeError("Invalid disclosure path");
        let parts = makePather(path, { relative: true }).rparts;
        const whole = !parts.length || parts.at(-1) === "";
        if (root !== null) {
          if (parts[0] !== root) continue;
          parts = parts.slice(1);
        }
        matched = true;
        marks.set("[]", []);
        if (whole && parts.at(-1) === "") parts.pop();
        let tail: MapperValue = this._mad;
        let mark: readonly string[] = [];
        for (const part of parts) {
          if (!tail || typeof tail !== "object" || Array.isArray(tail)) {
            throw new DeserializeError(`Invalid disclosure path=${path}`);
          }
          const label: string | undefined = /^\d+$/.test(part) ? Object.keys(tail)[Number(part)] : part;
          if (label === undefined || !Object.hasOwn(tail, label)) {
            throw new DeserializeError(`Invalid disclosure path=${path}`);
          }
          tail = tail[label];
          mark = [...mark, label];
          marks.set(JSON.stringify(mark), mark);
        }
        if (whole) {
          if (!tail || typeof tail !== "object" || Array.isArray(tail)) {
            throw new DeserializeError(`Invalid disclosure node=${path}`);
          }
          const nodes: [readonly string[], SadMap][] = [[mark, tail]];
          while (nodes.length) {
            const [parent, node] = nodes.pop()!;
            for (const [label, value] of Object.entries(node)) {
              if (value && typeof value === "object" && !Array.isArray(value)) {
                const child = [...parent, label];
                marks.set(JSON.stringify(child), child);
                nodes.push([child, value]);
              }
            }
          }
        }
      }
      this.partials = {};
      if (!matched) disclosure = null;
    }

    for (;;) {
      const current: string[][] = [];
      const paths = this._trace(this._mad, [], [], true, current);
      let compacted = false;
      for (const path of current) {
        const leaf = this.leafPaths.get(JSON.stringify(path))!.mapper;
        const [mad, tail] = this.getMad(path);
        if (mad !== null && tail !== null) {
          mad[tail] = leaf.said;
          compacted = true;
        }
      }
      if (!paths.length || this.iscompact) break;
      if (!compacted) throw new DeserializeError("Unable to compact mapping");
    }
    // The frozen Compactor leaves raw at its pre-compaction snapshot. Keep our
    // existing current-map serialization contract; canonical Mapper bytes agree.
    this.rebuild();
    if (disclosure !== null) {
      const pmad = this.mad;
      for (const [key, path] of [...marks].sort((a, b) => a[1].length - b[1].length)) {
        const leaf = this.leafPaths.get(key);
        if (!path.length || !leaf) continue;
        const [mad, tail] = this.getMad(path, pmad);
        if (mad !== null && tail !== null) mad[tail] = leaf.mapper.mad;
      }
      const partial = new Compactor({
        mad: pmad,
        strict: this.strict,
        saids: this.saids,
        saidive: this.saidive,
        verify: false,
        kind: this.kind,
      });
      partial.trace();
      this.partials![disclosure.join("|")] = partial;
    }
  }

  /** Refresh serialized views after internal map mutation without rewriting its commitments. */
  private rebuild(): void {
    const rebuilt = Mapper.fromSad(this._mad, {
      strict: this.strict,
      saidive: this.saidive,
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
    let paths = [...this.leafPaths.keys()];
    if (greedy) {
      paths = [...paths].reverse();
    }

    const used: string[] = [];
    if (paths.includes("[]")) {
      const top = this.leafPaths.get("[]")!.mapper;
      const partial = new Compactor({
        mad: top.mad,
        verify: false,
        saidive: false,
        strict: this.strict,
        kind: this.kind,
      });
      partial.trace(false);
      this.partials[""] = partial;
      used.push("[]");
    }

    const pmad = this.mad;
    while (true) {
      const unused = paths.filter((path) => !used.includes(path));
      if (unused.length === 0) {
        break;
      }

      let created = false;
      for (const path of unused) {
        const leaf = this.leafPaths.get(path)!;
        const [mad, tail] = this.getMad(leaf.path, pmad);
        if (mad === null || tail === null) {
          continue;
        }
        // Replacing one compact SAID with the full leaf map is the inverse
        // operation of `compact()`. Repeating this step builds a staircase of
        // disclosure variants from compact to expanded.
        mad[tail] = leaf.mapper.mad;
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
    path: readonly string[],
    saidify: boolean,
    exact?: string[][],
  ): string[] {
    // A map is a leaf when it has one of the configured saidive labels at this
    // level and no descendant map with its own saidive field. That is the key
    // mental model for every compact/disclose operation in this class.
    let isLeaf = Object.keys(this.saids).some((label) => Object.hasOwn(mad, label));

    for (const [label, value] of Object.entries(mad)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (Object.hasOwn(this.saids, label)) {
          throw new DeserializeError(
            `Got nested map in said field label=${label}`,
          );
        }
        if (this._hasSaid(value as SadMap)) {
          isLeaf = false;
          this._trace(value as SadMap, paths, [...path, label], saidify, exact);
        }
      }
    }

    if (isLeaf) {
      const dotted = path.length ? `.${path.join(".")}` : "";
      paths.push(dotted);
      exact?.push([...path]);
      // Each leaf is normalized through plain `Mapper` so `Compactor` stays
      // focused on tree traversal and branch replacement rather than duplicating
      // base map serialization logic.
      const leafer = Mapper.fromSad(mad, {
        strict: this.strict,
        saidive: saidify,
        saids: this.saids,
        kind: this.kind,
        makify: true,
        verify: false,
      });
      if (saidify) {
        for (const label of Object.keys(this.saids)) {
          if (Object.hasOwn(mad, label) && leafer.mad[label] !== undefined) {
            mad[label] = leafer.mad[label];
          }
        }
      }
      this.leaves[dotted] = leafer;
      this.leafPaths.set(JSON.stringify(path), { path: [...path], mapper: leafer });
    }

    return paths;
  }

  private _hasSaid(mad: SadMap): boolean {
    // This recursive predicate is deliberately separate from `_trace()` because
    // the leaf test is the hardest part of compactor reasoning; keeping it in
    // one helper makes future parity changes less error-prone.
    for (const [label, value] of Object.entries(mad)) {
      if (Object.hasOwn(this.saids, label)) {
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
  cold: CesrDomain,
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
