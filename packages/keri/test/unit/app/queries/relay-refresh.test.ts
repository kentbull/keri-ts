/**
 * Relay mode on the agent: a served edge's query about a remote subject makes the relaying agent query that subject
 * itself, by ordinary direct delivery, so a later edge query returns the refreshed state. The edge authorizes the
 * agent as `relaying.test.ts` does, through the real mailbox add.
 */
import { type Operation, run } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { parseBytes, SerderKERI } from "../../../../../cesr/mod.ts";
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

/** A recording peer that accepts every CESR POST/PUT. */
function recordingHttp(received: Received[]): HttpClient {
  return httpClient(async (url, init) => {
    const request = new Request(url, init);
    const bytes = request.method === "GET" ? new Uint8Array() : await readCesrRequestBytes(request);
    received.push({ url, destination: request.headers.get("CESR-DESTINATION"), bytes, frames: parseBytes(bytes) });
    return new Response(null, { status: 204 });
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
}

/**
 * Compose the scene. The agent already holds the remote's KEL and accepted controller endpoint from its own work;
 * the edge knows nothing of the remote.
 */
function withScene(body: (scene: RelayScene) => Operation<void>): Promise<void> {
  return run(function*() {
    const agentHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const edgeHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const remoteHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const agent = agentHby.makeHab("agent", undefined, { transferable: false });
      const agentOut: Received[] = [];
      const agentRuntime = yield* createAgentRuntime(agentHby, recordingHttp(agentOut), systemClock, {
        enableMailboxStore: true,
        relaying: true,
      });
      const relay: Relay = { aid: agent.pre!, oobi: `${RELAY_OOBI_ORIGIN}/oobi/${agent.pre}/controller` };
      edgeHby.db.locs.pin([relay.aid, "http"], { url: RELAY_URL });
      const edge = edgeHby.makeHab("edge");
      const edgeOut: Received[] = [];
      const edgeRuntime = yield* createAgentRuntime(edgeHby, recordingHttp(edgeOut), systemClock, { relay });
      const remote = remoteHby.makeHab("remote");
      try {
        yield* settleRuntimeIngress(agentRuntime, [
          agent.makeLocScheme(RELAY_URL, agent.pre, "http"),
          ...remoteHby.db.replay(remote.pre)!,
          remote.makeEndRole(remote.pre, Roles.controller),
          remote.makeLocScheme(REMOTE_URL, remote.pre, "http"),
        ]);
        yield* body({ agentRuntime, agent, agentOut, edgeRuntime, edge, edgeOut, remoteHby, remote });
      } finally {
        yield* edgeRuntime.close();
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

/** The edge sends one query per route through its querier; the agent ingests them and routes its cues. */
function* edgeQueries(scene: RelayScene, routes: readonly ("logs" | "ksn")[]): Operation<void> {
  for (const route of routes) {
    scene.edgeRuntime.querying.enqueue({ pre: scene.remote.pre, signer: scene.edge.pre, route, q: {} });
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
  await withScene(function*(scene) {
    yield* authorizeAgent(scene);
    yield* edgeQueries(scene, ["logs"]);

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
  await withScene(function*(scene) {
    yield* authorizeAgent(scene);
    yield* edgeQueries(scene, ["logs"]);
    yield* edgeReadsAnswers(scene);
    assertEquals(scene.edgeRuntime.hby.db.getKever(scene.remote.pre)?.sn, 0, "the first answer is what the agent held");

    // The remote rotates; the agent's refresh query is answered with the rotation, which the agent accepts.
    yield* scene.agentRuntime.querying.deliverOnce();
    assertEquals(queries(scene.agentOut).map((serder) => serder.route), ["logs"]);
    scene.remote.rotate();
    yield* settleRuntimeIngress(scene.agentRuntime, [...scene.remoteHby.db.replay(scene.remote.pre)!]);
    assertEquals(scene.agentRuntime.hby.db.getKever(scene.remote.pre)?.sn, 1);

    // The edge's next query returns the refreshed state.
    yield* edgeQueries(scene, ["logs"]);
    yield* edgeReadsAnswers(scene);
    assertEquals(scene.edgeRuntime.hby.db.getKever(scene.remote.pre)?.sn, 1);
  });
});

Deno.test("an unserved sender's query does not make the agent query anyone", async () => {
  await withScene(function*(scene) {
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
  await withScene(function*(scene) {
    yield* authorizeAgent(scene);
    yield* edgeQueries(scene, ["logs", "ksn", "logs"]);

    assertEquals(scene.agentRuntime.querying.pending.length, 1);
    yield* scene.agentRuntime.querying.deliverOnce();
    assertEquals(queries(scene.agentOut).length, 1);
  });
});
