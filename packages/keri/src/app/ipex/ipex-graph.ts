/** Borrowed IPEX frame DAGs, negotiated disclosure paths and traversal policy. */
import { type CesrFrame, Compactor, makePather, type MapperMap, Saider, SerderACDC } from "cesr-ts";
import {
  acdcEdgeBlocks as blocks,
  acdcEdgeTarget,
  type AcdcGraph,
  groupLabels,
  sectionLabels,
} from "../../acdc/graphing.ts";
import { fixedEdgeOrder, type SchemaValidation, verifyDisclosureClosure } from "../../acdc/scheming.ts";
import type { Baser } from "../../db/basing.ts";

/** One node selection: schema SAID, graph path and relative disclosure paths. */
export type DisclosurePlan = readonly (readonly [schema: string, path: string, fields: readonly string[]])[];
/** Graph indexes borrow the original frames and never transfer or dispose payload owners. */
export interface IpexGraph extends AcdcGraph {
  nodes: ReadonlyMap<string, CesrFrame & { body: SerderACDC }>;
}
const nodeIlks = new Set([null, "acm", "ace", "act", "acg"]);

/** Empty UUID marks field-map metadata; fixed-field public credentials keep that slot empty too. */
export function isIpexMetadata(node: SerderACDC): boolean {
  return [null, "acm", "ace"].includes(node.ilk) && node.sad!.u === "";
}

/** Offers carry bodies only; empty counted feet convey no child evidence. */
export function hasIpexNodeAttachments(frame: CesrFrame): boolean {
  return frame.attachments.some((group) => group.items.length > 0)
    || Boolean(frame.essrs?.length || frame.nests?.length);
}

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
/** Validate flat disclosure triples and their schema SAIDs without parsing child bytes. */
export function validDisclosurePlan(value: unknown): value is DisclosurePlan {
  if (!Array.isArray(value)) return false;
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 3) return false;
    const [schema, path, fields] = item;
    if (!validSaid(schema) || typeof path !== "string") return false;
    if (path !== "" && path !== "/") {
      if (!path.startsWith("/e/") || !path.endsWith("/_/")) return false;
      const parts = path.replace(/^\/+|\/+$/g, "").split("/");
      if (
        parts.some((part) => !part)
        || parts.some((part, i) => part === "_" && i < parts.length - 1 && parts[i + 1] !== "e")
      ) return false;
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
export function walkIpexGraph(
  origin: string,
  nests: readonly CesrFrame[],
  closed: boolean,
  db: Baser,
): IpexGraph | null | Extract<SchemaValidation, { kind: "missing" }> {
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
    const groups = edges.map((edge, index) => ({
      edge: edge as unknown,
      nested: false,
      path: Array.isArray(nodes.get(said)!.body.sad!.e) ? ["e", String(index)] : ["e"],
    }));
    for (let g = 0; g < groups.length; g++) {
      const { edge, nested, path } = groups[g];
      const target = acdcEdgeTarget(nodes.get(said)!.body, path, edge, db);
      if (target === false) return null;
      if (typeof target === "object" && target !== null) return target;
      if (typeof target === "string") {
        if (!nodes.has(target)) {
          if (closed) return null;
        } else {
          farNodes.add(target);
          if (!seen.has(target)) queue.push(target);
        }
      } else {
        if (!record(edge)) return null;
        const labels = nested ? groupLabels : sectionLabels;
        for (const [key, value] of Object.entries(edge)) {
          if (labels.has(key)) continue;
          groups.push({ edge: value, nested: true, path: [...path, key] });
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

/** Explicit selectors may omit unrequested nodes; positional selectors require fixed, gapless BFS shape. */
export function verifyIpexDisclosure(
  plan: DisclosurePlan,
  origin: string,
  graph: IpexGraph,
  db: Baser,
): boolean | Extract<SchemaValidation, { kind: "missing" }> {
  if (!plan.length || graph.order[0] !== origin) return false;
  const selected: string[] = [];
  let lastIndex = -1, positional = false;
  for (const [position, [schema, prefix, fields]] of plan.entries()) {
    if (prefix === "" && position >= graph.order.length) return false;
    let said = prefix === "" ? graph.order[position] : origin;
    positional ||= prefix === "" && position > 0;
    let node = graph.nodes.get(said);
    if (!node) return false;
    let value: unknown = node.body.sad;
    let edgePath: string[] = [];
    if (prefix !== "" && prefix !== "/") {
      for (const part of prefix.replace(/^\/+|\/+$/g, "").split("/")) {
        if (part === "_") {
          const target = acdcEdgeTarget(node.body, edgePath, value, db);
          if (typeof target === "object" && target !== null) return target;
          if (typeof target !== "string") return false;
          said = target;
          node = graph.nodes.get(said);
          if (!node) return false;
          value = node.body.sad;
          edgePath = [];
        } else {
          if (record(value) && Object.hasOwn(value, part)) value = value[part];
          else if (Array.isArray(value) && /^\d+$/.test(part) && Number(part) < value.length) {
            value = value[Number(part)];
          } else return false;
          edgePath.push(part);
        }
      }
    }
    const index = graph.order.indexOf(said);
    if (index <= lastIndex) return false;
    lastIndex = index;
    selected.push(said);
    const serder = node.body;
    const nodeSchema = serder.schema;
    if ((record(nodeSchema) ? nodeSchema.$id : nodeSchema) !== schema) return false;
    if ((prefix !== "" && fields.includes("")) || fields.includes("d/")) {
      for (const label of ["a", "e", "r"]) {
        const section = serder.sad![label];
        if (present(section) && !record(section)) return false;
      }
      if (present(serder.sad!.A) && !Array.isArray(serder.sad!.A)) return false;
      const closure = verifyDisclosureClosure(serder, db, ["d/"]);
      if (closure.kind !== "valid") return closure.kind === "missing" ? closure : false;
      continue;
    }
    const sections = new Map<string, string[]>();
    for (const field of fields) {
      if (!field) continue;
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
    const wholePaths = fields.filter((field) => field.endsWith("/"));
    if (wholePaths.length) {
      const closure = verifyDisclosureClosure(serder, db, wholePaths);
      if (closure.kind !== "valid") return closure.kind === "missing" ? closure : false;
    }
  }
  if (selected[0] !== origin) return false;
  if (positional) {
    if (!equal(selected, graph.order)) return false;
    for (const said of graph.order) {
      const fixed = fixedEdgeOrder(graph.nodes.get(said)!.body, db);
      if (fixed !== true) return fixed;
    }
  }
  return true;
}
