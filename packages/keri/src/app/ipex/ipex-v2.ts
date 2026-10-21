import { IPEX_V2_PREDECESSORS, type IpexVerb, isIpexVerb, nestedIpexRoute } from "../../core/protocol-exchanging.ts";
/** V2 IPEX route policy; v1 routing remains independently registered. */
import {
  type CesrFrame,
  Diger,
  ParserError,
  Prefixer,
  type SealSource,
  SerderACDC,
  type SerderKERI,
} from "cesr-ts";
import { type RegistryState, validateUpdate, verifyRegistryAnchor, vetBinds } from "../../acdc/regeventing.ts";
import type { RegistryStore } from "../../acdc/registering.ts";
import { validateSchema } from "../../acdc/scheming.ts";
import { DatabaseOperationError } from "../../core/errors.ts";
import { type ExchangeFactors, verifyExchangeProofs } from "../../core/exchange-proofing.ts";
import type { ExchangeRouteHandler, ExchangeRouteVerification } from "../exchanges/exchanging.ts";
import type { Habery } from "../identity/habbing.ts";
import type { Notifier } from "../notifications/notifying.ts";
import { envelopeFromFrame } from "../protocol/parsering.ts";
import {
  type DisclosurePlan,
  type IpexGraph,
  validDisclosurePlan,
  verifyIpexDisclosure,
  verifyIpexRelations,
  walkIpexGraph,
} from "./ipex-graph.ts";
import { acceptedRegistryEvidence, authenticateIpexNode } from "./ipex-node-authentication.ts";

type VerifyArgs = Parameters<NonNullable<ExchangeRouteHandler["verify"]>>[0];
type EvidenceArgs = Parameters<NonNullable<ExchangeRouteHandler["verifyEvidence"]>>[0];
/** SAD payloads include application-defined keys; named protocol fields are checked below before use. */
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Require the current single-DAG outer list shape. */
function single(value: unknown, type: "boolean" | "string" | "array"): value is [unknown] {
  return Array.isArray(value) && value.length === 1
    && (type === "array" ? Array.isArray(value[0]) : typeof value[0] === type);
}
/** Parsed exchange bodies retain the exact same ordered disclosure plan through dittos. */
function samePlan(a: DisclosurePlan, b: DisclosurePlan): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
/** The workflow owns a proof dependency cue and retry; no child is published here. */
function missing(reason: string): ExchangeRouteVerification {
  return { kind: "escrow", reason };
}

/**
 * Authenticate each disclosed node independently before Exchanger persists an EXN.
 * Registry evidence is caller-owned; notifier delivery follows durable acceptance.
 * Presentation registries require the retained receiver receipt and node-local proofs.
 */
export class IpexV2Handler implements ExchangeRouteHandler {
  readonly protocolMajor = 2;
  readonly acceptsSscs = true;
  readonly acceptsEvidence = true;
  readonly acceptsMissingEvidence: boolean;
  readonly acceptsNests: boolean;

  constructor(
    readonly resource: string,
    private readonly hby: Habery,
    private readonly notifier: Notifier | null = null,
    private readonly registry: RegistryStore | null = null,
  ) {
    this.acceptsMissingEvidence = resource === "/ipex/grant";
    this.acceptsNests = nestedIpexRoute(resource);
  }

  /**
   * Keep verified historical grant seals and current-key signatures, preferring a seal
   * for the same AID. Exchanger has already checked every supplied factor against
   * this exact body and accepted KEL; rotation cannot undo a recorded commitment.
   */
  verifyEvidence({ serder, factors, invalid, missing: unresolved = [] }: EvidenceArgs): ExchangeFactors | null {
    if (serder.route !== "/ipex/grant") {
      return invalid || unresolved.length || factors.tsgs.length || factors.cigars.length || factors.sourceSeals.length
        ? null
        : { tsgs: [], cigars: [], sourceSeals: [] };
    }
    const sourceSeals = [...factors.sourceSeals];
    const sealers = new Set(sourceSeals.map((seal) => seal.i.qb64));
    const tsgs = factors.tsgs.filter((group) => {
      const kever = this.hby.db.getKever(group.pre);
      return !sealers.has(group.pre) && kever && group.sn === BigInt(kever.lastEst.s) && group.said === kever.lastEst.d;
    });
    return { tsgs, cigars: factors.cigars.filter((cigar) => !sealers.has(cigar.verfer!.qb64)), sourceSeals };
  }

  /** Validate conversation, disclosure and authentication obligations in reference order. */
  verify({ serder, nests = [], sscs = [], evidence, receiverTime }: VerifyArgs): ExchangeRouteVerification {
    if (serder.pvrsn.major !== 2 || serder.route !== this.resource) return false;
    const route = serder.route.split("/");
    const verb = route[2];
    if (
      route.length !== 3 || route[0] !== "" || route[1] !== "ipex"
      || !isIpexVerb(verb)
    ) return false;
    const attrs = serder.sad!.a;
    const q = serder.sad!.q;
    const priorSaid = serder.sad!.p;
    if (!record(attrs) || !Object.hasOwn(attrs, "m") || !record(q)) return false;
    if (Object.hasOwn(attrs, "ax") && !single(attrs.ax, "boolean")) return false;
    if (["apply", "offer", "agree", "grant"].includes(verb)) {
      if (!single(q.dp, "array") || !validDisclosurePlan(q.dp[0])) return false;
    }
    if (verb === "agree" && (q.dp as unknown[][])[0].length) return false;
    if (verb === "offer") {
      if (Object.hasOwn(attrs, "o")) {
        if (!single(attrs.o, "string") || !this.validOrigin(attrs.o[0])) return false;
      } else if (nests.length) return false;
    } else if (verb !== "grant" && nests.length) return false;
    let previous: SerderKERI | null = null;
    if (!priorSaid) {
      if (!["apply", "offer", "grant"].includes(verb) || !serder.sad!.ri || !serder.sad!.x) return false;
    } else {
      if (verb === "apply" || typeof priorSaid !== "string") return false;
      previous = this.prior(verb, serder, priorSaid);
      if (!previous) return false;
    }
    const requiresAnchor = (attrs.ax as boolean[] | undefined)?.[0] === true;
    const priorAttrs = previous?.sad?.a;
    const priorAnchor = record(priorAttrs) && (priorAttrs.ax as boolean[] | undefined)?.[0] === true;
    if (previous) {
      if (["agree", "grant", "admit"].includes(verb) && requiresAnchor !== priorAnchor) return false;
      if (verb === "offer" && priorAnchor && !requiresAnchor) return false;
    }
    if (["agree", "admit"].includes(verb) && (requiresAnchor || priorAnchor)) {
      return sscs.length ? this.sourceAnchor(serder, serder.pre!, sscs.at(-1)!) : false;
    }
    if (verb === "offer" && nests.length) {
      const graph = walkIpexGraph((attrs.o as string[])[0], nests, false);
      return graph ? this.nodeSchemas(graph) : false;
    }
    if (verb !== "grant") return true;
    const plan = this.plan(serder);
    if (!plan) return false;
    if (previous) {
      const priorPlan = this.plan(previous);
      if (!priorPlan || !samePlan(plan, priorPlan)) return false;
    }
    if (!plan.length) {
      if (!Array.isArray(attrs.o) || attrs.o.length || nests.length) return false;
      return requiresAnchor || priorAnchor
        ? sscs.length ? this.sourceAnchor(serder, serder.pre!, sscs.at(-1)!) : false
        : true;
    }
    if (!single(attrs.o, "string") || !this.validOrigin(attrs.o[0]) || !nests.length) return false;
    const origin = attrs.o[0] as string;
    const graph = walkIpexGraph(origin, nests, true);
    if (!graph || !verifyIpexDisclosure(plan, origin, graph)) return false;
    const registrations = new Map<string, RegistryState>();
    for (const said of graph.order) {
      const frame = graph.nodes.get(said)!;
      const envelope = envelopeFromFrame(frame);
      if (!frame.body.regid && this.presentationRegistries(frame.body) === null) return false;
      const result = authenticateIpexNode(frame.body, envelope, this.hby.db, this.registry);
      if (result.kind === "missing") return missing(result.reason);
      if (result.kind === "reject") return false;
      if (result.registration) registrations.set(said, result.registration);
    }
    const schemas = this.nodeSchemas(graph);
    if (schemas !== true) return schemas;
    const relations = verifyIpexRelations(graph, this.hby.db, registrations);
    if (typeof relations === "object") {
      if (relations.kind === "unknownState") return false;
      if (relations.kind === "missingKel") return missing(`Missing delegation KEL approval for ${relations.pre}.`);
      return { kind: "escrow", reason: "Missing edge schema.", schema: relations.said };
    }
    if (!relations) return false;
    if (!evidence) return false; // Exchanger must supply its selected supplemental factor set.
    const tethered = new Set<string>();
    for (const said of graph.order) {
      const node = graph.nodes.get(said)!;
      const declarations = this.presentationRegistries(node.body);
      if (declarations === null) return false;
      if (declarations.length && !receiverTime) return false;
      for (const [issuee, registry] of declarations) {
        const result = this.presentation(node, registry, issuee, serder.said!, receiverTime!);
        if (result !== true) return result;
        tethered.add(issuee);
      }
    }
    if (requiresAnchor || priorAnchor) {
      const anchorers = tethered;
      if (sscs.length) {
        const result = this.sourceAnchor(serder, serder.pre!, sscs.at(-1)!);
        if (typeof result === "object") return result;
        if (result) anchorers.add(serder.pre!);
      }
      for (const seal of evidence?.sourceSeals ?? []) {
        const result = this.sourceAnchor(serder, seal.i.qb64, seal);
        if (typeof result === "object") return result;
        if (result) anchorers.add(seal.i.qb64);
      }
      const node = graph.nodes.get(origin)!.body;
      if (![serder.pre, node.issuee, node.issuer].some((aid) => aid && anchorers.has(aid))) return false;
    }
    return true;
  }

  /** Notify only after Exchanger has durably accepted the parent and its evidence. */
  handle({ serder }: Parameters<ExchangeRouteHandler["handle"]>[0]): void {
    this.notifier?.add({ r: `/exn${serder.route}`, d: serder.said, m: (serder.sad!.a as Record<string, unknown>).m });
  }

  /** Metadata offers withhold issuer proofs; grants call this only after every issuer authenticates. */
  private nodeSchemas(graph: IpexGraph): ExchangeRouteVerification {
    for (const said of graph.order) {
      const result = validateSchema(graph.nodes.get(said)!.body, this.hby.db);
      if (result.kind === "invalid") return false;
      if (result.kind === "missing") return { kind: "escrow", reason: "Missing node schema.", schema: result.said };
    }
    return true;
  }

  /** Origin commitments are SAIDs, never implicit signatures over the node. */
  private validOrigin(value: unknown): boolean {
    if (typeof value !== "string") return false;
    try {
      return new Diger({ qb64: value }).qb64 === value;
    } catch {
      return false;
    }
  }

  /** Enforce reciprocal parties, exchange id and the prior's single accepted response. */
  private prior(verb: Exclude<IpexVerb, "apply">, current: SerderKERI, said: string): SerderKERI | null {
    const prior = this.hby.db.exns.get(said);
    const previous = prior?.route?.split("/");
    if (
      !prior || previous?.length !== 3 || previous[0] !== "" || previous[1] !== "ipex"
      || !IPEX_V2_PREDECESSORS[verb].some((allowed) => allowed === previous[2])
    ) return null;
    if (verb === "spurn" && previous[2] === "grant" && prior.sad!.p) return null;
    if (
      current.sad!.ri !== prior.pre || !prior.sad!.ri || current.pre !== prior.sad!.ri
      || current.sad!.x !== prior.sad!.x
    ) return null;
    const response = this.hby.db.erpy.get(said);
    if (response && this.hby.db.exns.get(response.qb64)) return null;
    return prior;
  }

  /** Resolve empty-plan dittos only through accepted prior exchanges. */
  private plan(serder: SerderKERI): DisclosurePlan | null {
    const seen = new Set<string>();
    let current: SerderKERI | null = serder;
    while (current) {
      if (
        !current.said || seen.has(current.said)
        || !["/ipex/apply", "/ipex/offer", "/ipex/agree", "/ipex/grant"].includes(current.route ?? "")
      ) return null;
      seen.add(current.said);
      const q = current.sad!.q;
      if (!record(q) || !single(q.dp, "array") || !validDisclosurePlan(q.dp[0])) return null;
      if (q.dp[0].length) return q.dp[0];
      const prior: unknown = current.sad!.p;
      if (!prior) return [];
      current = typeof prior === "string" ? this.hby.db.exns.get(prior) : null;
    }
    return null;
  }

  /** Match the exact historical KEL commitment; missing evidence remains retryable. */
  private sourceAnchor(serder: SerderKERI, aid: string, seal: SealSource): ExchangeRouteVerification {
    const verified = verifyExchangeProofs(this.hby.db, serder, {
      sourceSeals: [{ i: new Prefixer({ qb64: aid }), s: seal.s, d: seal.d }],
    });
    if (verified.missing.length) return missing(`Missing anchorer KEL evidence for ${aid}.`);
    return !verified.invalid && verified.sourceSeals.length > 0;
  }

  /** Authenticate a grant target against this node's Issuee TEL and explicit fully witnessed KEL sources. */
  private presentation(
    frame: CesrFrame & { body: SerderACDC },
    regid: string,
    issuee: string,
    target: string,
    cutoff: string,
  ): ExchangeRouteVerification {
    const envelope = envelopeFromFrame(frame), blinders = [...envelope.bsqs, ...envelope.bsss];
    if (!blinders.length || !this.registry) return false;
    const chain = acceptedRegistryEvidence(this.registry, regid);
    if (!chain) return missing(`Missing presentation TEL evidence for ${regid}.`);
    const sources = new Map<string, string>();
    let unresolved = false;
    for (const seal of envelope.ssts) {
      if (seal.i.qb64 !== issuee) continue;
      const said = seal.s.num > BigInt(Number.MAX_SAFE_INTEGER)
        ? null
        : this.hby.db.kels.getLast(issuee, Number(seal.s.num));
      if (!said) {
        unresolved = true;
        continue;
      }
      if (said !== seal.d.qb64) continue;
      const anchor = this.hby.db.getEvtSerder(issuee, said);
      if (!anchor) {
        unresolved = true;
        continue;
      }
      // Inception can arrive before the update named by this source. A retry
      // between those messages must not turn missing TEL evidence into a bad binding.
      for (const tuple of anchor.seals) {
        if (
          !tuple || typeof tuple !== "object" || Array.isArray(tuple)
          || !("i" in tuple) || tuple.i !== regid || !("s" in tuple) || typeof tuple.s !== "string"
          || !/^[0-9a-f]+$/.test(tuple.s) || !("d" in tuple) || typeof tuple.d !== "string"
        ) continue;
        const sn = BigInt(`0x${tuple.s}`);
        if (sn <= BigInt(Number.MAX_SAFE_INTEGER) && !this.registry.seqSaider(regid, Number(sn))) unresolved = true;
      }
      for (const update of chain.updates) {
        const checked = validateUpdate(update, regid);
        if (checked.kind !== "valid") throw new DatabaseOperationError("Accepted presentation update is corrupt.");
        if (verifyRegistryAnchor(checked.event, { db: this.hby.db, issuer: issuee, number: seal.s, diger: seal.d })) {
          sources.set(update.said!, seal.d.qb64);
        }
      }
    }
    if (!sources.size && unresolved) return missing(`Missing presentation anchor source for ${regid}.`);
    const result = vetBinds({
      ...chain,
      db: this.hby.db,
      blinders,
      target,
      controller: issuee,
      cutoff,
      sources,
      requireSource: true,
    });
    if (result.kind === "missing" || (result.kind === "reject" && result.reason === "anchor" && unresolved)) {
      return missing(`Missing presentation TEL anchor for ${regid}.`);
    }
    return result.kind === "verified" && result.state.regid === regid;
  }

  /** Reject hidden requirements and preserve unique, validated Issuee/registry pairs in wire order. */
  private presentationRegistries(serder: SerderACDC): readonly (readonly [string, string])[] | null {
    const a = serder.sad!.a;
    const aggregate = serder.sad!.A;
    if (!serder.regid) {
      if (record(a) && a.rd) return null;
      const sections = Array.isArray(aggregate) ? aggregate.slice(1) : [aggregate];
      return sections.some((section) => record(section) && section.rd) ? null : [];
    }
    if (typeof a === "string" || typeof aggregate === "string") return null;
    const sections = record(a) ? [a] : [];
    if (Array.isArray(aggregate)) {
      if (!aggregate.slice(1).every(record)) return null;
      sections.push(...aggregate.slice(1) as Record<string, unknown>[]);
    } else if (record(aggregate)) sections.push(aggregate);
    const declarations: [string, string][] = [];
    for (const section of sections) {
      const regid = section.rd, issuee = section.i;
      if (!regid || !issuee) continue;
      if (typeof regid !== "string" || typeof issuee !== "string") return null;
      try {
        if (new Diger({ qb64: regid }).qb64 !== regid || new Prefixer({ qb64: issuee }).qb64 !== issuee) return null;
      } catch (error) {
        if (!(error instanceof ParserError)) throw error;
        return null;
      }
      if (!declarations.some(([aid, registry]) => aid === issuee && registry === regid)) {
        declarations.push([issuee, regid]);
      }
    }
    return declarations;
  }
}
