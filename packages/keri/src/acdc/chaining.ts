/**
 * Read-only ACDC chaining over caller-owned node verdicts; authentication and application state policy stay separate.
 *
 * KERIpy correspondence: the graph walk and Edge evaluation of upstream PR 1757's
 * `acdc.evaluating.EdgeEvaluator`. keri-ts keeps a functional seam: protocols
 * (IPEX) own node authentication and frame admission, then call `walkAcdcGraph`
 * and `evaluateChain` without this module knowing any disclosure protocol.
 */
import { ParserError, Saider, type SerderACDC } from "cesr-ts";
import { ValidationError } from "../core/errors.ts";
import { delegationAncestry } from "../core/kel/delegation-ancestry.ts";
import { Schemer } from "../core/scheming.ts";
import type { Baser } from "../db/basing.ts";
import { validateSchema } from "./scheming.ts";

/** Borrow a complete reachable DAG of verified credential views, with its origin first, without projecting frames. */
export interface AcdcGraph {
  nodes: ReadonlyMap<string, { readonly body: SerderACDC }>;
  order: readonly string[];
}

/** Reserved Edge-group labels include a pin at every level. The top-level Edge Section additionally forbids `w`. */
export const acdcGroupLabels: ReadonlySet<string> = new Set(["d", "u", "s", "o", "w"]);
const leafLabels = new Set([...acdcGroupLabels, "n"]);
const unary = new Set(["I2I", "NI2I", "DI2I", "E1E", "I1I", "DI1I", "NOT"]);
/** Latest-wins issuer-to-issuee group. */
const delegative = new Set(["I2I", "NI2I", "DI2I"]);
/** Latest-wins issuer-to-issuer group, independent of the delegative group; E1E composes with both. */
const issuerIdentity = new Set(["I1I", "DI1I"]);
/** Any explicit relation suppresses the implicit I2I/NI2I default. */
const suppressDefault = new Set([...delegative, "E1E", ...issuerIdentity]);
/** A truth verdict cannot absorb malformed input; callers represent that separately as null. */
export type ChainVerdict =
  | { kind: "valid" }
  | { kind: "invalid" }
  | { kind: "unknown"; retryable: boolean; reason: string; schemas: readonly string[] };

/** SAD maps exclude scalar/array edge representations. */
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Only canonical qualified digests identify expanded leaf targets, compact commitments and schema pins. */
function said(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Saider({ qb64: value }).qb64 === value;
  } catch {
    return false;
  }
}

/** One node's Edge Section: absent or empty, an opaque compact commitment, or one expanded top-level Edge-group. */
export type AcdcEdgeSection =
  | { kind: "none" }
  | { kind: "compact"; said: string }
  | { kind: "expanded"; section: Record<string, unknown> };

/**
 * Classify a node's `e` field; null is malformed.
 * Lists, falsy non-map values, non-SAID strings and a top-level `n` or `w` are
 * malformed. A compact SAID is a valid opaque terminal that names no far nodes.
 */
export function acdcEdgeSection(sad: Readonly<Record<string, unknown>>): AcdcEdgeSection | null {
  if (!Object.hasOwn(sad, "e")) return { kind: "none" };
  const value = sad.e;
  if (record(value)) {
    if (!Object.keys(value).length) return { kind: "none" };
    // The Edge Section is itself an Edge-group, never a leaf, and carries no weight.
    if (Object.hasOwn(value, "n") || Object.hasOwn(value, "w")) return null;
    return { kind: "expanded", section: value };
  }
  return said(value) ? { kind: "compact", said: value } : null;
}
/** Compact Edge strings name blocks, never far ACDCs. Expanded leaves have exact labels. */
export function acdcEdgeTarget(value: unknown): string | null | false {
  if (!record(value) || !Object.hasOwn(value, "n")) return null;
  return Object.keys(value).every((label) => leafLabels.has(label)) && said(value.n) ? value.n : false;
}

/**
 * Walk a disclosed graph of credential views from `origin` in BFS order.
 *
 * Every view must verify (including its carried section SAIDs) under its own
 * SAID key, every Edge Section must be well shaped, every disclosed node must be
 * reachable and the reachable graph must be acyclic. Closed walks also require
 * every expanded leaf target to be disclosed; open walks skip undisclosed ones.
 * Compact Edge Sections and compact Edge members are opaque terminals.
 * Protocol frame admission (ilks, nests, duplicates) belongs to the caller.
 */
export function walkAcdcGraph(
  origin: string,
  nodes: ReadonlyMap<string, { readonly body: SerderACDC }>,
  closed: boolean,
): string[] | null {
  for (const [id, { body }] of nodes) if (body.said !== id || !body.verify()) return null;
  if (!nodes.has(origin)) return null;
  const seen = new Set<string>();
  const order: string[] = [];
  const dependencies = new Map<string, Set<string>>();
  const queue = [origin];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    const farNodes = new Set<string>();
    dependencies.set(id, farNodes);
    const section = acdcEdgeSection(nodes.get(id)!.body.sad!);
    if (!section) return null;
    if (section.kind !== "expanded") continue;
    const groups: Record<string, unknown>[] = [section.section];
    for (let g = 0; g < groups.length; g++) {
      for (const [label, member] of Object.entries(groups[g])) {
        if (acdcGroupLabels.has(label)) continue;
        if (typeof member === "string") {
          if (!said(member)) return null;
          continue;
        }
        const target = acdcEdgeTarget(member);
        if (target === false) return null;
        if (target === null) {
          if (!record(member)) return null;
          groups.push(member);
        } else if (!nodes.has(target)) {
          if (closed) return null;
        } else {
          farNodes.add(target);
          if (!seen.has(target)) queue.push(target);
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
  const dependencyOrder = order.filter((id) => dependencies.get(id)!.size === 0);
  for (let i = 0; i < dependencyOrder.length; i++) {
    for (const near of parents.get(dependencyOrder[i]) ?? []) {
      const children = dependencies.get(near)!;
      children.delete(dependencyOrder[i]);
      if (!children.size) dependencyOrder.push(near);
    }
  }
  return dependencyOrder.length === nodes.size ? order : null;
}

/** Missing proof/pin dependencies retain their ordered schema causes for the existing escrow owner. */
function unknown(reason: string, retryable = false, schemas: readonly string[] = []): ChainVerdict {
  return { kind: "unknown", reason, retryable, schemas };
}
/** Strong conjunction/disjunction retain only outcome-relevant unknown dependencies. */
function reduce(op: "AND" | "OR", members: readonly ChainVerdict[]): ChainVerdict {
  const decisive = members.find((member) => member.kind === (op === "AND" ? "invalid" : "valid"));
  if (decisive) return decisive;
  const unresolved = members.filter((member) => member.kind === "unknown");
  if (unresolved.length) {
    return unknown(
      unresolved.map((member) => member.reason).join("; "),
      op === "AND" ? unresolved.every((member) => member.retryable) : unresolved.some((member) => member.retryable),
      unresolved.flatMap((member) => member.schemas),
    );
  }
  return { kind: op === "AND" ? "valid" : "invalid" };
}
/** Accepted delegation ancestry is the only evidence beyond the two ACDCs; missing KEL evidence can still arrive. */
function delegatedFrom(db: Baser, op: string, pre: string, ancestor: string): ChainVerdict {
  const ancestry = delegationAncestry(db, pre, ancestor);
  if (ancestry.kind === "valid") return { kind: "valid" };
  if (ancestry.kind === "refused") return { kind: "invalid" };
  return unknown(`${op} delegation evidence: ${ancestry.reason}`, true);
}

/**
 * Evaluate the unary relations of one leaf between its near and far ACDCs.
 *
 * Unrecognized tokens and the unimplemented NOT are non-retryable unknowns that
 * are ANDed with, not substituted for, the recognized relations. Absent any
 * explicit relation, I2I applies when the far node has an issuee, else NI2I.
 * The delegative and issuer-identity groups are each latest-wins.
 */
function leafRelation(db: Baser, ops: readonly string[], near: SerderACDC, far: SerderACDC): ChainVerdict {
  const relations: ChainVerdict[] = [];
  const unrecognized = ops.filter((token) => !unary.has(token));
  if (unrecognized.length) relations.push(unknown(`Unrecognized unary Edge operator ${unrecognized.join(", ")}.`));
  if (ops.includes("NOT")) relations.push(unknown("Unimplemented unary Edge operator NOT."));
  const operators = [...ops];
  if (!operators.some((token) => suppressDefault.has(token))) operators.push(far.issuee !== null ? "I2I" : "NI2I");
  const delegate = operators.findLast((token) => delegative.has(token));
  const identity = operators.findLast((token) => issuerIdentity.has(token));
  const truth = (value: boolean): ChainVerdict => ({ kind: value ? "valid" : "invalid" });

  if (operators.includes("E1E")) {
    relations.push(truth(Boolean(near.issuee && far.issuee && near.issuee === far.issuee)));
  }
  if (delegate === "I2I") relations.push(truth(Boolean(far.issuee && near.issuer === far.issuee)));
  if (delegate === "DI2I") {
    if (!near.issuer || !far.issuee) relations.push({ kind: "invalid" });
    else if (near.issuer !== far.issuee) relations.push(delegatedFrom(db, "DI2I", near.issuer, far.issuee));
  }
  // Issuer identity never reads issuees.
  if (identity) {
    if (!near.issuer || !far.issuer) relations.push({ kind: "invalid" });
    else if (near.issuer !== far.issuer) {
      relations.push(identity === "I1I" ? { kind: "invalid" } : delegatedFrom(db, "DI1I", near.issuer, far.issuer));
    }
  }
  return reduce("AND", relations);
}

/**
 * Validate every own schema, then conjoin each caller verdict with its complete edge expression.
 * Every branch is inspected for malformed shape, even when its truth value is unused.
 * Protocol callers supply issuer authentication; applications supply their state policy.
 * The graph must come from `walkAcdcGraph` (directly or through a protocol walk).
 * This helper reads schemas and KEL state but writes no records and publishes no cues.
 */
export function evaluateChain(
  graph: AcdcGraph,
  verdicts: ReadonlyMap<string, ChainVerdict>,
  db: Baser,
): ChainVerdict | null {
  // Own schemas are global obligations, unlike optional edge pins and node verdicts.
  for (const { body } of graph.nodes.values()) {
    const schema = validateSchema(body, db);
    if (schema.kind === "invalid") return null;
    if (schema.kind === "missing") return unknown(`Missing node schema ${schema.said}.`, true, [schema.said]);
  }
  const memo = new Map<string, ChainVerdict>();
  const evaluateNode = (id: string): ChainVerdict | null => {
    const cached = memo.get(id);
    if (cached) return cached;
    const node = graph.nodes.get(id)?.body, auth = verdicts.get(id);
    if (!node || !auth) return null;
    memo.set(id, unknown(`Node ${id} is already being evaluated.`));
    const section = acdcEdgeSection(node.sad!);
    if (!section) return null;
    const members: ChainVerdict[] = [auth];
    if (section.kind === "compact") {
      members.push(unknown(`Node ${id} carries compact Edge Section ${section.said}, which cannot be evaluated.`));
    } else if (section.kind === "expanded") {
      const result = evaluateGroup(section.section, node, []);
      if (!result) return null;
      members.push(result);
    }
    const result = reduce("AND", members);
    memo.set(id, result);
    return result;
  };
  const evaluateGroup = (
    group: Record<string, unknown>,
    near: SerderACDC,
    inherited: readonly unknown[],
  ): ChainVerdict | null => {
    const pins = Object.hasOwn(group, "s") ? [...inherited, group.s] : inherited;
    const op = Object.hasOwn(group, "o") ? group.o : "AND";
    if (typeof op !== "string") return null;
    const members: ChainVerdict[] = [];
    for (const [label, member] of Object.entries(group)) {
      if (acdcGroupLabels.has(label)) continue;
      if (typeof member === "string") {
        if (!said(member)) return null;
        members.push(unknown(`Compact Edge ${label} cannot be dereferenced.`));
        continue;
      }
      const target = acdcEdgeTarget(member);
      if (target === false || !record(member)) return null;
      const result = target === null ? evaluateGroup(member, near, pins) : evaluateLeaf(member, target, near, pins);
      if (!result) return null;
      members.push(result);
    }
    if (!members.length) return null;
    return op === "AND" || op === "OR" ? reduce(op, members) : unknown(`Unsupported Edge-group operator ${op}.`);
  };
  const evaluateLeaf = (
    edge: Record<string, unknown>,
    target: string,
    near: SerderACDC,
    inherited: readonly unknown[],
  ): ChainVerdict | null => {
    const far = graph.nodes.get(target)?.body;
    if (!far) return null;
    const pins = Object.hasOwn(edge, "s") ? [...inherited, edge.s] : inherited;
    const op = edge.o;
    const ops = op == null ? [] : typeof op === "string" ? [op] : Array.isArray(op) ? [...op] : null;
    if (!ops || !ops.every((token) => typeof token === "string")) return null;
    // Pin shape is morphological, so validate it before unsupported tokens or relations.
    const resolved: (string | Record<string, unknown>)[] = [];
    const ownSchema = far.schema;
    const ownSchemaId = record(ownSchema) ? ownSchema.$id : ownSchema;
    if (pins.length && typeof ownSchemaId !== "string") return null;
    for (const pin of pins) {
      if (typeof pin === "string") {
        if (!said(pin)) return null;
        resolved.push(pin);
      } else if (record(pin)) {
        if (typeof pin.$id !== "string") return null;
        try {
          if (new Schemer({ sed: structuredClone(pin) }).said !== pin.$id) return null;
        } catch (error) {
          if (error instanceof ValidationError || error instanceof ParserError) return null;
          throw error;
        }
        resolved.push(pin);
      } else return null;
    }
    const relation = leafRelation(db, ops as string[], near, far);
    const own = [relation];
    // A decided relation refusal needs no pin evidence; otherwise every pin is evaluated, not only the first failure.
    if (relation.kind !== "invalid") {
      for (let pin of resolved) {
        if (pin === ownSchemaId && record(ownSchema)) pin = ownSchema;
        const result = validateSchema(far, db, pin);
        if (result.kind === "valid") continue;
        own.push(
          result.kind === "missing"
            ? unknown(`Missing edge schema ${result.said}.`, true, [result.said])
            : { kind: "invalid" },
        );
      }
    }
    // Do not short-circuit a far subtree: its shape cannot be outvoted by this leaf.
    const farVerdict = evaluateNode(target);
    return farVerdict ? reduce("AND", [reduce("AND", own), farVerdict]) : null;
  };
  return graph.order.length ? evaluateNode(graph.order[0]) : null;
}
