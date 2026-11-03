/** IPEX admission's read-only graph reduction; application EGF/state policy stays separate. */
import { ParserError, Saider, type SerderACDC } from "cesr-ts";
import { acdcEdgeBlocks } from "../../acdc/graphing.ts";
import { validateSchema } from "../../acdc/scheming.ts";
import { ValidationError } from "../../core/errors.ts";
import { Schemer } from "../../core/scheming.ts";
import type { Baser } from "../../db/basing.ts";
import type { IpexGraph } from "./ipex-graph.ts";
import type { IpexNodeAuthentication } from "./ipex-node-authentication.ts";

/** Reserved IPEX section/group labels include a pin at every level. */
export const ipexGroupLabels: ReadonlySet<string> = new Set(["d", "u", "s", "o", "w"]);
const leafLabels = new Set([...ipexGroupLabels, "n"]);
const unary = new Set(["I2I", "NI2I", "DI2I", "E1E", "NOT"]);
const delegative = new Set(["I2I", "NI2I", "DI2I"]);
const suppressDefault = new Set([...delegative, "E1E"]);
/** A truth verdict cannot absorb malformed input; callers represent that separately as null. */
export type IpexChainVerdict =
  | { kind: "valid" }
  | { kind: "invalid" }
  | { kind: "unknown"; retryable: boolean; reason: string; schemas: readonly string[] };

/** SAD maps exclude scalar/array edge representations. */
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Only canonical qualified digests identify expanded leaf targets and schema pins. */
function said(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Saider({ qb64: value }).qb64 === value;
  } catch {
    return false;
  }
}
/** Compact Edge strings name blocks, never far ACDCs. Expanded leaves have exact labels. */
export function ipexEdgeTarget(value: unknown): string | null | false {
  if (!record(value) || !Object.hasOwn(value, "n")) return null;
  return Object.keys(value).every((label) => leafLabels.has(label)) && said(value.n) ? value.n : false;
}
/** Missing proof/pin dependencies retain their ordered schema causes for the existing escrow owner. */
function unknown(reason: string, retryable = false, schemas: readonly string[] = []): IpexChainVerdict {
  return { kind: "unknown", reason, retryable, schemas };
}
/** Strong conjunction/disjunction retain only outcome-relevant unknown dependencies. */
function reduce(op: "AND" | "OR", members: readonly IpexChainVerdict[]): IpexChainVerdict {
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

/**
 * Evaluate the origin after disclosure, own schemas, presentations and ax have vetted.
 * Every branch is inspected for malformed shape, even when its truth value is unused.
 * Own issuer authentication is conjoined with own edges; authenticated registry states
 * are evidence only. This helper reads schemas but writes no records and publishes no cues.
 */
export function evaluateIpexChain(
  graph: IpexGraph,
  authentications: ReadonlyMap<string, IpexNodeAuthentication>,
  db: Baser,
): IpexChainVerdict | null {
  const memo = new Map<string, IpexChainVerdict>();
  const evaluateNode = (id: string): IpexChainVerdict | null => {
    const cached = memo.get(id);
    if (cached) return cached;
    const node = graph.nodes.get(id)?.body, authentication = authentications.get(id);
    if (!node || !authentication) return null;
    memo.set(id, unknown(`Node ${id} is already being evaluated.`));
    const auth: IpexChainVerdict = authentication.kind === "authenticated"
      ? { kind: "valid" }
      : authentication.kind === "reject"
      ? { kind: "invalid" }
      : unknown(authentication.reason, true);
    const blocks = acdcEdgeBlocks(node.sad!.e);
    if (!blocks) return null;
    const members: IpexChainVerdict[] = [auth];
    for (const block of blocks) {
      const result = evaluateEdge(block, node, []);
      if (!result) return null;
      members.push(result);
    }
    const result = reduce("AND", members);
    memo.set(id, result);
    return result;
  };
  const evaluateEdge = (
    edge: Record<string, unknown>,
    near: SerderACDC,
    inherited: readonly unknown[],
  ): IpexChainVerdict | null => {
    const target = ipexEdgeTarget(edge);
    if (target === false) return null;
    const pins = Object.hasOwn(edge, "s") ? [...inherited, edge.s] : inherited;
    if (target !== null) return evaluateLeaf(edge, target, near, pins);
    const op = Object.hasOwn(edge, "o") ? edge.o : "AND";
    if (typeof op !== "string") return null;
    const members: IpexChainVerdict[] = [];
    for (const [label, member] of Object.entries(edge)) {
      if (ipexGroupLabels.has(label)) continue;
      if (typeof member === "string") {
        members.push(unknown(`Compact Edge ${label} cannot be dereferenced.`));
      } else {
        if (!record(member)) return null;
        const result = evaluateEdge(member, near, pins);
        if (!result) return null;
        members.push(result);
      }
    }
    if (!members.length) return null;
    return op === "AND" || op === "OR" ? reduce(op, members) : unknown(`Unsupported Edge-group operator ${op}.`);
  };
  const evaluateLeaf = (
    edge: Record<string, unknown>,
    target: string,
    near: SerderACDC,
    pins: readonly unknown[],
  ): IpexChainVerdict | null => {
    const far = graph.nodes.get(target)?.body;
    if (!far) return null;
    const op = edge.o;
    const ops = op == null ? [] : typeof op === "string" ? [op] : Array.isArray(op) ? [...op] : null;
    if (!ops) return null;
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
    let own: IpexChainVerdict;
    if (ops.some((token) => typeof token !== "string" || !unary.has(token))) {
      own = unknown("Unrecognized unary Edge operator.");
    } else {
      const operators = ops as string[];
      if (!operators.some((token) => suppressDefault.has(token))) operators.push(far.issuee !== null ? "I2I" : "NI2I");
      const delegate = operators.findLast((token) => delegative.has(token));
      if (operators.includes("NOT") || delegate === "DI2I") {
        own = unknown("Unimplemented unary Edge operator.");
      } else {
        const matched = (!operators.includes("E1E") || Boolean(near.issuee && far.issuee && near.issuee === far.issuee))
          && (delegate !== "I2I" || Boolean(far.issuee && near.issuer === far.issuee));
        own = { kind: matched ? "valid" : "invalid" };
        if (matched) {
          for (let pin of resolved) {
            if (pin === ownSchemaId && record(ownSchema)) pin = ownSchema;
            const result = validateSchema(far, db, pin);
            if (result.kind === "valid") continue;
            own = result.kind === "missing"
              ? unknown(`Missing edge schema ${result.said}.`, true, [result.said])
              : { kind: "invalid" };
            break;
          }
        }
      }
    }
    // Do not short-circuit a far subtree: its shape cannot be outvoted by this leaf.
    const farVerdict = evaluateNode(target);
    return farVerdict ? reduce("AND", [own, farVerdict]) : null;
  };
  return graph.order.length ? evaluateNode(graph.order[0]) : null;
}
