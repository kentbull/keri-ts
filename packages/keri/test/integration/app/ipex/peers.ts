/** Independent HTTP peers. Fixtures own resources; tests own conversation order. */
import {
  type CesrFrame,
  collectPayload,
  Diger,
  framePayload,
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
import { type AgentRuntime, createAgentRuntime } from "../../../../src/app/agent-runtime.ts";
import { requestFrame } from "../../../../src/app/cesr-egress.ts";
import { readCesrRequestBytes } from "../../../../src/app/cesr-http.ts";
import { createHabery, type Hab, type Habery } from "../../../../src/app/habbing.ts";
import { ipexExnBody } from "../../../../src/app/ipex-building.ts";
import type { DisclosurePlan } from "../../../../src/app/ipex-graph.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { messageAttachmentGroups, messagize } from "../../../../src/core/protocol-serialization.ts";
import { loadNests } from "../../../../src/db/exchange-nests.ts";
import {
  createInteropContext,
  type InteropContext,
  randomPort,
  spawnChild,
  stopChild,
} from "../interop-test-helpers.ts";
import { type DisclosureGraph, disclosurePlan, type GraphCase, graphDisclosures } from "./disclosures.ts";

const PEER = fromFileUrl(new URL("../../../fixtures/ipex-http-peer.py", import.meta.url));
export type Implementation = "TypeScript" | "KERIpy";
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
  inspected: { accepted: boolean; escrowed: boolean; nests: number; decision?: string } | null;
  nodes: {
    said: string;
    attributes: { status: { value: string }; private: unknown };
    raw: string;
    independentlyAccepted: boolean;
  }[];
}

/** Two concrete implementations expose actions, never an automatic responder. */
export interface IpexPeer {
  readonly implementation: Implementation;
  readonly info: PeerInfo;
  connect(remote: PeerInfo, plan: DisclosurePlan): Promise<void>;
  send(verb: Verb, prior?: string, invalid?: boolean): Promise<string>;
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
  private readonly received: { said: string; decision: string | undefined }[] = [];
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
        const result = await run(() => this.runtime.reactor.dispatch(frame));
        this.received.push({ said: frame.body.said!, decision: result.decision ? result.decision.kind : undefined });
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
    const services = this.runtime.services;
    await run(() =>
      scoped(function*() {
        const response = yield* requestFrame(remote.url, frame, { destination: remote.pre, services });
        yield* call(() => response.arrayBuffer());
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
  private signed(body: SerderACDC | SerderKERI): CesrFrame {
    const owner = body instanceof SerderACDC
      ? this.graph.issuers.find((issuer) => issuer.pre === body.issuer)
      : this.hab;
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
            owner.sign(body.raw, true),
          ),
        ],
      }, Vrsn_2_0),
    };
  }

  async send(verb: Verb, prior?: string, invalid = false): Promise<string> {
    assertExists(this.remote);
    assertExists(this.plan);
    const previous = prior ? this.hby.db.exns.get(prior) : undefined;
    if (prior) assertExists(previous, `Missing prior exchange: ${prior}`);
    let carried: SerderACDC[] = [];
    if (verb === "grant") carried = invalid ? this.graph.badNodes : this.graph.nodes;
    if (verb === "offer" && !this.graphCase) carried = this.graph.nodes;
    const body = ipexExnBody(this.hab.pre, `/ipex/${verb}`, carried, {
      message: invalid ? "invalid chain" : verb,
      prior: previous ?? undefined,
      recipient: this.remote.pre,
      ...(!prior ? { xid: this.graph.fullNodes[0].said!, plan: this.plan } : {}),
    });
    const frame = this.signed(body);
    frame.nests = carried.map((node) =>
      verb === "grant" && !(invalid && node.said === this.graph.unsigned)
        ? this.signed(node)
        : { body: node, attachments: [], gvrsn: Vrsn_2_0 }
    );
    const wire = await collectPayload(framePayload(frame));
    await run(() => this.runtime.reactor.processBytes(wire));
    assertEquals(Boolean(this.hby.db.exns.get(body.said!)), !invalid, `local outcome of ${verb}`);
    await this.post(frame);
    return body.said!;
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
  send(verb: Verb, prior?: string, invalid = false): Promise<string> {
    return this.command("send", { verb, prior, invalid });
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
      const runtime = yield* createAgentRuntime(hby, {
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
