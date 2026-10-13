/** V2 IPEX route policy; v1 routing remains independently registered. */
import {
  type CesrFrame,
  Diger,
  NumberPrimitive,
  Prefixer,
  ResourceLimitError,
  type SealEvent,
  type SealSource,
  SerderACDC,
  type SerderKERI,
} from "cesr-ts";
import { validateRip, validateUpdate, vetBinds } from "../acdc/regeventing.ts";
import type { RegistryStore } from "../acdc/registering.ts";
import { TransIdxSigGroup } from "../core/dispatch.ts";
import { DatabaseOperationError } from "../core/errors.ts";
import { type ExchangeFactors, verifyExchangeProofs } from "../core/exchange-proofing.ts";
import type { ExchangeRouteHandler, ExchangeRouteVerification } from "./exchanging.ts";
import type { Habery } from "./habbing.ts";
import {
  type DisclosurePlan,
  validDisclosurePlan,
  verifyIpexDisclosure,
  verifyIpexRelations,
  walkIpexGraph,
} from "./ipex-graph.ts";
import type { Notifier } from "./notifying.ts";
import { envelopeFromFrame } from "./parsering.ts";

type VerifyArgs = Parameters<NonNullable<ExchangeRouteHandler["verify"]>>[0];
type EvidenceArgs = Parameters<NonNullable<ExchangeRouteHandler["verifyEvidence"]>>[0];
const previousRoutes: Record<string, readonly string[]> = {
  offer: ["apply"],
  agree: ["offer"],
  grant: ["apply", "agree"],
  admit: ["grant"],
  spurn: ["apply", "offer", "agree", "grant"],
};

/** JSON-like mapping test at the untrusted SAD boundary. */
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
 * Presentation registries remain guarded until receiver-owned KRAM intake exists.
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
    private readonly maxRegistryEvents = 16384,
  ) {
    if (!Number.isSafeInteger(maxRegistryEvents) || maxRegistryEvents < 1) {
      throw new RangeError("IPEX maxRegistryEvents must be a positive safe integer.");
    }
    this.acceptsMissingEvidence = resource === "/ipex/grant";
    this.acceptsNests = resource === "/ipex/grant" || resource === "/ipex/offer";
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
  verify({ serder, nests = [], sscs = [], evidence }: VerifyArgs): ExchangeRouteVerification {
    if (serder.pvrsn.major !== 2 || serder.route !== this.resource) return false;
    const route = serder.route.split("/");
    const verb = route[2];
    if (
      route.length !== 3 || route[0] !== "" || route[1] !== "ipex"
      || (verb !== "apply" && !Object.hasOwn(previousRoutes, verb))
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
    if (verb === "offer" && nests.length) return walkIpexGraph((attrs.o as string[])[0], nests, false) !== null;
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
    if (!graph || !verifyIpexRelations(graph, this.hby.db) || !verifyIpexDisclosure(plan, origin, graph)) return false;
    for (const said of graph.order) {
      const result = this.issuer(graph.nodes.get(said)!);
      if (result !== true) return result;
    }
    // A receiver-owned KRAM timestamp is required for presentation registries.
    // Until consolidated processMsg intake owns it, never substitute sender time.
    for (const node of graph.nodes.values()) {
      const declarations = this.presentationRegistries(node.body);
      if (declarations === null || declarations.length) return false;
    }
    if (requiresAnchor || priorAnchor) {
      const anchorers = new Set<string>();
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
  private prior(verb: string, current: SerderKERI, said: string): SerderKERI | null {
    const prior = this.hby.db.exns.get(said);
    const previous = prior?.route?.split("/");
    if (
      !prior || previous?.length !== 3 || previous[0] !== "" || previous[1] !== "ipex"
      || !previousRoutes[verb].includes(previous[2])
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
    // Check credit before collecting any updates or converting the ordinal to the storage number API.
    if (last >= BigInt(this.maxRegistryEvents)) {
      throw new ResourceLimitError("IPEX registry evidence exceeds configured event limit.");
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

  /** Detect hidden issuer registries and disclosed presentation requirements without accepting them. */
  private presentationRegistries(serder: SerderACDC): readonly unknown[] | null {
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
    return sections.filter((section) => section.rd && section.i);
  }
}
