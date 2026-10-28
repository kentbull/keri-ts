/** Exact retained IPEX views and current configured-source policy; no credential-view enrichment. */
import type { Registrar } from "@keri-ts/registrar";
import { BlindState, BoundState, bytesEqual, concatBytes, Counter, Diger, type SerderACDC, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation } from "effection";
import { loadNests } from "keri-ts/db";
import {
  acceptedRegistryEvidence,
  authenticateIpexNode,
  envelopeFromFrame,
  evaluateAcdcRelations,
  type Exchanger,
  type Hab,
  type Habery,
  type HttpClient,
  isCesrContentType,
  query,
  type RegistryDisclosure,
  type RegistryState,
  timestampMicros,
  TransportError,
  ValidationError,
  vetBinds,
  walkIpexGraph,
} from "keri-ts/runtime";

/** Recent observation of an exact locally authenticated head from one configured TLS endpoint. */
export interface AcdcV2Observation {
  registry: string;
  source: string;
  head: string;
  observedAt: string;
}
/** Historical proof validity carries no current-standing, business-policy or delivery claim. */
export interface HistoricalInspection {
  purpose: "historical-evidence";
  proofValidity: "valid";
  currentStanding: "not-evaluated";
  grant: string;
  credential: SerderACDC | null;
  views: { credential: string; view: string }[];
}
/** Unavailable evidence remains separate from a known policy refusal or public revocation. */
export interface AcdcV2Verification {
  kind: "issued" | "revoked" | "missing" | "refused";
  credential: SerderACDC | null;
  observations: AcdcV2Observation[];
}
export interface AcdcV2VerifierOptions {
  source: string;
  maximumAgeMs: number;
  requestTimeoutMs: number;
  now: () => number;
}

/** Borrow accepted exchange/public evidence owners; acquire no stores, parser or background worker. */
export class AcdcV2Verifier {
  constructor(
    readonly hby: Habery,
    readonly hab: Hab,
    readonly exc: Exchanger,
    readonly evidence: Registrar,
    readonly http: HttpClient,
    readonly options: AcdcV2VerifierOptions,
  ) {
    if (exc.hby !== hby || hab.db !== hby.db || evidence.processor.kvy.db !== hby.db) {
      throw new ValidationError("ACDC v2 verifier requires its actual local evidence owners.");
    }
    if (![options.maximumAgeMs, options.requestTimeoutMs].every(value => Number.isFinite(value) && value > 0)) {
      throw new ValidationError("Source age and request timeout must be finite and positive.");
    }
    const source = new URL(options.source);
    if (source.protocol !== "https:" || source.username || source.password || source.search || source.hash) {
      throw new ValidationError("Observation source must be HTTPS without credentials, query or fragment.");
    }
  }

  /** Inspect the immutable retained nested material without querying, reporting or applying graph policy. */
  inspectHistorical(grant: string): HistoricalInspection {
    const body = this.hby.db.exns.get([grant]);
    if (
      !body || body.route !== "/ipex/grant" || body.pvrsn.major !== 2
      || !this.exc.verifyAccepted(grant, "/ipex/grant", { historical: true })
    ) throw new ValidationError("Authenticated retained ACDC v2 Grant is required.");
    const nodes = loadNests(this.hby.db, grant), origins = (body.sad!.a as Record<string, unknown>).o;
    if (!Array.isArray(origins) || origins.length > 1) {
      throw new ValidationError("Verifier requires zero or one retained origin.");
    }
    const credential = origins.length ? nodes.find(node => node.body.said === origins[0])?.body : null;
    if (origins.length && !credential) throw new ValidationError("Retained origin is missing.");
    return {
      purpose: "historical-evidence",
      proofValidity: "valid",
      currentStanding: "not-evaluated",
      grant,
      credential: credential as SerderACDC | null,
      views: nodes.map(node => ({
        credential: node.body.said!,
        view: new Diger({ raw: Diger.digest(node.body.raw, "E"), code: "E" }).qb64,
      })),
    };
  }

  /** Authenticate one complete source response and its exact accepted head, never infer global latest state. */
  private *observe(regid: string): Operation<AcdcV2Observation | null> {
    const { source, maximumAgeMs, requestTimeoutMs, now } = this.options;
    const wire = this.hab.endorse(query("tels", { i: regid }, { pre: this.hab.pre, version: Vrsn_2_0 }), {
      gvrsn: Vrsn_2_0,
    });
    const deadline = new AbortController(), expired = new Error("Observation request deadline expired");
    const timer = setTimeout(() => deadline.abort(expired), requestTimeoutMs);
    let response;
    try {
      response = yield* this.http.request(source, {
        method: "POST",
        headers: { "Content-Type": "application/cesr" },
        body: wire,
        redirect: "error",
        signal: deadline.signal,
      });
    } catch (error) {
      if (error instanceof TransportError || (deadline.signal.aborted && error === expired)) return null;
      throw error;
    } finally {
      clearTimeout(timer);
    }
    const stamp = response.headers.get("Observer-Observed-At"), head = response.headers.get("Observer-Registry-Head");
    const micros = timestampMicros(stamp), age = micros === null ? NaN : now() - Number(micros) / 1000;
    if (
      response.status !== 200 || !isCesrContentType(response.headers.get("content-type"))
      || response.headers.get("Observer-Evidence-State") !== "fresh" || !stamp || !Number.isFinite(age) || age < 0
      || age > maximumAgeMs || !head
    ) return null;
    const result = yield* call(() => this.evidence.ingest(concatBytes(Counter.makeGVC(Vrsn_2_0), response.body)));
    if (
      Object.keys(result.pending).length || Object.keys(result.rejected).length || result.heads[regid] !== head
      || this.evidence.store.head(regid)?.qb64 !== head
    ) return null;
    return { registry: regid, source, head, observedAt: stamp };
  }

  /** Require shared graph approval and full current standing over the exact retained credential views. */
  *verifyCurrent(grant: string): Operation<AcdcV2Verification> {
    const inspected = this.inspectHistorical(grant), observations: AcdcV2Observation[] = [];
    const result = (kind: AcdcV2Verification["kind"]): AcdcV2Verification => ({
      kind,
      credential: inspected.credential,
      observations,
    });
    if (!inspected.credential) return result("refused");
    const graph = walkIpexGraph(inspected.credential.said!, loadNests(this.hby.db, grant), true, this.hby.db);
    if (!graph) return result("refused");
    if ("kind" in graph) return result("missing");
    const registrations = new Map<string, RegistryState>();
    for (const [said, node] of graph.nodes) {
      const auth = authenticateIpexNode(node.body, envelopeFromFrame(node), this.hby.db, this.evidence.store, true);
      if (auth.kind !== "authenticated") return result(auth.kind === "missing" ? "missing" : "refused");
      if (auth.registration) registrations.set(said, auth.registration);
    }
    const registries = new Set<string>();
    for (const { body } of graph.nodes.values()) {
      if (body.regid) registries.add(body.regid);
      // W06's attribute declaration is already authenticated by the IPEX handler; aggregate pairs are data.
      const attrs: unknown = body.attrib;
      if (
        body.regid && attrs && typeof attrs === "object" && !Array.isArray(attrs)
        && typeof (attrs as Record<string, unknown>).rd === "string"
        && typeof (attrs as Record<string, unknown>).i === "string"
      ) registries.add((attrs as { rd: string }).rd);
    }
    for (const regid of registries) {
      const observation = yield* this.observe(regid);
      if (!observation) return result("missing");
      observations.push(observation);
    }
    for (const node of graph.nodes.values()) {
      if (!node.body.regid) continue;
      const chain = acceptedRegistryEvidence(this.evidence.store, node.body.regid);
      if (!chain) return result("missing");
      const envelope = envelopeFromFrame(node), proofs = new Map<string, RegistryDisclosure>();
      for (const proof of [...envelope.bsqs, ...envelope.bsss]) proofs.set(proof.d.nonce, proof);
      const encoded = (proof: RegistryDisclosure) => "bn" in proof ? BoundState.qb64b(proof) : BlindState.qb64b(proof);
      // Public source proofs may establish current standing; retained node bytes and historical selection stay unchanged.
      for (const event of chain.updates) {
        const proof = this.evidence.store.publicOpening(event.said!);
        if (!proof) continue;
        const previous = proofs.get(proof.d.nonce);
        if (previous && !bytesEqual(encoded(previous), encoded(proof))) return result("refused");
        proofs.set(proof.d.nonce, proof);
      }
      const state = vetBinds({
        ...chain,
        db: this.hby.db,
        blinders: [...proofs.values()],
        target: node.body.said!,
        acdc: node.body,
      });
      if (state.kind !== "verified") return result(state.kind === "missing" ? "missing" : "refused");
      registrations.set(node.body.said!, state.state);
    }
    const truth = evaluateAcdcRelations(graph, this.hby.db, registrations);
    if (
      observations.some(observation => {
        const age = this.options.now() - Number(timestampMicros(observation.observedAt)!) / 1000;
        return age < 0 || age > this.options.maximumAgeMs
          || this.evidence.store.head(observation.registry)?.qb64 !== observation.head;
      })
    ) return result("missing");
    // The shared evaluator deliberately excludes the origin's own standing; this consumer requires an issued root.
    const rootState = registrations.get(inspected.credential.said!)?.state;
    if (inspected.credential.regid && rootState !== "issued") {
      return result(rootState === "revoked" ? "revoked" : "missing");
    }
    if (truth === true) return result("issued");
    if (truth !== false) return result("missing");
    return result("refused");
  }
}
