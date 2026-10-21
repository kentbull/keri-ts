/** Independent HTTP peers. Fixtures own resources; tests own conversation order. */
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { collectBytes } from "../../../../src/app/transport/byte-source.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";

import {
  type CesrFrame,
  collectPayload,
  concatBytes,
  Counter,
  DigDex,
  Diger,
  framePayload,
  type MapperMap,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  SerderACDC,
  type SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run, scoped } from "effection";
import { assertEquals, assertExists, assertInstanceOf } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { acdcmap } from "../../../../src/acdc/messaging.ts";
import {
  acceptedEventReplayMessage,
  createHabery,
  type Hab,
  type Habery,
} from "../../../../src/app/identity/habbing.ts";
import { ipexExnBody } from "../../../../src/app/ipex/ipex-building.ts";
import type { DisclosurePlan } from "../../../../src/app/ipex/ipex-graph.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { requestFrame } from "../../../../src/app/transport/cesr-egress.ts";
import { readCesrRequestBytes } from "../../../../src/app/transport/cesr-http.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { exchange } from "../../../../src/core/exchange/protocol-exchanging.ts";
import { messageAttachmentGroups, messagize } from "../../../../src/core/protocol-serialization.ts";
import { loadNests } from "../../../../src/db/exchange/exchange-nests.ts";
import {
  createInteropContext,
  type InteropContext,
  randomPort,
  spawnChild,
  stopChild,
} from "../interop-test-helpers.ts";
import {
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
export type DisclosureDefect = "extra" | "missing" | "altered";
export type Verb = "apply" | "offer" | "agree" | "grant" | "admit" | "spurn";

/** Public coordinates only; each peer keeps its private keys and stores. */
export interface PeerInfo {
  pre: string;
  url: string;
  schema: string;
  commitment: string;
}

/** The same observations from each implementation, without sharing persistence internals. */
export interface PeerSnapshot {
  messages: { d: string; r: string; p: string; x: string; i: string; ri: string }[];
  received: string[];
  known: string[];
  notifications?: number;
  inspected: { accepted: boolean; escrowed: boolean; nests: number; decision?: string; reason?: string } | null;
  nodes: {
    said: string;
    attributes: { status: { value: string }; private: unknown; contact: unknown; role: unknown };
    raw: string;
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

/** Native runtime behind a real CESR listener, with observations from its own store. */
class TypeScriptPeer implements IpexPeer {
  readonly implementation = "TypeScript";
  readonly server: Deno.HttpServer<Deno.NetAddr>;
  readonly info: PeerInfo;
  private readonly graph: DisclosureGraph;
  private readonly hab: Hab;
  private readonly received: { said: string; decision: string | undefined; reason?: string }[] = [];
  private remote?: PeerInfo;
  private plan?: DisclosurePlan;
  private intakeFailure?: unknown;

  constructor(private hby: Habery, private runtime: AgentRuntime, private graphCase?: GraphCase) {
    this.hab = hby.makeHab("typescript");
    this.graph = graphDisclosures(hby, this.hab, graphCase);
    this.server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => this.receive(request));
    this.info = {
      pre: this.hab.pre,
      url: `http://127.0.0.1:${this.server.addr.port}/`,
      schema: (this.graph.fullNodes[0].sad!.s as { $id: string }).$id,
      commitment: this.graph.fullNodes[0].said!,
    };
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
      return new Response(null, { status: 204 });
    } catch (error) {
      this.intakeFailure = error;
      return new Response(String(error), { status: 500 });
    }
  }

  private async post(frame: CesrFrame): Promise<void> {
    const remote = this.remote;
    assertExists(remote, "connect the peer before sending");
    const http = this.runtime.http;
    await run(() =>
      scoped(function*() {
        const response = yield* requestFrame(remote.url, frame, http, { destination: remote.pre });
        yield* call(() => collectBytes(response.body()));
        assertEquals(response.status, 204);
      })
    );
  }

  async connect(remote: PeerInfo, plan: DisclosurePlan): Promise<void> {
    this.remote = remote;
    this.plan = plan;
    for (const issuer of this.graph.issuers) {
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
      nodes[0] = acdcmap(node.issuer!, {
        uuid: node.sad!.u as string,
        schema: node.sad!.s as MapperMap,
        edge: node.sad!.e as MapperMap | undefined,
        attribute: attributes,
      });
    }
    return nodes;
  }

  async send(verb: Verb, prior?: string, invalid: boolean | DisclosureDefect = false): Promise<string> {
    assertExists(this.remote);
    assertExists(this.plan);
    const previous = prior ? this.hby.db.exns.get(prior) : undefined;
    if (prior) assertExists(previous, `Missing prior exchange: ${prior}`);
    let carried: SerderACDC[] = [];
    if (verb === "grant") carried = this.disclosed(invalid);
    if (verb === "offer" && !this.graphCase) carried = this.disclosed(false);
    const body = ipexExnBody(this.hab.pre, `/ipex/${verb}`, carried, {
      message: invalid ? "invalid chain" : verb,
      prior: previous ?? undefined,
      recipient: this.remote.pre,
      ...(!prior ? { xid: this.graph.fullNodes[0].said!, plan: this.plan } : {}),
    });
    const frame = this.signed(body);
    frame.nests = carried.map((node, i) =>
      verb === "grant" && !(invalid && node.said === this.graph.unsigned)
        ? this.signed(node, invalid === "altered" && !i ? this.disclosed(false)[0] : node)
        : { body: node, attachments: [], gvrsn: Vrsn_2_0 }
    );
    return await this.deliver(frame, !invalid);
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
      xid: node.said!,
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

  snapshot(inspect?: string): Promise<PeerSnapshot> {
    if (this.intakeFailure) throw this.intakeFailure;
    const db = this.hby.db;
    const messages = [...db.exns.getItemIter()].map(([, body]) => body);
    const selected = inspect ? db.exns.get(inspect) : null;
    const grant = selected?.route === "/ipex/grant" ? selected : messages.find((body) => body.route === "/ipex/grant");
    return Promise.resolve({
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
      nodes: (grant ? loadNests(db, grant.said!) : []).map(({ body }) => {
        assertInstanceOf(body, SerderACDC);
        return {
          said: body.said!,
          attributes: body.sad!.a as PeerSnapshot["nodes"][number]["attributes"],
          raw: new TextDecoder().decode(body.raw),
          independentlyAccepted: db.exns.get(body.said!) !== null,
        };
      }),
    });
  }
}

/** Control client for the independent Python process; never builds its protocol bytes. */
class PythonPeer implements IpexPeer {
  readonly implementation = "KERIpy";
  constructor(readonly info: PeerInfo) {}

  private async command<T>(action: string, args: object): Promise<T> {
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
  snapshot(inspect?: string): Promise<PeerSnapshot> {
    return this.command("snapshot", { inspect });
  }
}

/** Start the subprocess without scenario flags; preserve live output on failure. */
async function withPythonPeer(
  context: InteropContext,
  graph: GraphCase | undefined,
  body: (peer: IpexPeer) => Promise<void>,
): Promise<void> {
  // HIO HTTP treats port=0 as port 80; select an available unprivileged port explicitly.
  const port = randomPort();
  const child = spawnChild(
    context.pythonCommand,
    [PEER, context.home, graph ?? "-", String(port)],
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
    await body(new PythonPeer(info));
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

/** Scope the native runtime independently of the Python process and scenario. */
async function withTypeScriptPeer(
  graph: GraphCase | undefined,
  body: (peer: IpexPeer) => Promise<void>,
): Promise<void> {
  await run(function*() {
    const hby = yield* createHabery({ name: `ipex-http-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
        kram: { enabled: true, denials: [], caches: { "~": [1000, 60000, 120000, 300000, 60000, 120000, 300000] } },
      });
      try {
        const peer = new TypeScriptPeer(hby, runtime, graph);
        try {
          yield* call(() => body(peer));
        } finally {
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
  options: { issuer: Implementation; graph?: GraphCase },
  scenario: (peers: IpexPeers) => Promise<void>,
): Promise<void> {
  const context = await createInteropContext();
  const tsIssuer = options.issuer === "TypeScript";
  try {
    await withTypeScriptPeer(
      tsIssuer ? options.graph : undefined,
      (ts) =>
        withPythonPeer(context, tsIssuer ? undefined : options.graph, async (py) => {
          const issuer = tsIssuer ? ts : py, holder = tsIssuer ? py : ts;
          const plan = disclosurePlan(issuer.info.schema, options.graph);
          await ts.connect(py.info, plan);
          await py.connect(ts.info, plan);
          for (const [peer, other] of [[ts, py], [py, ts]]) {
            await observed(
              `${peer.implementation} verified remote KEL`,
              async () => (await peer.snapshot()).known.includes(other.info.pre) ? true : undefined,
            );
          }
          await scenario({ issuer, holder, plan });
        }),
    );
  } finally {
    await Deno.remove(context.home, { recursive: true });
  }
}
