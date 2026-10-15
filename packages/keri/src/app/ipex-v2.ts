import { IPEX_V2_PREDECESSORS, type IpexVerb, isIpexVerb, nestedIpexRoute } from "../core/protocol-exchanging.ts";
/** V2 IPEX route policy; v1 routing remains independently registered. */
import {
  type CesrFrame,
  Diger,
  NumberPrimitive,
  ParserError,
  Prefixer,
  ResourceLimitError,
  type SealEvent,
  type SealSource,
  SerderACDC,
  type SerderKERI,
} from "cesr-ts";
import { validateRip, validateUpdate, verifyRegistryAnchor, vetBinds } from "../acdc/regeventing.ts";
import type { RegistryStore } from "../acdc/registering.ts";
import { validateSchema } from "../acdc/scheming.ts";
import { TransIdxSigGroup } from "../core/dispatch.ts";
import { DatabaseOperationError } from "../core/errors.ts";
import { type ExchangeFactors, verifyExchangeProofs } from "../core/exchange-proofing.ts";
import type { ExchangeRouteHandler, ExchangeRouteVerification } from "./exchanging.ts";
import type { Habery } from "./habbing.ts";
import {
  type DisclosurePlan,
  type IpexGraph,
  validDisclosurePlan,
  verifyIpexDisclosure,
  verifyIpexRelations,
  walkIpexGraph,
} from "./ipex-graph.ts";
import type { Notifier } from "./notifying.ts";
import { envelopeFromFrame } from "./parsering.ts";

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

  /** Select only fresh foreign grant evidence, preferring a seal to the same AID's signatures. */
  verifyEvidence({ serder, factors, invalid, missing: unresolved = [] }: EvidenceArgs): ExchangeFactors | null {
    if (serder.route !== "/ipex/grant") {
      return invalid || unresolved.length || factors.tsgs.length || factors.cigars.length || factors.sourceSeals.length
        ? null
        : { tsgs: [], cigars: [], sourceSeals: [] };
    }
    const sourceSeals = factors.sourceSeals.filter((seal) => {
      const kever = this.hby.db.getKever(seal.i.qb64);
      if (!kever || seal.s.num < BigInt(kever.lastEst.s)) return false;
      return seal.s.num === BigInt(kever.lastEst.s)
        ? seal.d.qb64 === kever.lastEst.d
        : this.hby.db.getEvtSerder(seal.i.qb64, seal.d.qb64)?.ilk === "ixn";
    });
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
    for (const said of graph.order) {
      const result = this.issuer(graph.nodes.get(said)!);
      if (result !== true) return result;
    }
    const schemas = this.nodeSchemas(graph);
    if (schemas !== true) return schemas;
    const relations = verifyIpexRelations(graph, this.hby.db);
    if (typeof relations === "object") {
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

  /** A negotiated outer anchor must be at or after the anchorer's current establishment. */
  private sourceAnchor(serder: SerderKERI, aid: string, seal: SealSource): ExchangeRouteVerification {
    const kever = this.hby.db.getKever(aid);
    if (!kever) return missing(`Missing current anchorer key state for ${aid}.`);
    if (
      seal.s.num < BigInt(kever.lastEst.s)
      || (seal.s.num === BigInt(kever.lastEst.s) && seal.d.qb64 !== kever.lastEst.d)
    ) return false;
    if (seal.s.num > BigInt(Number.MAX_SAFE_INTEGER)) return false;
    const said = this.hby.db.kels.getLast(aid, Number(seal.s.num));
    const event = said ? this.hby.db.getEvtSerder(aid, said) : null;
    if (!event) return missing(`Missing anchorer KEL evidence for ${aid}.`);
    if (said !== seal.d.qb64 || (seal.s.num > BigInt(kever.lastEst.s) && event.ilk !== "ixn")) return false;
    return event.seals.some((seal) => record(seal) && seal.d === serder.said);
  }

  /** Assemble accepted ordinals only; a missing head is retryable, contradictory durable rows are corrupt. */
  private registryEvidence(regid: string): { rip: SerderACDC; updates: SerderACDC[] } | null {
    const store = this.registry!;
    const marker = store.head(regid);
    if (!marker) return null;
    const rip = store.seqEvent(regid, 0), head = store.headEvent(regid);
    if (
      !rip || !head || head.said !== marker.qb64 || typeof head.sad?.n !== "string"
      || !/^[0-9a-f]+$/.test(head.sad.n)
    ) {
      throw new DatabaseOperationError("Accepted registry evidence has a missing or corrupt head/inception.");
    }
    const last = BigInt(`0x${head.sad.n}`);
    if (last > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new DatabaseOperationError("Accepted registry ordinal exceeds exact storage representation.");
    }
    if (validateRip(rip).kind !== "valid" || rip.said !== regid || store.seqSaider(regid, 0)?.qb64 !== regid) {
      throw new DatabaseOperationError("Accepted registry inception is inconsistent.");
    }
    const updates: SerderACDC[] = [];
    let prior = rip.said;
    for (let sn = 1; sn <= Number(last); sn++) {
      const item = store.seqEvent(regid, sn);
      if (!item) throw new DatabaseOperationError("Accepted registry evidence has a missing sequence entry.");
      const checked = validateUpdate(item, regid);
      if (
        checked.kind !== "valid" || checked.event.sn !== BigInt(sn) || checked.event.prior !== prior
        || store.seqSaider(regid, sn)?.qb64 !== item.said
      ) {
        throw new DatabaseOperationError("Accepted registry sequence is inconsistent.");
      }
      updates.push(item);
      prior = item.said;
    }
    if ((updates.at(-1) ?? rip).said !== marker.qb64) {
      throw new DatabaseOperationError("Registry head and sequence disagree.");
    }
    return { rip, updates };
  }

  /** A declared registry, then supplied anchors, take precedence over current signatures. */
  private issuer(frame: CesrFrame & { body: SerderACDC }): ExchangeRouteVerification {
    const serder = frame.body;
    const envelope = envelopeFromFrame(frame);
    if (serder.regid) {
      const proofs = [...envelope.bsqs, ...envelope.bsss];
      if (!proofs.length || !this.registry) return false;
      const chain = this.registryEvidence(serder.regid);
      if (!chain) return missing(`Missing local TEL evidence for ${serder.regid}.`);
      const result = vetBinds({
        ...chain,
        db: this.hby.db,
        blinders: proofs,
        target: serder.said!,
        acdc: serder,
      });
      return result.kind === "verified"
        ? result.state.regid === serder.regid
        : result.kind === "missing"
        ? missing(`Missing issuer TEL anchor for ${serder.regid}.`)
        : false;
    }
    if (this.presentationRegistries(serder) === null || !serder.issuer) return false;
    let issuer: Prefixer;
    try {
      issuer = new Prefixer({ qb64: serder.issuer });
    } catch {
      return false;
    }
    const sourceSeals: SealEvent[] = [
      ...envelope.sscs.map((seal) => ({ i: issuer, ...seal })),
      ...envelope.ssts.filter((seal) => seal.i.qb64 === issuer.qb64),
    ];
    if (sourceSeals.length) {
      const result = verifyExchangeProofs(this.hby.db, serder, { sourceSeals });
      return result.missing.length
        ? missing(`Missing issuer KEL anchor for ${serder.said}.`)
        : result.sourceSeals.length > 0;
    }
    const explicit = envelope.tsgs.filter((group) => group.pre === issuer.qb64);
    const last = envelope.ssgs.filter((group) => group.pre === issuer.qb64);
    const tsgs: TransIdxSigGroup[] = [];
    if (issuer.transferable && (envelope.sigers.length || explicit.length || last.length)) {
      const kever = this.hby.db.getKever(issuer.qb64);
      if (!kever) return missing(`Missing current issuer key state for ${serder.said}.`);
      const number = NumberPrimitive.fromNum(BigInt(kever.lastEst.s));
      const diger = new Diger({ qb64: kever.lastEst.d });
      if (envelope.sigers.length) tsgs.push(new TransIdxSigGroup(issuer, number, diger, [...envelope.sigers]));
      tsgs.push(...explicit.filter((group) => group.sn === number.num && group.said === diger.qb64));
      tsgs.push(...last.map((group) => new TransIdxSigGroup(issuer, number, diger, [...group.sigers])));
    }
    const cigars = envelope.cigars.filter((cigar) => cigar.verfer?.qb64 === issuer.qb64);
    const result = verifyExchangeProofs(this.hby.db, serder, { tsgs, cigars });
    return result.missing.length
      ? missing(`Missing current issuer KEL evidence for ${serder.said}.`)
      : result.tsgs.length + result.cigars.length > 0;
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
    const chain = this.registryEvidence(regid);
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
      if (!this.hby.db.getEvtSerder(issuee, said)) {
        unresolved = true;
        continue;
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
        if (!(error instanceof ParserError) || error instanceof ResourceLimitError) throw error;
        return null;
      }
      if (!declarations.some(([aid, registry]) => aid === issuee && registry === regid)) {
        declarations.push([issuee, regid]);
      }
    }
    return declarations;
  }
}
