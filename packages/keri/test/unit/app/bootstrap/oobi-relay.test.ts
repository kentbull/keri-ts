/**
 * Relay mode for OOBI resolution: an edge asks its relay agent to resolve a third party's OOBI and reads the result
 * from the relay's own OOBI endpoint, and a relaying agent accepts `/oobis` only from a sender it serves.
 * The relay is scripted, except where a test says it runs a real relaying agent behind the hosting OOBI endpoint.
 */
import { type Operation, run } from "effection";
import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { parseBytes, SerderKERI } from "../../../../../cesr/mod.ts";
import { createProtocolHandler } from "../../../../../hosting/src/http/protocol-handler.ts";
import {
  OOBI_REQUEST_ROUTE,
  Oobiery,
  oobiRequestExn,
  OobiRequestHandler,
  RELAY_OOBI_TIMEOUT_MS,
} from "../../../../src/app/bootstrap/oobiery.ts";
import type { Relay } from "../../../../src/app/delivery/relaying.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import {
  type AgentRuntime,
  createAgentRuntime,
  settleRuntimeIngress,
} from "../../../../src/app/runtime/agent-runtime.ts";
import { type RuntimeClock, systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { readCesrRequestBytes } from "../../../../src/app/transport/cesr-http.ts";
import type { AgentCue } from "../../../../src/core/cues.ts";
import { Deck } from "../../../../src/core/deck.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { Schemer } from "../../../../src/core/scheming.ts";
import { FakeRuntimeHttpClient, ManualRuntimeClock } from "../../../support/runtime-fakes.ts";

const RELAY_ORIGIN = "http://agent.test:5642";
const RELAY_URL = `${RELAY_ORIGIN}/`;

/** The edge, its relay agent and a third party the edge resolves, each in its own Habery. */
interface RelayScene {
  readonly edgeHby: Habery;
  readonly agentHby: Habery;
  readonly edge: Hab;
  readonly agent: Hab;
  readonly third: Hab;
  readonly relay: Relay;
}

/** Run `body` over an edge that holds its agent's KEL and location and has authorized the agent as its mailbox. */
function withRelayScene(body: (scene: RelayScene) => Operation<void>): Promise<void> {
  return run(function*() {
    const edgeHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const agentHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const thirdHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const edge = edgeHby.makeHab("edge");
      const agent = agentHby.makeHab("agent");
      const third = thirdHby.makeHab("third");
      const relay = { aid: agent.pre!, oobi: `${RELAY_URL}oobi/${agent.pre}/controller` };
      agentHby.db.locs.pin([relay.aid, "http"], { url: RELAY_URL });
      yield* ingest(edgeHby, [agent.replyToOobi(agent.pre!, Roles.controller)]);
      edgeHby.db.locs.pin([relay.aid, "http"], { url: RELAY_URL });
      edgeHby.db.ends.pin([edge.pre!, Roles.mailbox, relay.aid], { allowed: true });
      yield* body({ edgeHby, agentHby, edge, agent, third, relay });
    } finally {
      yield* thirdHby.close(true);
      yield* agentHby.close(true);
      yield* edgeHby.close(true);
    }
  });
}

/** Accept wire into a Habery through a short-lived runtime with no egress. */
function* ingest(hby: Habery, messages: Uint8Array[]): Operation<void> {
  const runtime = yield* createAgentRuntime(hby, new FakeRuntimeHttpClient(), new ManualRuntimeClock());
  try {
    yield* settleRuntimeIngress(runtime, messages);
  } finally {
    yield* runtime.close();
  }
}

/** Compose the edge runtime over the scripted relay. */
function* edgeRuntime(scene: RelayScene, http: FakeRuntimeHttpClient, clock: RuntimeClock): Operation<AgentRuntime> {
  return yield* createAgentRuntime(scene.edgeHby, http, clock, { relay: scene.relay });
}

/** Deliver what Poster holds. */
function* deliver(runtime: AgentRuntime): Operation<void> {
  for (let pass = 0; pass < 4 && runtime.postman.hasPending; pass++) yield* runtime.postman.process();
}

/**
 * A scripted relay that records the `/oobis` exchanges POSTed to it, while the request is live, and answers each
 * GET with `answer`.
 */
function scriptedRelay(
  posted: SerderKERI[],
  answer: (request: Request) => Response,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return answer(request);
    for (const frame of parseBytes(await readCesrRequestBytes(request))) {
      if (frame.body instanceof SerderKERI && frame.body.route === OOBI_REQUEST_ROUTE) posted.push(frame.body);
    }
    return new Response(null, { status: 204 });
  };
}

/** Paths of the GETs that reached the network. */
function gets(http: FakeRuntimeHttpClient): string[] {
  return http.requests.filter(({ method }) => method === "GET").map(({ url }) => url);
}

Deno.test("job stays queued while the relay answers 404", async () => {
  await withRelayScene(function*(scene) {
    const clock = new ManualRuntimeClock(1_000_000);
    const http = new FakeRuntimeHttpClient();
    const posted: SerderKERI[] = [];
    http.registerOrigin(RELAY_ORIGIN, scriptedRelay(posted, () => new Response("Not Found", { status: 404 })));
    const runtime = yield* edgeRuntime(scene, http, clock);
    try {
      const url = `http://third.test:5643/oobi/${scene.third.pre}/controller`;
      runtime.oobiery.resolve(url);
      yield* runtime.oobiery.processOnce();
      assertEquals(scene.edgeHby.db.oobis.get(url)?.state, "relay-requested");
      assertEquals(scene.edgeHby.db.eoobi.get(url), null, "a 404 from the relay is not a failure");
      yield* deliver(runtime);
      const [request] = posted;
      assertEquals(request?.ked?.a, { dest: scene.relay.aid, oobi: url });
      assertEquals(request?.pre, scene.edge.pre, "the served edge identity asks");

      clock.advance(RELAY_OOBI_TIMEOUT_MS - 1);
      yield* runtime.oobiery.processOnce();
      assertEquals(scene.edgeHby.db.oobis.get(url)?.state, "relay-requested", "still within the bound");
      assertEquals(posted.length, 1, "the relay is asked once");

      clock.advance(1);
      yield* runtime.oobiery.processOnce();
      assertEquals(scene.edgeHby.db.oobis.get(url), null);
      assertEquals(scene.edgeHby.db.eoobi.get(url)?.state, "relay-unresolved");
      assertEquals(gets(http), [
        `${RELAY_URL}oobi/${scene.third.pre}/controller`,
        `${RELAY_URL}oobi/${scene.third.pre}/controller`,
        `${RELAY_URL}oobi/${scene.third.pre}/controller`,
      ]);
    } finally {
      yield* runtime.close();
    }
  });
});

Deno.test("schema OOBI resolves from the relay", async () => {
  await withRelayScene(function*(scene) {
    const schemer = new Schemer({
      sed: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { name: { type: "string" } },
      },
    });
    const http = new FakeRuntimeHttpClient();
    http.registerOrigin(RELAY_ORIGIN, (request) =>
      new URL(request.url).pathname === `/oobi/${schemer.said}`
        ? new Response(new Blob([schemer.raw.slice().buffer as ArrayBuffer]), {
          headers: { "Content-Type": "application/schema+json" },
        })
        : new Response(null, { status: request.method === "GET" ? 404 : 204 }));
    const runtime = yield* edgeRuntime(scene, http, new ManualRuntimeClock());
    try {
      const url = `http://schema.test/oobi/${schemer.said}`;
      runtime.oobiery.resolve(url);
      yield* runtime.oobiery.processOnce();
      assertEquals(scene.edgeHby.db.schema.get(schemer.said)?.said, schemer.said);
      assertEquals(scene.edgeHby.db.roobi.get(url)?.state, "resolved");
      assertEquals(scene.edgeHby.db.oobis.get(url), null);
      assertEquals(gets(http), [`${RELAY_URL}oobi/${schemer.said}`]);
    } finally {
      yield* runtime.close();
    }
  });
});

Deno.test("oobiery asks the relay then resolves from the relay origin", async () => {
  await withRelayScene(function*(scene) {
    // A real relaying agent behind the hosting protocol handler; it reaches the third party itself.
    const thirdOrigin = "http://third.test:5643";
    const url = `${thirdOrigin}/oobi/${scene.third.pre}/controller`;
    const agentHttp = new FakeRuntimeHttpClient();
    agentHttp.registerOrigin(
      thirdOrigin,
      () =>
        new Response(new Blob([scene.third.replyToOobi(scene.third.pre!, Roles.controller).slice()]), {
          headers: { "Content-Type": "application/json+cesr" },
        }),
    );
    const agentRuntime = yield* createAgentRuntime(scene.agentHby, agentHttp, systemClock, {
      enableMailboxStore: true,
      relaying: true,
    });
    const handler = createProtocolHandler(agentRuntime, {
      serviceHab: scene.agent,
      hostedPrefixes: [scene.agent.pre!],
    });
    const http = new FakeRuntimeHttpClient();
    http.registerOrigin(RELAY_ORIGIN, (request) => handler(request));
    const runtime = yield* edgeRuntime(scene, http, new ManualRuntimeClock());
    try {
      // Onboarding: the agent holds the edge's KEL and its mailbox authorization.
      yield* settleRuntimeIngress(agentRuntime, [
        scene.edge.replyToOobi(scene.edge.pre!, Roles.controller),
        scene.edge.makeEndRole(scene.agent.pre!, Roles.mailbox, true),
      ]);
      runtime.oobiery.resolve(url);
      yield* runtime.oobiery.processOnce();
      assertEquals(scene.edgeHby.db.oobis.get(url)?.state, "relay-requested", "the agent does not hold it yet");

      yield* deliver(runtime);
      assertEquals(scene.agentHby.db.oobis.get(url)?.state, "queued", "the agent accepted the edge's /oobis");
      yield* agentRuntime.oobiery.processOnce();
      assertEquals(scene.agentHby.db.roobi.get(url)?.state, "resolved");

      yield* runtime.oobiery.processOnce();
      assertEquals(scene.edgeHby.db.roobi.get(url)?.state, "resolved");
      assertEquals(scene.edgeHby.db.getKever(scene.third.pre!)?.said, scene.third.kever!.said);
      assertEquals(scene.edgeHby.db.oobis.get(url), null);
      assertEquals(gets(http), [
        `${RELAY_URL}oobi/${scene.third.pre}/controller`,
        `${RELAY_URL}oobi/${scene.third.pre}/controller`,
      ]);
      assert(
        http.requests.every(({ url }) => new URL(url).origin === RELAY_ORIGIN),
        "the edge contacted only its agent",
      );
      assertEquals(agentHttp.requests.map(({ url }) => url), [url], "the agent fetched the third party");
    } finally {
      yield* runtime.close();
      handler.close?.();
      yield* agentRuntime.close();
    }
  });
});

Deno.test("an edge with a relay never requests a third-party origin while resolving", async () => {
  await withRelayScene(function*(scene) {
    const http = new FakeRuntimeHttpClient();
    // Only the relay's own OOBI is held; everything else is still being resolved.
    const posted: SerderKERI[] = [];
    http.registerOrigin(
      RELAY_ORIGIN,
      scriptedRelay(posted, (request) =>
        request.url === scene.relay.oobi
          ? new Response(new Blob([scene.agent.replyToOobi(scene.agent.pre!, Roles.controller).slice()]), {
            headers: { "Content-Type": "application/json+cesr" },
          })
          : new Response(null, { status: 404 })),
    );
    const runtime = yield* edgeRuntime(scene, http, new ManualRuntimeClock());
    try {
      // The edge runtime's Poster carries the requests; this Oobiery's client has no relay guard, so any
      // third-party fetch would reach the recording client instead of being refused.
      const cues = new Deck<AgentCue>();
      const oobiery = new Oobiery(scene.edgeHby, runtime.protocol, runtime.protocol.rvy, http, cues, {
        relay: scene.relay,
        postman: runtime.postman,
        clock: new ManualRuntimeClock(),
      });
      const third = scene.third.pre!, wit = scene.agent.pre!;
      const urls = [
        `http://third.test/oobi/${third}/controller`,
        `http://witness.test:5631/oobi/${third}/witness/${wit}`,
        `https://host.test/base/oobi/${third}/agent/${wit}?name=Third`,
        "http://schema.test/oobi/EBdXt3gIXOf2BBWNHdSXCJnFJL5OuQPyM5K0neuniccM",
      ];
      for (const url of [...urls, scene.relay.oobi]) oobiery.resolve(url);
      for (let pass = 0; pass < 2 * (urls.length + 1); pass++) yield* oobiery.processOnce();
      yield* deliver(runtime);

      assert(http.requests.every(({ url }) => new URL(url).origin === RELAY_ORIGIN), "only the relay was contacted");
      assertEquals(scene.edgeHby.db.roobi.get(scene.relay.oobi)?.state, "resolved", "the relay OOBI is direct");
      assertEquals(
        new Set(gets(http)),
        new Set([
          `${RELAY_URL}oobi/${third}/controller`,
          `${RELAY_URL}oobi/${third}/witness/${wit}`,
          `${RELAY_URL}oobi/${third}/agent/${wit}`,
          `${RELAY_URL}oobi/EBdXt3gIXOf2BBWNHdSXCJnFJL5OuQPyM5K0neuniccM`,
          scene.relay.oobi,
        ]),
      );
      const asked = posted.map((exn) => (exn.ked?.a as { oobi: string }).oobi);
      assertEquals(asked.sort(), [...urls].sort(), "each third-party OOBI was handed to the relay once");
      for (const url of urls) assertEquals(scene.edgeHby.db.oobis.get(url)?.state, "relay-requested");
    } finally {
      yield* runtime.close();
    }
  });
});

Deno.test("the agent refuses an /oobis request from an unserved sender when relaying", async () => {
  await run(function*() {
    const agentHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const edgeHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const agent = agentHby.makeHab("agent");
      const edge = edgeHby.makeHab("edge");
      const runtime = yield* createAgentRuntime(agentHby, new FakeRuntimeHttpClient(), systemClock, {
        enableMailboxStore: true,
        relaying: true,
      });
      try {
        const unserved = "http://third.test/oobi/EAunserved/controller";
        const served = "http://third.test/oobi/EAserved/controller";
        const request = (oobi: string) => edge.endorse(oobiRequestExn(edge, agent.pre!, oobi), { pipelined: false });
        yield* settleRuntimeIngress(runtime, [edge.replyToOobi(edge.pre!, Roles.controller), request(unserved)]);
        assertExists(agentHby.db.getKever(edge.pre!));
        assertEquals(agentHby.db.oobis.get(unserved), null, "an unserved sender cannot make the agent fetch");
        // Without relaying the same request is accepted, as in KERIpy.
        assertEquals(
          new OobiRequestHandler(agentHby).verify({ serder: oobiRequestExn(edge, agent.pre!, unserved) }),
          true,
        );

        yield* settleRuntimeIngress(runtime, [edge.makeEndRole(agent.pre!, Roles.mailbox, true), request(served)]);
        assertEquals(agentHby.db.ends.get([edge.pre!, Roles.mailbox, agent.pre!])?.allowed, true);
        assertEquals(agentHby.db.oobis.get(served)?.state, "queued", "a served sender's request is queued");
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* edgeHby.close(true);
      yield* agentHby.close(true);
    }
  });
});
