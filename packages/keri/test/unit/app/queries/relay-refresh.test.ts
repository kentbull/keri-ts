/**
 * Relay mode on the agent: a served edge's query about a remote subject makes the relaying agent query that subject
 * itself, by ordinary direct delivery, so a later edge query returns the refreshed state. The edge authorizes the
 * agent as `relaying.test.ts` does, through the real mailbox add. Where a test says so, the edge reaches a real
 * relaying agent behind the hosting protocol handler.
 */
import { type Operation, run, sleep, spawn } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { parseBytes, SerderKERI } from "../../../../../cesr/mod.ts";
import { createProtocolHandler } from "../../../../../hosting/src/http/protocol-handler.ts";
import type { ProtocolHandler } from "../../../../../hosting/src/http/protocol/types.ts";
import type { Relay } from "../../../../src/app/delivery/relaying.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { addMailbox, type MailboxAdminDeps } from "../../../../src/app/mailbox/mailbox-admin.ts";
import { mailboxTopicKey } from "../../../../src/app/mailbox/mailboxing.ts";
import {
  type AgentRuntime,
  createAgentRuntime,
  settleRuntimeIngress,
} from "../../../../src/app/runtime/agent-runtime.ts";
import { processCuesOnce } from "../../../../src/app/runtime/cue-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { readCesrRequestBytes } from "../../../../src/app/transport/cesr-http.ts";
import type { HttpClient } from "../../../../src/app/transport/http-client.ts";
import { TransportError } from "../../../../src/app/transport/transport-error.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { httpClient } from "../../../support/http-client.ts";

const RELAY_OOBI_ORIGIN = "http://agent-oobi.test";
const RELAY_URL = "http://agent.test:5642/";
const REMOTE_URL = "http://remote.test:5642/";

/** One HTTP request as its peer received it. */
interface Received {
  readonly url: string;
  readonly destination: string | null;
  readonly bytes: Uint8Array;
  readonly frames: ReturnType<typeof parseBytes>;
}

/** What a recording client does with a request once it has recorded it. */
type Answer = (request: Request) => Promise<Response>;

/** Accept every request. */
const accept: Answer = () => Promise.resolve(new Response(null, { status: 204 }));

/** Fail every request as an unreachable peer does. */
const unreachable: Answer = (request) => Promise.reject(new TransportError(`${request.url} is unreachable`));

/** A client that records every CESR request and then answers it with `answer`. */
function recordingHttp(received: Received[], answer: Answer): HttpClient {
  return httpClient(async (url, init) => {
    const request = new Request(url, init);
    const forwarded = request.clone();
    const bytes = request.method === "GET" ? new Uint8Array() : await readCesrRequestBytes(request);
    received.push({ url, destination: request.headers.get("CESR-DESTINATION"), bytes, frames: parseBytes(bytes) });
    return await answer(forwarded);
  });
}

/** The `qry` messages of a set of requests (an introduction may precede them). */
function queries(received: readonly Received[]): SerderKERI[] {
  return received.flatMap(({ frames }) =>
    frames.flatMap((frame) => frame.body instanceof SerderKERI && frame.body.ilk === "qry" ? [frame.body] : [])
  );
}

/** The mailbox-admin collaborators of a composed runtime, as the wallet passes them. */
function adminDeps(runtime: AgentRuntime): MailboxAdminDeps {
  return {
    hby: runtime.hby,
    http: runtime.http,
    reactor: runtime.reactor,
    protocol: runtime.protocol,
    publisher: runtime.kelPublisher,
  };
}

/** A relaying agent, an edge that relays through it, and a remote controller only the agent can reach. */
interface RelayScene {
  readonly agentRuntime: AgentRuntime;
  readonly agent: Hab;
  /** Everything the agent sent over the network. */
  readonly agentOut: Received[];
  readonly edgeRuntime: AgentRuntime;
  readonly edge: Hab;
  /** Everything the edge sent over the network, all of it to the agent. */
  readonly edgeOut: Received[];
  readonly remoteHby: Habery;
  readonly remote: Hab;
  /** The agent behind the hosting protocol handler, when the scene is hosted. */
  readonly handler: ProtocolHandler | null;
}

/** How the scene's network behaves. */
interface SceneNetwork {
  /** Every request the agent makes fails as a TransportError. */
  readonly agentUnreachable: boolean;
  /** The edge reaches the agent through the hosting protocol handler instead of a recording peer. */
  readonly hosted: boolean;
}

const RECORDED: SceneNetwork = { agentUnreachable: false, hosted: false };

/**
 * Compose the scene. The agent already holds the remote's KEL and accepted controller endpoint from its own work;
 * the edge knows nothing of the remote.
 */
function withScene(network: SceneNetwork, body: (scene: RelayScene) => Operation<void>): Promise<void> {
  return run(function*() {
    const agentHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const edgeHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const remoteHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const agent = agentHby.makeHab("agent", undefined, { transferable: false });
      const agentOut: Received[] = [];
      const agentHttp = recordingHttp(agentOut, network.agentUnreachable ? unreachable : accept);
      const agentRuntime = yield* createAgentRuntime(agentHby, agentHttp, systemClock, {
        enableMailboxStore: true,
        relaying: true,
      });
      const relay: Relay = { aid: agent.pre!, oobi: `${RELAY_OOBI_ORIGIN}/oobi/${agent.pre}/controller` };
      edgeHby.db.locs.pin([relay.aid, "http"], { url: RELAY_URL });
      const edge = edgeHby.makeHab("edge");
      const edgeOut: Received[] = [];
      const handler = network.hosted
        ? createProtocolHandler(agentRuntime, { serviceHab: agent, hostedPrefixes: [agent.pre!] })
        : null;
      const edgeHttp = recordingHttp(edgeOut, handler ?? accept);
      const edgeRuntime = yield* createAgentRuntime(edgeHby, edgeHttp, systemClock, { relay });
      const remote = remoteHby.makeHab("remote");
      try {
        yield* settleRuntimeIngress(agentRuntime, [
          agent.makeLocScheme(RELAY_URL, agent.pre, "http"),
          ...remoteHby.db.replay(remote.pre)!,
          remote.makeEndRole(remote.pre, Roles.controller),
          remote.makeLocScheme(REMOTE_URL, remote.pre, "http"),
        ]);
        yield* body({ agentRuntime, agent, agentOut, edgeRuntime, edge, edgeOut, remoteHby, remote, handler });
      } finally {
        yield* edgeRuntime.close();
        handler?.close?.();
        yield* agentRuntime.close();
      }
    } finally {
      yield* remoteHby.close(true);
      yield* edgeHby.close(true);
      yield* agentHby.close(true);
    }
  });
}

/** Onboard the edge: it authorizes the agent as mailbox and the agent accepts the admin request. */
function* authorizeAgent(scene: RelayScene): Operation<void> {
  yield* addMailbox(adminDeps(scene.edgeRuntime), scene.edge, scene.agent.pre);
  yield* settleRuntimeIngress(scene.agentRuntime, scene.edgeOut.map(({ bytes }) => bytes));
  scene.edgeOut.length = 0;
  assertEquals(scene.agentRuntime.hby.db.ends.get([scene.edge.pre, Roles.mailbox, scene.agent.pre])?.allowed, true);
}

/** The edge sends one query per route about `subject`; the agent ingests them and routes its cues. */
function* edgeQueries(scene: RelayScene, subject: string, routes: readonly ("logs" | "ksn")[]): Operation<void> {
  for (const route of routes) {
    scene.edgeRuntime.querying.enqueue({ pre: subject, signer: scene.edge.pre, route, q: {} });
  }
  yield* scene.edgeRuntime.querying.deliverOnce();
  assertEquals(queries(scene.edgeOut).map((serder) => serder.route), [...routes]);
  for (const { bytes } of scene.edgeOut) {
    yield* settleRuntimeIngress(scene.agentRuntime, [bytes]);
    // As the hosted HTTP ingress does after each request.
    yield* processCuesOnce(scene.agentRuntime, { hab: scene.agent });
  }
  scene.edgeOut.length = 0;
}

/** Let the agent's Poster store its answers in the edge mailbox it hosts, then the edge reads that mailbox. */
function* edgeReadsAnswers(scene: RelayScene): Operation<void> {
  const postman = scene.agentRuntime.postman;
  for (let pass = 0; pass < 4 && postman.hasPending; pass++) yield* postman.process();
  const stored = scene.agentRuntime.mailboxer!.getTopicMsgs(mailboxTopicKey(scene.edge.pre, "/replay"));
  assert(stored.length > 0, "the agent answered into the edge's mailbox");
  yield* settleRuntimeIngress(scene.edgeRuntime, stored);
}

Deno.test("served query for a remote prefix enqueues the agent's own query", async () => {
  await withScene(RECORDED, function*(scene) {
    yield* authorizeAgent(scene);
    yield* edgeQueries(scene, scene.remote.pre, ["logs"]);

    const pending = scene.agentRuntime.querying.pending.peekHead();
    assertEquals(scene.agentRuntime.querying.pending.length, 1);
    assertEquals(pending, { pre: scene.remote.pre, route: "logs", q: {}, signer: scene.agent.pre, wits: undefined });

    // The agent is a forwarder: its own query goes directly to the remote's controller endpoint.
    yield* scene.agentRuntime.querying.deliverOnce();
    const sent = queries(scene.agentOut);
    assertEquals(sent.length, 1);
    assert(scene.agentOut.every(({ url, destination }) => url === REMOTE_URL && destination === scene.remote.pre));
    assertEquals(sent[0].ked!.q, { i: scene.remote.pre, src: scene.remote.pre });
  });
});

Deno.test("edge sees a rotation the agent learned after the first query", async () => {
  await withScene(RECORDED, function*(scene) {
    yield* authorizeAgent(scene);
    yield* edgeQueries(scene, scene.remote.pre, ["logs"]);
    yield* edgeReadsAnswers(scene);
    assertEquals(scene.edgeRuntime.hby.db.getKever(scene.remote.pre)?.sn, 0, "the first answer is what the agent held");

    // The remote rotates; the agent's refresh query is answered with the rotation, which the agent accepts.
    yield* scene.agentRuntime.querying.deliverOnce();
    assertEquals(queries(scene.agentOut).map((serder) => serder.route), ["logs"]);
    scene.remote.rotate();
    yield* settleRuntimeIngress(scene.agentRuntime, [...scene.remoteHby.db.replay(scene.remote.pre)!]);
    assertEquals(scene.agentRuntime.hby.db.getKever(scene.remote.pre)?.sn, 1);

    // The edge's next query returns the refreshed state.
    yield* edgeQueries(scene, scene.remote.pre, ["logs"]);
    yield* edgeReadsAnswers(scene);
    assertEquals(scene.edgeRuntime.hby.db.getKever(scene.remote.pre)?.sn, 1);
  });
});

Deno.test("an unserved sender's query does not make the agent query anyone", async () => {
  await withScene(RECORDED, function*(scene) {
    // The agent holds the edge's KEL, so the query authenticates, but the edge never authorized the agent.
    yield* settleRuntimeIngress(scene.agentRuntime, [...scene.edgeRuntime.hby.db.replay(scene.edge.pre)!]);
    const query = scene.edge.query(scene.remote.pre, scene.agent.pre, { route: "logs", q: {} });
    yield* settleRuntimeIngress(scene.agentRuntime, [query]);
    yield* processCuesOnce(scene.agentRuntime, { hab: scene.agent });

    assertEquals(scene.agentRuntime.querying.pending.length, 0);
    yield* scene.agentRuntime.querying.deliverOnce();
    assertEquals(scene.agentOut, [], "the agent sent nothing over the network");
  });
});

Deno.test("repeated edge queries for one subject enqueue one agent query", async () => {
  await withScene(RECORDED, function*(scene) {
    yield* authorizeAgent(scene);
    yield* edgeQueries(scene, scene.remote.pre, ["logs", "ksn", "logs"]);

    assertEquals(scene.agentRuntime.querying.pending.length, 1);
    yield* scene.agentRuntime.querying.deliverOnce();
    assertEquals(queries(scene.agentOut).length, 1);
  });
});

/** Run the agent's own query-sender loop until `done` holds (or a bounded wait passes), then stop it. */
function* runAgentQuerier(scene: RelayScene, done: () => boolean): Operation<void> {
  const worker = yield* spawn(() => scene.agentRuntime.querying.deliverDo());
  try {
    for (let wait = 0; wait < 200 && !done(); wait++) yield* sleep(10);
  } finally {
    yield* worker.halt();
  }
}

Deno.test("a refresh for a subject with no reachable attester does not end the querier loop", async () => {
  await withScene(RECORDED, function*(scene) {
    const agentDb = scene.agentRuntime.hby.db;
    // A second remote whose controller endpoint the agent accepted without any location for it.
    const unplaced = scene.remoteHby.makeHab("unplaced");
    yield* settleRuntimeIngress(scene.agentRuntime, [
      ...scene.remoteHby.db.replay(unplaced.pre)!,
      unplaced.makeEndRole(unplaced.pre, Roles.controller),
    ]);
    yield* authorizeAgent(scene);
    yield* edgeQueries(scene, unplaced.pre, ["logs"]);
    assertEquals(scene.agentRuntime.querying.pending.length, 0, "no refresh for a subject the agent cannot reach");

    // A refresh queued while the remote was reachable, whose location is withdrawn before the loop sends it.
    yield* edgeQueries(scene, scene.remote.pre, ["logs"]);
    assertEquals(scene.agentRuntime.querying.pending.length, 1);
    agentDb.locs.rem([scene.remote.pre, "http"]);
    // A failing loop would fail this operation; it keeps running and the request waits, unsent.
    yield* runAgentQuerier(scene, () => false);
    assertEquals(scene.agentRuntime.querying.pending.length, 1);
    assertEquals(scene.agentOut, []);

    // Once the location is accepted again the next pass sends it.
    agentDb.locs.pin([scene.remote.pre, "http"], { url: REMOTE_URL });
    yield* runAgentQuerier(scene, () => queries(scene.agentOut).length > 0);
    assertEquals(queries(scene.agentOut).map((serder) => serder.route), ["logs"]);
    assertEquals(scene.agentRuntime.querying.pending.length, 0);
  });
});

Deno.test("the edge's query is answered when the agent's refresh query fails", async () => {
  await withScene({ agentUnreachable: true, hosted: true }, function*(scene) {
    // Onboarding through the hosted mailbox admin resource.
    yield* addMailbox(adminDeps(scene.edgeRuntime), scene.edge, scene.agent.pre);
    assertEquals(scene.agentRuntime.hby.db.ends.get([scene.edge.pre, Roles.mailbox, scene.agent.pre])?.allowed, true);

    // The edge's query is accepted at once: the agent only queues its own refresh while handling the request.
    scene.edgeRuntime.querying.enqueue({ pre: scene.remote.pre, signer: scene.edge.pre, route: "logs", q: {} });
    yield* scene.edgeRuntime.querying.deliverOnce();
    assertEquals(scene.agentOut, [], "the request did not wait on the agent's own query");
    assertEquals(scene.agentRuntime.querying.pending.length, 1);

    // The answer reaches the edge from what the agent holds.
    yield* edgeReadsAnswers(scene);
    assertEquals(scene.edgeRuntime.hby.db.getKever(scene.remote.pre)?.sn, 0);

    // The refresh then fails on the agent's own loop, which reports it and keeps running.
    // Its first POST (the introduction) fails, which ends that attempt.
    yield* runAgentQuerier(scene, () => scene.agentOut.length > 0);
    assert(scene.agentOut.length > 0 && scene.agentOut.every(({ url }) => url === REMOTE_URL), "the agent tried");
    assertEquals(scene.agentRuntime.querying.pending.length, 0, "a failed attempt is not retried automatically");
  });
});
