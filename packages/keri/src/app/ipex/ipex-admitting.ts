/**
 * IPEX Admit preparation over borrowed protocol owners.
 *
 * Reads accepted Grants and their graph truth from the Habery, Exchanger and
 * registry store only; it records no admission. Embedders that keep admitted
 * records (the wallet) call it before and after their own inventory writes.
 */
import { SerderACDC, type SerderKERI, type Versionage, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation } from "effection";
import { type ChainVerdict, evaluateChain } from "../../acdc/chaining.ts";
import type { RegistryStore } from "../../acdc/registering.ts";
import { ValidationError } from "../../core/errors.ts";
import { loadNests } from "../../db/exchange/exchange-nests.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import type { Habery } from "../identity/habbing.ts";
import { isLocalGroupHab } from "../multisig/group-members.ts";
import { envelopeFromFrame } from "../protocol/parsering.ts";
import type { Receiptor, WitnessAuthMap } from "../witness/receipting.ts";
import { ipexExnBody } from "./ipex-building.ts";
import { anchorExchange, exchangeWire, IpexDiscloser } from "./ipex-discloser.ts";
import { walkIpexGraph } from "./ipex-graph.ts";
import { authenticateIpexNode, issuedNodeVerdict } from "./ipex-node-authentication.ts";
import { ipexGrantWalk } from "./ipex-v2.ts";

/** A signed response prepared after consent/current policy; intake and delivery remain caller-owned. */
export interface PreparedAdmit {
  admit: SerderKERI;
  wire: Uint8Array;
  support: Uint8Array;
}

/** Borrow concrete owners only; no constructor opens a store or starts a worker. */
export class IpexAdmitter {
  constructor(readonly hby: Habery, readonly registry: RegistryStore, readonly exc: Exchanger) {}

  /** Authenticate accepted outer evidence through existing replay, without current node policy. */
  async accepted(said: string, route: string): Promise<SerderKERI> {
    const body = this.hby.db.exns.get([said]);
    if (!body || body.said !== said || body.route !== route || body.pvrsn.major !== 2 || !this.exc.complete(said)) {
      throw new ValidationError("Accepted ACDC v2 exchange at the exact route is required.");
    }
    for await (const _chunk of this.exc.replay(said)) { /* replay authenticates retained outer factors */ }
    return body;
  }

  /** New use requires current node evidence and a valid root under shared issued-state policy. */
  graphAccepted(grant: string, origin: string): boolean {
    if (!this.exc.verifyAccepted(grant, "/ipex/grant")) return false;
    const graph = walkIpexGraph(origin, loadNests(this.hby.db, grant), ipexGrantWalk(this.exc));
    if (!graph) return false;
    const verdicts = new Map<string, ChainVerdict>();
    for (const [said, node] of graph.nodes) {
      const auth = authenticateIpexNode(node.body, envelopeFromFrame(node), this.hby.db, this.registry);
      verdicts.set(said, issuedNodeVerdict(auth));
    }
    return evaluateChain(graph, verdicts, this.hby.db)?.kind === "valid";
  }

  /** Resolve only the origin actually carried by this accepted Grant. */
  origin(grant: SerderKERI): string {
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

  /** Freeze an unsigned response only after explicit consent, exact prior authentication and current root truth. */
  *prepareAdmitBody(
    grant: string,
    holder: string,
    { consent = false, message = "", gvrsn = Vrsn_2_0 }: {
      consent?: boolean;
      message?: string;
      gvrsn?: Versionage;
    } = {},
  ): Operation<SerderKERI> {
    if (consent !== true) throw new ValidationError("Explicit consent is required.");
    if (gvrsn.major < 2) throw new ValidationError("ACDC v2 Admit requires attachment genus 2 or later.");
    const g = yield* call(() => this.accepted(grant, "/ipex/grant")), hab = this.hby.habs.get(holder);
    if (!hab || g.sad!.ri !== holder) throw new ValidationError("Grant must address the intended local holder.");
    const response = this.hby.db.erpy.get([grant]);
    if (response && this.exc.complete(response.qb64)) {
      throw new ValidationError("Grant already has an accepted response.");
    }
    if (!this.graphAccepted(grant, this.origin(g))) {
      throw new ValidationError("Current authenticated graph acceptance is required before signing.");
    }
    return ipexExnBody(holder, "/ipex/admit", [], { message, prior: g, gvrsn });
  }

  /** Sign an individual response; group approval consumes the same unsigned body through its own exact-stream owner. */
  *prepareAdmit(
    grant: string,
    holder: string,
    { consent = false, message = "", gvrsn = Vrsn_2_0, receiptor, auths }: {
      consent?: boolean;
      message?: string;
      gvrsn?: Versionage;
      receiptor?: Receiptor;
      auths?: WitnessAuthMap;
    } = {},
  ): Operation<PreparedAdmit> {
    if (consent !== true) throw new ValidationError("Explicit consent is required.");
    if (gvrsn.major < 2) throw new ValidationError("ACDC v2 Admit requires attachment genus 2 or later.");
    const hab = this.hby.habs.get(holder);
    if (!hab) throw new ValidationError("Grant must address the intended local holder.");
    if (isLocalGroupHab(this.hby, hab)) {
      throw new ValidationError("ACDC v2 wallet admission requires a single-signature holder.");
    }
    const admit = yield* this.prepareAdmitBody(grant, holder, { consent, message, gvrsn });
    const anchored = (admit.sad!.a as { ax?: boolean[] }).ax?.[0] === true;
    if (anchored && !receiptor) throw new ValidationError("Anchored Admit requires its actual receipt owner.");
    const source = anchored ? yield* anchorExchange(this.hby, receiptor!, hab, admit, auths) : undefined;
    if (!this.graphAccepted(grant, this.origin(this.hby.db.exns.get([grant])!))) {
      throw new ValidationError("Current authenticated graph acceptance is required after source receipts.");
    }
    return {
      admit,
      wire: exchangeWire(hab, admit, undefined, source, gvrsn),
      support: source ? new IpexDiscloser(this.hby, this.registry, this.exc, receiptor!).kel(hab) : new Uint8Array(),
    };
  }
}
