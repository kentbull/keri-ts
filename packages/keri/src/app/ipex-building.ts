/** Pure v2 IPEX body construction and finite, cancellable byte-input preparation. */
import {
  collectPayload,
  discardFrame,
  nestedPayload,
  parseBytes,
  ResourceLimitError,
  SerderACDC,
  type SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import type { Operation } from "effection";
import { exchange, IPEX_V2_PREDECESSORS, isIpexVerb } from "../core/protocol-exchanging.ts";
import { abortable } from "./abortable.ts";
import { type DisclosurePlan, validDisclosurePlan } from "./ipex-graph.ts";
import type { IpexBuilderOptions, IpexMessage, IpexRoute } from "./ipexing.ts";

/** Explicit body inputs; opening a conversation requires a caller-supplied exchange id. */
export interface IpexV2BodyOptions extends Omit<IpexBuilderOptions, "version" | "pvrsn"> {
  message: string;
  recipient?: string;
  xid?: string;
  prior?: SerderKERI;
  plan?: DisclosurePlan;
  anchor?: boolean;
  /** KERIpy apply/offer/grant permit application-defined payload fields; named protocol inputs stay reserved. */
  attrs?: Record<string, unknown>;
}
const nodeIlks = new Set([null, "acm", "ace", "act", "acg"]);

/**
 * Construct an EXN body from parsed credential bodies, without reading or owning wire.
 * The first node is the origin SAID commitment; offer callers may send just that
 * commitment or borrow the frames' nestedPayloads. A commitment authenticates no
 * child signature. Conversation storage, signing and anchoring belong to callers.
 */
export function ipexExnBody(
  sender: string,
  route: IpexRoute,
  nodes: readonly SerderACDC[],
  options: IpexV2BodyOptions,
): SerderKERI {
  const verb = route.slice("/ipex/".length);
  if (route !== `/ipex/${verb}` || !isIpexVerb(verb)) {
    throw new Error("Unsupported IPEX route.");
  }
  if (nodes.length && verb !== "offer" && verb !== "grant") {
    throw new Error("Only offer and grant disclose credential nodes.");
  }
  if (nodes.some((node) => !(node instanceof SerderACDC) || !node.said || !nodeIlks.has(node.ilk))) {
    throw new Error("IPEX requires parsed disclosed ACDC nodes.");
  }
  if (new Set(nodes.map((node) => node.said)).size !== nodes.length) throw new Error("Duplicate IPEX credential node.");
  const prior = options.prior;
  let recipient = options.recipient;
  let xid = options.xid;
  if (prior) {
    if (
      prior.pvrsn.major !== 2 || verb === "apply"
      || !IPEX_V2_PREDECESSORS[verb].some((v) => prior.route === `/ipex/${v}`)
    ) {
      throw new Error("Unsupported IPEX prior route.");
    }
    if (!prior.sad!.ri || prior.sad!.ri !== sender || (recipient !== undefined && recipient !== prior.pre)) {
      throw new Error("IPEX reply parties do not match the prior.");
    }
    if (verb === "spurn" && prior.route === "/ipex/grant" && prior.sad!.p) {
      throw new Error("Only an opening grant may be spurned.");
    }
    recipient = prior.pre!;
    if (xid !== undefined && xid !== prior.sad!.x) throw new Error("IPEX reply exchange id differs from the prior.");
    xid = prior.sad!.x as string;
  } else if (!["apply", "offer", "grant"].includes(verb) || !recipient || !xid) {
    throw new Error("An IPEX opener requires a recipient and exchange id; replies require a prior.");
  }
  const attrs = { ...options.attrs };
  if (["m", "o", "ax"].some((key) => Object.hasOwn(attrs, key))) {
    throw new Error("Use named IPEX inputs for m, o and ax.");
  }
  attrs.m = options.message;
  const priorAnchor = (prior?.sad?.a as { ax?: boolean[] } | undefined)?.ax?.[0] === true;
  const anchor = options.anchor ?? (["agree", "admit"].includes(verb) && priorAnchor ? true : undefined);
  if (anchor !== undefined) {
    if (typeof anchor !== "boolean") throw new TypeError("IPEX anchor must be boolean.");
    attrs.ax = [anchor];
  }
  if (
    prior && ((["agree", "grant", "admit"].includes(verb) && (anchor === true) !== priorAnchor)
      || (verb === "offer" && priorAnchor && anchor !== true))
  ) throw new Error("IPEX reply must preserve the anchoring requirement.");
  let plan = options.plan;
  if (verb === "offer") plan ??= (prior?.sad?.q as { dp?: DisclosurePlan[] } | undefined)?.dp?.[0];
  if (verb === "agree") {
    if (plan?.length) throw new Error("IPEX agree must use an empty ditto plan.");
    plan = [];
  }
  if (verb === "grant" && plan === undefined) {
    if (prior || !nodes.length) plan = [];
    else if (nodes.length === 1) {
      const schema = nodes[0].schema;
      plan = [[
        typeof schema === "object" && schema !== null
          ? (schema as Record<string, unknown>).$id as string
          : schema as string,
        "/",
        [],
      ]];
    } else throw new Error("A grant with multiple nodes requires an explicit disclosure plan.");
  }
  const modifiers: { dp?: DisclosurePlan[] } = {};
  if (["apply", "offer", "agree", "grant"].includes(verb)) {
    if (!validDisclosurePlan(plan)) throw new Error("IPEX requires a valid disclosure plan.");
    modifiers.dp = [structuredClone(plan)];
  } else if (plan !== undefined) throw new Error("This IPEX route does not negotiate disclosure.");
  if (verb === "grant") {
    if (!prior && Boolean(plan!.length) !== Boolean(nodes.length)) {
      throw new Error("Opening grant nodes must match its disclosure obligation.");
    }
    attrs.o = nodes.length ? [nodes[0].said] : [];
  } else if (verb === "offer" && nodes.length) attrs.o = [nodes[0].said];
  return exchange(route, attrs, {
    sender,
    recipient,
    xid,
    dig: prior?.said ?? "",
    modifiers,
    stamp: options.stamp,
    date: options.date,
    kind: options.kind,
    pvrsn: Vrsn_2_0,
    gvrsn: options.gvrsn ?? Vrsn_2_0,
  })[0];
}

/**
 * Parse a finite stream of direct child messages once, then consume their nested
 * wire under one collection ceiling. This operation owns every parsed frame and
 * joins disposal on success, rejection and cancellation; no lazy owner escapes.
 * Returned nested bytes must share the enclosure with the parent's own proofs.
 */
export function* prepareIpexExn(
  sender: string,
  route: IpexRoute,
  wire: Uint8Array,
  options: IpexV2BodyOptions,
): Operation<IpexMessage> {
  return yield* abortable(async (signal) => {
    const limit = 8 * 1024 ** 2;
    if (wire.length > limit) throw new ResourceLimitError("IPEX input exceeds collection limit.");
    const frames = await parseBytes(wire, { signal });
    const errors: unknown[] = [];
    try {
      if (frames.some((frame) => !(frame.body instanceof SerderACDC) || frame.nests?.length)) {
        throw new Error("IPEX requires direct credential node frames.");
      }
      const body = ipexExnBody(sender, route, frames.map((frame) => frame.body as SerderACDC), options);
      const payloads = frames.map((frame) => nestedPayload(frame, Vrsn_2_0));
      const payload = {
        size: payloads.reduce((sum, child) => sum + child.size, 0),
        /** Borrow each frame only until collection completes or aborts. */
        async *open(signal?: AbortSignal) {
          for (const child of payloads) yield* child.open(signal);
        },
      };
      return [body, await collectPayload(payload, limit, signal)] as const;
    } catch (error) {
      errors.push(error);
      throw error;
    } finally {
      const results = await Promise.allSettled(frames.map(discardFrame));
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length) {
        // deno-lint-ignore no-unsafe-finally -- Preserve processing and cleanup failures together.
        throw new AggregateError(
          [...errors, ...failed.map((result) => result.reason)],
          "IPEX preparation cleanup failed.",
        );
      }
    }
  });
}
