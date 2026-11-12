/** Independent HTTP peers. Fixtures own resources; tests own conversation order. */
import {
  createWalletBaser,
  RegistryCustody,
  Wallet,
  WalletAuthor,
  type WalletBaser,
  WalletDiscloser,
} from "@keri-ts/wallet";
import { oobiTerminalState } from "../../../../src/app/bootstrap/oobiery.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { runAgentRuntimeUntil } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { collectBytes } from "../../../../src/app/transport/byte-source.ts";
import {
  FetchHttpClient,
  type HttpRequestInit,
  type HttpStreamResponse,
} from "../../../../src/app/transport/http-client.ts";
import { Receiptor } from "../../../../src/app/witness/receipting.ts";
import { openLmdbRegistry } from "../../../../src/db/lmdb-stores.ts";

import {
  type CesrFrame,
  collectPayload,
  Compactor,
  concatBytes,
  Counter,
  DigDex,
  Diger,
  framePayload,
  type MapperMap,
  nestedPayload,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  SerderACDC,
  SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, ensure, type Operation, run, scoped, suspend, type Task, useScope } from "effection";
import { assertEquals, assertExists, assertInstanceOf } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { runGroupDerivedIssuance } from "../../../../../tufa/src/cli/commands/ipex-group-issuance.ts";
import { prepareDerivedIssuance } from "../../../../../tufa/src/cli/commands/ipex-issuance.ts";
import { runPresentationUnblind } from "../../../../../tufa/src/cli/commands/ipex-unblinding.ts";
import type { AcdcWalkPolicy } from "../../../../src/acdc/chaining.ts";
import { acdcmap } from "../../../../src/acdc/messaging.ts";
import { Regery } from "../../../../src/acdc/registraring.ts";
import { acceptedEventReplayMessage, type Hab, type Habery } from "../../../../src/app/identity/habbing.ts";
import { ipexExnBody } from "../../../../src/app/ipex/ipex-building.ts";
import type { DisclosurePlan } from "../../../../src/app/ipex/ipex-graph.ts";
import { prepareAcdcV2GroupIpex } from "../../../../src/app/ipex/ipex-grouping.ts";
import { groupSigningMembers } from "../../../../src/app/multisig/group-members.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { requestFrame } from "../../../../src/app/transport/cesr-egress.ts";
import { readCesrRequestBytes } from "../../../../src/app/transport/cesr-http.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { exchange } from "../../../../src/core/exchange/protocol-exchanging.ts";
import { reply } from "../../../../src/core/protocol-eventing.ts";
import { messageAttachmentGroups, messagize } from "../../../../src/core/protocol-serialization.ts";
import { Schemer } from "../../../../src/core/scheming.ts";
import { dgKey } from "../../../../src/db/core/keys.ts";
import { loadNests } from "../../../../src/db/exchange/exchange-nests.ts";
import {
  createInteropContext,
  type InteropContext,
  type KeriPyWitnessNode,
  randomPort,
  spawnChild,
  startKeriPyWitnessHarness,
  stopChild,
} from "../interop-test-helpers.ts";
import {
  delegatedGraphCase,
  type DisclosureGraph,
  disclosurePlan,
  type GraphCase,
  graphDisclosures,
  partialDisclosure,
} from "./disclosures.ts";

const PEER = fromFileUrl(new URL("../../../fixtures/ipex-http-peer.py", import.meta.url));
export type Implementation = "TypeScript" | "KERIpy";
export type ReplyDefect = { kind: "prior"; said: string } | {
  kind: "exchange-id" | "recipient" | "sender" | "non-opening";
};
/** `refused` carries the negotiated graph unchanged; the peers' Grant walk policy refuses it. */
export type DisclosureDefect = "extra" | "missing" | "altered" | "refused";
export type Verb = "apply" | "offer" | "agree" | "grant" | "admit" | "spurn";

/** Public coordinates only; each peer keeps its private keys and stores. */
export interface PeerInfo {
  pre: string;
  url: string;
  urls?: string[];
  member?: string;
  schemas: string[];
  commitment: string;
}

/** The same observations from each implementation, without sharing persistence internals. */
export interface PeerSnapshot {
  messages: {
    t: "xip" | "exn";
    d: string;
    r: string;
    p?: string;
    x?: string;
    i: string;
    ri: string;
    q: { dp?: [DisclosurePlan] };
  }[];
  received: string[];
  known: string[];
  notifications?: number;
  inspected: { accepted: boolean; escrowed: boolean; nests: number; decision?: string; reason?: string } | null;
  nodes: {
    said: string;
    attributes: { status: { value: string }; private: unknown; contact: unknown; role: unknown };
    raw: string;
    proof?: string;
    independentlyAccepted: boolean;
  }[];
}

/** Two concrete implementations expose actions, never an automatic responder. */
export interface IpexPeer {
  readonly implementation: Implementation;
  readonly info: PeerInfo;
  connect(remote: PeerInfo, plan: DisclosurePlan): Promise<void>;
  send(verb: Verb, prior?: string, invalid?: boolean | DisclosureDefect): Promise<string>;
  historicalGrant(): Promise<string>;
  invalidReply(verb: "grant" | "spurn", prior: string, defect: ReplyDefect): Promise<{ said: string; sender: string }>;
  replay(said: string): Promise<void>;
  snapshot(inspect?: string): Promise<PeerSnapshot>;
  enableWitnessedEvidence(witnesses: readonly KeriPyWitnessNode[]): Promise<void>;
  present(grant: string): Promise<string>;
  reopenEvidence(): Promise<void>;
}
/** Public observations only; registry roots never cross the control interface. */
export interface DerivedPeerSnapshot extends PeerSnapshot {
  registryHead: string | null;
  openingPresent: boolean;
  rootPresent: boolean;
  encrypted: boolean;
  auxiliaryReady: boolean;
  deadline: string | null;
  grantRaw: string | null;
  admit: string | null;
  witnesses: { threshold: number; count: number };
}
/** Explicit scenario actions; receipt alone never approves auxiliary work or Admit. */
export interface DerivedIpexPeer extends IpexPeer {
  prepareDerived(recipient: string): Promise<string>;
  approveDh(grant: string): Promise<void>;
  issueDerived(grant: string): Promise<string>;
  finishDh(grant: string): Promise<void>;
  useUnblind(): Promise<void>;
  publishUpdate(recipient: PeerInfo): Promise<string>;
  approveUnblind(grant: string): Promise<void>;
  finishUnblind(grant: string): Promise<void>;
  snapshot(inspect?: string, registry?: string): Promise<DerivedPeerSnapshot>;
}

export interface GroupPeerSnapshot extends DerivedPeerSnapshot {
  member: string;
  groupReady: boolean;
  signingMembers: string[];
  groupPhase: string;
  /** Issuer query identity observed from its existing exact proposal. */
  querySaid?: string | null;
  deliveredReply: boolean;
  groupEndpoints?: boolean;
}
export interface GroupProposal {
  said: string;
  wire: string;
}

/** Python's finite group issuer actions retain their ordinary explicit proposal boundaries. */
export interface GroupIssuerPeer extends DerivedIpexPeer {
  createGroup(members: PeerInfo[], witnesses: readonly KeriPyWitnessNode[]): Promise<void>;
  groupEndpoints(): Promise<string[]>;
  approveGroupEndpoints(wires: string[]): Promise<void>;
  prepareGroupRegistry(): Promise<{ registry: string; proposal: string }>;
  approveGroupEvent(wire: string): Promise<void>;
  pendingGroupEvent(): Promise<GroupProposal | null>;
  prepareGroupDerived(recipient: string, consentLifetime: number): Promise<{ grant: string; proposal: string }>;
  approveGroupDerived(proposal: string, consentLifetime: number): Promise<void>;
  finalProof(grant: string): Promise<string>;
  acceptGroupProof(grant: string, proof: string): Promise<void>;
  snapshot(inspect?: string, registry?: string): Promise<GroupPeerSnapshot>;
}
export interface GroupHolderPeer extends DerivedIpexPeer {
  prepareGroupIpex(verb: "grant" | "admit", prior: string): Promise<GroupProposal>;
  approveGroupIpex(wire: string): Promise<void>;
  finishGroupIpex(said: string): Promise<void>;
  approveUnblind(grant: string, proposer?: string): Promise<void>;
  snapshot(inspect?: string, registry?: string): Promise<GroupPeerSnapshot>;
}

/** Poll actual state; a failed read fails immediately with its original diagnostic. */
export async function observed<T>(label: string, read: () => T | undefined | Promise<T | undefined>): Promise<T> {
  const deadline = performance.now() + 35_000;
  while (performance.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** TypeScript runtime behind a real CESR listener, with observations from its own store. */
class TypeScriptPeer implements DerivedIpexPeer {
  readonly implementation = "TypeScript";
  readonly server: Deno.HttpServer<Deno.NetAddr>;
  readonly info: PeerInfo;
  private readonly graph: DisclosureGraph;
  protected hab: Hab;
  private readonly received: { said: string; decision: string | undefined; reason?: string }[] = [];
  protected remote?: PeerInfo;
  protected plan?: DisclosurePlan;
  private intakeFailure?: unknown;
  protected wallet?: Wallet;
  private walletDb?: WalletBaser;
  protected discloser?: WalletDiscloser;
  private remotes = new Map<string, PeerInfo>();
  protected operation?: { grant: string; xid: string; replySent?: boolean };
  private pumping?: Promise<void>;
  private derivedSchema?: MapperMap;

  constructor(
    protected hby: Habery,
    protected runtime: AgentRuntime,
    private graphCase?: GraphCase,
    hab?: Hab,
    protected selectRuntime?: (kind: "dhke" | "unblind", hab?: Hab) => Promise<AgentRuntime>,
  ) {
    this.hab = hab ?? hby.makeHab("typescript");
    this.graph = graphDisclosures(hby, this.hab, graphCase);
    this.server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => this.receive(request));
    this.info = {
      pre: this.hab.pre,
      url: `http://127.0.0.1:${this.server.addr.port}/`,
      schemas: this.graph.fullNodes.map((node) => (node.schema as { $id: string }).$id),
      commitment: this.graph.fullNodes[0].said!,
    };
    if (selectRuntime) {
      const schema = structuredClone(this.graph.fullNodes[0].schema) as MapperMap;
      schema.$id = "";
      (schema.properties as MapperMap).rd = { type: "string" };
      this.derivedSchema = new Schemer({ sed: schema }).sed as MapperMap;
      this.info.schemas = [this.derivedSchema.$id as string];
    }
  }

  private async receive(request: Request): Promise<Response> {
    try {
      for (const frame of await parseBytes(await readCesrRequestBytes(request))) {
        const result = await run(() => this.runtime.protocol.dispatch(frame));
        this.received.push({
          said: frame.body.said!,
          decision: result.decision ? result.decision.kind : undefined,
          reason: result.decision && "reason" in result.decision ? result.decision.reason : undefined,
        });
      }
      // Finite introduction must advance ordinary delegation dependencies, as the Python peer's loop does.
      this.runtime.protocol.processKelReplyEscrowsOnce();
      // Let HTTP acknowledge before reciprocal delivery; Python's synchronous POST must return first.
      if (this.operation) {
        setTimeout(() => {
          void this.drainAuxiliary().catch(error => this.intakeFailure = error);
        }, 0);
      }
      return new Response(null, { status: 204 });
    } catch (error) {
      this.intakeFailure = error;
      return new Response(String(error), { status: 500 });
    }
  }

  protected async post(frame: CesrFrame, destination?: string): Promise<void> {
    const remote = destination ? this.remotes.get(destination) : this.remote;
    assertExists(remote, "connect the peer before sending");
    const http = this.runtime.http;
    for (const url of remote.urls ?? [remote.url]) {
      await run(() =>
        scoped(function*() {
          const response = yield* requestFrame(url, frame, http, { destination: remote.pre });
          yield* call(() => collectBytes(response.body()));
          assertEquals(response.status, 204);
        })
      );
    }
  }

  async connect(remote: PeerInfo, plan: DisclosurePlan): Promise<void> {
    this.remotes.set(remote.pre, remote);
    this.remote = remote;
    this.plan = plan;
    for (const issuer of this.graph.issuers) {
      if (delegatedGraphCase(this.graphCase)) {
        // The graph orders delegators before delegates; replay the actual approvals as well as inceptions.
        for (const wire of this.hby.db.clonePreIter(issuer.pre, 0, Vrsn_2_0)) {
          for (const frame of parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), wire))) await this.post(frame);
        }
        continue;
      }
      if (this.wallet) {
        for (const frame of parseBytes(this.discloser!.kel(issuer))) await this.post(frame);
        continue;
      }
      const inception = issuer.kever!.serder;
      const kel = messagize(inception, {
        sigers: issuer.sign(inception.raw, true),
        gvrsn: Vrsn_2_0,
        pipelined: true,
        genusify: true,
      });
      await this.post((await parseBytes(kel))[0]);
    }
  }

  /** A nested credential carries its own issuer's proof, not the outer sender's. */
  private signed(body: SerderACDC | SerderKERI, proofBody = body, signer?: Hab): CesrFrame {
    const owner = signer ?? (body instanceof SerderACDC
      ? this.graph.issuers.find((issuer) => issuer.pre === body.issuer)
      : this.hab);
    assertExists(owner, "fixture node issuer");
    return {
      body,
      gvrsn: Vrsn_2_0,
      attachments: messageAttachmentGroups({
        tsgs: [
          new TransIdxSigGroup(
            new Prefixer({ qb64: owner.pre }),
            NumberPrimitive.fromNum(BigInt(owner.kever!.lastEst.s)),
            new Diger({ qb64: owner.kever!.lastEst.d }),
            owner.sign(proofBody.raw, true),
          ),
        ],
      }, Vrsn_2_0),
    };
  }

  /** Derive negotiated partials afresh; defects change only the evidence sent by this test peer. */
  private disclosed(defect: boolean | DisclosureDefect): SerderACDC[] {
    assertExists(this.plan);
    if (defect === true) return this.graph.badNodes;
    const nodes = this.graph.fullNodes.map((full, i) => {
      const fields = [...this.plan![i][2]];
      if (defect === "extra") fields.push("a/private/");
      if (defect === "missing") fields.pop();
      return partialDisclosure(full, fields);
    });
    if (defect === "altered") {
      const node = nodes[0], attributes = structuredClone(node.sad!.a) as MapperMap;
      attributes.d = "";
      (attributes.status as MapperMap).d = "";
      (attributes.status as MapperMap).value = "forged-value";
      // Normalize only the already disclosed maps; the negative is its old issuer proof.
      const compactor = new Compactor({ mad: attributes, kind: node.kind, compactify: true, verify: false });
      const normalized = Object.values(compactor.partials!).at(-1);
      assertExists(normalized);
      nodes[0] = acdcmap(node.issuer!, {
        uuid: node.sad!.u as string,
        schema: node.sad!.s as MapperMap,
        edge: node.sad!.e as MapperMap | undefined,
        attribute: normalized.mad,
      });
      assertEquals(nodes[0].verify(), true, "the altered disclosure remains a well-formed credential body");
    }
    return nodes;
  }

  async send(verb: Verb, prior?: string, invalid: boolean | DisclosureDefect = false): Promise<string> {
    assertExists(this.remote);
    assertExists(this.plan);
    if (this.wallet && !invalid) return await this.walletSend(verb, prior);
    const previous = prior ? this.hby.db.exns.get(prior) : undefined;
    if (prior) assertExists(previous, `Missing prior exchange: ${prior}`);
    let carried: SerderACDC[] = [];
    if (verb === "grant") carried = this.disclosed(invalid);
    if (verb === "offer" && !this.graphCase) carried = this.disclosed(false);
    if (verb === "grant" && (this.graphCase === "required-edge" || this.graphCase === "optional-edge")) {
      assertEquals(this.plan.map(([schema]) => schema), carried.map((node) => (node.schema as { $id: string }).$id));
      assertEquals(
        carried.map((node) => node.raw),
        this.graph.nodes.map((node) => node.raw),
        "prefix selection preserves exact credential bytes",
      );
    }
    const body = ipexExnBody(this.hab.pre, `/ipex/${verb}`, carried, {
      message: invalid ? "invalid chain" : verb,
      prior: previous ?? undefined,
      recipient: this.remote.pre,
      ...(!prior ? { plan: this.plan } : {}),
    });
    const frame = this.signed(body);
    frame.nests = carried.map((node, i) =>
      verb === "grant" && !(invalid && node.said === this.graph.unsigned)
        ? this.signed(node, invalid === "altered" && !i ? this.disclosed(false)[0] : node)
        : { body: node, attachments: [], gvrsn: Vrsn_2_0 }
    );
    return await this.deliver(frame, !invalid);
  }

  /** Optional application scenario, preserving every existing protocol-negative peer path. */
  async enableWitnessedEvidence(witnesses: readonly KeriPyWitnessNode[]): Promise<void> {
    await run(function*(this: TypeScriptPeer) {
      const oobis = witnesses.map(node => node.controllerOobi);
      for (const url of oobis) this.runtime.oobiery.resolve(url);
      yield* runAgentRuntimeUntil(
        this.runtime,
        () => oobis.every(url => oobiTerminalState(this.hby.db, url).status === "resolved"),
        { hab: this.hab, timeoutMs: 20_000, pollMailbox: false },
      );
      this.hab.rotate({ adds: witnesses.map(node => node.pre), toad: 2 });
      const receipts = new Receiptor(this.hby, this.runtime.protocol, this.runtime.http, this.runtime.clock, {
        gvrsn: Vrsn_2_0,
      });
      yield* receipts.receipt(this.hab.pre);
      this.walletDb = yield* createWalletBaser({ name: crypto.randomUUID(), temp: true });
      this.wallet = new Wallet({
        hby: this.hby,
        registry: this.runtime.acdc!.store,
        exc: this.runtime.exc,
        db: this.walletDb,
      });
      this.discloser = new WalletDiscloser(this.wallet, receipts);
      if (this.selectRuntime) {
        this.discloser = new WalletDiscloser(
          this.wallet,
          receipts,
          new RegistryCustody({
            hby: this.hby,
            hab: this.hab,
            registry: this.wallet.registry,
            db: this.wallet.db,
          }),
        );
        return; // The derived story explicitly authors its fresh RIP and first BUP later.
      }
      const author = new WalletAuthor(this.wallet, this.runtime.acdc!, receipts);
      yield* author.incept("wallet", this.hab.pre);
      const old = this.graph.fullNodes[0], schema = structuredClone(old.schema) as MapperMap;
      schema.$id = "";
      (schema.properties as MapperMap).rd = { type: "string" };
      const reg = author.registry("wallet", this.hab.pre);
      const full = author.create(reg, { schema, uuid: old.sad!.u as string, attribute: old.attrib as MapperMap });
      yield* author.issue(reg, full, { public: true });
      this.graph.fullNodes = [full];
      this.graph.nodes = [partialDisclosure(full, ["a/status/"])];
      this.info.schemas = [(full.schema as { $id: string }).$id];
      this.info.commitment = full.said!;
    }.bind(this));
  }
  private async walletSend(verb: Verb, prior?: string, held?: string): Promise<string> {
    const d = this.discloser!, wallet = this.wallet!;
    return await run(function*(this: TypeScriptPeer) {
      const selection = held ? { fromGrant: held } : { said: this.info.commitment, disclose: this.plan![0][2] };
      const options = {
        message: verb,
        recipient: this.remote!.pre,

        plan: prior ? undefined : this.plan,
        priorSaid: prior,
        anchor: !this.selectRuntime,
      };
      const prepared = verb === "apply"
        ? yield* d.prepareApply(this.hab.pre, options)
        : verb === "offer"
        ? yield* d.prepareOffer(this.hab.pre, selection, options)
        : verb === "grant"
        ? yield* d.prepareGrant(this.hab.pre, selection, options)
        : verb === "admit"
        ? (() => undefined)()
        : yield* d.prepareReply(this.hab.pre, verb, prior!);
      let wire: Uint8Array, said: string;
      if (verb === "admit") {
        const response = yield* wallet.prepareAdmit(prior!, this.hab.pre, { consent: true, receiptor: d.receiptor });
        wire = concatBytes(response.support, response.wire);
        said = response.admit.said!;
      } else {
        wire = concatBytes(prepared!.support, prepared!.wire);
        said = prepared!.exn.said!;
      }
      const evidence = concatBytes(
        d.kel(this.hab),
        ...[...wallet.registry.baser.heads.getTopItemIter()].map(([key]) => wallet.registry.cloneTel(String(key[0]))),
      );
      for (const frame of parseBytes(concatBytes(evidence, wire))) {
        yield* this.runtime.protocol.dispatch(frame);
        yield* call(() => this.post(frame));
      }
      assertEquals(this.runtime.exc.complete(said), true);
      if (verb === "admit") yield* call(() => wallet.recordAdmission(prior!, said, { consent: true }));
      return said;
    }.bind(this));
  }
  present(grant: string): Promise<string> {
    return this.walletSend("grant", undefined, grant);
  }
  /** Only selected owner cues are delivered; this never creates consent or issues a credential. */
  protected async drainAuxiliary(): Promise<void> {
    if (this.pumping) return await this.pumping;
    this.pumping = (async () => {
      const selected = this.runtime.ipexAuxiliary;
      if (!selected || !this.operation) return;
      while (selected.owner.outgoing.length) {
        const cue = selected.owner.outgoing.pull()!;
        if (cue.kin === "sign") throw new Error("Individual reciprocal fixture received a group contribution cue");
        for (const frame of parseBytes(cue.msg)) await this.post(frame, cue.dest);
        if (cue.kin === "reply" && this.operation) this.operation.replySent = true;
      }
    })();
    try {
      await this.pumping;
    } finally {
      this.pumping = undefined;
    }
  }
  /** Borrow the real encrypted custody capability; no root creation fallback is allowed. */
  private author(): WalletAuthor {
    assertExists(this.wallet);
    return new WalletAuthor(
      this.wallet,
      this.runtime.acdc!,
      this.discloser!.receiptor,
      new RegistryCustody({
        hby: this.hby,
        hab: this.hab,
        registry: this.wallet.registry,
        db: this.wallet.db,
      }),
    );
  }
  async prepareDerived(recipient: string): Promise<string> {
    assertExists(this.derivedSchema);
    return await run(function*(this: TypeScriptPeer) {
      const author = this.author();
      yield* author.incept("derived", this.hab.pre);
      const old = this.graph.fullNodes[0], reg = author.registry("derived", this.hab.pre);
      const full = author.create(reg, {
        schema: this.derivedSchema,
        uuid: old.sad!.u as string,
        attribute: { ...old.attrib as MapperMap, i: recipient },
      });
      const selected = partialDisclosure(full, ["a/i", "a/status/"]);
      this.graph.fullNodes = [full];
      this.graph.nodes = [selected];
      this.info.commitment = full.said!;
      const prepared = yield* prepareDerivedIssuance(this.runtime, this.wallet!, selected, {
        recipient,
        message: "derived issuance",
        plan: this.plan,
      });
      for (const frame of parseBytes(prepared.wire)) yield* call(() => this.post(frame, recipient));
      return prepared.grant;
    }.bind(this));
  }
  async approveDh(grant: string): Promise<void> {
    const selected = this.runtime.ipexAuxiliary;
    assertEquals(selected?.kind, "dhke");
    if (selected?.kind !== "dhke") throw new Error("Select DH runtime");
    const xid = selected.owner.approve(grant);
    this.operation = { grant, xid };
    const body = this.runtime.exc.retainedInput(grant)!.serder;
    if (body.pre === this.hab.pre) {
      for (const frame of parseBytes(selected.owner.start(grant))) await this.post(frame, body.sad!.ri as string);
    }
    await this.drainAuxiliary();
  }
  async issueDerived(grant: string): Promise<string> {
    const selected = this.runtime.ipexAuxiliary;
    if (selected?.kind !== "dhke" || this.operation?.grant !== grant || !selected.owner.complete(this.operation.xid)) {
      throw new Error("Issuance requires the explicitly approved completed DH exchange");
    }
    const body = this.runtime.exc.retainedInput(grant)!.serder;
    return await run(function*(this: TypeScriptPeer) {
      const author = this.author(), reg = author.registry("derived", this.hab.pre);
      const issued = yield* author.issue(reg, this.graph.nodes[0]);
      const evidence = concatBytes(this.discloser!.kel(this.hab), this.wallet!.registry.cloneTel(reg.regk!));
      for (const frame of parseBytes(evidence)) yield* call(() => this.post(frame, body.sad!.ri as string));
      return issued.update;
    }.bind(this));
  }
  async finishDh(grant: string): Promise<void> {
    const selected = this.runtime.ipexAuxiliary;
    if (selected?.kind !== "dhke" || this.operation?.grant !== grant) throw new Error("Select approved DH Grant");
    assertEquals((await run(() => selected.owner.finish(this.operation!.xid))).kind, "accept");
    selected.owner.abandon(this.operation.xid);
    this.operation = undefined;
  }
  async useUnblind(): Promise<void> {
    assertExists(this.selectRuntime);
    if (this.operation) throw new Error("Finish the selected auxiliary operation before changing invocation");
    await this.pumping;
    this.runtime = await this.selectRuntime("unblind");
    this.wallet = new Wallet({
      hby: this.hby,
      registry: this.runtime.acdc!.store,
      exc: this.runtime.exc,
      db: this.walletDb!,
    });
    this.discloser = new WalletDiscloser(
      this.wallet,
      new Receiptor(this.hby, this.runtime.protocol, this.runtime.http, this.runtime.clock, { gvrsn: Vrsn_2_0 }),
      new RegistryCustody({ hby: this.hby, hab: this.hab, registry: this.wallet.registry, db: this.wallet.db }),
    );
  }
  async publishUpdate(recipient: PeerInfo): Promise<string> {
    this.remotes.set(recipient.pre, recipient);
    return await run(function*(this: TypeScriptPeer) {
      const author = this.author(), reg = author.registry("derived", this.hab.pre);
      const event = yield* author.update(reg, this.graph.nodes[0], "issued");
      const kel = this.discloser!.kel(this.hab);
      for (const frame of parseBytes(kel)) yield* call(() => this.post(frame));
      for (const frame of parseBytes(concatBytes(kel, this.wallet!.registry.cloneTel(reg.regk!)))) {
        yield* call(() => this.post(frame, recipient.pre));
      }
      return event.said!;
    }.bind(this));
  }
  async approveUnblind(grant: string): Promise<void> {
    const selected = this.runtime.ipexAuxiliary;
    if (selected?.kind !== "unblind") throw new Error("Select Unblind runtime");
    this.operation = { grant, xid: selected.owner.approve(grant) };
    const body = this.runtime.exc.retainedInput(grant)!.serder;
    if (body.sad!.ri === this.hab.pre) {
      for (const frame of parseBytes(selected.owner.start(grant))) await this.post(frame, body.pre!);
    }
    await this.drainAuxiliary();
  }
  async finishUnblind(grant: string): Promise<void> {
    const selected = this.runtime.ipexAuxiliary;
    if (selected?.kind !== "unblind" || this.operation?.grant !== grant) {
      throw new Error("Select approved presentation");
    }
    assertEquals((await run(() => selected.owner.finish(this.operation!.xid))).kind, "accept");
    selected.owner.abandon(this.operation.xid);
    this.operation = undefined;
  }
  async reopenEvidence(): Promise<void> {
    await run(function*(this: TypeScriptPeer) {
      yield* this.walletDb!.close();
      yield* this.runtime.acdc!.baser.close();
      yield* this.hby.ks.close();
      yield* this.hby.db.close();
      yield* this.hby.ks.reopen();
      yield* this.hby.db.reopen();
      yield* this.runtime.acdc!.baser.reopen({ reuse: true });
      yield* this.walletDb!.reopen();
    }.bind(this));
  }
  async closeWallet(): Promise<void> {
    if (this.walletDb) await run(() => this.walletDb!.close(true));
  }

  /** Deliver a fresh grant only after both peers know its anchorer's subsequent rotation. */
  async historicalGrant(): Promise<string> {
    assertExists(this.remote);
    const node = this.disclosed(false)[0];
    const anchor = (said: string) => {
      this.hab.interact({ data: [{ d: said }] });
      return {
        i: new Prefixer({ qb64: this.hab.pre }),
        s: this.hab.kever!.sner,
        d: new Diger({ qb64: this.hab.kever!.said }),
      };
    };
    const childSeal = anchor(node.said!);
    const body = ipexExnBody(this.hab.pre, "/ipex/grant", [node], {
      message: "anchored before rotation",
      recipient: this.remote.pre,

      plan: this.plan,
      anchor: true,
    });
    const grantSeal = anchor(body.said!);
    this.hab.rotate();
    for (let sn = Number(childSeal.s.num); sn <= this.hab.kever!.sn; sn++) {
      const wire = acceptedEventReplayMessage(this.hby, this.hab.pre, sn, Vrsn_2_0).message;
      for (const frame of parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), wire))) await this.post(frame);
    }
    return await this.deliver({
      body,
      gvrsn: Vrsn_2_0,
      attachments: messageAttachmentGroups({ sourceSeals: [grantSeal] }, Vrsn_2_0),
      nests: [{
        body: node,
        gvrsn: Vrsn_2_0,
        attachments: messageAttachmentGroups({ sourceSeals: [childSeal] }, Vrsn_2_0),
      }],
    }, true);
  }

  /** Local protocol processing and public delivery share the same signed frame. */
  private async deliver(frame: CesrFrame, accepted: boolean): Promise<string> {
    const wire = await collectPayload(framePayload(frame));
    await run(() => this.runtime.reactor.processBytes(wire));
    assertEquals(Boolean(this.hby.db.exns.get(frame.body.said!)), accepted, `local outcome of ${frame.body.ilk}`);
    await this.post(frame);
    return frame.body.said!;
  }

  /** Build authenticated protocol-invalid replies without weakening the guarded public builders. */
  async invalidReply(
    verb: "grant" | "spurn",
    prior: string,
    defect: ReplyDefect,
  ): Promise<{ said: string; sender: string }> {
    const previous = this.hby.db.exns.get(prior);
    assertExists(previous);
    const owner = defect.kind === "sender" ? this.hby.makeHab("other-party") : this.hab;
    if (owner !== this.hab) {
      // The stored KEL replay is body-first; select its actual attachment genus before decoding.
      const wire = acceptedEventReplayMessage(this.hby, owner.pre, 0, Vrsn_2_0).message;
      for (const frame of parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), wire))) await this.post(frame);
    }
    const nodes = verb === "grant" ? this.disclosed(false) : [];
    const [body] = exchange(`/ipex/${verb}`, { m: "invalid reply", ...(nodes.length ? { o: [nodes[0].said] } : {}) }, {
      sender: owner.pre,
      recipient: defect.kind === "recipient" ? this.hab.pre : previous.pre!,
      xid: defect.kind === "exchange-id"
        ? new Diger({
          code: DigDex.Blake3_256,
          raw: Diger.digest(new TextEncoder().encode("other conversation"), DigDex.Blake3_256),
        }).qb64
        : previous.ilk === "xip"
        ? previous.said!
        : previous.sad!.x as string,
      dig: defect.kind === "prior" ? defect.said : prior,
      modifiers: verb === "grant" ? { dp: [[]] } : {},
      pvrsn: Vrsn_2_0,
      gvrsn: Vrsn_2_0,
    });
    const frame = this.signed(body, body, owner);
    frame.nests = nodes.map((node) => this.signed(node));
    return { said: await this.deliver(frame, false), sender: owner.pre };
  }

  /** Replay actual retained exchange evidence through ordinary HTTP ingress. */
  async replay(said: string): Promise<void> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of this.runtime.exc.replay(said)) chunks.push(chunk);
    for (const frame of parseBytes(concatBytes(...chunks))) await this.post(frame);
  }

  async snapshot(inspect?: string, registry?: string): Promise<DerivedPeerSnapshot> {
    if (this.intakeFailure) throw this.intakeFailure;
    const db = this.hby.db;
    const messages = [...db.exns.getItemIter()].map(([, body]) => body);
    const selected = inspect ? db.exns.get(inspect) ?? db.epse.get(inspect) : null;
    const grant = selected?.route === "/ipex/grant" ? selected : messages.find((body) => body.route === "/ipex/grant");
    registry ??= grant
      ? (loadNests(db, grant.said!)[0]?.body as SerderACDC | undefined)?.regid ?? undefined
      : undefined;
    const head = registry ? this.runtime.acdc!.store.headEvent(registry) : null;
    return {
      registryHead: head?.said ?? null,
      openingPresent: Boolean(head && this.runtime.acdc!.store.opening(head.said!)),
      rootPresent: Boolean(
        this.selectRuntime && registry && this.hab.mgr.getRegistryRoot(this.hab.pre, registry),
      ),
      encrypted: Boolean(this.hab.mgr.aeid),
      auxiliaryReady: Boolean(
        this.operation && (this.runtime.ipexAuxiliary!.kind === "unblind"
            && (db.exns.get(this.operation.grant) ?? db.epse.get(this.operation.grant))?.pre === this.hab.pre
          ? this.operation.replySent
          : this.runtime.ipexAuxiliary!.owner.complete(this.operation.xid)),
      ),
      deadline: grant ? this.runtime.exc.exchangeDeadline(grant) : null,
      grantRaw: grant ? new TextDecoder().decode(grant.raw) : null,
      admit: grant ? db.erpy.get([grant.said!])?.qb64 ?? null : null,
      witnesses: { threshold: Number(this.hab.kever!.toader.num), count: this.hab.kever!.wits.length },
      messages: messages.map((body) => body.sad as unknown as PeerSnapshot["messages"][number]),
      received: this.received.map(({ said }) => said),
      known: [...db.kevers.keys()],
      inspected: inspect
        ? {
          accepted: db.exns.get(inspect) !== null,
          escrowed: db.epse.get(inspect) !== null,
          nests: db.enst.get(inspect).length,
          decision: this.received.find(({ said }) => said === inspect)?.decision,
          reason: this.received.find(({ said }) => said === inspect)?.reason,
        }
        : null,
      nodes: await Promise.all((grant ? loadNests(db, grant.said!) : []).map(async frame => {
        const { body } = frame;
        assertInstanceOf(body, SerderACDC);
        return {
          said: body.said!,
          attributes: body.sad!.a as PeerSnapshot["nodes"][number]["attributes"],
          raw: new TextDecoder().decode(body.raw),
          proof: new TextDecoder().decode(await collectPayload(nestedPayload(frame, Vrsn_2_0))),
          independentlyAccepted: db.exns.get(body.said!) !== null,
        };
      })),
    };
  }
}

/** Observe real HTTP completion without replacing protocol processing or transport. */
class GroupHttpClient extends FetchHttpClient {
  replied = false;
  override *open(url: string, init?: HttpRequestInit): Operation<HttpStreamResponse> {
    const response = yield* super.open(url, init);
    if (response.ok && init?.method === "POST" && init.body) {
      const bytes = yield* call(() =>
        readCesrRequestBytes(
          new Request(url, {
            method: "POST",
            headers: init.headers,
            body: init.body as BodyInit,
          }),
        )
      );
      if (
        parseBytes(bytes).some(frame =>
          frame.body instanceof SerderKERI && frame.body.ilk === "rpy" && frame.body.route === "/ipex/unblind"
        )
      ) {
        this.replied = true;
      }
    }
    return response;
  }
}

/** Two holder invocations borrow the same maintained finite coordinators as Tufa. */
class TypeScriptGroupHolder extends TypeScriptPeer implements GroupHolderPeer {
  readonly memberHab = this.hab;
  members: PeerInfo[] = [];
  private work?: Promise<void>;
  private task?: Task<unknown>;
  private failure?: unknown;
  private phase = "idle";
  private approvedAdmits = new Map<string, string>();
  private readonly text = new TextDecoder();
  private endpointEvidence: Uint8Array[] = [];

  /** Finite coordinators own auxiliary cues; the individual fixture pump must not consume them. */
  protected override async drainAuxiliary(): Promise<void> {}

  async selectGroup(hab: Hab, members: PeerInfo[]): Promise<void> {
    this.hab = hab;
    this.members = members;
    this.info.member = this.memberHab.pre;
    this.info.pre = hab.pre;
    this.info.urls = members.map(member => member.url);
    this.runtime = await this.selectRuntime!("dhke", hab);
    this.wallet = new Wallet({
      hby: this.hby,
      registry: this.runtime.acdc!.store,
      exc: this.runtime.exc,
      db: this.wallet!.db,
    });
    this.discloser = new WalletDiscloser(
      this.wallet,
      new Receiptor(this.hby, this.runtime.protocol, this.runtime.http, this.runtime.clock, { gvrsn: Vrsn_2_0 }),
    );
  }

  override async connect(remote: PeerInfo, plan: DisclosurePlan): Promise<void> {
    await super.connect(remote, plan);
    if (this.hab.pre === this.memberHab.pre) return;
    const kel = [this.hab.pre, ...this.members.map(member => member.pre)].flatMap(
      pre => [...this.hby.db.clonePreIter(pre, 0, Vrsn_2_0)],
    );
    for (const wire of [...kel, ...this.endpointEvidence]) {
      for (const frame of parseBytes(wire)) await this.post(frame, remote.pre);
    }
  }
  async intake(wire: Uint8Array): Promise<void> {
    for (const frame of parseBytes(wire)) await run(() => this.runtime.protocol.dispatch(frame));
    await run(() => this.runtime.protocol.processEscrowsOnce());
  }
  memberEvidence(): Uint8Array {
    return concatBytes(
      ...this.hby.db.clonePreIter(this.memberHab.pre, 0, Vrsn_2_0),
      this.memberHab.makeLocScheme(this.info.url, this.memberHab.pre, "http"),
      this.memberHab.makeEndRole(this.memberHab.pre, "controller", true),
    );
  }
  async form(members: PeerInfo[], witnesses: readonly KeriPyWitnessNode[]): Promise<Uint8Array> {
    const prefixes = members.map(member => member.pre);
    const made = this.hby.makeGroupHab("holder-group", this.memberHab, prefixes, prefixes, undefined, {
      isith: "2",
      nsith: "2",
      wits: witnesses.map(node => node.pre),
      toad: 2,
    });
    await this.selectGroup(made.hab, members);
    return made.message;
  }
  async witnessGroup(): Promise<void> {
    await run(() => this.discloser!.receiptor.receipt(this.hab.pre));
  }
  groupKel(): Uint8Array {
    return concatBytes(...this.hby.db.clonePreIter(this.hab.pre, 0, Vrsn_2_0));
  }
  endpointBody(member: string): SerderKERI {
    return reply("/end/role/add", { cid: this.hab.pre, role: "controller", eid: member }, {
      pre: this.hab.pre,
      pvrsn: Vrsn_2_0,
    });
  }
  endorseEndpoint(body: SerderKERI): Uint8Array {
    return this.hab.endorse(body, { gvrsn: Vrsn_2_0 });
  }
  async rememberEndpoints(wires: Uint8Array[]): Promise<void> {
    for (const wire of wires) await this.intake(wire);
    this.endpointEvidence.push(...wires);
  }
  async rotateMember(): Promise<Uint8Array> {
    this.memberHab.rotate();
    await run(() => this.discloser!.receiptor.receipt(this.memberHab.pre));
    return this.memberEvidence();
  }
  rotateGroup(order: string[]): Uint8Array {
    return this.hby.rotateGroupHab("holder-group", order, order, { isith: "2", nsith: "2" }).message;
  }
  /** Distributed approval finishes after authoring; bind membership only to its accepted rotation. */
  commitRotation(wire: Uint8Array, order: string[]): void {
    const rotation = parseBytes(wire)[0].body;
    assertInstanceOf(rotation, SerderKERI);
    assertEquals(this.hab.kever!.said, rotation.said);
    assertEquals(rotation.ilk, "rot");
    assertEquals(
      this.hab.kever!.verfers.map(key => key.qb64),
      order.map(member => {
        const state = this.hby.db.getKever(member)!;
        assertEquals(state.verfers.length, 1);
        return state.verfers[0].qb64;
      }),
    );
    this.hby.commitGroupHabMembers(this.hab.pre, order, order);
  }

  private start(phase: string, operation: () => Operation<unknown>): void {
    if (this.work) throw new Error("Finish the previous finite group invocation first");
    this.phase = phase;
    this.task = run(operation);
    this.work = Promise.resolve(this.task).then(() => {
      this.phase = `${phase}-complete`;
      this.operation = undefined;
    }, error => {
      this.failure = error;
    });
  }
  private async finish(): Promise<void> {
    if (!this.work) throw new Error("No selected group invocation");
    await this.work;
    if (this.failure) throw this.failure;
    this.work = undefined;
    this.operation = undefined;
  }
  override approveDh(grant: string): Promise<void> {
    const selected = this.runtime.ipexAuxiliary;
    if (selected?.kind !== "dhke") throw new Error("Select group DH runtime");
    const coordinator = this.hab.kever!.said, custodian = this.members[0].pre;
    const xid = selected.owner.approve(grant, {
      coordinator: { sn: this.hab.kever!.sn, said: coordinator },
      custodian,
    });
    this.operation = { grant, xid };
    this.start("dh", () =>
      runGroupDerivedIssuance(this.runtime, this.wallet!, {
        role: "recipient",
        grant,
        coordinator,
        custodian,
      }, { timeoutMs: 120000, witnessGvrsn: Vrsn_2_0 }));
    return Promise.resolve();
  }
  override async finishDh(_grant: string): Promise<void> {
    await this.finish();
  }

  /** Both explicit member approvals select the same exact IPEX body and retained node bytes. */
  async prepareGroupIpex(verb: "grant" | "admit", prior: string): Promise<GroupProposal> {
    let body: SerderKERI, nests: CesrFrame[];
    if (verb === "grant") {
      const prepared = await run(() =>
        this.discloser!.prepareGrantBody(this.hab.pre, { fromGrant: prior }, {
          recipient: this.remote!.pre,
          message: "Exact group presentation",
          plan: this.plan,
        })
      );
      body = prepared.exn;
      nests = parseBytes(prepared.nests);
    } else {
      body = ipexExnBody(this.hab.pre, "/ipex/admit", [], {
        prior: this.hby.db.exns.get(prior)!,
        message: "Separate group acceptance",
      });
      nests = [];
    }
    const raw = await collectPayload(framePayload({ body, attachments: [], nests, gvrsn: Vrsn_2_0 }));
    const wire = await run(() => prepareAcdcV2GroupIpex(this.hby, this.runtime.protocol, this.hab, raw));
    assertExists(wire, "selected group IPEX policy must authorize this exact contribution");
    if (verb === "admit") this.approvedAdmits.set(body.said!, prior);
    return { said: body.said!, wire: this.text.decode(wire) };
  }
  async approveGroupIpex(wire: string): Promise<void> {
    const raw = new TextEncoder().encode(wire), body = parseBytes(raw)[0].body as SerderKERI;
    const approved = await run(() => prepareAcdcV2GroupIpex(this.hby, this.runtime.protocol, this.hab, raw));
    assertExists(approved);
    if (body.route === "/ipex/admit") this.approvedAdmits.set(body.said!, body.sad!.p as string);
    await this.deliverGroup(approved);
  }
  async finishGroupIpex(said: string): Promise<void> {
    assertEquals(this.runtime.exc.complete(said), true);
    const grant = this.approvedAdmits.get(said);
    if (grant) await this.wallet!.recordAdmission(grant, said, { consent: true });
  }
  private async deliverGroup(wire: Uint8Array): Promise<void> {
    for (const frame of parseBytes(wire)) {
      for (const peer of this.members) {
        if (peer.pre === this.memberHab.pre) continue;
        await run(() =>
          scoped(function*(this: TypeScriptGroupHolder) {
            const response = yield* requestFrame(peer.url, frame, this.runtime.http, { destination: this.hab.pre });
            yield* call(() => collectBytes(response.body()));
            assertEquals(response.status, 204);
          }.bind(this))
        );
      }
      await this.post(frame);
    }
  }
  override approveUnblind(grant: string, proposer?: string): Promise<void> {
    if (!proposer) throw new Error("Select the ordinary group Unblind proposer");
    this.start("unblind", () => runPresentationUnblind(this.runtime, grant, { proposer, timeoutMs: 120000 }));
    return Promise.resolve();
  }
  override async finishUnblind(_grant: string): Promise<void> {
    await this.finish();
  }
  override async snapshot(inspect?: string, registry?: string): Promise<GroupPeerSnapshot> {
    if (this.failure) throw this.failure;
    const snapshot = await super.snapshot(inspect, registry);
    return {
      ...snapshot,
      member: this.memberHab.pre,
      groupReady: Boolean(
        this.hab.kever && this.hab.pre !== this.memberHab.pre
          && this.hby.db.wigs.get(dgKey(this.hab.pre, this.hab.kever.said)).length >= Number(this.hab.kever.toader.num),
      ),
      signingMembers: groupSigningMembers(this.hby, this.hab.pre),
      groupPhase: this.phase,
      auxiliaryReady: this.phase.endsWith("-complete") || snapshot.auxiliaryReady,
      deliveredReply: this.phase === "unblind-complete" && (this.runtime.http as GroupHttpClient).replied,
    };
  }
  async closeGroup(): Promise<void> {
    if (this.task) await this.task.halt();
  }
}

/** Control client for the independent Python process; never builds its protocol bytes. */
class PythonPeer implements DerivedIpexPeer {
  readonly implementation = "KERIpy";
  constructor(readonly info: PeerInfo) {}

  protected async command<T>(action: string, args: object): Promise<T> {
    const response = await fetch(new URL("_fixture", this.info.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...args }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    assertEquals(response.status, 200, `${action}: ${text}`);
    return JSON.parse(text);
  }

  async connect(remote: PeerInfo, plan: DisclosurePlan): Promise<void> {
    await this.command("connect", { remote, plan });
  }
  send(verb: Verb, prior?: string, invalid: boolean | DisclosureDefect = false): Promise<string> {
    return this.command("send", { verb, prior, invalid });
  }
  historicalGrant(): Promise<string> {
    return this.command("historical_grant", {});
  }
  invalidReply(verb: "grant" | "spurn", prior: string, defect: ReplyDefect): Promise<{ said: string; sender: string }> {
    return this.command("invalid_reply", { verb, prior, defect });
  }
  async replay(said: string): Promise<void> {
    await this.command("replay", { said });
  }
  snapshot(inspect?: string, registry?: string): Promise<DerivedPeerSnapshot> {
    return this.command("snapshot", { inspect, registry });
  }
  async enableWitnessedEvidence(witnesses: readonly KeriPyWitnessNode[]): Promise<void> {
    Object.assign(this.info, await this.command("witnessed_evidence", { witnesses }));
  }
  present(grant: string): Promise<string> {
    return this.command("present", { grant });
  }
  async reopenEvidence(): Promise<void> {
    await this.command("reopen_evidence", {});
  }
  async prepareDerived(recipient: string): Promise<string> {
    const result = await this.command("prepare_derived", { recipient }) as { grant: string; info: PeerInfo };
    Object.assign(this.info, result.info);
    return result.grant;
  }
  async approveDh(grant: string): Promise<void> {
    await this.command("approve_dh", { grant });
  }
  async issueDerived(grant: string): Promise<string> {
    return (await this.command("issue_derived", { grant }) as { event: string }).event;
  }
  async finishDh(grant: string): Promise<void> {
    await this.command("finish_dh", { grant });
  }
  async useUnblind(): Promise<void> {
    await this.command("use_unblind", {});
  }
  async publishUpdate(recipient: PeerInfo): Promise<string> {
    return (await this.command("publish_update", { recipient }) as { event: string }).event;
  }
  async approveUnblind(grant: string): Promise<void> {
    await this.command("approve_unblind", { grant });
  }
  async finishUnblind(grant: string): Promise<void> {
    await this.command("finish_unblind", { grant });
  }
}

/** Public commands run the Python command owners in their own encrypted member stores. */
class PythonGroupPeer extends PythonPeer implements GroupIssuerPeer {
  async groupEndpoints(): Promise<string[]> {
    return (await this.command<{ wires: string[] }>("group_endpoints", {})).wires;
  }
  async approveGroupEndpoints(wires: string[]): Promise<void> {
    await this.command("approve_group_endpoints", { wires });
  }
  async createGroup(members: PeerInfo[], witnesses: readonly KeriPyWitnessNode[]): Promise<void> {
    Object.assign(this.info, await this.command("create_group", { members, witnesses }));
  }
  prepareGroupRegistry(): Promise<{ registry: string; proposal: string }> {
    return this.command("prepare_group_registry", {});
  }
  async approveGroupEvent(wire: string): Promise<void> {
    await this.command("approve_group_event", { wire });
  }
  pendingGroupEvent(): Promise<GroupProposal | null> {
    return this.command("pending_group_event", {});
  }
  async prepareGroupDerived(recipient: string, consentLifetime: number): Promise<{ grant: string; proposal: string }> {
    const result = await this.command<{ grant: string; proposal: string; info: PeerInfo }>("prepare_group_derived", {
      recipient,
      consentLifetime,
    });
    Object.assign(this.info, result.info);
    return result;
  }
  async approveGroupDerived(proposal: string, consentLifetime: number): Promise<void> {
    await this.command("approve_group_derived", { proposal, consentLifetime });
  }
  async finalProof(grant: string): Promise<string> {
    return (await this.command<{ proof: string }>("final_group_proof", { grant })).proof;
  }
  async acceptGroupProof(grant: string, proof: string): Promise<void> {
    await this.command("accept_group_proof", { grant, proof });
  }
  override snapshot(inspect?: string, registry?: string): Promise<GroupPeerSnapshot> {
    return this.command("snapshot", { inspect, registry });
  }
}

/** Start the subprocess without scenario flags; preserve live output on failure. */
async function withPythonPeer(
  context: InteropContext,
  graph: GraphCase | undefined,
  body: (peer: DerivedIpexPeer) => Promise<void>,
  witnessed: boolean | "derived" = false,
  group = false,
  grantWalk?: AcdcWalkPolicy,
): Promise<void> {
  // HIO HTTP treats port=0 as port 80; select an available unprivileged port explicitly.
  const port = randomPort();
  const child = spawnChild(
    context.pythonCommand,
    [
      PEER,
      context.home,
      group ? "derived-group" : witnessed === "derived" ? "derived" : witnessed ? "witnessed" : graph ?? "-",
      String(port),
      grantWalk ?? "-",
    ],
    context.env,
    context.repoRoot,
  );
  const output = Promise.all([new Response(child.liveStdout).text(), new Response(child.liveStderr).text()]);
  let exited: Deno.CommandStatus | undefined;
  void child.status.then((status) => {
    exited = status;
  });
  let failure: { cause: unknown } | undefined;
  let diagnostics = "";
  try {
    const info = await observed("KERIpy listener", async () => {
      if (exited) throw new Error(`KERIpy exited ${exited.code}: ${(await output).join("\n")}`);
      try {
        return JSON.parse(await Deno.readTextFile(`${context.home}/ready.json`)) as PeerInfo;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return undefined;
        throw error;
      }
    });
    assertEquals(Number(new URL(info.url).port), port, "KERIpy peer must bind the selected unprivileged port");
    await body(group ? new PythonGroupPeer(info) : new PythonPeer(info));
  } catch (error) {
    failure = { cause: error };
  } finally {
    diagnostics = await stopChild(child);
    await output;
  }
  if (failure) throw new Error(`KERIpy HTTP fixture: ${diagnostics}`, failure);
}

export interface IpexPeers {
  issuer: IpexPeer;
  holder: IpexPeer;
  plan: DisclosurePlan;
}

/** Scope the TypeScript runtime independently of the Python process and scenario. */
async function withTypeScriptPeer(
  graph: GraphCase | undefined,
  body: (peer: IpexPeer) => Promise<void>,
  grantWalk?: AcdcWalkPolicy,
): Promise<void> {
  await run(function*() {
    const hby = yield* createHabery({ name: `ipex-http-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
        kram: { enabled: true, denials: [], caches: { "~": [1000, 60000, 120000, 300000, 60000, 120000, 300000] } },
        grantWalk,
      });
      try {
        const peer = new TypeScriptPeer(hby, runtime, graph);
        try {
          yield* call(() => body(peer));
        } finally {
          yield* call(() => peer.closeWallet());
          yield* call(() => peer.server.shutdown());
        }
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close(true);
    }
  });
}

/** One fresh pair per test. KEL introduction also uses the public CESR endpoints. */
export async function withIpexPeers(
  /** `grantWalk` applies to both peers; omitted, each uses its default policy. */
  options: { issuer: Implementation; graph?: GraphCase; witnessed?: boolean; grantWalk?: AcdcWalkPolicy },
  scenario: (peers: IpexPeers) => Promise<void>,
): Promise<void> {
  const context = await createInteropContext();
  const tsIssuer = options.issuer === "TypeScript";
  const witnesses = options.witnessed
    ? await startKeriPyWitnessHarness(context, { aliases: ["wan", "wil", "wes"], protocolVersion: 2 })
    : undefined;
  try {
    await withTypeScriptPeer(
      tsIssuer ? options.graph : undefined,
      (ts) =>
        withPythonPeer(
          context,
          tsIssuer ? undefined : options.graph,
          async (py) => {
            if (witnesses) {
              await ts.enableWitnessedEvidence(witnesses.nodes);
              await py.enableWitnessedEvidence(witnesses.nodes);
            }
            const issuer = tsIssuer ? ts : py, holder = tsIssuer ? py : ts;
            const plan = disclosurePlan(issuer.info.schemas, options.graph);
            await ts.connect(py.info, plan);
            await py.connect(ts.info, plan);
            for (const [peer, other] of [[ts, py], [py, ts]]) {
              await observed(
                `${peer.implementation} verified remote KEL`,
                async () => (await peer.snapshot()).known.includes(other.info.pre) ? true : undefined,
              );
            }
            await scenario({ issuer, holder, plan });
          },
          options.witnessed,
          false,
          options.grantWalk,
        ),
      options.grantWalk,
    );
  } finally {
    await witnesses?.close();
    await Deno.remove(context.home, { recursive: true });
  }
}

/** Three independent stores; only the issuer and holder take part in DH. */
export interface DerivedIpexPeers {
  issuer: DerivedIpexPeer;
  holder: DerivedIpexPeer;
  verifier: DerivedIpexPeer;
  plan: DisclosurePlan;
}

/** Keep actual borrowed registry/wallet stores open across the holder's ordinary invocation switch. */
async function withDerivedTypeScriptPeer(body: (peer: DerivedIpexPeer) => Promise<void>, group = false): Promise<void> {
  await run(function*() {
    const hby = yield* createHabery({
      name: crypto.randomUUID(),
      temp: true,
      skipConfig: true,
      bran: "ReciprocalSecretABCD12",
    });
    yield* ensure(() => hby.close(true));
    let hab = hby.makeHab(
      "typescript",
      undefined,
      group
        ? { icount: 1, isith: "1", ncount: 1, nsith: "1" }
        : { icount: 2, isith: "2", ncount: 2, nsith: "2" },
    );
    const http = group ? new GroupHttpClient() : new FetchHttpClient();
    const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
    yield* ensure(() => baser.close(true));
    const rgy = new Regery(hby, baser), scope = yield* useScope();
    let phase: Task<void> | undefined;
    const select = async (kind: "dhke" | "unblind", selectedHab?: Hab): Promise<AgentRuntime> => {
      if (phase) await phase.halt();
      if (selectedHab) hab = selectedHab;
      return await new Promise<AgentRuntime>((resolve, reject) => {
        phase = scope.run(function*() {
          const runtime = yield* createAgentRuntime(hby, http, systemClock, {
            acdc: rgy,
            kram: { enabled: true, denials: [], caches: { "~": [1000, 60000, 120000, 300000, 60000, 120000, 300000] } },
            ipexAuxiliary: kind === "dhke" ? { kind, hab } : { kind, hab },
          });
          resolve(runtime);
          try {
            yield* suspend();
          } finally {
            yield* runtime.close();
          }
        });
        void Promise.resolve(phase).catch(reject);
      });
    };
    const runtime = yield* call(() => select("dhke"));
    const peer = group
      ? new TypeScriptGroupHolder(hby, runtime, undefined, hab, select)
      : new TypeScriptPeer(hby, runtime, undefined, hab, select);
    try {
      yield* call(() => body(peer));
    } finally {
      if (peer instanceof TypeScriptGroupHolder) yield* call(() => peer.closeGroup());
      yield* call(() => peer.server.shutdown());
      if (phase) yield* phase.halt();
      yield* call(() => peer.closeWallet());
    }
  });
}

/** Reuse the real three-witness quorum while assigning every Python process its own home/ready file. */
export async function withDerivedIpexPeers(
  { issuer: implementation }: { issuer: Implementation },
  scenario: (peers: DerivedIpexPeers) => Promise<void>,
): Promise<void> {
  const context = await createInteropContext();
  const witnesses = await startKeriPyWitnessHarness(context, { aliases: ["wan", "wil", "wes"], protocolVersion: 2 });
  const withPeer = async (kind: Implementation, role: string, body: (peer: DerivedIpexPeer) => Promise<void>) => {
    if (kind === "TypeScript") return await withDerivedTypeScriptPeer(body);
    const home = `${context.home}/${role}`;
    await Deno.mkdir(home);
    return await withPythonPeer({ ...context, home }, undefined, body, "derived");
  };
  try {
    await withPeer(
      implementation,
      "issuer",
      issuer =>
        withPeer(
          implementation === "TypeScript" ? "KERIpy" : "TypeScript",
          "holder",
          holder =>
            withPeer(implementation, "verifier", async verifier => {
              for (const peer of [issuer, holder, verifier]) {
                await peer.enableWitnessedEvidence(witnesses.nodes);
              }
              const plan: DisclosurePlan = [[issuer.info.schemas[0], "/", ["a/i", "a/status/"]]];
              // Introductions carry only public KEL evidence; final connection selects each initial conversation partner.
              await issuer.connect(verifier.info, plan);
              await verifier.connect(issuer.info, plan);
              await holder.connect(verifier.info, plan);
              await verifier.connect(holder.info, plan);
              await issuer.connect(holder.info, plan);
              await holder.connect(issuer.info, plan);
              for (const peer of [issuer, holder, verifier]) {
                await observed(`${peer.implementation} ${peer.info.pre} introduced peers`, async () => {
                  const known = (await peer.snapshot()).known;
                  return [issuer, holder, verifier].every(other => known.includes(other.info.pre)) || undefined;
                });
              }
              await scenario({ issuer, holder, verifier, plan });
            }),
        ),
    );
  } finally {
    await witnesses.close();
    await Deno.remove(context.home, { recursive: true });
  }
}

export interface DerivedGroupIpexPeers {
  issuers: [GroupIssuerPeer, GroupIssuerPeer];
  holders: [GroupHolderPeer, GroupHolderPeer];
  verifier: DerivedIpexPeer;
  plan: DisclosurePlan;
  rotateHolders(): Promise<void>;
}

/** One five-store topology; every public introduction still enters ordinary HTTP/Parser owners. */
export async function withDerivedGroupIpexPeers(
  scenario: (peers: DerivedGroupIpexPeers) => Promise<void>,
): Promise<void> {
  const context = await createInteropContext();
  const witnesses = await startKeriPyWitnessHarness(context, { aliases: ["wan", "wil", "wes"], protocolVersion: 2 });
  const python = async (role: string, group: boolean, body: (peer: DerivedIpexPeer) => Promise<void>) => {
    const home = `${context.home}/${role}`;
    await Deno.mkdir(home);
    await withPythonPeer({ ...context, home }, undefined, body, "derived", group);
  };
  try {
    await python(
      "issuer-0",
      true,
      first =>
        python(
          "issuer-1",
          true,
          second =>
            withDerivedTypeScriptPeer(left =>
              withDerivedTypeScriptPeer(right =>
                python("verifier", false, async verifier => {
                  const issuers = [first, second] as [GroupIssuerPeer, GroupIssuerPeer];
                  const holders = [left, right] as [TypeScriptGroupHolder, TypeScriptGroupHolder];
                  const all = [...issuers, ...holders, verifier];
                  for (const peer of all) {
                    await peer.enableWitnessedEvidence(witnesses.nodes);
                  }
                  const plan: DisclosurePlan = [[first.info.schemas[0], "/", []]];
                  // Introduce actual member KELs before group construction, preserving each member's coordinates.
                  for (const source of all) {
                    for (const target of all) {
                      if (source !== target) await source.connect(target.info, plan);
                    }
                  }
                  const issuerMembers = issuers.map(peer => structuredClone(peer.info));
                  const holderMembers = holders.map(peer => structuredClone(peer.info));
                  await issuers[0].createGroup(issuerMembers, witnesses.nodes);
                  await issuers[1].createGroup(issuerMembers, witnesses.nodes);
                  for (const peer of issuers) {
                    await observed(
                      "Python group accepted",
                      async () => (await peer.snapshot()).groupReady || undefined,
                    );
                  }
                  await issuers[1].approveGroupEndpoints(await issuers[0].groupEndpoints());
                  for (const peer of issuers) {
                    await observed("Python group controller endpoints authenticated", async () =>
                      (await peer.snapshot()).groupEndpoints || undefined);
                  }
                  const memberWires = holders.map(peer =>
                    peer.memberEvidence()
                  );
                  for (const peer of holders) for (const wire of memberWires) await peer.intake(wire);
                  const inceptions = [];
                  for (const peer of holders) inceptions.push(await peer.form(holderMembers, witnesses.nodes));
                  for (const peer of holders) for (const wire of inceptions) await peer.intake(wire);
                  await holders[0].witnessGroup();
                  await holders[1].intake(holders[0].groupKel());
                  const endpoints = [...memberWires];
                  for (const member of holderMembers) {
                    const body = holders[0].endpointBody(member.pre);
                    endpoints.push(...holders.map(peer => peer.endorseEndpoint(body)));
                  }
                  for (const peer of holders) await peer.rememberEndpoints(endpoints);
                  // Current endpoints carry both member URLs, while each process retains only its own private keys.
                  for (const source of all) {
                    for (const target of all) {
                      if (source !== target && source.info.pre !== target.info.pre) {
                        await source.connect(target.info, plan);
                      }
                    }
                  }
                  for (const peer of issuers) {
                    await peer.connect(holders[0].info, plan);
                  }
                  for (const peer of holders) await peer.connect(issuers[0].info, plan);
                  await verifier.connect(holders[0].info, plan);
                  await scenario({
                    issuers,
                    holders,
                    verifier,
                    plan,
                    async rotateHolders() {
                      const memberRotations = await Promise.all(holders.map(peer => peer.rotateMember()));
                      for (const peer of holders) for (const wire of memberRotations) await peer.intake(wire);
                      const order = holderMembers.map(peer => peer.pre).reverse();
                      const rotations = holders.map(peer => peer.rotateGroup(order));
                      for (const peer of holders) for (const wire of rotations) await peer.intake(wire);
                      await holders[1].witnessGroup();
                      await holders[0].intake(holders[1].groupKel());
                      for (const peer of holders) peer.commitRotation(rotations[0], order);
                      for (const source of holders) {
                        for (const target of [...issuers, verifier]) await source.connect(target.info, plan);
                      }
                    },
                  });
                }), true), true),
        ),
    );
  } finally {
    await witnesses.close();
    await Deno.remove(context.home, { recursive: true });
  }
}
