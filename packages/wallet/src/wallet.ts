/** Explicit ACDC inventory and consent over borrowed authenticated protocol evidence. */
import {
  bytesEqual,
  collectPayload,
  nestedPayload,
  SerderACDC,
  type SerderKERI,
  type Versionage,
  Vrsn_2_0,
} from "cesr-ts";
import { loadNests, type RegistryStore } from "keri-ts/db";
import {
  acceptedRegistryEvidence,
  authenticateIpexNode,
  envelopeFromFrame,
  evaluateAcdcRelations,
  type Exchanger,
  type Habery,
  ipexExnBody,
  isLocalGroupHab,
  type RegistryDisclosure,
  type RegistryState,
  ValidationError,
  vet,
  walkIpexGraph,
} from "keri-ts/runtime";
import { Buffer } from "node:buffer";
import { type AdmittedCredential, type IssuedCredential, WalletBaser } from "./storing.ts";

/** Borrowed protocol owners and the application's separately owned inventory environment. */
export interface WalletOptions {
  hby: Habery;
  registry: RegistryStore;
  exc: Exchanger;
  db: WalletBaser;
}
/** Exact admitted node streams; no fuller cached section replaces retained disclosure. */
export interface HeldCredential {
  credential: SerderACDC;
  proof: Uint8Array;
  artifacts: Uint8Array[];
  grant: SerderKERI;
  admit: string;
}
/** A signed response prepared after consent/current policy; intake and delivery remain caller-owned. */
export interface PreparedAdmit {
  admit: SerderKERI;
  wire: Uint8Array;
}
/** Compare durable application values, including exact originally issued raw bytes. */
function identical(left: object, right: object): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Inventory owns consent, never protocol acceptance, current standing or custody. */
export class Wallet {
  readonly hby: Habery;
  readonly registry: RegistryStore;
  readonly exc: Exchanger;
  readonly db: WalletBaser;

  constructor({ hby, registry, exc, db }: WalletOptions) {
    if (exc.hby !== hby) throw new ValidationError("Wallet requires its actual Exchanger.");
    this.hby = hby;
    this.registry = registry;
    this.exc = exc;
    this.db = db;
  }

  /** Verify accepted local issuance, or return identical retained history without fresh proof. */
  recordIssued(acdc: SerderACDC, update: string, { blinder }: { blinder?: RegistryDisclosure } = {}): IssuedCredential {
    const event = this.registry.event(update);
    const regid = acdc.regid ?? (typeof event?.sad?.rd === "string" ? event.sad.rd : null);
    const chain = regid ? acceptedRegistryEvidence(this.registry, regid) : null;
    if (!event || !chain || !this.hby.habs.has(chain.rip.issuer!)) {
      throw new ValidationError("Local accepted issuance evidence is required.");
    }
    const index = chain.updates.findIndex((item) => item.said === update);
    if (index < 0) throw new ValidationError("Issuance update is still pending.");
    const old = this.db.issued.get([acdc.said!]);
    const raw = Buffer.from(acdc.raw).toString("base64");
    if (old && !blinder) {
      const expected: IssuedCredential = {
        credential: acdc.said!,
        registry: regid!,
        controller: chain.rip.issuer!,
        update,
        raw,
        encoding: "base64",
        bound: old.bound,
      };
      if (!identical(old, expected)) throw new ValidationError("Different issuance is already retained.");
      return old;
    }
    if (event.ilk === "bup" && !blinder) {
      throw new ValidationError("Fresh blinded issuance requires an explicit opening.");
    }
    if (blinder && event.ilk !== "bup") throw new ValidationError("Opening requires a blinded update.");
    const verified = vet({ ...chain, updates: chain.updates.slice(0, index + 1), db: this.hby.db, acdc, blinder });
    if (verified.kind !== "verified" || verified.state.state !== "issued") {
      throw new ValidationError("Referenced update does not prove issued state.");
    }
    const record: IssuedCredential = {
      credential: acdc.said!,
      registry: regid!,
      controller: chain.rip.issuer!,
      update,
      raw,
      encoding: "base64",
      bound: blinder && "bn" in blinder ? { bn: blinder.bn.num.toString(16), bd: blinder.bd.qb64 } : null,
    };
    if (old && !identical(old, record)) throw new ValidationError("Different issuance is already retained.");
    this.db.issued.put([acdc.said!], record);
    return this.db.issued.get([acdc.said!])!;
  }

  /** Reconstruct the original serialization without asserting present registry standing. */
  issuedCredential(said: string): SerderACDC {
    const record = this.db.issued.get([said]);
    if (!record || record.encoding !== "base64") throw new ValidationError("Issued credential is required.");
    const raw = new Uint8Array(Buffer.from(record.raw, "base64"));
    const acdc = new SerderACDC({ raw });
    if (Buffer.from(raw).toString("base64") !== record.raw || acdc.said !== said || !bytesEqual(acdc.raw, raw)) {
      throw new ValidationError("Retained issuance bytes do not match their identifier.");
    }
    return acdc;
  }

  /** Authenticate accepted outer evidence through existing replay, without current node policy. */
  private async accepted(said: string, route: string): Promise<SerderKERI> {
    const body = this.hby.db.exns.get([said]);
    if (!body || body.said !== said || body.route !== route || body.pvrsn.major !== 2 || !this.exc.complete(said)) {
      throw new ValidationError("Accepted ACDC v2 exchange at the exact route is required.");
    }
    for await (const _chunk of this.exc.replay(said)) { /* replay authenticates retained outer factors */ }
    return body;
  }

  /** New use requires current authentication and the single complete-root evaluator's explicit true. */
  private graphAccepted(grant: string, origin: string): boolean {
    if (!this.exc.verifyAccepted(grant, "/ipex/grant")) return false;
    const graph = walkIpexGraph(origin, loadNests(this.hby.db, grant), true, this.hby.db);
    if (!graph || "kind" in graph) return false;
    const registrations = new Map<string, RegistryState>();
    for (const [said, node] of graph.nodes) {
      const auth = authenticateIpexNode(node.body, envelopeFromFrame(node), this.hby.db, this.registry);
      if (auth.kind !== "authenticated") return false;
      if (auth.registration) registrations.set(said, auth.registration);
    }
    return evaluateAcdcRelations(graph, this.hby.db, registrations) === true;
  }

  /** Resolve only the origin actually carried by this accepted Grant. */
  private origin(grant: SerderKERI): string {
    const origins = grant.sad!.a && (grant.sad!.a as Record<string, unknown>).o;
    if (!Array.isArray(origins) || origins.length !== 1 || typeof origins[0] !== "string") {
      throw new ValidationError("Wallet admission requires one disclosed origin.");
    }
    if (
      !loadNests(this.hby.db, grant.said!).some((node) =>
        node.body instanceof SerderACDC && node.body.said === origins[0]
      )
    ) {
      throw new ValidationError("Accepted Grant origin is missing.");
    }
    return origins[0];
  }

  /** Require explicit consent and current root truth before authoring any holder signature. */
  async prepareAdmit(
    grant: string,
    holder: string,
    { consent = false, message = "", gvrsn = Vrsn_2_0 }: { consent?: boolean; message?: string; gvrsn?: Versionage } =
      {},
  ): Promise<PreparedAdmit> {
    if (consent !== true) throw new ValidationError("Explicit consent is required.");
    if (gvrsn.major < 2) throw new ValidationError("Native Admit requires attachment genus 2 or later.");
    const g = await this.accepted(grant, "/ipex/grant"), hab = this.hby.habs.get(holder);
    if (!hab || g.sad!.ri !== holder) throw new ValidationError("Grant must address the intended local holder.");
    if (isLocalGroupHab(this.hby, hab)) {
      throw new ValidationError("Native wallet admission requires a single-signature holder.");
    }
    if ((g.sad!.a as { ax?: boolean[] }).ax?.[0]) {
      throw new ValidationError("Anchored Admit requires the source-anchor publication workflow.");
    }
    const response = this.hby.db.erpy.get([grant]);
    if (response && this.exc.complete(response.qb64)) {
      throw new ValidationError("Grant already has an accepted response.");
    }
    if (!this.graphAccepted(grant, this.origin(g))) {
      throw new ValidationError("Current authenticated graph acceptance is required before signing.");
    }
    const admit = ipexExnBody(holder, "/ipex/admit", [], { message, prior: g, gvrsn });
    return { admit, wire: hab.endorse(admit, { pipelined: false, gvrsn, genusify: true }) };
  }

  /** Record explicit local consent to one accepted, linked Grant/Admit pair. */
  async recordAdmission(
    grant: string,
    admit: string,
    { consent = false }: { consent?: boolean } = {},
  ): Promise<AdmittedCredential> {
    if (consent !== true) throw new ValidationError("Explicit consent is required.");
    const g = await this.accepted(grant, "/ipex/grant"), a = await this.accepted(admit, "/ipex/admit");
    const holder = g.sad!.ri;
    if (
      typeof holder !== "string" || !this.hby.habs.has(holder) || a.pre !== holder || a.sad!.p !== grant
      || a.sad!.ri !== g.pre || this.hby.db.erpy.get([grant])?.qb64 !== admit
    ) {
      throw new ValidationError("Admit must be the intended local holder response to this Grant.");
    }
    const origin = this.origin(g);
    const old = this.db.admitted.get([grant]);
    if (old) {
      if (old.admit !== admit || old.credential !== origin || old.holder !== holder) {
        throw new ValidationError("Conflicting wallet admission.");
      }
      return old;
    }
    if (!this.exc.verifyAccepted(admit, "/ipex/admit") || !this.graphAccepted(grant, origin)) {
      throw new ValidationError("Current authenticated graph acceptance is required for new admission.");
    }
    const record: AdmittedCredential = { credential: origin, grant, admit, holder, admitted: new Date().toISOString() };
    this.db.env!.transactionSync(() => {
      this.db.admitted.put([grant], record);
      this.db.credentials.put([origin, grant], grant);
    });
    return this.db.admitted.get([grant])!;
  }

  /** Read the original admitted proof; later disclosures and current policy cannot expand it. */
  async heldCredential(grant: string): Promise<HeldCredential> {
    const record = this.db.admitted.get([grant]);
    if (!record) throw new ValidationError("Grant has not been admitted.");
    const body = await this.accepted(grant, "/ipex/grant");
    await this.accepted(record.admit, "/ipex/admit");
    const nests = loadNests(this.hby.db, grant);
    const origin = nests.find((node) => node.body instanceof SerderACDC && node.body.said === record.credential);
    if (!origin) throw new ValidationError("Admitted origin evidence is missing.");
    return {
      credential: origin.body as SerderACDC,
      proof: await collectPayload(nestedPayload(origin, Vrsn_2_0)),
      artifacts: await Promise.all(
        nests.filter((node) => node !== origin).map((node) => collectPayload(nestedPayload(node, Vrsn_2_0))),
      ),
      grant: body,
      admit: record.admit,
    };
  }

  /** List historical references, with no current-standing or private-capability claim. */
  inventory(): { issued: IssuedCredential[]; held: AdmittedCredential[] } {
    return {
      issued: [...this.db.issued.getTopItemIter()].map(([, row]) => row),
      held: [...this.db.admitted.getTopItemIter()].map(([, row]) => row),
    };
  }

  /** List distinct explicit disclosure admissions for the same credential. */
  admissions(credential: string): AdmittedCredential[] {
    return [...this.db.credentials.getTopItemIter([credential])].map(([, grant]) => this.db.admitted.get([grant])!);
  }
}
