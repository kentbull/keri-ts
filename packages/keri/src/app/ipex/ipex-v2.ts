import {
  IPEX_V2_PREDECESSORS,
  type IpexVerb,
  isIpexVerb,
  nestedIpexRoute,
} from "../../core/exchange/protocol-exchanging.ts";
/** V2 IPEX route policy; v1 routing remains independently registered. */
import {
  type CesrFrame,
  Diger,
  ParserError,
  Prefixer,
  type SealSource,
  type SerderACDC,
  type SerderKERI,
} from "cesr-ts";
import { type ChainVerdict, evaluateChain } from "../../acdc/chaining.ts";
import {
  type RegistryDisclosure,
  validateUpdate,
  verifyRegistryAnchor,
  vet,
  vetBinds,
  vetBlind,
  vetBound,
} from "../../acdc/regeventing.ts";
import type { RegistryStore } from "../../acdc/registering.ts";
import { validateSchema } from "../../acdc/scheming.ts";
import { DatabaseOperationError } from "../../core/errors.ts";
import { type ExchangeFactors, verifyExchangeProofs } from "../../core/exchange/exchange-proofing.ts";
import { loadNests } from "../../db/exchange/exchange-nests.ts";
import type { ExchangeRouteHandler, ExchangeRouteVerification, PresentationScope } from "../exchanges/exchanging.ts";
import type { Habery } from "../identity/habbing.ts";
import type { Notifier } from "../notifications/notifying.ts";
import { envelopeFromFrame } from "../protocol/parsering.ts";
import {
  type DisclosurePlan,
  hasIpexNodeAttachments,
  type IpexGraph,
  isIpexMetadata,
  singleDagDisclosurePlan,
  verifyIpexDisclosure,
  walkIpexGraph,
} from "./ipex-graph.ts";
import {
  acceptedRegistryEvidence,
  authenticatedNodeVerdict,
  authenticateIpexNode,
  type IpexNodeAuthentication,
} from "./ipex-node-authentication.ts";

type VerifyArgs = Parameters<NonNullable<ExchangeRouteHandler["verify"]>>[0];
type EvidenceArgs = Parameters<NonNullable<ExchangeRouteHandler["verifyEvidence"]>>[0];
/** Shared Grant context keeps graph construction and node authentication identical for admission and inspection. */
interface GrantContext {
  kind: "grant";
  graph: IpexGraph;
  authentications: ReadonlyMap<string, IpexNodeAuthentication>;
}
/** SAD payloads include application-defined keys; named protocol fields are checked below before use. */
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Require the current single-DAG outer list shape. */
function single(value: unknown, type: "boolean" | "string"): value is [unknown] {
  return Array.isArray(value) && value.length === 1
    && typeof value[0] === type;
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
    readonly hby: Habery,
    private readonly notifier: Notifier | null = null,
    readonly registry: RegistryStore | null = null,
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

  /** Apply final issuer-state reduction only after the shared context is valid. */
  verify(args: VerifyArgs): ExchangeRouteVerification {
    const context = this.verifyContext(args);
    if (typeof context !== "object" || context.kind !== "grant") return context;
    const { graph, authentications } = context, { serder } = args;
    const fresh = this.pendingIssuance(serder, graph, authentications);
    if (fresh === null) return false;
    if (fresh.size) return missing("Grant awaits issuance of its fresh registries.");
    const verdict = evaluateChain(
      graph,
      new Map([...authentications].map(([said, auth]) => [said, authenticatedNodeVerdict(auth)])),
      this.hby.db,
    );
    if (!verdict || verdict.kind === "invalid") {
      const pending = this.presentationState(serder, graph, authentications)?.pending;
      if (!pending?.size) return false;
      const retry = evaluateChain(graph, this.pendingVerdicts(authentications, pending), this.hby.db);
      return retry?.kind === "unknown" && retry.retryable
        ? missing("Grant awaits current issuer-registry openings.")
        : false;
    }
    if (verdict.kind === "valid") {
      const registryStates: Extract<ExchangeRouteVerification, { kind: "accept" }>["registryStates"][number][] = [];
      for (const [node, authentication] of authentications) {
        if (authentication.kind !== "authenticated" || !authentication.registration) continue;
        const record = authentication.registration;
        // acceptedRegistryEvidence already requires exact safe storage ordinals.
        registryStates.push([node, {
          regid: record.regid,
          said: record.said,
          sn: Number(record.sn),
          state: record.state,
          stamp: record.stamp,
        }]);
      }
      return { kind: "accept", registryStates };
    }
    if (!verdict.retryable) return false;
    return verdict.schemas.length
      ? { kind: "escrow", reason: verdict.reason, schema: verdict.schemas[0] }
      : missing(verdict.reason);
  }

  /** Return deduplicated fresh registry IDs; stored sender authentication belongs to Exchanger. */
  pendingGrant(args: VerifyArgs): readonly string[] | null {
    if (args.serder.route !== "/ipex/grant") return null;
    const context = this.verifyContext({ ...args, historical: false });
    if (typeof context !== "object" || context.kind !== "grant") return null;
    const fresh = this.pendingIssuance(args.serder, context.graph, context.authentications);
    return fresh?.size ? [...new Set(fresh.values())] : null;
  }

  /**
   * Return auxiliary registry scope without issuing an admission verdict.
   * Every supplied opening and non-registry issuer factor must authenticate,
   * including optional graph branches. A separate discloser needs each node's
   * issuer to endorse this exact Grant; origin authority cannot extend to others.
   */
  presentationContext(args: VerifyArgs): PresentationScope | null {
    if (args.serder.route !== "/ipex/grant") return null;
    const context = this.verifyContext({ ...args, historical: false });
    if (typeof context !== "object" || context.kind !== "grant") return null;
    const { graph, authentications } = context;
    const state = this.presentationState(args.serder, graph, authentications);
    if (!state) return null;
    const verdict = evaluateChain(graph, this.pendingVerdicts(authentications, state.pending), this.hby.db);
    if (!verdict || !(verdict.kind === "valid" || verdict.kind === "unknown" && verdict.retryable)) return null;
    // Exchanger already cryptographically verified and route-selected these factors.
    const evidence = args.evidence!;
    const endorsers = new Set([
      ...evidence.tsgs.map(group => group.pre),
      ...evidence.cigars.map(cigar => cigar.verfer!.qb64),
      ...evidence.sourceSeals.map(seal => seal.i.qb64),
    ]);
    const registries = new Map<string, readonly string[]>();
    for (const [regid, saids] of state.registries) {
      if (
        saids.every((said) => {
          const node = graph.nodes.get(said)!.body;
          return args.serder.pre === node.issuer || args.serder.pre === node.issuee || endorsers.has(node.issuer!);
        })
      ) registries.set(regid, saids);
    }
    return registries.size ? registries : null;
  }

  /** Validate shared conversation, disclosure, schema and authentication obligations in reference order. */
  private verifyContext(
    { serder, nests = [], sscs = [], evidence, receiverTime, historical = false }: VerifyArgs,
  ): ExchangeRouteVerification | GrantContext {
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
    const messagePlan = singleDagDisclosurePlan(q.dp);
    if (["apply", "offer", "agree", "grant"].includes(verb) && messagePlan === null) return false;
    if (verb === "agree" && messagePlan?.length) return false;
    if (verb === "offer") {
      if (Object.hasOwn(attrs, "o")) {
        if (!single(attrs.o, "string") || !this.validOrigin(attrs.o[0])) return false;
      } else if (nests.length) return false;
    } else if (verb !== "grant" && nests.length) return false;
    let previous: SerderKERI | null = null;
    if (!priorSaid) {
      if (serder.ilk !== "xip" || !["apply", "offer", "grant"].includes(verb) || !serder.sad!.ri) return false;
    } else {
      if (serder.ilk !== "exn" || verb === "apply" || typeof priorSaid !== "string") return false;
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
      if (nests.some(hasIpexNodeAttachments)) return false;
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
      return requiresAnchor ? (sscs.length ? this.sourceAnchor(serder, serder.pre!, sscs.at(-1)!) : false) : true;
    }
    if (!single(attrs.o, "string") || !this.validOrigin(attrs.o[0]) || !nests.length) return false;
    const origin = attrs.o[0] as string;
    const graph = walkIpexGraph(origin, nests, true);
    if (!graph || [...graph.nodes.values()].some((node) => isIpexMetadata(node.body))) return false;
    if (!verifyIpexDisclosure(plan, origin, graph)) return false;
    const fulfilled = this.offerFulfilled(previous, origin, graph);
    if (fulfilled !== true) return fulfilled;
    const schemas = this.nodeSchemas(graph);
    if (schemas !== true) return schemas;
    if (!evidence) return false; // Exchanger must supply its selected supplemental factor set.
    const originNode = graph.nodes.get(origin)!.body;
    const grantors = new Set([serder.pre!, originNode.issuee || originNode.issuer]);
    for (const group of evidence.tsgs ?? []) grantors.add(group.pre);
    for (const cigar of evidence.cigars ?? []) grantors.add(cigar.verfer!.qb64);
    for (const seal of evidence.sourceSeals ?? []) grantors.add(seal.i.qb64);
    const issuance = serder.pre === originNode.issuer && serder.sad!.ri === originNode.issuee;
    const tethered = new Set<string>();
    for (const said of graph.order) {
      const node = graph.nodes.get(said)!;
      const declarations = this.presentationRegistries(node.body);
      if (declarations === null) return false;
      for (const [issuee, registry] of declarations) {
        // Only participating Grantors present; direct issuance exempts its recipient.
        if (!grantors.has(issuee) || (issuance && issuee === serder.sad!.ri)) continue;
        if (!receiverTime) return false;
        const result = this.presentation(node, registry, issuee, serder.said!);
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
    const authentications = new Map<string, IpexNodeAuthentication>();
    for (const said of graph.order) {
      const frame = graph.nodes.get(said)!;
      authentications.set(
        said,
        authenticateIpexNode(
          frame.body,
          envelopeFromFrame(frame),
          this.hby.db,
          this.registry,
          historical,
        ),
      );
    }
    return { kind: "grant", graph, authentications };
  }

  /** Substitute node-own unknowns only; the shared evaluator still traverses every edge. */
  private pendingVerdicts(
    authentications: ReadonlyMap<string, IpexNodeAuthentication>,
    pending: ReadonlySet<string>,
  ): Map<string, ChainVerdict> {
    return new Map([...authentications].map(([said, auth]) => [
      said,
      pending.has(said)
        ? { kind: "unknown", retryable: true, reason: "Missing registry opening.", schemas: [] }
        : authenticatedNodeVerdict(auth),
    ]));
  }

  /** Fresh issuance is authorized by an accepted issuer RIP and exact Grant parties, before final reduction. */
  private pendingIssuance(
    grant: SerderKERI,
    graph: IpexGraph,
    authentications: ReadonlyMap<string, IpexNodeAuthentication>,
  ): Map<string, string> | null {
    const pending = new Map<string, string>();
    if (!this.registry) return pending;
    for (const said of graph.order) {
      const frame = graph.nodes.get(said)!;
      const node = frame.body, envelope = envelopeFromFrame(frame);
      // Python's BlindState parser verifies primitive integrity before candidate selection.
      if (node.regid && [...envelope.bsqs, ...envelope.bsss].some((proof) => !vetBlind(proof, proof.d.nonce))) {
        return null;
      }
      if (
        !node.regid || envelope.bsqs.length || envelope.bsss.length
        || node.issuer !== grant.pre || node.issuee !== grant.sad!.ri
      ) continue;
      const chain = acceptedRegistryEvidence(this.registry, node.regid);
      if (
        !chain || chain.updates.length || chain.rip.said !== node.regid || chain.rip.issuer !== grant.pre
        || vet({ ...chain, db: this.hby.db }).kind !== "verified"
      ) continue;
      pending.set(said, node.regid);
    }
    if (!pending.size) return pending;
    for (const [said, auth] of authentications) {
      if (!pending.has(said) && auth.kind !== "authenticated") return null;
    }
    const verdict = evaluateChain(graph, this.pendingVerdicts(authentications, new Set(pending.keys())), this.hby.db);
    // A satisfied OR cannot authorize publishing a still proofless issuance.
    return verdict && (verdict.kind === "valid" || (verdict.kind === "unknown" && verdict.retryable)) ? pending : null;
  }

  /** Validate all supplied claims, then classify absent issuer openings and exact per-registry node scope. */
  private presentationState(
    grant: SerderKERI,
    graph: IpexGraph,
    authentications: ReadonlyMap<string, IpexNodeAuthentication>,
  ): { pending: ReadonlySet<string>; registries: PresentationScope } | null {
    if (!this.registry) return null;
    const pending = new Set<string>(), registries = new Map<string, string[]>();
    for (const said of graph.order) {
      const frame = graph.nodes.get(said)!;
      const node = frame.body, envelope = envelopeFromFrame(frame);
      const proofs: RegistryDisclosure[] = [...envelope.bsqs, ...envelope.bsss];
      if (!node.regid) {
        if (proofs.length || authentications.get(said)?.kind !== "authenticated") return null;
        continue;
      }
      const chain = acceptedRegistryEvidence(this.registry, node.regid);
      if (
        !chain || !chain.updates.length || chain.rip.said !== node.regid || chain.rip.issuer !== node.issuer
        || vet({ ...chain, db: this.hby.db }).kind !== "verified"
      ) return null;
      const allowed = new Map(
        chain.updates.map((event) => [event.sad!.b as string, { target: said, acdc: node as SerderACDC | undefined }]),
      );
      if (proofs.some((proof) => !allowed.has(proof.d.nonce))) {
        for (const [issuee, regid] of this.presentationRegistries(node) ?? []) {
          const presentation = acceptedRegistryEvidence(this.registry, regid);
          if (
            !presentation || presentation.rip.said !== regid || presentation.rip.issuer !== issuee
            || vet({ ...presentation, db: this.hby.db }).kind !== "verified"
          ) return null;
          for (const event of presentation.updates) {
            const blid = event.sad!.b as string, prior = allowed.get(blid);
            if (prior && (prior.target !== grant.said || prior.acdc !== undefined)) return null;
            allowed.set(blid, { target: grant.said!, acdc: undefined });
          }
        }
      }
      const opened = new Map<string, RegistryDisclosure>();
      for (const proof of proofs) {
        const blid = proof.d.nonce, expected = allowed.get(blid);
        if (
          opened.has(blid) || !expected || !vetBlind(proof, blid) || vetBound(proof, expected.acdc, this.hby.db)
          || ((proof.td.nonce || proof.ts.text) && proof.td.nonce !== expected.target)
        ) return null;
        opened.set(blid, proof);
      }
      let bound = false;
      for (const update of [...chain.updates].reverse()) {
        const proof = opened.get(update.sad!.b as string);
        if (!proof) {
          pending.add(said);
          bound = true;
          break;
        }
        if (proof.td.nonce || proof.ts.text) {
          bound = true;
          break;
        }
      }
      if (!bound) return null; // A completely opened placeholder history binds no credential.
      const selected = registries.get(node.regid) ?? [];
      selected.push(said);
      registries.set(node.regid, selected);
    }
    return { pending, registries };
  }

  /** Notify only after Exchanger has durably accepted the parent and its evidence. */
  handle({ serder }: Parameters<ExchangeRouteHandler["handle"]>[0]): void {
    this.notifier?.add({ r: `/exn${serder.route}`, d: serder.said, m: (serder.sad!.a as Record<string, unknown>).m });
  }

  /** Every disclosed own schema vets before presentation and issuer graph reduction. */
  private nodeSchemas(graph: IpexGraph): ExchangeRouteVerification {
    for (const said of graph.order) {
      const result = validateSchema(graph.nodes.get(said)!.body, this.hby.db);
      if (result.kind === "invalid") return false;
      if (result.kind === "missing") return { kind: "escrow", reason: "Missing node schema.", schema: result.said };
    }
    return true;
  }

  /** Compare the exact accepted Offer before authenticating the Grant's independent issuer proofs. */
  private offerFulfilled(agree: SerderKERI | null, origin: string, graph: IpexGraph): ExchangeRouteVerification {
    if (agree?.route !== "/ipex/agree") return true;
    const offerSaid = agree.sad!.p as string;
    const offer = this.hby.db.exns.get(offerSaid);
    if (!offer) return missing(`Missing accepted Offer ${offerSaid}.`);
    const attrs = offer.sad!.a;
    if (!record(attrs)) return false;
    if (!Object.hasOwn(attrs, "o")) return true;
    if (!single(attrs.o, "string")) return false;
    const offeredOrigin = attrs.o[0] as string;
    if (offeredOrigin === origin) return true;
    const nests = loadNests(this.hby.db, offerSaid);
    if (!nests.length) return missing(`Missing metadata ACDC for accepted Offer ${offerSaid}.`);
    const offered = walkIpexGraph(offeredOrigin, nests, false);
    if (!offered) return false;
    const metadata = offered.nodes.get(offeredOrigin)!.body;
    if (!isIpexMetadata(metadata)) return false;
    const schemas = this.nodeSchemas(offered);
    if (schemas !== true) return schemas;
    const granted = graph.nodes.get(origin)!.body;
    if (metadata.issuer !== granted.issuer || (metadata.regid && metadata.regid !== granted.regid)) return false;
    for (const label of ["s", "a", "A", "e", "r"]) {
      const section = metadata.sad![label];
      if (
        section === undefined || section === null || section === ""
        || (Array.isArray(section) && !section.length) || (record(section) && !Object.keys(section).length)
      ) continue;
      const promised = this.sectionCommitment(label, section);
      if (!promised || promised !== this.sectionCommitment(label, granted.sad![label])) return false;
    }
    return true;
  }

  /** Read only walk-verified nodes: Serder authenticates exposed d/$id/AGID claims; strings stay opaque. */
  private sectionCommitment(label: string, value: unknown): string | null {
    const said = typeof value === "string"
      ? value
      : label === "A" && Array.isArray(value)
      ? value[0]
      : record(value)
      ? value[label === "s" ? "$id" : "d"]
      : null;
    return this.validOrigin(said) ? said as string : null;
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
    if (
      prior.ilk === "xip"
        ? !["apply", "offer", "grant"].includes(previous[2])
        : prior.ilk !== "exn" || !prior.sad!.p
    ) return null;
    if (verb === "spurn" && previous[2] === "grant" && prior.sad!.p) return null;
    if (
      current.sad!.ri !== prior.pre || !prior.sad!.ri || current.pre !== prior.sad!.ri
      || current.sad!.x !== (prior.ilk === "xip" ? prior.said : prior.sad!.x)
    ) return null;
    const response = this.hby.db.erpy.get(said);
    if (response && response.qb64 !== current.said && this.hby.db.exns.get(response.qb64)) return null;
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
      const plan = record(q) ? singleDagDisclosurePlan(q.dp) : null;
      if (plan === null) return null;
      if (plan.length) return plan;
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
  ): ExchangeRouteVerification {
    const envelope = envelopeFromFrame(frame), blinders = [...envelope.bsqs, ...envelope.bsss];
    if (!blinders.length || !this.registry) return false;
    const chain = acceptedRegistryEvidence(this.registry, regid);
    if (!chain) return missing(`Missing presentation TEL evidence for ${regid}.`);
    const sources = new Map<string, string>();
    let selected: { said: string; sn: bigint } | null = null;
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
          if (!selected || checked.event.sn > selected.sn) selected = { said: update.said!, sn: checked.event.sn };
        }
      }
    }
    if (!sources.size && unresolved) return missing(`Missing presentation anchor source for ${regid}.`);
    if (!selected) return false;
    const result = vetBinds({
      ...chain,
      db: this.hby.db,
      blinders,
      target,
      controller: issuee,
      at: selected.said,
      sources,
      requireSource: true,
    });
    if (
      (result.kind === "missing" && result.reason === "anchor")
      || (result.kind === "reject" && result.reason === "anchor" && unresolved)
    ) {
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
