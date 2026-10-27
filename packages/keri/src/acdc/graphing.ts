/** Evaluate disclosed ACDC edge relationships over borrowed credential graph indexes. */
import { Saider, SealEvent, type SerderACDC } from "cesr-ts";
import type { Baser } from "../db/basing.ts";
import type { RegistryState } from "./regeventing.ts";
import { type SchemaValidation, simpleEdgeSchema, validateSchema } from "./scheming.ts";

/** Borrow credential nodes and caller-supplied traversal orders without projecting frames. */
export interface AcdcGraph {
  nodes: ReadonlyMap<string, { readonly body: SerderACDC }>;
  /** Caller traversal order, with the origin first. */
  order: readonly string[];
  /** Authenticated far nodes precede their parents. */
  dependencyOrder: readonly string[];
}
type MissingSchema = Extract<SchemaValidation, { kind: "missing" }>;
/** Absent edge evidence remains distinct from a disproved relationship. */
type RelationDependency = MissingSchema | { kind: "missingKel"; pre: string };
type UnknownNodeState = { kind: "unknownState"; said: string; state: string | null };
/** Existing dependency and unknown-state outcomes remain separate from a false relationship. */
export type AcdcRelationIssue = RelationDependency | UnknownNodeState;
type Relation = boolean | null | AcdcRelationIssue;
/** Reserved edge-section labels, shared with disclosure traversal. */
export const sectionLabels: ReadonlySet<string> = new Set(["d", "u", "o", "w"]);
/** Nested edge groups additionally admit a schema pin. */
export const groupLabels: ReadonlySet<string> = new Set([...sectionLabels, "s"]);
/** Reserved leaf labels for a far-node reference. */
export const nodeLabels: ReadonlySet<string> = new Set(["d", "u", "n", "s", "o", "w"]);
const unaryOps = new Set(["I2I", "NI2I", "DI2I", "E1E", "NOT"]);

/** SAD maps, including null-prototype maps, exclude scalar/array representations. */
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Python's empty section containers carry no disclosed edge semantics. */
function present(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : record(value) ? Object.keys(value).length > 0 : Boolean(value);
}
/** Return disclosed edge blocks, with null distinguishing malformed from absent. */
export function acdcEdgeBlocks(value: unknown): Record<string, unknown>[] | null {
  if (!present(value)) return [];
  if (record(value)) return [value];
  return Array.isArray(value) && value.every(record) ? value : null;
}

/** Shared edge interpretation: a target, group/opaque null, malformed false, or missing schema; never rewrites nodes. */
export function acdcEdgeTarget(
  near: SerderACDC,
  path: readonly string[],
  value: unknown,
  db: Baser,
): string | null | false | MissingSchema {
  if (path.length < 2 || path[0] !== "e" || path.slice(1).some((part) => nodeLabels.has(part))) return null;
  let ancestor: unknown = near.sad;
  for (const part of path) {
    if (record(ancestor)) {
      if ("n" in ancestor) return null;
      ancestor = ancestor[part];
    } else if (Array.isArray(ancestor) && /^\d+$/.test(part) && Number(part) < ancestor.length) {
      ancestor = ancestor[Number(part)];
    } else break;
  }
  let target: unknown;
  if (record(value)) {
    if (!("n" in value)) return null;
    const reserved = Object.keys(value).filter((key) => nodeLabels.has(key));
    const expected = [...nodeLabels].filter((key) => Object.hasOwn(value, key));
    if (reserved.some((key, i) => key !== expected[i] || Object.keys(value)[i] !== key)) return false;
    target = value.n;
  } else if (typeof value === "string") {
    const simple = simpleEdgeSchema(near, db, path);
    if (typeof simple === "object") return simple;
    if (!simple) return null;
    target = value;
  } else return null;
  if (typeof target !== "string") return false;
  try {
    return new Saider({ qb64: target }).qb64 === target ? target : false;
  } catch {
    // Qualified peer text can also fail in the primitive's base64 decoder.
    return false;
  }
}

/** Walk approved inception relationships without modifying delegation hints or imposing a depth policy. */
function delegatedIssuer(issuer: string, issuee: string, db: Baser): boolean | RelationDependency {
  let pre = issuer;
  while (pre !== issuee) {
    if (!db.getKever(pre)) return { kind: "missingKel", pre };
    const said = db.kels.getLast(pre, 0);
    const inception = said ? db.getEvtSerder(pre, said) : null;
    if (!inception) return { kind: "missingKel", pre };
    if (inception.ilk !== "dip" || !inception.delpre) return false;
    const delegator = inception.delpre;
    if (!db.getKever(delegator)) return { kind: "missingKel", pre: delegator };
    const parentSaid = db.kels.getLast(delegator, 0);
    const parent = parentSaid ? db.getEvtSerder(delegator, parentSaid) : null;
    if (!parent) return { kind: "missingKel", pre: delegator };
    if (parent.traits.includes("DND")) return false;
    let approved = false;
    for (const event of db.getEvtPreIter(delegator)) {
      // Only the DIP's ordinal-zero seal matters; unrelated application data stays opaque.
      if (
        event.seals.some((seal) =>
          SealEvent.isSad(seal) && seal.i === pre && seal.d === inception.said && /^0+$/.test(seal.s)
        )
      ) {
        approved = true;
        break;
      }
    }
    if (!approved) return { kind: "missingKel", pre: delegator };
    // DIP prefixes commit their delegator: a valid chain cannot contain a hash cycle.
    pre = delegator;
  }
  return true;
}

/** Only a visible block with absent/string i proves targeted or untargeted identity knowledge. */
function edgeIssuee(node: SerderACDC): { known: boolean; issuee: string | null } {
  const sad = node.sad!, aggregate = sad.A;
  const block = Object.hasOwn(sad, "a") ? sad.a : Array.isArray(aggregate) ? aggregate[1] : undefined;
  if (!record(block) || (Object.hasOwn(block, "i") && typeof block.i !== "string")) {
    return { known: false, issuee: null };
  }
  return { known: true, issuee: typeof block.i === "string" ? block.i : null };
}

/** Identity policy is separate from edge shape and additional far-node schema validation. */
function identityRelation(
  operators: readonly string[],
  near: SerderACDC,
  far: SerderACDC,
  db: Baser,
): boolean | null | RelationDependency {
  const farIssuee = edgeIssuee(far);
  const entity = operators.includes("E1E");
  let relation: "I2I" | "NI2I" | "DI2I" | undefined;
  for (const operator of operators) {
    if (operator === "I2I" || operator === "NI2I" || operator === "DI2I") relation = operator;
  }
  if (!relation && entity) relation = "NI2I";
  if (relation !== "NI2I" && !farIssuee.known) return null;
  relation ??= farIssuee.issuee ? "I2I" : "NI2I";
  if (entity) {
    const nearIssuee = edgeIssuee(near);
    if (!farIssuee.known || !nearIssuee.known) return null;
    if (!nearIssuee.issuee || !farIssuee.issuee || nearIssuee.issuee !== farIssuee.issuee) return false;
  }
  if (relation === "NI2I") return true;
  if (!farIssuee.issuee || !near.issuer) return false;
  if (near.issuer === farIssuee.issuee) return true;
  return relation === "DI2I" ? delegatedIssuer(near.issuer, farIssuee.issuee, db) : false;
}

/** Check one declared edge relation and its schema pin after the graph's issuer proofs pass. */
function leafRelation(
  group: Record<string, unknown>,
  near: SerderACDC,
  graph: AcdcGraph,
  inheritedSchemas: readonly unknown[],
  db: Baser,
  validities: ReadonlyMap<string, boolean>,
): Relation {
  if (typeof group.n !== "string") return null;
  const far = graph.nodes.get(group.n)?.body;
  if (!far) return null;
  const op = group.o;
  const operators = op == null || op === ""
    ? []
    : typeof op === "string"
    ? [op]
    : Array.isArray(op) && op.every((item) => typeof item === "string")
    ? op
    : null;
  if (!operators || operators.some((item) => !unaryOps.has(item))) return null;
  const identity = identityRelation(operators, near, far, db);
  if (typeof identity === "object") return identity;
  const pins = Object.hasOwn(group, "s") ? [...inheritedSchemas, group.s] : inheritedSchemas;
  let schemaMatches = true;
  for (const schema of pins) {
    if (typeof schema !== "string" && !record(schema)) return null;
    const supplied = typeof schema === "string" && record(far.schema) && far.schema.$id === schema
      ? far.schema
      : schema;
    const result = validateSchema(far, db, supplied);
    if (result.kind === "missing") return result;
    if (result.kind === "invalid") {
      if (result.subject === "schema") return null;
      schemaMatches = false;
    }
  }
  const valid = validities.get(group.n);
  if (valid === undefined) return null;
  return identity && schemaMatches && (operators.includes("NOT") ? !valid : valid);
}

/** Reduce every AND/OR/NAND/NOR member; unresolved evidence is never negated or hidden by a decisive sibling. */
function groupRelation(
  group: Record<string, unknown>,
  near: SerderACDC,
  graph: AcdcGraph,
  inheritedSchemas: readonly unknown[],
  nested: boolean,
  db: Baser,
  validities: ReadonlyMap<string, boolean>,
  path: readonly string[],
): Relation {
  const op = group.o ?? "AND";
  if (op !== "AND" && op !== "OR" && op !== "NAND" && op !== "NOR") return null;
  const labels = nested ? groupLabels : sectionLabels;
  const pins = nested && Object.hasOwn(group, "s") ? [...inheritedSchemas, group.s] : inheritedSchemas;
  const results: boolean[] = [];
  for (const [key, node] of Object.entries(group)) {
    if (labels.has(key)) continue;
    const target = acdcEdgeTarget(near, [...path, key], node, db);
    if (target === false) return null;
    if (typeof target === "object" && target !== null) return target;
    const result = typeof target === "string"
      ? leafRelation(record(node) ? node : { n: target }, near, graph, pins, db, validities)
      : record(node)
      ? groupRelation(node, near, graph, pins, true, db, validities, [...path, key])
      : null;
    if (result === null) return null;
    if (typeof result === "object") return result;
    results.push(result);
  }
  if (!results.length) return null;
  switch (op) {
    case "AND":
      return results.every(Boolean);
    case "OR":
      return results.some(Boolean);
    case "NAND":
      return !results.every(Boolean);
    case "NOR":
      return !results.some(Boolean);
  }
}

/** Preserve malformed/dependency outcomes separately from a disproved node relationship. */
function nodeRelations(
  near: SerderACDC,
  graph: AcdcGraph,
  db: Baser,
  validities: ReadonlyMap<string, boolean>,
): Relation {
  const edges = acdcEdgeBlocks(near.sad!.e);
  if (!edges) return null;
  let valid = true;
  for (const [index, edge] of edges.entries()) {
    if (Object.hasOwn(edge, "n")) return null;
    const matched = groupRelation(
      edge,
      near,
      graph,
      [],
      false,
      db,
      validities,
      Array.isArray(near.sad!.e) ? ["e", String(index)] : ["e"],
    );
    if (matched === null || typeof matched === "object") return matched;
    valid &&= matched;
  }
  return valid;
}

/**
 * Evaluate authenticated far-node validity before its parents. The issuance profile
 * uses the receiver's accepted observer state at this validation: issued/revoked.
 * Unknown vocabularies, malformed input and dependencies are never negated. The
 * origin is a disclosed message, not wallet acceptance of its own issuance state.
 * Callers authenticate issuer proofs and own-node schemas, and supply unique,
 * coherent graph indexes and traversal orders. This function does not establish
 * those prerequisites; a true relation verdict is neither exchange acceptance
 * nor wallet consent. Applications require an explicit true verdict before use;
 * null and dependency records remain unresolved rather than known false.
 */
export function evaluateAcdcRelations(
  graph: AcdcGraph,
  db: Baser,
  registrations: ReadonlyMap<string, RegistryState>,
): boolean | null | AcdcRelationIssue {
  const validities = new Map<string, boolean>();
  const origin = graph.order[0];
  for (const said of graph.dependencyOrder) {
    const near = graph.nodes.get(said)!.body;
    const matched = nodeRelations(near, graph, db, validities);
    if (matched === null || typeof matched === "object") return matched;
    let valid = matched;
    if (said !== origin && near.regid) {
      const state = registrations.get(said)?.state ?? null;
      if (state !== "issued" && state !== "revoked") return { kind: "unknownState", said, state };
      valid &&= state === "issued";
    }
    validities.set(said, valid);
  }
  return validities.get(origin) ?? null;
}
