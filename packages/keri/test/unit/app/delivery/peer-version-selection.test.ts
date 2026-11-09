/** Peers are treated as v1 until their own KEL says otherwise, and v2 never reaches them silently. */
import { Vrsn_1_0, Vrsn_2_0 } from "cesr-ts";
import { type Operation, run, spawn } from "effection";
import { assert, assertEquals, assertInstanceOf, assertThrows } from "jsr:@std/assert";
import { PeerVersionError, Poster } from "../../../../src/app/delivery/forwarding.ts";
import { createHabery, type Hab, type Habery } from "../../../../src/app/identity/habbing.ts";
import {
  type AgentRuntime,
  createAgentRuntime,
  settleRuntimeIngress,
} from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { Roles } from "../../../../src/core/roles.ts";

type Version = typeof Vrsn_1_0;

const TRANSFERABLE = { transferable: true, icount: 1, isith: "1", ncount: 1, nsith: "1", toad: 0 } as const;

/** One sender store, one remote store and a server counting what actually reached the network. */
interface Fixture {
  hby: Habery;
  remote: Habery;
  runtime: AgentRuntime;
  url: string;
  received: () => number;
}

/** Create a remote identifier at a chosen version and teach the sender its KEL. */
function* remoteHab(fixture: Fixture, name: string, version: Version): Operation<Hab> {
  const hab = fixture.remote.makeHab(name, undefined, { ...TRANSFERABLE, version });
  yield* teachKel(fixture, hab);
  return hab;
}

/** Replay a remote identifier's accepted KEL, so the sender's view reflects its latest event. */
function* teachKel(fixture: Fixture, hab: Hab): Operation<void> {
  for (const message of fixture.remote.db.clonePreIter(hab.pre)) {
    yield* settleRuntimeIngress(fixture.runtime, [message]);
  }
}

/** Authorize one endpoint of a recipient at the fixture server. */
function* authorize(fixture: Fixture, recipient: Hab, endpoint: Hab, role: string): Operation<void> {
  yield* settleRuntimeIngress(fixture.runtime, [
    endpoint.makeLocScheme(fixture.url, endpoint.pre, "http"),
    recipient.makeEndRole(endpoint.pre, role, true),
  ]);
}

/** Send through the real Poster worker and return its terminal outcome. */
function* send(fixture: Fixture, sender: Hab, recipient: Hab) {
  const postman = new Poster(fixture.hby, null, fixture.runtime.protocol, fixture.runtime.http, fixture.runtime.clock);
  const worker = yield* spawn(() => postman.deliverDo());
  try {
    const message = sender.query(recipient.pre, sender.pre, { route: "logs", q: { s: "0" } });
    const evt = postman.send({ src: sender.pre, dest: recipient.pre, msg: message, topic: "credential" }, {
      notify: true,
    });
    return yield* postman.wait(evt);
  } finally {
    yield* worker.halt();
  }
}

/** Run one scenario with isolated stores and a local CESR endpoint. */
async function scenario(body: (fixture: Fixture) => Operation<void>): Promise<void> {
  let count = 0;
  const controller = new AbortController();
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, signal: controller.signal, onListen() {} },
    async request => {
      await request.arrayBuffer();
      count++;
      return new Response(null, { status: 204 });
    },
  );
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        yield* body({ hby, remote, runtime, url: `http://127.0.0.1:${server.addr.port}`, received: () => count });
      } finally {
        yield* runtime.close();
        yield* remote.close(true);
        yield* hby.close(true);
      }
    });
  } finally {
    controller.abort();
    await server.finished;
  }
}

Deno.test("a v2 message to a v1 recipient is refused before reaching the network", async () => {
  await scenario(function*(fixture) {
    const sender = fixture.hby.makeHab("sender", undefined, { ...TRANSFERABLE, version: Vrsn_2_0 });
    const recipient = yield* remoteHab(fixture, "recipient", Vrsn_1_0);
    yield* authorize(fixture, recipient, recipient, Roles.controller);
    const outcome = yield* send(fixture, sender, recipient);
    assertEquals(outcome.kin, "failed");
    if (outcome.kin === "failed") assertInstanceOf(outcome.error, PeerVersionError);
    assertEquals(fixture.received(), 0);
  });
});

Deno.test("a peer with no accepted KEL is not refused, so delegated inception can complete", async () => {
  await scenario(function*(fixture) {
    const sender = fixture.hby.makeHab("sender", undefined, { ...TRANSFERABLE, version: Vrsn_2_0 });
    const recipient = fixture.remote.makeHab("escrowed", undefined, { ...TRANSFERABLE, version: Vrsn_2_0 });
    // Location and role replies alone give an endpoint without any accepted KEL for the recipient.
    const provider = yield* remoteHab(fixture, "provider", Vrsn_2_0);
    fixture.hby.db.ends.pin([recipient.pre, Roles.mailbox, provider.pre], { allowed: true });
    fixture.hby.db.locs.pin([provider.pre, "http"], { url: fixture.url });
    assertEquals((yield* send(fixture, sender, recipient)).kin, "sent");
  });
});

Deno.test("a v2 message reaches a recipient whose latest event is v2", async () => {
  await scenario(function*(fixture) {
    const sender = fixture.hby.makeHab("sender", undefined, { ...TRANSFERABLE, version: Vrsn_2_0 });
    const recipient = yield* remoteHab(fixture, "recipient", Vrsn_2_0);
    yield* authorize(fixture, recipient, recipient, Roles.controller);
    assertEquals((yield* send(fixture, sender, recipient)).kin, "sent");
    assertEquals(fixture.received(), 1);
  });
});

Deno.test("a v1 sender still reaches v1 and v2 recipients", async () => {
  await scenario(function*(fixture) {
    const sender = fixture.hby.makeHab("sender", undefined, { ...TRANSFERABLE, version: Vrsn_1_0 });
    for (const [name, version] of [["old", Vrsn_1_0], ["new", Vrsn_2_0]] as const) {
      const recipient = yield* remoteHab(fixture, name, version);
      yield* authorize(fixture, recipient, recipient, Roles.controller);
      assertEquals((yield* send(fixture, sender, recipient)).kin, "sent");
    }
  });
});

Deno.test("a recipient upgraded by rotation is treated as v2 only after the rotation is accepted", async () => {
  await scenario(function*(fixture) {
    const sender = fixture.hby.makeHab("sender", undefined, { ...TRANSFERABLE, version: Vrsn_2_0 });
    const recipient = yield* remoteHab(fixture, "recipient", Vrsn_1_0);
    yield* authorize(fixture, recipient, recipient, Roles.controller);
    recipient.rotate({ version: Vrsn_2_0 });
    assertEquals((yield* send(fixture, sender, recipient)).kin, "failed", "stale local KEL stays v1");
    yield* teachKel(fixture, recipient);
    assertEquals((yield* send(fixture, sender, recipient)).kin, "sent");
  });
});

Deno.test("a v2 recipient behind a v1 mailbox provider is refused, because the provider reads the envelope", async () => {
  await scenario(function*(fixture) {
    const sender = fixture.hby.makeHab("sender", undefined, { ...TRANSFERABLE, version: Vrsn_2_0 });
    const recipient = yield* remoteHab(fixture, "recipient", Vrsn_2_0);
    const provider = yield* remoteHab(fixture, "provider", Vrsn_1_0);
    yield* authorize(fixture, recipient, provider, Roles.mailbox);
    const outcome = yield* send(fixture, sender, recipient);
    assertEquals(outcome.kin, "failed");
    if (outcome.kin === "failed") assertInstanceOf(outcome.error, PeerVersionError);
    assertEquals(fixture.received(), 0);
  });
});

Deno.test("a v1 message travels through a v1 mailbox provider", async () => {
  await scenario(function*(fixture) {
    const sender = fixture.hby.makeHab("sender", undefined, { ...TRANSFERABLE, version: Vrsn_1_0 });
    const recipient = yield* remoteHab(fixture, "recipient", Vrsn_1_0);
    const provider = yield* remoteHab(fixture, "provider", Vrsn_1_0);
    yield* authorize(fixture, recipient, provider, Roles.mailbox);
    assertEquals((yield* send(fixture, sender, recipient)).kin, "sent");
    assert(fixture.received() > 0, "the legacy envelope reached the provider");
  });
});

Deno.test("only rotation upgrades a v1 identifier, and no event moves back down", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("upgrader", undefined, { ...TRANSFERABLE, version: Vrsn_1_0 });
      assertEquals(hab.kelVersion, Vrsn_1_0);
      assertThrows(() => hab.interact({ version: Vrsn_2_0 }), ValidationError, "refusing");
      hab.rotate({ version: Vrsn_2_0 });
      assertEquals(hab.kelVersion, Vrsn_2_0);
      assertEquals(hby.db.getKever(hab.pre)?.serder.pvrsn.major, 2);
      hab.interact();
      assertEquals(hby.db.getKever(hab.pre)?.serder.pvrsn.major, 2, "later events follow the upgrade");
      assertThrows(() => hab.rotate({ version: Vrsn_1_0 }), ValidationError, "refusing");
    } finally {
      yield* hby.close(true);
    }
  });
});
