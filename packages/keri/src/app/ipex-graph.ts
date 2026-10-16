/** Borrowed ACDC disclosure DAGs: structure, negotiated paths and edge semantics. */
import { type CesrFrame, Compactor, makePather, type MapperMap, Saider, SealEvent, SerderACDC } from "cesr-ts";
import type { RegistryState } from "../acdc/regeventing.ts";
import { type SchemaValidation, validateSchema } from "../acdc/scheming.ts";
import type { Baser } from "../db/basing.ts";

/** One node selection: schema SAID, graph path and relative disclosure paths. */
export type DisclosurePlan = readonly (readonly [schema: string, path: string, fields: readonly string[]])[];
/** Graph indexes borrow the original frames and never transfer or dispose payload owners. */
export interface IpexGraph {
  nodes: ReadonlyMap<string, CesrFrame & { body: SerderACDC }>;
  order: readonly string[];
  /** Far nodes precede their parents; disclosure still uses the independent BFS order. */
  dependencyOrder: readonly string[];
}
type MissingSchema = Extract<SchemaValidation, { kind: "missing" }>;
/** Absent edge evidence remains distinct from a disproved relationship. */
type RelationDependency = MissingSchema | { kind: "missingKel"; pre: string };
type UnknownNodeState = { kind: "unknownState"; said: string; state: string | null };
type RelationIssue = RelationDependency | UnknownNodeState;
type Relation = boolean | null | RelationIssue;
const sectionLabels = new Set(["d", "u", "o", "w"]);
const groupLabels = new Set([...sectionLabels, "s"]);
const nodeLabels = new Set(["d", "u", "n", "s", "o", "w"]);
const nodeIlks = new Set([null, "acm", "ace", "act", "acg"]);
const unaryOps = new Set(["I2I", "NI2I", "DI2I", "E1E", "NOT"]);

/** SAD maps, including null-prototype maps, exclude scalar/array representations. */
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Required SAIDs must have valid digest-qualified CESR material. */
function validSaid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Saider({ qb64: value }).qb64 === value;
  } catch {
    return false;
  }
}
/** Python's empty section containers carry no disclosed edge semantics. */
function present(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : record(value) ? Object.keys(value).length > 0 : Boolean(value);
}
/** Return disclosed edge blocks, with null distinguishing malformed from absent. */
function blocks(value: unknown): Record<string, unknown>[] | null {
  if (!present(value)) return [];
  if (record(value)) return [value];
  return Array.isArray(value) && value.every(record) ? value : null;
}

/** Validate the frozen single-DAG disclosure triple grammar without parsing child bytes. */
export function validDisclosurePlan(value: unknown): value is DisclosurePlan {
  if (!Array.isArray(value)) return false;
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 3) return false;
    const [schema, path, fields] = item;
    if (typeof schema !== "string" || typeof path !== "string") return false;
    if (path !== "/") {
      if (!path.startsWith("/") || !path.endsWith("/")) return false;
      const parts = path.replace(/^\/+|\/+$/g, "").split("/");
      if (parts.some((part) => !part) || parts.at(-1) !== "_") return false;
    }
    if (!Array.isArray(fields)) return false;
    if (fields.length === 1 && fields[0] === "") continue;
    for (const field of fields) {
      if (typeof field !== "string" || !field || field.startsWith("/")) return false;
      try {
        makePather(field, { relative: true });
      } catch {
        return false;
      }
    }
  }
  return true;
}

/**
 * Index unique disclosed credential nodes and walk their reachable graph in BFS order.
 * Offers may omit far nodes; grants require every referenced node. Nested ownership
 * does not make these nodes independently accepted runtime messages.
 */
export function walkIpexGraph(origin: string, nests: readonly CesrFrame[], closed: boolean): IpexGraph | null {
  const nodes = new Map<string, CesrFrame & { body: SerderACDC }>();
  for (const [index, frame] of nests.entries()) {
    const body = frame.body;
    if (
      !(body instanceof SerderACDC) || !body.verify() || !nodeIlks.has(body.ilk)
      || !body.said || (index === 0 && body.said !== origin) || nodes.has(body.said)
    ) return null;
    // Descendants are not additional implicit evidence for this disclosed node.
    if (frame.nests?.length) return null;
    nodes.set(body.said, frame as CesrFrame & { body: SerderACDC });
  }
  if (!nodes.has(origin)) return null;
  const seen = new Set<string>();
  const order: string[] = [];
  const dependencies = new Map<string, Set<string>>();
  const queue = [origin];
  for (let index = 0; index < queue.length; index++) {
    const said = queue[index];
    if (seen.has(said)) continue;
    seen.add(said);
    order.push(said);
    const farNodes = new Set<string>();
    dependencies.set(said, farNodes);
    const edges = blocks(nodes.get(said)!.body.sad!.e);
    if (!edges) return null;
    const groups = edges.map((edge) => ({ edge, nested: false }));
    for (let g = 0; g < groups.length; g++) {
      const { edge, nested } = groups[g];
      if (Object.hasOwn(edge, "n")) {
        if (Object.keys(edge).some((key) => !nodeLabels.has(key)) || !validSaid(edge.n)) return null;
        if (!nodes.has(edge.n)) {
          if (closed) return null;
        } else {
          farNodes.add(edge.n);
          if (!seen.has(edge.n)) queue.push(edge.n);
        }
      } else {
        const labels = nested ? groupLabels : sectionLabels;
        for (const [key, value] of Object.entries(edge)) {
          if (labels.has(key)) continue;
          if (!record(value)) return null;
          groups.push({ edge: value, nested: true });
        }
      }
    }
  }
  if (seen.size !== nodes.size) return null;
  const parents = new Map<string, Set<string>>();
  for (const [near, children] of dependencies) {
    for (const far of children) {
      if (!parents.has(far)) parents.set(far, new Set());
      parents.get(far)!.add(near);
    }
  }
  const dependencyOrder = order.filter((said) => dependencies.get(said)!.size === 0);
  for (let i = 0; i < dependencyOrder.length; i++) {
    for (const near of parents.get(dependencyOrder[i]) ?? []) {
      const children = dependencies.get(near)!;
      children.delete(dependencyOrder[i]);
      if (!children.size) dependencyOrder.push(near);
    }
  }
  return dependencyOrder.length === nodes.size ? { nodes, order, dependencyOrder } : null;
}

/** Compare SAD values structurally while retaining list order; map insertion order is not semantic here. */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => equal(item, b[i]));
  if (record(a) && record(b)) {
    return Object.keys(a).length === Object.keys(b).length
      && Object.entries(a).every(([key, value]) => Object.hasOwn(b, key) && equal(value, b[key]));
  }
  return false;
}

/** Require the plan to select every disclosed node in canonical breadth-first order. */
export function verifyIpexDisclosure(plan: DisclosurePlan, origin: string, graph: IpexGraph): boolean {
  const selected: string[] = [];
  for (const [schema, prefix, fields] of plan) {
    let said = origin;
    let node = graph.nodes.get(said);
    if (!node) return false;
    let value: unknown = node.body.sad;
    if (prefix !== "/") {
      for (const part of prefix.replace(/^\/+|\/+$/g, "").split("/")) {
        if (part === "_") {
          if (!record(value) || typeof value.n !== "string") return false;
          said = value.n;
          node = graph.nodes.get(said);
          if (!node) return false;
          value = node.body.sad;
        } else if (record(value) && Object.hasOwn(value, part)) value = value[part];
        else if (Array.isArray(value) && /^\d+$/.test(part) && Number(part) < value.length) value = value[Number(part)];
        else return false;
      }
    }
    selected.push(said);
    const serder = node.body;
    const nodeSchema = serder.schema;
    if ((record(nodeSchema) ? nodeSchema.$id : nodeSchema) !== schema) return false;
    if (fields.length === 1 && fields[0] === "") {
      for (const label of ["a", "e", "r"]) {
        const section = serder.sad![label];
        if (present(section) && !record(section)) return false;
      }
      if (present(serder.sad!.A) && !Array.isArray(serder.sad!.A)) return false;
      continue;
    }
    const sections = new Map<string, string[]>();
    for (const field of fields) {
      try {
        const pather = makePather(field, { relative: true });
        pather.resolve(serder.sad);
        const root = pather.rparts[0];
        if (root !== undefined) sections.set(root, [...(sections.get(root) ?? []), field]);
      } catch {
        return false;
      }
    }
    for (const [root, paths] of sections) {
      const section = serder.sad![root];
      if (!record(section)) continue;
      try {
        const compactor = new Compactor({
          mad: structuredClone(section) as MapperMap,
          makify: true,
          kind: serder.kind,
        });
        compactor.compact(paths, root);
        const partial = compactor.partials?.[paths.join("|")];
        if (!partial) return false;
        const expected = partial.mad;
        if (section.d === "" && expected.d) expected.d = "";
        if (!equal(expected, section)) return false;
      } catch {
        return false;
      }
    }
  }
  return equal(selected, graph.order);
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

/** Identity policy is separate from edge shape and additional far-node schema validation. */
function identityRelation(
  operators: readonly string[],
  near: SerderACDC,
  far: SerderACDC,
  db: Baser,
): boolean | RelationDependency {
  if (operators.includes("E1E") && (!near.issuee || !far.issuee || near.issuee !== far.issuee)) return false;
  // Preserve the reference E1E extension's entity-only path unless identity is explicit.
  let relation: "I2I" | "NI2I" | "DI2I" = far.issuee && !operators.includes("E1E") ? "I2I" : "NI2I";
  for (const operator of operators) {
    if (operator === "I2I" || operator === "NI2I" || operator === "DI2I") relation = operator;
  }
  if (relation === "NI2I") return true;
  if (!far.issuee || !near.issuer) return false;
  if (near.issuer === far.issuee) return true;
  return relation === "DI2I" ? delegatedIssuer(near.issuer, far.issuee, db) : false;
}

/** Check one declared edge relation and its schema pin after the graph's issuer proofs pass. */
function leafRelation(
  group: Record<string, unknown>,
  near: SerderACDC,
  graph: IpexGraph,
  inheritedSchema: unknown,
  db: Baser,
  validities: ReadonlyMap<string, boolean>,
): Relation {
  if (Object.keys(group).some((key) => !nodeLabels.has(key)) || typeof group.n !== "string") return null;
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
  const schema = Object.hasOwn(group, "s") ? group.s : inheritedSchema;
  let schemaMatches = true;
  if (schema != null) {
    if (typeof schema !== "string" && !record(schema)) return null;
    const result = validateSchema(far, db, schema);
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

/** Evaluate AND/OR edge groups; malformed members cannot be hidden by a passing sibling. */
function groupRelation(
  group: Record<string, unknown>,
  near: SerderACDC,
  graph: IpexGraph,
  inheritedSchema: unknown,
  nested: boolean,
  db: Baser,
  validities: ReadonlyMap<string, boolean>,
): Relation {
  const op = group.o ?? "AND";
  if (op !== "AND" && op !== "OR") return null;
  const labels = nested ? groupLabels : sectionLabels;
  const schema = nested && Object.hasOwn(group, "s") ? group.s : inheritedSchema;
  const results: boolean[] = [];
  for (const [key, node] of Object.entries(group)) {
    if (labels.has(key)) continue;
    if (!record(node)) return null;
    const result = Object.hasOwn(node, "n")
      ? leafRelation(node, near, graph, schema, db, validities)
      : groupRelation(node, near, graph, schema, true, db, validities);
    if (result === null) return null;
    if (typeof result === "object") return result;
    results.push(result);
  }
  return !results.length ? null : op === "OR" ? results.some(Boolean) : results.every(Boolean);
}

/** Preserve malformed/dependency outcomes separately from a disproved node relationship. */
function nodeRelations(
  near: SerderACDC,
  graph: IpexGraph,
  db: Baser,
  validities: ReadonlyMap<string, boolean>,
): Relation {
  const edges = blocks(near.sad!.e);
  if (!edges) return null;
  let valid = true;
  for (const edge of edges) {
    const matched = Object.hasOwn(edge, "n")
      ? leafRelation(edge, near, graph, null, db, validities)
      : groupRelation(edge, near, graph, null, false, db, validities);
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
 */
export function verifyIpexRelations(
  graph: IpexGraph,
  db: Baser,
  registrations: ReadonlyMap<string, RegistryState>,
): boolean | RelationIssue {
  const validities = new Map<string, boolean>();
  const origin = graph.order[0];
  for (const said of graph.dependencyOrder) {
    const near = graph.nodes.get(said)!.body;
    const matched = nodeRelations(near, graph, db, validities);
    if (matched === null) return false;
    if (typeof matched === "object") return matched;
    let valid = matched;
    if (said !== origin && near.regid) {
      const state = registrations.get(said)?.state ?? null;
      if (state !== "issued" && state !== "revoked") return { kind: "unknownState", said, state };
      valid &&= state === "issued";
    }
    validities.set(said, valid);
  }
  return validities.get(origin) ?? false;
}
