/**
 * IPEX discloser core: Grant preparation over borrowed protocol owners.
 *
 * Holds the parts of disclosure that read no credential inventory: exchange
 * wires, source anchoring, fresh-issuance Grant bodies and public proof
 * support. Presentation selection from issued or held views, and the wallet's
 * records, stay with the embedder (`WalletDiscloser` extends this class).
 * No constructor opens a store, starts a worker or loads registry secrets.
 */
import {
  concatBytes,
  Counter,
  Diger,
  NumberPrimitive,
  parseBytes,
  SealSource,
  SerderACDC,
  type SerderKERI,
  type Versionage,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation } from "effection";
import type { RegistryCustody } from "../../acdc/custody.ts";
import { matchesRegistrySeal, vet } from "../../acdc/regeventing.ts";
import type { RegistryStore } from "../../acdc/registering.ts";
import { validateSchema as validateAcdcSchema } from "../../acdc/scheming.ts";
import { ValidationError } from "../../core/errors.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import { acceptedEventReplayMessage, type Hab, type Habery } from "../identity/habbing.ts";
import { isLocalGroupHab } from "../multisig/group-members.ts";
import { envelopeFromFrame } from "../protocol/parsering.ts";
import type { Receiptor, WitnessAuthMap } from "../witness/receipting.ts";
import { type IpexV2BodyOptions, prepareIpexExn } from "./ipex-building.ts";
import { walkIpexGraph } from "./ipex-graph.ts";
import { acceptedRegistryEvidence, authenticateIpexNode } from "./ipex-node-authentication.ts";
import { ipexGrantWalk } from "./ipex-v2.ts";

/** A prepared signed exchange and its supporting public KEL/TEL bytes; delivery and intake stay explicit. */
export interface PreparedDisclosure {
  exn: SerderKERI;
  wire: Uint8Array;
  support: Uint8Array;
}
/** Frozen unsigned Grant and its exact selected nodes; group approval and presentation anchoring remain explicit. */
export interface PreparedGrantBody {
  exn: SerderKERI;
  raw: Uint8Array;
  nests: Uint8Array;
}
/** Fresh origin and explicit far-node proofs; preparation grants neither DH nor inventory consent. */
export interface IssuanceGrantOptions extends Omit<IpexV2BodyOptions, "prior"> {
  recipient: string;
  priorSaid?: string;
  artifacts?: readonly Uint8Array[];
}
/** Reuse a matching accepted KEL seal, or author once and gather real witness receipts. */
export function* anchorExchange(
  hby: Habery,
  receiptor: Receiptor,
  hab: Hab,
  body: SerderKERI | SerderACDC,
  auths?: WitnessAuthMap,
): Operation<SealSource> {
  if (receiptor.hby !== hby) throw new ValidationError("Receipt owner must share this wallet's Habery.");
  let anchor: SerderKERI | null = null, event: SerderKERI | null = hab.kever!.serder;
  while (event) {
    if (
      event.seals.some((seal) =>
        body instanceof SerderACDC
          ? matchesRegistrySeal(seal, body)
          : seal && typeof seal === "object" && "d" in seal && seal.d === body.said
      )
    ) {
      anchor = event;
    }
    event = event.prior ? hab.db.getEvtSerder(hab.pre, event.prior) : null;
  }
  if (!anchor) {
    const data = body instanceof SerderACDC
      ? [{ i: body.regid ?? body.said!, s: body.sad!.n, d: body.said! }]
      : [{ d: body.said! }];
    if (hab.kever!.estOnly) hab.rotate({ data });
    else hab.interact({ data });
    anchor = hab.kever!.serder;
  }
  yield* receiptor.receipt(hab.pre, { sn: anchor.sn!, allowTcp: true, auths });
  if (!hab.db.fullyWitnessed(anchor)) throw new ValidationError("Source anchor remains pending witness receipts.");
  return { s: NumberPrimitive.fromNum(BigInt(anchor.sn!)), d: new Diger({ qb64: anchor.said! }) };
}

/** Encode one frozen body and its existing prepared nests; source proofs do not alter its SAID. */
export function exchangeWire(
  hab: Hab,
  exn: SerderKERI,
  nested: Uint8Array = new Uint8Array(),
  source?: SealSource,
  gvrsn: Versionage = Vrsn_2_0,
): Uint8Array {
  const proof = source
    ? Counter.enclose({ code: "SealSourceCouples", qb64: SealSource.qb64b(source), version: gvrsn })
    : concatBytes(
      ...parseBytes(hab.endorse(exn, { gvrsn, pipelined: false, genusify: true }))[0].attachments.map((g) => g.raw),
    );
  return concatBytes(
    Counter.makeGVC(gvrsn),
    exn.raw,
    Counter.enclose({ qb64: concatBytes(proof, nested), version: gvrsn }),
  );
}

/** Borrow concrete owners only. No constructor opens a store, starts a worker or loads registry secrets. */
export class IpexDiscloser {
  constructor(
    readonly hby: Habery,
    readonly registry: RegistryStore,
    readonly exc: Exchanger,
    readonly receiptor: Receiptor,
    readonly custody?: RegistryCustody,
  ) {
    if (receiptor.hby !== hby) throw new ValidationError("Disclosure receipt owner must share the Habery.");
    if (custody && (custody.options.hby !== hby || custody.options.registry !== registry)) {
      throw new ValidationError("Disclosure custody must use this discloser's actual owners.");
    }
  }
  /** Resolve only a local individual signer; group approval composes this body in the group workflow. */
  protected signer(sender: string, gvrsn: Versionage = Vrsn_2_0): Hab {
    if (gvrsn.major < 2) throw new ValidationError("ACDC v2 disclosure requires attachment genus 2 or later.");
    const hab = this.hby.habs.get(sender);
    if (!hab || isLocalGroupHab(this.hby, hab)) {
      throw new ValidationError("ACDC v2 disclosure requires a local individual signer.");
    }
    return hab;
  }

  /** Revalidate exact accepted prior bytes without treating notification or salt possession as acceptance. */
  protected *prior(said?: string): Operation<SerderKERI | undefined> {
    if (!said) return undefined;
    const body = this.hby.db.exns.get(said);
    if (!body || !this.exc.complete(said) || !this.exc.verifyAccepted(said, body.route!)) {
      throw new ValidationError("Prior ACDC v2 IPEX exchange must be accepted and authenticated.");
    }
    yield* call(async () => {
      for await (const _ of this.exc.replay(said)) { /* authenticated retained outer proof */ }
    });
    return body;
  }

  /** Prepare one fresh issuer origin with explicit authenticated far nodes, without changing disclosure authority. */
  *prepareIssuanceGrantBody(
    sender: string,
    credential: SerderACDC,
    options: IssuanceGrantOptions,
  ): Operation<PreparedGrantBody> {
    const hab = this.hby.habs.get(sender), origin = new SerderACDC({ raw: credential.raw.slice() });
    if (
      !hab?.kever || (options.gvrsn ?? Vrsn_2_0).major < 2 || origin.pvrsn.major !== 2
      || !origin.verify() || !["acm", "act", "acg"].includes(origin.ilk!) || origin.issuer !== sender
      || !options.recipient || options.recipient === sender || origin.issuee !== options.recipient || !origin.regid
    ) {
      throw new ValidationError(
        "Fresh issuance requires an exact v2 credential from the local issuer to its selected issuee.",
      );
    }
    const chain = acceptedRegistryEvidence(this.registry, origin.regid);
    if (
      !chain || chain.updates.length || chain.rip.issuer !== sender
      || vet({ ...chain, db: this.hby.db }).kind !== "verified"
    ) {
      throw new ValidationError("Fresh issuance requires the issuer's accepted anchored RIP without updates.");
    }
    const raw = concatBytes(
      Counter.makeGVC(Vrsn_2_0),
      origin.raw,
      Counter.enclose({ qb64: new Uint8Array(), version: Vrsn_2_0 }),
      ...(options.artifacts ?? []).map(artifact => artifact.slice()),
    );
    const graph = walkIpexGraph(origin.said!, parseBytes(raw), ipexGrantWalk(this.exc));
    if (!graph) {
      throw new ValidationError("Fresh issuance requires its complete explicitly disclosed credential graph.");
    }
    for (const [said, node] of graph.nodes) {
      const schema = validateAcdcSchema(node.body, this.hby.db);
      if (schema.kind !== "valid") {
        throw new ValidationError(schema.kind === "missing" ? `Missing ACDC schema: ${schema.said}` : schema.reason);
      }
      if (
        said !== origin.said
        && authenticateIpexNode(node.body, envelopeFromFrame(node), this.hby.db, this.registry).kind
          !== "authenticated"
      ) {
        throw new ValidationError(
          "Fresh issuance supports one new origin; every far node requires authenticated issuer proof.",
        );
      }
    }
    const prior = yield* this.prior(options.priorSaid);
    if (
      options.anchor || prior && (!["/ipex/apply", "/ipex/agree"].includes(prior.route!)
          || (prior.sad!.a as { ax?: boolean[] }).ax?.[0])
    ) {
      throw new ValidationError(
        "Fresh issuance requires an unanchored Grant and an accepted Apply or Agree when linked.",
      );
    }
    const [exn, nests] = yield* prepareIpexExn(sender, "/ipex/grant", raw, { ...options, prior });
    return { exn, raw, nests };
  }

  /** Carry selected public evidence and root-first delegation ancestry; receiver intake still verifies every approval. */
  proofSupport(raw: Uint8Array, hab: Hab): Uint8Array {
    const aids = new Set([hab.pre]), registries = new Set<string>();
    for (const frame of parseBytes(raw)) {
      if (!(frame.body instanceof SerderACDC)) continue;
      const node = frame.body, envelope = envelopeFromFrame(frame);
      if (node.issuer) aids.add(node.issuer);
      if (node.issuee) aids.add(node.issuee);
      if (node.regid) registries.add(node.regid);
      const a = node.sad!.a as { rd?: unknown; i?: unknown };
      if (a && typeof a === "object" && typeof a.rd === "string") registries.add(a.rd);
      for (const seal of envelope.ssts) {
        if (this.registry.seqEvent(seal.i.qb64, 0)) registries.add(seal.i.qb64);
        else aids.add(seal.i.qb64);
      }
    }
    const messages: Uint8Array[] = [Counter.makeGVC(Vrsn_2_0)];
    const db = this.hby.db, ordered = new Set<string>();
    // An ancestry claim selects supporting KELs; it does not establish delegation authority.
    for (const aid of aids) {
      const ancestors: string[] = [], seen = new Set<string>();
      let current: string | null = aid;
      while (current && !ordered.has(current)) {
        if (seen.has(current)) throw new ValidationError(`Cyclic disclosure delegation ancestry at ${current}.`);
        seen.add(current);
        const state = db.getKever(current);
        if (!state) break;
        ancestors.push(current);
        current = state.delpre;
      }
      for (const ancestor of ancestors.reverse()) ordered.add(ancestor);
    }
    // Keep first-seen authorizers and exact stored attachments, including superseded history.
    // clonePreIter skips broken rows; finite disclosure must instead fail if an accepted row cannot be replayed.
    for (const aid of ordered) {
      for (const [, fn, said] of db.fels.getAllItemIter(aid)) messages.push(db.cloneEvtMsg(aid, fn, said, Vrsn_2_0));
    }
    for (const regid of registries) messages.push(this.registry.cloneTel(regid));
    return concatBytes(...messages);
  }

  /** Public replay includes actual stored witness receipts; it grants no new consent. */
  kel(hab: Hab): Uint8Array {
    return concatBytes(
      Counter.makeGVC(Vrsn_2_0),
      ...Array.from(
        { length: hab.kever!.sn + 1 },
        (_, sn) => acceptedEventReplayMessage(this.hby, hab.pre, sn, Vrsn_2_0).message,
      ),
    );
  }
}
