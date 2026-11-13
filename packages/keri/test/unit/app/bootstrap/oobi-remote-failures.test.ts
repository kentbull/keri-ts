/**
 * What a remote party can make an OOBI or well-known authentication job do: a URL the HTTP client refuses, an
 * unreachable host, a response that is not CESR or whose frames do not decode, an introduction or multi-OOBI reply
 * naming such a URL. Each ends that one job as failed, or is refused at intake, and the next job still runs.
 */
import { type Operation, run } from "effection";
import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import { Diger, Prefixer, SerderKERI } from "../../../../../cesr/mod.ts";
import { Authenticator } from "../../../../src/app/bootstrap/authenticating.ts";
import { Oobiery, oobiRequestExn, OobiRequestHandler } from "../../../../src/app/bootstrap/oobiery.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { Reactor } from "../../../../src/app/protocol/reactor.ts";
import { FetchHttpClient, type HttpClient } from "../../../../src/app/transport/http-client.ts";
import type { AgentCue } from "../../../../src/core/cues.ts";
import { Deck } from "../../../../src/core/deck.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { makeNowIso8601 } from "../../../../src/time/mod.ts";
import { reserveTcpPort } from "../../../http-test-support.ts";
import { protocolFixture } from "../../../protocol-fixture.ts";
import { FakeRuntimeHttpClient } from "../../../support/runtime-fakes.ts";

const GOOD_ORIGIN = "http://good.test";
const BAD_ORIGIN = "http://bad.test";

/** A resolving Habery, the source whose OOBI it resolves, and an Oobiery over the supplied client. */
interface OobiScene {
  readonly hby: Habery;
  readonly source: Hab;
  readonly oobiery: Oobiery;
  readonly cues: Deck<AgentCue>;
}

/** Run `body` over a fresh resolver and a source identifier held by another Habery. */
function withOobiScene(http: HttpClient, body: (scene: OobiScene) => Operation<void>): Promise<void> {
  return run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sourceHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const source = sourceHby.makeHab("source");
      const cues = new Deck<AgentCue>();
      const reactor = new Reactor(protocolFixture(hby));
      const oobiery = new Oobiery(hby, reactor.protocol, reactor.protocol.rvy, http, cues);
      yield* body({ hby, source, oobiery, cues });
    } finally {
      yield* sourceHby.close(true);
      yield* hby.close(true);
    }
  });
}

/** The source's controller OOBI as its host serves it. */
function controllerOobi(source: Hab): Response {
  return new Response(new Blob([source.replyToOobi(source.pre!, Roles.controller).slice()]), {
    headers: { "Content-Type": "application/json+cesr" },
  });
}

/** Assert `url` ended failed with `state`, left no queued or in-flight row, and published the failure cue. */
function assertFailedJob(scene: OobiScene, url: string, state: string): void {
  assertEquals(scene.hby.db.oobis.get(url), null, "the failed job is not re-read");
  assertEquals(scene.hby.db.coobi.get(url), null);
  assertEquals(scene.hby.db.eoobi.get(url)?.state, state);
  const failed = scene.cues.toArray().find((cue) => cue.kin === "oobiFailed" && cue.url === url);
  assertEquals(failed, { kin: "oobiFailed", url, reason: state });
}

/** Run one pass per queued job; a pass that throws fails the test. */
function* drain(oobiery: Oobiery, passes: number): Operation<void> {
  for (let pass = 0; pass < passes; pass++) yield* oobiery.processOnce();
}

/** Sign an `/introduce` reply as `hab`. */
function introduction(hab: Hab, a: Record<string, unknown>) {
  const serder = new SerderKERI({ sad: { t: "rpy", dt: makeNowIso8601(), r: "/introduce", a }, makify: true });
  return {
    serder,
    diger: new Diger({ qb64: serder.said! }),
    route: "/introduce",
    tsgs: [
      new TransIdxSigGroup(
        new Prefixer({ qb64: hab.pre! }),
        hab.kever!.sner,
        new Diger({ qb64: hab.kever!.said }),
        hab.sign(serder.raw, true),
      ),
    ],
  };
}

Deno.test("an OOBI request naming a URL with credentials is refused at intake", async () => {
  await withOobiScene(new FakeRuntimeHttpClient(), function*({ hby, source }) {
    const handler = new OobiRequestHandler(hby);
    const asking = hby.makeHab("asking");
    const request = (oobi: string) => ({ serder: oobiRequestExn(asking, source.pre!, oobi) });
    assertEquals(handler.verify(request(`${GOOD_ORIGIN}/oobi/${source.pre}/controller`)), true);
    for (
      const refused of [
        `http://user:secret@bad.test/oobi/${source.pre}/controller`,
        `http://user@bad.test/oobi/${source.pre}/controller`,
        `tcp://bad.test:5632/oobi/${source.pre}/controller`,
        "not a url",
      ]
    ) {
      assertEquals(handler.verify(request(refused)), false, refused);
    }
  });
});

Deno.test("a queued OOBI naming a URL with credentials ends that job and the loop resolves the next", async () => {
  // The real client refuses the URL before any I/O; the next job comes from a host this test serves.
  const port = reserveTcpPort();
  const controller = new AbortController();
  let served: Hab | null = null;
  const server = Deno.serve(
    { hostname: "127.0.0.1", port, signal: controller.signal, onListen: () => {} },
    () => controllerOobi(served!),
  );
  try {
    await withOobiScene(new FetchHttpClient(), function*(scene) {
      served = scene.source;
      const refused = `http://user:secret@127.0.0.1:${port}/oobi/${scene.source.pre}/controller`;
      const good = `http://127.0.0.1:${port}/oobi/${scene.source.pre}/controller`;
      scene.oobiery.resolve(refused);
      scene.oobiery.resolve(good);
      yield* drain(scene.oobiery, 2);
      assertFailedJob(scene, refused, "url-refused");
      assertEquals(scene.hby.db.roobi.get(good)?.state, "resolved");
      assertExists(scene.hby.db.getKever(scene.source.pre!));
    });
  } finally {
    controller.abort();
    await server.finished;
  }
});

Deno.test("a failed OOBI fetch ends that job and the loop resolves the next", async () => {
  const port = reserveTcpPort(), closed = reserveTcpPort();
  const controller = new AbortController();
  let served: Hab | null = null;
  const server = Deno.serve(
    { hostname: "127.0.0.1", port, signal: controller.signal, onListen: () => {} },
    () => controllerOobi(served!),
  );
  try {
    await withOobiScene(new FetchHttpClient(), function*(scene) {
      served = scene.source;
      const unreachable = `http://127.0.0.1:${closed}/oobi/${scene.source.pre}/controller`;
      const good = `http://127.0.0.1:${port}/oobi/${scene.source.pre}/controller`;
      scene.oobiery.resolve(unreachable);
      scene.oobiery.resolve(good);
      yield* drain(scene.oobiery, 2);
      assertFailedJob(scene, unreachable, "transport-failed");
      assertEquals(scene.hby.db.roobi.get(good)?.state, "resolved");
    });
  } finally {
    controller.abort();
    await server.finished;
  }
});

Deno.test("an OOBI host answering non-CESR ends that job and the loop resolves the next", async () => {
  const http = new FakeRuntimeHttpClient();
  await withOobiScene(http, function*(scene) {
    http.registerOrigin(BAD_ORIGIN, () =>
      new Response("<html><body>not an OOBI</body></html>", {
        headers: { "Content-Type": "text/html" },
      }));
    http.registerOrigin(GOOD_ORIGIN, () => controllerOobi(scene.source));
    const garbage = `${BAD_ORIGIN}/oobi/${scene.source.pre}/controller`;
    const good = `${GOOD_ORIGIN}/oobi/${scene.source.pre}/controller`;
    scene.oobiery.resolve(garbage);
    scene.oobiery.resolve(good);
    yield* drain(scene.oobiery, 2);
    assertFailedJob(scene, garbage, "unparseable-response");
    assertEquals(scene.hby.db.roobi.get(good)?.state, "resolved");
  });
});

Deno.test("an OOBI response frame that does not decode ends that job and the loop resolves the next", async () => {
  const http = new FakeRuntimeHttpClient();
  await withOobiScene(http, function*(scene) {
    // A SAID-valid receipt whose sequence number is not hex: the frame parses, its field does not decode.
    const receipt = new SerderKERI({
      sad: { t: "rct", d: "", i: scene.source.pre!, s: "zz" },
      makify: true,
    });
    http.registerOrigin(
      BAD_ORIGIN,
      () => new Response(new Blob([receipt.raw.slice()]), { headers: { "Content-Type": "application/json+cesr" } }),
    );
    http.registerOrigin(GOOD_ORIGIN, () => controllerOobi(scene.source));
    const invalid = `${BAD_ORIGIN}/oobi/${scene.source.pre}/controller`;
    const good = `${GOOD_ORIGIN}/oobi/${scene.source.pre}/controller`;
    scene.oobiery.resolve(invalid);
    scene.oobiery.resolve(good);
    yield* drain(scene.oobiery, 2);
    assertFailedJob(scene, invalid, "invalid-response-frame");
    assertEquals(scene.hby.db.roobi.get(good)?.state, "resolved");
  });
});

Deno.test("an introduced OOBI naming a URL the client refuses is rejected and queues nothing", async () => {
  await withOobiScene(new FakeRuntimeHttpClient(), function*({ hby, oobiery }) {
    // The introducer is a local identifier so its reply verifies; only the introduced URL is at fault.
    const introducer = hby.makeHab("introducer");
    for (
      const a of [
        { cid: introducer.pre, oobi: `http://user:secret@bad.test/oobi/${introducer.pre}/controller` },
        { cid: introducer.pre, oobi: "not a url" },
        { cid: "not-a-prefix", oobi: `${GOOD_ORIGIN}/oobi/${introducer.pre}/controller` },
      ]
    ) {
      assertThrows(() => oobiery.processReply(introduction(introducer, a)), ValidationError);
      assertEquals([...hby.db.oobis.getTopItemIter()].length, 0, JSON.stringify(a));
      assertEquals([...hby.db.woobi.getTopItemIter()].length, 0);
    }
    const good = `${GOOD_ORIGIN}/oobi/${introducer.pre}/controller`;
    assertEquals(oobiery.processReply(introduction(introducer, { cid: introducer.pre, oobi: good })).kind, "accept");
    assertEquals(hby.db.oobis.get(good)?.state, "queued");
  });
});

Deno.test("a multi-OOBI reply naming a child URL the client refuses fails the parent and queues no child", async () => {
  const http = new FakeRuntimeHttpClient();
  await withOobiScene(http, function*(scene) {
    const cid = scene.source.pre!;
    const urls: Record<string, string[]> = {
      "/credentials": [`${GOOD_ORIGIN}/oobi/${cid}/controller`, `http://user:secret@bad.test/oobi/${cid}/controller`],
      "/unparseable": [`${GOOD_ORIGIN}/oobi/${cid}/controller`, "not a url"],
      "/bad-aid": [`${GOOD_ORIGIN}/oobi/${cid}/controller`],
    };
    http.registerOrigin(BAD_ORIGIN, (request) => {
      const path = new URL(request.url).pathname.split("/oobi/")[0];
      const reply = new SerderKERI({
        sad: {
          t: "rpy",
          dt: makeNowIso8601(),
          r: "/oobi/controller",
          a: { aid: path === "/bad-aid" ? "not-a-prefix" : cid, urls: urls[path] },
        },
        makify: true,
      });
      return new Response(new Blob([reply.raw.slice()]), { headers: { "Content-Type": "application/json" } });
    });
    const parents = Object.keys(urls).map((path) => `${BAD_ORIGIN}${path}/oobi/${cid}/controller`);
    for (const parent of parents) scene.oobiery.resolve(parent);
    yield* drain(scene.oobiery, parents.length);
    for (const parent of parents) {
      assertFailedJob(scene, parent, "invalid-multi-oobi");
      assertEquals(scene.hby.db.moobi.get(parent), null);
    }
    assertEquals(scene.hby.db.oobis.get(`${GOOD_ORIGIN}/oobi/${cid}/controller`), null, "no partial fanout");
  });
});

Deno.test("a refused or unreachable well-known URL ends that authentication and the next is tried", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const cid = hby.makeHab("subject").pre!;
      const closed = reserveTcpPort();
      const refused = `http://user:secret@127.0.0.1:${closed}/.well-known/keri/oobi/${cid}`;
      const unreachable = `http://127.0.0.1:${closed}/.well-known/keri/oobi/${cid}`;
      for (const url of [refused, unreachable]) hby.db.mfa.pin(url, { state: "auth-pending", cid });
      const authenticator = new Authenticator(hby, new FetchHttpClient());
      yield* authenticator.processOnce();
      yield* authenticator.processOnce();
      for (const [url, state] of [[refused, "url-refused"], [unreachable, "transport-failed"]]) {
        assertEquals(hby.db.mfa.get(url), null, "the failed authentication is not re-read");
        assertEquals(hby.db.rmfa.get(url)?.state, state);
        assertEquals(hby.db.wkas.get(cid).some((record) => record.url === url), false);
      }
    } finally {
      yield* hby.close(true);
    }
  });
});
