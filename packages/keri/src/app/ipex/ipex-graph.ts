/** Borrowed IPEX frame DAGs, negotiated disclosure paths and traversal policy. */
import { type CesrFrame, Compactor, makePather, type MapperMap, SerderACDC } from "cesr-ts";
import { type AcdcGraph, type AcdcWalkPolicy, walkAcdcGraph } from "../../acdc/chaining.ts";

/** One node selection: schema query, graph path and relative disclosure paths. */
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
/** Python's empty section containers carry no disclosed edge semantics. */
function present(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : record(value) ? Object.keys(value).length > 0 : Boolean(value);
}
/** Validate disclosure-query shape; actual schema commitments are checked against disclosed nodes. */
export function validDisclosurePlan(value: unknown): value is DisclosurePlan {
  if (!Array.isArray(value)) return false;
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 3) return false;
    const [schema, path, fields] = item;
    if (typeof schema !== "string" || typeof path !== "string") return false;
    if (path !== "/") {
      if (!path.startsWith("/") || !path.endsWith("/")) return false;
      const parts = path.replace(/^\/+|\/+$/g, "").split("/");
      if (
        parts.some((part) => !part) || parts.at(-1) !== "_"
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

/** Decode exactly one wire DAG without accepting the retired flat q.dp shape. */
export function singleDagDisclosurePlan(value: unknown): DisclosurePlan | null {
  return Array.isArray(value) && value.length === 1 && validDisclosurePlan(value[0]) ? value[0] : null;
}

/**
 * Index unique disclosed credential frames, then delegate the graph walk to `walkAcdcGraph`.
 * Offers always walk open; Grants use the caller's walk policy. Nested ownership
 * does not make these nodes independently accepted runtime messages.
 */
export function walkIpexGraph(
  origin: string,
  nests: readonly CesrFrame[],
  walk: AcdcWalkPolicy,
): IpexGraph | null {
  const nodes = new Map<string, CesrFrame & { body: SerderACDC }>();
  for (const [index, frame] of nests.entries()) {
    const body = frame.body;
    if (
      !(body instanceof SerderACDC) || !nodeIlks.has(body.ilk)
      || !body.said || (index === 0 && body.said !== origin) || nodes.has(body.said)
    ) return null;
    // Descendants are not additional implicit evidence for this disclosed node.
    if (frame.nests?.length) return null;
    nodes.set(body.said, frame as CesrFrame & { body: SerderACDC });
  }
  const order = walkAcdcGraph(origin, nodes, walk);
  return order ? { nodes, order, walk } : null;
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

/** Select every disclosed node in exact BFS order using literal SAD paths and virtual far-node hops. */
export function verifyIpexDisclosure(
  plan: DisclosurePlan,
  origin: string,
  graph: IpexGraph,
): boolean {
  if (!plan.length || graph.order[0] !== origin) return false;
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
          const target = value.n;
          said = target;
          node = graph.nodes.get(said);
          if (!node) return false;
          value = node.body.sad;
        } else {
          if (record(value) && Object.hasOwn(value, part)) value = value[part];
          else if (Array.isArray(value) && /^\d+$/.test(part) && Number(part) < value.length) {
            value = value[Number(part)];
          } else return false;
        }
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
