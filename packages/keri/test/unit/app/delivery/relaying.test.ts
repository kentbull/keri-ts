/**
 * Relay mode on the edge: the egress guard, the queued relay OOBI, Poster's relay route and its mailbox
 * authorization, queries and mailbox polling through the relay. The relay's accepted location is pinned the way an
 * accepted `/loc/scheme` reply records it; an accepted mailbox end role is pinned the way an accepted
 * `/end/role/add` reply records it, except where a test signs and accepts the real reply.
 */
import { type Operation, run, sleep, spawn } from "effection";
import { assert, assertEquals, assertInstanceOf, assertThrows } from "jsr:@std/assert";
import { parseBytes, SerderKERI } from "../../../../../cesr/mod.ts";
import { Poster, type PosterOutcome } from "../../../../src/app/delivery/forwarding.ts";
import {
  type Relay,
  relayEndpoint,
  RelayOnlyError,
  relayOnlyHttpClient,
  RelayUnauthorizedError,
  RelayUnresolvedError,
} from "../../../../src/app/delivery/relaying.ts";
import type { Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { addMailbox, type MailboxAdminDeps } from "../../../../src/app/mailbox/mailbox-admin.ts";
import { MailboxDirector } from "../../../../src/app/mailbox/mailbox-director.ts";
import { MailboxPoller } from "../../../../src/app/mailbox/mailbox-poller.ts";
import { mailboxPollEndpoints, mailboxTopicKey } from "../../../../src/app/mailbox/mailboxing.ts";
import { WitnessInquisitor } from "../../../../src/app/queries/witness-inquisitor.ts";
import {
  type AgentRuntime,
  createAgentRuntime,
  settleRuntimeIngress,
} from "../../../../src/app/runtime/agent-runtime.ts";
import { processCuesOnce } from "../../../../src/app/runtime/cue-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { readCesrRequestBytes } from "../../../../src/app/transport/cesr-http.ts";
import type { HttpClient } from "../../../../src/app/transport/http-client.ts";
import type { TcpDialer } from "../../../../src/app/transport/tcp-dialer.ts";
import type { TCPMessenger } from "../../../../src/app/transport/tcp-messenger.ts";
import type { TCPStreamMessenger } from "../../../../src/app/transport/tcp-stream-messenger.ts";
import { TransportError } from "../../../../src/app/transport/transport-error.ts";
import { EndpointRoles, Roles } from "../../../../src/core/roles.ts";
import { protocolFixture } from "../../../protocol-fixture.ts";
import { httpClient } from "../../../support/http-client.ts";

const RELAY_OOBI_ORIGIN = "http://agent-oobi.test";
const RELAY_URL = "http://agent.test:5642/";

/** One HTTP request as the relay (or anything else) received it. */
interface Received {
  readonly url: string;
  readonly method: string;
  readonly destination: string | null;
  readonly bytes: Uint8Array;
  readonly frames: ReturnType<typeof parseBytes>;
}

/** A recording peer that accepts every CESR POST/PUT; `failWith` makes every request fail instead. */
function recordingHttp(received: Received[], failWith?: Error): HttpClient {
  return httpClient(async (url, init) => {
    if (failWith) throw failWith;
    const request = new Request(url, init);
    const bytes = request.method === "GET" ? new Uint8Array() : await readCesrRequestBytes(request);
    const frames = bytes.length ? parseBytes(bytes) : [];
    received.push({ url, method: request.method, destination: request.headers.get("CESR-DESTINATION"), bytes, frames });
    return new Response(null, { status: 204 });
  });
}

/** The relay this edge habery sends through; its location is accepted only when `resolved`. */
function relayOf(hby: Habery, resolved: boolean): Relay {
  const agent = hby.makeHab("agent", undefined, { transferable: false });
  const relay = { aid: agent.pre!, oobi: `${RELAY_OOBI_ORIGIN}/oobi/${agent.pre}/controller` };
  // The edge's own Habery holds the agent here only to mint a real prefix; Poster has no local mailbox store.
  if (resolved) hby.db.locs.pin([relay.aid, "http"], { url: RELAY_URL });
  return relay;
}

/** Record `pre`'s accepted mailbox end role naming the relay, as an accepted `/end/role/add` reply does. */
function authorize(hby: Habery, pre: string, relay: Relay): void {
  hby.db.ends.pin([pre, Roles.mailbox, relay.aid], { allowed: true });
}

/** Deliver every admitted event with one Poster pass and return its outcomes in admission order. */
function* deliverAll(postman: Poster, admitted: ReturnType<Poster["send"]>[]): Operation<PosterOutcome[]> {
  for (let pass = 0; pass < 4 && postman.hasPending; pass++) yield* postman.process();
  const outcomes: PosterOutcome[] = [];
  for (const evt of admitted) outcomes.push(yield* postman.wait(evt));
  return outcomes;
}

/** The `/fwd` frames of one request. */
function forwards(received: Received): ReturnType<typeof parseBytes> {
  return received.frames.filter((frame) => frame.body instanceof SerderKERI && frame.body.route === "/fwd");
}

/** Run `body` over a fresh temporary Habery and close it afterwards. */
function withHabery(body: (hby: Habery) => Operation<void>): Promise<void> {
  return run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      yield* body(hby);
    } finally {
      yield* hby.close(true);
    }
  });
}

Deno.test("relay guard refuses a non-relay origin as TransportError", async () => {
  await withHabery(function*(hby) {
    const relay = relayOf(hby, true);
    const received: Received[] = [];
    const dialed: string[] = [];
    const tcp: TcpDialer = {
      messenger(url) {
        dialed.push(url);
        return {} as TCPMessenger;
      },
      streamMessenger(url) {
        dialed.push(url);
        return {} as TCPStreamMessenger;
      },
    };
    const guarded = relayOnlyHttpClient({ ...recordingHttp(received), tcp }, hby, relay);
    for (const url of ["http://witness.test:5631/", "https://agent.test:5642/", "http://agent.test:5643/"]) {
      const error = yield* refusal(() => guarded.request(url, { method: "POST", body: "x" }));
      assertInstanceOf(error, RelayOnlyError);
      assertInstanceOf(error, TransportError);
      assertInstanceOf(yield* refusal(() => guarded.open(url)), RelayOnlyError);
    }
    const tcpError = assertThrows(() => guarded.tcp!.messenger("tcp://witness.test:5632", systemClock));
    assertInstanceOf(tcpError, RelayOnlyError);
    assertEquals(received, [], "nothing reached the network");
    assertEquals(dialed, [], "nothing was dialed");
    assertThrows(() => relayOnlyHttpClient(recordingHttp(received), hby, { ...relay, oobi: "tcp://agent.test:1" }));
  });
});

/** Run one guarded request and return what it threw. */
function* refusal(request: () => Operation<unknown>): Operation<unknown> {
  try {
    yield* request();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the guarded request to be refused");
}

Deno.test("relay guard allows the relay OOBI origin and accepted locations", async () => {
  await withHabery(function*(hby) {
    const relay = relayOf(hby, false);
    const received: Received[] = [];
    const guarded = relayOnlyHttpClient(recordingHttp(received), hby, relay);
    assertEquals((yield* guarded.request(relay.oobi)).status, 204, "the OOBI origin is allowed before resolution");
    assertInstanceOf(yield* refusal(() => guarded.request(RELAY_URL)), RelayOnlyError);
    // The relay's location is accepted after the guard was built; the guard reads it on each request.
    hby.db.locs.pin([relay.aid, "http"], { url: RELAY_URL });
    assertEquals((yield* guarded.request(`${RELAY_URL}mailbox`)).status, 204);
    assertEquals((yield* guarded.request(relay.oobi)).status, 204);
    assertEquals(received.map(({ url }) => url), [relay.oobi, `${RELAY_URL}mailbox`, relay.oobi]);
  });
});

Deno.test("runtime queues the relay OOBI when unresolved", async () => {
  await withHabery(function*(hby) {
    const unresolved = relayOf(hby, false);
    const received: Received[] = [];
    const runtime = yield* createAgentRuntime(hby, recordingHttp(received), systemClock, { relay: unresolved });
    try {
      assertEquals(hby.db.oobis.get(unresolved.oobi)?.state, "queued");
      assertInstanceOf(yield* refusal(() => runtime.http.request("http://witness.test/")), RelayOnlyError);
      assertEquals(runtime.postman.relay, unresolved);
    } finally {
      yield* runtime.close();
    }
    hby.db.oobis.rem(unresolved.oobi);
    hby.db.locs.pin([unresolved.aid, "http"], { url: RELAY_URL });
    const resolved = yield* createAgentRuntime(hby, recordingHttp(received), systemClock, { relay: unresolved });
    try {
      assertEquals(hby.db.oobis.get(unresolved.oobi), null, "a relay with an accepted location is not re-queued");
    } finally {
      yield* resolved.close();
    }
    assertEquals(received, []);
  });
});

Deno.test("Poster with a relay forwards every recipient to the relay", async () => {
  await withHabery(function*(hby) {
    const relay = relayOf(hby, true);
    const sender = hby.makeHab("sender");
    authorize(hby, sender.pre, relay);
    // One recipient with direct and mailbox endpoints a forwarder would use; one with no endpoints at all.
    const served = hby.makeHab("served"), unknown = hby.makeHab("unknown");
    for (const role of [EndpointRoles.controller, EndpointRoles.agent, EndpointRoles.mailbox]) {
      const endpoint = hby.makeHab(`${role}-endpoint`);
      hby.db.ends.pin([served.pre, role, endpoint.pre], { allowed: true });
      hby.db.locs.pin([endpoint.pre, "http"], { url: `http://${role}.test/` });
    }
    const received: Received[] = [];
    const postman = new Poster(hby, null, null, recordingHttp(received), systemClock, relay);
    try {
      const msg = sender.query(sender.pre, sender.pre, { route: "logs", q: {} });
      assert(postman.canReach(sender.pre, unknown.pre), "a resolved relay reaches every recipient");
      const outcomes = yield* deliverAll(postman, [
        postman.send({ src: sender.pre, dest: served.pre, topic: "/credential", msg }, { notify: true }),
        postman.send({ src: sender.pre, dest: unknown.pre, topic: "/credential", msg }, { notify: true }),
      ]);
      assertEquals(outcomes.map(({ kin, deliveries }) => ({ kin, deliveries })), [
        { kin: "sent", deliveries: [RELAY_URL] },
        { kin: "sent", deliveries: [RELAY_URL] },
      ]);
      assert(
        received.every(({ url, destination }) => url === RELAY_URL && destination === relay.aid),
        "every request (introduction and wrapper) went to the relay, with no direct fallback",
      );
      const wrappers = received.flatMap(forwards);
      assertEquals(wrappers.map((frame) => frame.body.ked!.q), [
        { pre: served.pre, topic: "credential" },
        { pre: unknown.pre, topic: "credential" },
      ], "exactly one forward per message");
      assertEquals(wrappers.map((frame) => frame.body.ked!.i), [sender.pre, sender.pre]);
    } finally {
      yield* postman.close();
    }
  });
});

Deno.test("Poster sends directly when the recipient is the relay", async () => {
  await withHabery(function*(hby) {
    const relay = relayOf(hby, true);
    const sender = hby.makeHab("sender");
    const received: Received[] = [];
    const postman = new Poster(hby, null, null, recordingHttp(received), systemClock, relay);
    try {
      const msg = sender.query(sender.pre, sender.pre, { route: "logs", q: {} });
      const [outcome] = yield* deliverAll(postman, [
        postman.send({ src: sender.pre, dest: relay.aid, topic: "", msg }, { notify: true }),
      ]);
      assertEquals(outcome.kin, "sent");
      assertEquals(outcome.deliveries, [RELAY_URL]);
      assertEquals(received.length, 1);
      assertEquals(forwards(received[0]), [], "no forwarding wrapper");
      assertEquals(received[0].frames.map((frame) => frame.body.raw), parseBytes(msg).map((frame) => frame.body.raw));
    } finally {
      yield* postman.close();
    }
  });
});

Deno.test("group source wraps with the local member", async () => {
  await withHabery(function*(hby) {
    const relay = relayOf(hby, true);
    const member = hby.makeHab("member"), other = hby.makeHab("other"), recipient = hby.makeHab("recipient");
    const group = hby.makeGroupHab("group", member, [member.pre, other.pre], undefined, undefined, {
      isith: "2",
      nsith: "2",
      toad: 0,
    });
    authorize(hby, member.pre, relay);
    const received: Received[] = [];
    const postman = new Poster(hby, null, null, recordingHttp(received), systemClock, relay);
    try {
      const msg = member.query(member.pre, member.pre, { route: "logs", q: {} });
      const [outcome] = yield* deliverAll(postman, [
        postman.send({ src: group.hab.pre!, dest: recipient.pre, topic: "/multisig", msg }, { notify: true }),
      ]);
      assertEquals(outcome.kin, "sent");
      const wrappers = received.flatMap(forwards);
      assertEquals(wrappers.length, 1);
      assertEquals(wrappers[0].body.ked!.i, member.pre, "the local member signs the wrapper, not the group");
      assertEquals(wrappers[0].body.ked!.q, { pre: recipient.pre, topic: "multisig" });
      assert(received.every(({ url, destination }) => url === RELAY_URL && destination === relay.aid));
    } finally {
      yield* postman.close();
    }
  });
});

Deno.test("stream admission wraps each frame for the relay", async () => {
  await withHabery(function*(hby) {
    const relay = relayOf(hby, true);
    const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
    authorize(hby, sender.pre, relay);
    const received: Received[] = [];
    const postman = new Poster(hby, null, null, recordingHttp(received), systemClock, relay);
    try {
      const msgs = ["0", "1"].map((s) => sender.query(sender.pre, sender.pre, { route: "logs", q: { s } }));
      const stream = postman.sendStream({ src: sender.pre, dest: recipient.pre, topic: "/replay", msgs }, {
        notify: true,
      });
      const [outcome] = yield* deliverAll(postman, [stream]);
      assertEquals(outcome.kin, "sent");
      assertEquals(outcome.deliveries, [RELAY_URL]);
      assertEquals(received.map(({ url, method }) => ({ url, method })), [{ url: RELAY_URL, method: "PUT" }]);
      assertEquals(
        forwards(received[0]).map((frame) => ({
          q: frame.body.ked!.q,
          s: ((frame.nests?.[0]?.body as SerderKERI).ked!.q as Record<string, unknown>).s,
        })),
        ["0", "1"].map((s) => ({ q: { pre: recipient.pre, topic: "replay" }, s })),
      );
    } finally {
      yield* postman.close();
    }
  });
});

Deno.test("unreachable relay yields a failed outcome", async () => {
  await withHabery(function*(hby) {
    const relay = relayOf(hby, true);
    const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
    authorize(hby, sender.pre, relay);
    const received: Received[] = [];
    const refused = new TransportError("connection refused");
    const postman = new Poster(hby, null, null, recordingHttp(received, refused), systemClock, relay);
    try {
      const msg = sender.query(sender.pre, sender.pre, { route: "logs", q: {} });
      const [outcome] = yield* deliverAll(postman, [
        postman.send({ src: sender.pre, dest: recipient.pre, topic: "/credential", msg }, { notify: true }),
      ]);
      assert(outcome.kin === "failed");
      assertInstanceOf(outcome.error, TransportError);
      assertEquals(outcome.deliveries, []);
    } finally {
      yield* postman.close();
    }
  });
});

Deno.test("Poster with an unresolved relay fails with RelayUnresolvedError and sends nothing", async () => {
  await withHabery(function*(hby) {
    const relay = relayOf(hby, false);
    const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
    const mailbox = hby.makeHab("mailbox");
    hby.db.ends.pin([recipient.pre, EndpointRoles.mailbox, mailbox.pre], { allowed: true });
    hby.db.locs.pin([mailbox.pre, "http"], { url: "http://mailbox.test/" });
    const received: Received[] = [];
    const postman = new Poster(hby, null, null, recordingHttp(received), systemClock, relay);
    try {
      assertEquals(relayEndpoint(hby, relay), null);
      assertEquals(postman.canReach(sender.pre, recipient.pre), false);
      const msg = sender.query(sender.pre, sender.pre, { route: "logs", q: {} });
      const [toRecipient, toRelay] = yield* deliverAll(postman, [
        postman.send({ src: sender.pre, dest: recipient.pre, topic: "/credential", msg }, { notify: true }),
        postman.send({ src: sender.pre, dest: relay.aid, topic: "", msg }, { notify: true }),
      ]);
      for (const outcome of [toRecipient, toRelay]) {
        assert(outcome.kin === "failed");
        assertInstanceOf(outcome.error, RelayUnresolvedError);
        assertEquals(outcome.deliveries, []);
      }
      assertEquals(received, [], "nothing was sent, not even to the recipient's own mailbox");
    } finally {
      yield* postman.close();
    }
  });
});

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

/** The `qry` frames of one request (an introduction may precede them). */
function queries(received: Received): SerderKERI[] {
  return received.frames.flatMap((frame) =>
    frame.body instanceof SerderKERI && frame.body.ilk === "qry" ? [frame.body] : []
  );
}

Deno.test("Poster with an unauthorized relay fails with RelayUnauthorizedError and sends nothing", async () => {
  await withHabery(function*(hby) {
    const relay = relayOf(hby, true);
    const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
    const received: Received[] = [];
    const postman = new Poster(hby, null, null, recordingHttp(received), systemClock, relay);
    try {
      assertEquals(postman.canReach(sender.pre, recipient.pre), false, "an unauthorized relay reaches no recipient");
      assert(postman.canReach(sender.pre, relay.aid), "the relay itself needs no authorization");
      const msg = sender.query(sender.pre, sender.pre, { route: "logs", q: {} });
      const [toRecipient] = yield* deliverAll(postman, [
        postman.send({ src: sender.pre, dest: recipient.pre, topic: "/credential", msg }, { notify: true }),
      ]);
      assert(toRecipient.kin === "failed");
      assertInstanceOf(toRecipient.error, RelayUnauthorizedError);
      assertEquals(toRecipient.deliveries, []);
      assertEquals(received, [], "no wrapper and no introduction was sent");
      // A revoked role is not an authorization either.
      hby.db.ends.pin([sender.pre, Roles.mailbox, relay.aid], { allowed: false });
      const [revoked] = yield* deliverAll(postman, [
        postman.send({ src: sender.pre, dest: recipient.pre, topic: "/credential", msg }, { notify: true }),
      ]);
      assert(revoked.kin === "failed");
      assertInstanceOf(revoked.error, RelayUnauthorizedError);
      assertEquals(received, []);
    } finally {
      yield* postman.close();
    }
  });
});

Deno.test("a group source is relayed once its member has authorized the relay", async () => {
  await withHabery(function*(hby) {
    const relay = relayOf(hby, true);
    const member = hby.makeHab("member"), other = hby.makeHab("other"), recipient = hby.makeHab("recipient");
    const group = hby.makeGroupHab("group", member, [member.pre, other.pre], undefined, undefined, {
      isith: "2",
      nsith: "2",
      toad: 0,
    });
    // The group's own row does not serve: the wrapper is the member's, and the agent reads the member's row.
    authorize(hby, group.hab.pre!, relay);
    const received: Received[] = [];
    const postman = new Poster(hby, null, null, recordingHttp(received), systemClock, relay);
    try {
      const msg = member.query(member.pre, member.pre, { route: "logs", q: {} });
      const send = () =>
        postman.send({ src: group.hab.pre!, dest: recipient.pre, topic: "/multisig", msg }, { notify: true });
      const [refused] = yield* deliverAll(postman, [send()]);
      assert(refused.kin === "failed");
      assertInstanceOf(refused.error, RelayUnauthorizedError);
      assertEquals(received, []);
      authorize(hby, member.pre, relay);
      const [sent] = yield* deliverAll(postman, [send()]);
      assertEquals(sent.kin, "sent");
      const wrappers = received.flatMap(forwards);
      assertEquals(wrappers.map((frame) => frame.body.ked!.i), [member.pre]);
      assert(received.every(({ url, destination }) => url === RELAY_URL && destination === relay.aid));
    } finally {
      yield* postman.close();
    }
  });
});

Deno.test("an edge authorizes its relay as mailbox and then sends through it", async () => {
  await withHabery(function*(hby) {
    const relay = relayOf(hby, true);
    const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
    const received: Received[] = [];
    const runtime = yield* createAgentRuntime(hby, recordingHttp(received), systemClock, { relay });
    try {
      const msg = sender.query(sender.pre, sender.pre, { route: "logs", q: {} });
      const send = () =>
        runtime.postman.send({ src: sender.pre, dest: recipient.pre, topic: "/credential", msg }, { notify: true });
      const [before] = yield* deliverAll(runtime.postman, [send()]);
      assert(before.kin === "failed");
      assertInstanceOf(before.error, RelayUnauthorizedError);
      assertEquals(received, []);

      // The mailbox add goes to the relay's admin resource through the guarded client, carrying the KEL.
      const status = yield* addMailbox(adminDeps(runtime), sender, relay.aid);
      assertEquals(status.state, "authorized");
      assertEquals(received.map(({ url, destination }) => ({ url, destination })), [
        { url: `${RELAY_URL}mailboxes`, destination: relay.aid },
      ]);
      const admin = received[0].frames.map((frame) => frame.body as SerderKERI);
      assertEquals(admin.map((serder) => serder.ilk), ["icp", "rpy"]);
      assertEquals(admin[1].ked!.a, { cid: sender.pre, role: Roles.mailbox, eid: relay.aid });

      received.length = 0;
      const [after] = yield* deliverAll(runtime.postman, [send()]);
      assertEquals(after.kin, "sent");
      assertEquals(after.deliveries, [RELAY_URL]);
      const wrappers = received.flatMap(forwards);
      assertEquals(wrappers.map((frame) => frame.body.ked!.q), [{ pre: recipient.pre, topic: "credential" }]);
    } finally {
      yield* runtime.close();
    }
  });
});

Deno.test("querier with a relay addresses the relay", async () => {
  await withHabery(function*(hby) {
    const relay = relayOf(hby, true);
    const signer = hby.makeHab("signer"), subject = hby.makeHab("subject"), witness = hby.makeHab("witness");
    // Endpoints a forwarder would query: the subject's own controller endpoint and an explicit witness.
    hby.db.ends.pin([subject.pre, Roles.controller, subject.pre], { allowed: true });
    for (const pre of [subject.pre, witness.pre]) hby.db.locs.pin([pre, "http"], { url: `http://${pre}.test/` });
    const received: Received[] = [];
    const guarded = relayOnlyHttpClient(recordingHttp(received), hby, relay);
    const inquisitor = new WitnessInquisitor(hby, protocolFixture(hby), guarded, systemClock, relay, signer);
    try {
      assertEquals(inquisitor.attestersFor(subject.pre), [relay.aid]);
      inquisitor.enqueue({ pre: subject.pre, route: "logs", q: {} });
      inquisitor.enqueue({ pre: subject.pre, route: "ksn", q: {}, src: witness.pre });
      inquisitor.enqueue({ pre: subject.pre, route: "logs", q: {}, wits: [witness.pre] });
      // Until the signer has authorized the relay as mailbox (where the answer goes) nothing is sent.
      yield* inquisitor.deliverOnce();
      assertEquals(received, []);
      assertEquals(inquisitor.pending.length, 3, "the requests stay queued");

      authorize(hby, signer.pre, relay);
      yield* inquisitor.deliverOnce();
      assertEquals(inquisitor.pending.length, 0);
      // Each message (the introduction's and the query) is its own POST; every one went to the relay.
      assert(received.every(({ url, destination }) => url === RELAY_URL && destination === relay.aid));
      const sent = received.flatMap(queries);
      assertEquals(sent.map((serder) => serder.route), ["logs", "ksn", "logs"]);
      for (const serder of sent) {
        assertEquals((serder.ked!.q as Record<string, unknown>).src, relay.aid, "the relay is the attester");
        assertEquals((serder.ked!.q as Record<string, unknown>).i, subject.pre);
      }
    } finally {
      yield* inquisitor.close();
    }
  });
});

Deno.test("agent answers logs into the edge mailbox", async () => {
  await run(function*() {
    const agentHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const edgeHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      // The agent: a forwarder hosting mailboxes, with its own accepted location.
      const agent = agentHby.makeHab("agent", undefined, { transferable: false });
      const agentOut: Received[] = [];
      const agentRuntime = yield* createAgentRuntime(agentHby, recordingHttp(agentOut), systemClock, {
        enableMailboxStore: true,
      });
      // The edge: a relay runtime whose agent's location is accepted.
      const relay: Relay = { aid: agent.pre!, oobi: `${RELAY_OOBI_ORIGIN}/oobi/${agent.pre}/controller` };
      edgeHby.db.locs.pin([relay.aid, "http"], { url: RELAY_URL });
      const edge = edgeHby.makeHab("edge"), remote = edgeHby.makeHab("remote");
      const edgeOut: Received[] = [];
      const edgeRuntime = yield* createAgentRuntime(edgeHby, recordingHttp(edgeOut), systemClock, { relay });
      try {
        yield* settleRuntimeIngress(agentRuntime, [agent.makeLocScheme(RELAY_URL, agent.pre, "http")]);
        // The agent holds the remote subject's KEL from its own work.
        yield* settleRuntimeIngress(agentRuntime, [...edgeHby.db.replay(remote.pre)!]);

        // Onboarding: the edge authorizes the agent as mailbox; the agent receives the admin request.
        yield* addMailbox(adminDeps(edgeRuntime), edge, relay.aid);
        yield* settleRuntimeIngress(agentRuntime, [edgeOut[0].bytes]);
        assertEquals(agentHby.db.ends.get([edge.pre, Roles.mailbox, agent.pre])?.allowed, true);

        // The edge queries the agent; the agent receives the query.
        edgeOut.length = 0;
        edgeRuntime.querying.enqueue({ pre: remote.pre, signer: edge.pre, route: "logs", q: {} });
        yield* edgeRuntime.querying.deliverOnce();
        assert(edgeOut.every(({ url, destination }) => url === RELAY_URL && destination === relay.aid));
        assertEquals(edgeOut.flatMap(queries).map((serder) => serder.route), ["logs"]);
        yield* settleRuntimeIngress(agentRuntime, edgeOut.map(({ bytes }) => bytes));

        // The agent answers from its own store through Respondant and Poster into the edge's mailbox it hosts.
        yield* processCuesOnce(agentRuntime, { hab: agent });
        for (let pass = 0; pass < 4 && agentRuntime.postman.hasPending; pass++) yield* agentRuntime.postman.process();
        const stored = agentRuntime.mailboxer!.getTopicMsgs(mailboxTopicKey(edge.pre, "/replay"));
        assert(stored.length > 0, "the replay is in the edge's mailbox");
        const events = stored.flatMap((msg) => parseBytes(msg)).map((frame) => frame.body as SerderKERI);
        assertEquals(events.map((serder) => [serder.ilk, serder.pre]), [["icp", remote.pre]]);
        assertEquals(agentOut, [], "the agent sent nothing over the network");
      } finally {
        yield* edgeRuntime.close();
        yield* agentRuntime.close();
      }
    } finally {
      yield* edgeHby.close(true);
      yield* agentHby.close(true);
    }
  });
});

Deno.test("poller with a relay polls only the relay", async () => {
  await withHabery(function*(hby) {
    const relay = relayOf(hby, true);
    const witness = hby.makeHab("witness", undefined, { transferable: false });
    hby.db.locs.pin([witness.pre, "http"], { url: "http://witness.test/" });
    const subject = hby.makeHab("subject", undefined, { wits: [witness.pre], toad: 1 });
    const mailbox = hby.makeHab("mailbox", undefined, { transferable: false });
    hby.db.locs.pin([mailbox.pre, "http"], { url: "http://mailbox.test/" });
    authorize(hby, subject.pre, { aid: mailbox.pre, oobi: "" });
    assertEquals(
      mailboxPollEndpoints(subject, null).map(({ eid }) => eid).sort(),
      [mailbox.pre, witness.pre].sort(),
      "a forwarder polls its mailboxes and witnesses",
    );
    assertEquals(mailboxPollEndpoints(subject, relay), [], "nothing is polled before the relay is authorized");
    authorize(hby, subject.pre, relay);
    assertEquals(mailboxPollEndpoints(subject, relay), [
      { key: `${relay.aid}:${RELAY_URL}`, eid: relay.aid, url: RELAY_URL },
    ]);

    // The running poller reaches only the relay: a request anywhere else would fail the guard.
    const received: Received[] = [];
    const guarded = relayOnlyHttpClient(recordingHttp(received), hby, relay);
    const poller = new MailboxPoller(hby, new MailboxDirector(hby), guarded, systemClock, relay);
    poller.registerTopic("/reply");
    const worker = yield* spawn(() => poller.pollDo(() => {}));
    try {
      for (let wait = 0; wait < 200 && received.length < 2; wait++) yield* sleep(10);
    } finally {
      yield* worker.halt();
    }
    assert(received.length >= 2, "the relay was polled");
    assert(received.every(({ url, destination }) => url === RELAY_URL && destination === relay.aid));
    const polled = received.flatMap(queries);
    assert(polled.every((serder) => serder.route === "mbx"));
    assertEquals(new Set(polled.map((serder) => (serder.ked!.q as Record<string, unknown>).i)), new Set([subject.pre]));
  });
});
