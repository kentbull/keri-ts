import { call, run, spawn, type Task } from "effection";
import { assert, assertEquals, assertExists, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { parseBytes, ParserError, SerderKERI } from "../../../../cesr/mod.ts";
import { queryCommand } from "../../../../tufa/src/cli/query.ts";
import {
  createAgentRuntime,
  runAgentRuntimeUntil,
} from "../../../src/app/agent-runtime.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { processCuesOnce } from "../../../src/app/cue-runtime.ts";
import { acceptedEventReplayMessage, createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { type HttpClient } from "../../../src/app/http-client.ts";
import { envelopeFromFrame, queryEnvelopeFromDispatch } from "../../../src/app/parsering.ts";
import { AnchorQuerier, KeyStateNoticer, SeqNoQuerier } from "../../../src/app/querying.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { runtimeTurn } from "../../../src/app/runtime-turn.ts";
import { WitnessInquisitor } from "../../../src/app/witness-inquisitor.ts";
import { drainWitnessCues } from "../../../src/app/witnessing.ts";

import type { AgentCue, QueryCue, QueryInstruction, QueryRequest, TelQueryCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { reply as replyEvent } from "../../../src/core/protocol-eventing.ts";
import { Roles } from "../../../src/core/roles.ts";
import { protocolFixture } from "../../protocol-fixture.ts";
import { httpClient } from "../../support/http-client.ts";

// @ts-expect-error Routed work must identify its target.
void ({ kin: "query", route: "logs", q: {} } satisfies QueryCue);
// @ts-expect-error Local query work must select a route.
void ({ kin: "query", pre: "aid", q: {} } satisfies QueryCue);
// @ts-expect-error TEL queries require the registry as well as the credential.
void ({ route: "tels", q: { i: "credential" } } satisfies QueryInstruction);
// @ts-expect-error KEL queries cannot carry a TEL registry body.
void ({ route: "logs", q: { ri: "registry", i: "credential" } } satisfies QueryInstruction);
// @ts-expect-error KSN queries do not accept an anchor filter.
void ({ route: "ksn", q: { a: { i: "aid", s: "0", d: "digest" } } } satisfies QueryInstruction);
// @ts-expect-error A recovery notice has no outbound attester yet.
void ({ kin: "query", src: "aid", q: { r: "schema", said: "schema" } } satisfies QueryCue);
// @ts-expect-error Mailbox signing requires its topic cursors.
void ({ route: "mbx", q: {} } satisfies Parameters<Hab["query"]>[2]);
// @ts-expect-error A schema notice is not a signed outbound request.
void ({ kin: "query", signer: "aid", q: { r: "schema", said: "schema" } } satisfies QueryCue);
// @ts-expect-error TEL recovery must identify its registry and credential.
void ({ kin: "telquery", q: { i: "credential" } } satisfies TelQueryCue);
// @ts-expect-error Anchor queries require the event digest, not an optional payload bag.
void ({ i: "prefix", s: "0" } satisfies ConstructorParameters<typeof AnchorQuerier>[3]);
// @ts-expect-error Event-seal ordinals are hex text; credential KEL anchors use another shape.
void ({ i: "prefix", s: 0, d: "digest" } satisfies ConstructorParameters<typeof AnchorQuerier>[3]);
// @ts-expect-error Event seals have no diagnostic extension slot.
void ({ i: "prefix", s: "0", d: "digest", extra: true } satisfies ConstructorParameters<typeof AnchorQuerier>[3]);

/** Capture actual HTTP query wire after production framing; introductions are not queries. */
function queryHttp(messages: Uint8Array[], urls: string[] = []): HttpClient {
  return httpClient(async (url, init) => {
    const bytes = await readCesrRequestBytes(new Request(url, init));
    const serder = new SerderKERI({ raw: bytes });
    if (serder.ilk === "qry") {
      messages.push(bytes);
      urls.push(url);
    }
    return new Response(null, { status: 204 });
  });
}

function seedControllerEndpoint(hby: Habery, pre: string, url = "http://controller.test/"): void {
  hby.db.locs.pin([pre, "http"], { url });
  hby.db.ends.pin([pre, Roles.controller, pre], { allowed: true });
}

/** Verify the endorsement from actual transmitted attachments, independently of body routing. */
async function assertQuerySigner(bytes: Uint8Array, hab: Hab): Promise<void> {
  const frames = await parseBytes(bytes);
  assertEquals(frames.length, 1);
  const envelope = queryEnvelopeFromDispatch(envelopeFromFrame(frames[0]));
  assertEquals(envelope.source?.qb64, hab.pre);
  assertExists(envelope.sigers);
  assertEquals(envelope.sigers.length, 1);
  const signature = envelope.sigers[0];
  assert(hab.kever!.verfers[signature.index].verify(signature.raw, envelope.serder.raw));
}

Deno.test("runtime sends queued and recovery-cue queries through its concrete sender", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), subject = hby.makeHab("subject");
    const messages: Uint8Array[] = [];
    seedControllerEndpoint(hby, subject.pre);
    const runtime = yield* createAgentRuntime(hby, queryHttp(messages), systemClock);
    const sign = sender.query;
    let signatures = 0;
    sender.query = function(...args) {
      signatures++;
      return sign.apply(this, args);
    };
    try {
      runtime.querying.enqueue({ pre: subject.pre, signer: sender.pre, route: "logs", q: {} });
      runtime.cues.push({ kin: "query", pre: subject.pre, route: "ksn", q: {} });
      yield* runAgentRuntimeUntil(
        runtime,
        () => messages.length === 2 && runtime.querying.pending.empty && !runtime.querying.hasPendingDelivery,
        { hab: sender, timeoutMs: 1_000, pollMailbox: false },
      );
      assertEquals(
        [messages.length, signatures, runtime.querying.pending.length, runtime.querying.hasPendingDelivery],
        [2, 2, 0, false],
      );
      assertEquals(messages.map((wire) => new SerderKERI({ raw: wire }).route), ["logs", "ksn"]);
      for (const message of messages) yield* call(() => assertQuerySigner(message, sender));
    } finally {
      sender.query = sign;
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("queued and cue queries never substitute an ambient identity for an explicitly selected signer", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const ambient = hby.makeHab("ambient"), selected = hby.makeHab("selected"), subject = hby.makeHab("subject");
    const messages: Uint8Array[] = [];
    seedControllerEndpoint(hby, subject.pre);
    const inquisitor = new WitnessInquisitor(hby, protocolFixture(hby), queryHttp(messages), systemClock, ambient);
    try {
      const request = { pre: subject.pre, signer: selected.pre, src: subject.pre, route: "logs" as const, q: {} };
      inquisitor.enqueue(request);
      const pending = inquisitor.pending.peekHead();
      hby.habs.delete(selected.pre);

      assertStrictEquals(inquisitor.pending.peekHead(), pending);
      assertEquals(inquisitor.hasPendingDelivery, false);
      hby.habs.set(selected.pre, selected);

      inquisitor.enqueueCue({ kin: "query", ...request }, ambient);
      yield* inquisitor.deliverOnce();
      assertEquals([messages.length, inquisitor.pending.length], [2, 0]);
      for (const message of messages) yield* call(() => assertQuerySigner(message, selected));
    } finally {
      yield* inquisitor.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("unrouted notices create no requests; ambiguous identities and missing endpoints remain deferred", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), subject = hby.makeHab("subject");
    const messages: Uint8Array[] = [];
    const runtime = yield* createAgentRuntime(hby, queryHttp(messages), systemClock);
    try {
      runtime.cues.push({ kin: "query", q: { r: "schema", said: subject.pre } });
      runtime.cues.push({ kin: "query", q: { r: "tels", pre: subject.pre } });
      yield* processCuesOnce(runtime);
      assertEquals([runtime.cues.length, runtime.querying.pending.length, messages.length], [0, 0, 0]);
      runtime.cues.push({ kin: "query", pre: subject.pre, route: "logs", q: {} });
      yield* processCuesOnce(runtime);
      assertEquals([runtime.querying.pending.length, messages.length], [1, 0]);
      const pending = runtime.querying.pending.peekHead();
      runtime.querying.configure({ hab: sender });

      assertStrictEquals(runtime.querying.pending.peekHead(), pending);
      assertEquals(messages.length, 0);
      seedControllerEndpoint(hby, subject.pre);

      yield* runtime.querying.deliverOnce();
      assertEquals([runtime.querying.pending.length, messages.length], [0, 1]);
      yield* call(() => assertQuerySigner(messages[0], sender));
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("KeyStateNoticer upgrades to logs on ahead state and completes only after accepted catchup", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), subject = remote.makeHab("subject");
    const messages: Uint8Array[] = [];
    const runtime = yield* createAgentRuntime(hby, queryHttp(messages), systemClock);
    const queryCues = new Deck<AgentCue>();
    let current: Task<void> | undefined, ahead: Task<void> | undefined;
    try {
      yield* runtime.reactor.processBytes(acceptedEventReplayMessage(remote, subject.pre, 0).message);
      runtime.cues.clear();
      seedControllerEndpoint(hby, subject.pre);
      runtime.querying.configure({ hab: sender });
      current = yield* spawn(() =>
        new KeyStateNoticer(hby.db, runtime.querying, subject.pre, queryCues, { signer: sender.pre })
          .queryDo()
      );
      yield* processCuesOnce(runtime, { hab: sender, queryCues });

      yield* runtime.querying.deliverOnce();
      assertEquals(new SerderKERI({ raw: messages[0] }).route, "ksn");
      const notice = replyEvent(`/ksn/${subject.pre}`, subject.kever!.state().asDict());
      yield* runtime.reactor.processBytes(subject.endorse(notice, { pipelined: false }));
      yield* processCuesOnce(runtime, { hab: sender, queryCues });

      yield* runtime.querying.deliverOnce();
      yield* current;
      assertEquals(messages.length, 1);
      let caughtUp = false;
      ahead = yield* spawn(function*() {
        yield* new KeyStateNoticer(hby.db, runtime.querying, subject.pre, queryCues, {
          signer: sender.pre,
        }).queryDo();
        caughtUp = true;
      });
      yield* processCuesOnce(runtime, { hab: sender, queryCues });

      yield* runtime.querying.deliverOnce();
      const interaction = subject.interact();
      const aheadNotice = replyEvent(`/ksn/${subject.pre}`, subject.kever!.state().asDict());
      yield* runtime.reactor.processBytes(subject.endorse(aheadNotice, { pipelined: false }));
      yield* processCuesOnce(runtime, { hab: sender, queryCues });
      yield* runtimeTurn(); // The noticer consumes its Deck on a cooperative turn.

      yield* runtime.querying.deliverOnce();
      assertEquals(messages.map((wire) => new SerderKERI({ raw: wire }).route), ["ksn", "ksn", "logs"]);
      assertEquals(caughtUp, false, "HTTP completion does not satisfy accepted-state catch-up");
      assertEquals(hby.db.getKever(subject.pre)?.sn, 0);
      yield* runtime.reactor.processBytes(interaction);
      yield* processCuesOnce(runtime, { hab: sender, queryCues });

      yield* runtime.querying.deliverOnce();
      yield* ahead;
      assertEquals([caughtUp, hby.db.getKever(subject.pre)?.sn], [true, 1]);
    } finally {
      if (ahead) yield* ahead.halt();
      if (current) yield* current.halt();
      yield* runtime.close();
      yield* remote.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("a noticer requires a validated remote KSN even when its KEL is already accepted", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const signer = hby.makeHab("signer"), subject = remote.makeHab("subject");
    const runtime = yield* createAgentRuntime(hby, queryHttp([]), systemClock);
    const queryCues = new Deck<AgentCue>();
    let completed = false;
    const task = yield* spawn(function*() {
      yield* new KeyStateNoticer(hby.db, runtime.querying, subject.pre, queryCues, { signer: signer.pre }).queryDo();
      completed = true;
    });
    try {
      yield* runtime.reactor.processBytes(acceptedEventReplayMessage(remote, subject.pre, 0).message);
      yield* processCuesOnce(runtime, { hab: signer, queryCues });
      yield* runtimeTurn();
      assertEquals(hby.db.getKever(subject.pre)?.said, subject.kever!.said);
      assertEquals(completed, false, "accepted KEL evidence does not establish a received remote notice");

      const notice = replyEvent(`/ksn/${subject.pre}`, subject.kever!.state().asDict());
      // The body claims the subject as its attester, but this endorsement is by another AID.
      yield* runtime.reactor.processBytes(signer.endorse(notice, { pipelined: false }));
      yield* processCuesOnce(runtime, { hab: signer, queryCues });
      yield* runtimeTurn();
      assertEquals(completed, false, "an invalid attester endorsement cannot complete the query");
      assertEquals(hby.db.ksns.get([subject.kever!.said]), null);

      yield* runtime.reactor.processBytes(subject.endorse(notice, { pipelined: false }));
      assertEquals(hby.db.ksns.get([subject.kever!.said]), subject.kever!.state());
      yield* processCuesOnce(runtime, { hab: signer, queryCues });
      yield* task;
      assertEquals(completed, true, "the persisted valid notice supplies a target already met by accepted state");
    } finally {
      yield* task.halt();
      yield* runtime.close();
      yield* remote.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("sequence and anchor workflows preserve the seal snapshot and complete on accepted evidence", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), subject = remote.makeHab("subject");
    const messages: Uint8Array[] = [];
    const runtime = yield* createAgentRuntime(hby, queryHttp(messages), systemClock);
    try {
      yield* runtime.reactor.processBytes(acceptedEventReplayMessage(remote, subject.pre, 0).message);
      runtime.cues.clear();
      seedControllerEndpoint(hby, subject.pre);
      const original = { d: subject.kever!.said, s: "0", i: subject.pre };
      const expected = { i: subject.pre, s: "0", d: subject.kever!.said };
      let sequenceDone = false, anchorDone = false;
      const sequence = yield* spawn(function*() {
        yield* new SeqNoQuerier(hby.db, runtime.querying, subject.pre, 1, { signer: sender.pre }).queryDo();
        sequenceDone = true;
      });
      const anchor = yield* spawn(function*() {
        yield* new AnchorQuerier(hby.db, runtime.querying, subject.pre, original, { signer: sender.pre }).queryDo();
        anchorDone = true;
      });
      original.d = sender.pre;

      yield* runtime.querying.deliverOnce();
      assertEquals(messages.length, 2);
      const query = new SerderKERI({ raw: messages[1] }).ked?.q as { a: object };
      assertEquals(query.a, expected);
      assertEquals(Object.keys(query.a), ["i", "s", "d"]);
      assertEquals([sequenceDone, anchorDone], [false, false]);
      yield* runtime.reactor.processBytes(subject.interact({ data: [expected] }));

      yield* runtime.querying.deliverOnce();
      yield* sequence;
      yield* anchor;
      assertEquals([sequenceDone, anchorDone, runtime.querying.hasPendingWork()], [true, true, false]);
    } finally {
      yield* runtime.close();
      yield* remote.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("query preparation preserves a failed head and limits delivery to its initial work", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    seedControllerEndpoint(hby, hab.pre);
    const messages: Uint8Array[] = [];
    const inquisitor = new WitnessInquisitor(hby, protocolFixture(hby), queryHttp(messages), systemClock, hab);
    const request = { pre: hab.pre, src: hab.pre, route: "logs" as const, q: {} };
    const sign = hab.query, fault = new Error("signing failed");
    try {
      inquisitor.enqueue(request);
      const head = inquisitor.pending.peekHead();
      hab.query = () => {
        throw fault;
      };
      assertStrictEquals(yield* call(() => assertRejects(() => run(() => inquisitor.deliverOnce()))), fault);
      assertStrictEquals(inquisitor.pending.peekHead(), head);
      hab.query = function(...args) {
        inquisitor.enqueue(request);
        return sign.apply(this, args);
      };

      yield* inquisitor.deliverOnce();
      assertEquals([inquisitor.pending.length, inquisitor.hasPendingDelivery], [1, false]);
      assertEquals(messages.length, 1);
      hab.query = sign;

      yield* inquisitor.deliverOnce();
      assertEquals([messages.length, inquisitor.pending.length], [2, 0]);
    } finally {
      hab.query = sign;
      yield* inquisitor.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("anchor queries ask all eligible attesters once and stop on accepted seal state", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender"),
      first = hby.makeHab("first", undefined, { transferable: false, ncount: 0 }),
      second = hby.makeHab("second", undefined, { transferable: false, ncount: 0 });
    for (const attester of [first, second]) seedControllerEndpoint(hby, attester.pre);
    const messages: Uint8Array[] = [];
    const inquisitor = new WitnessInquisitor(hby, protocolFixture(hby), queryHttp(messages), systemClock, hab);
    const seal = { i: hab.pre, s: "0", d: hab.pre };
    const anchor = yield* spawn(() =>
      new AnchorQuerier(hby.db, inquisitor, hab.pre, seal, { wits: [first.pre, second.pre] }).queryDo()
    );
    try {
      yield* inquisitor.deliverOnce();

      yield* inquisitor.deliverOnce();
      assertEquals(
        messages.map((wire) => new SerderKERI({ raw: wire }).ked?.q),
        [first, second].map((attester) => ({ fn: "0", s: "0", a: seal, i: hab.pre, src: attester.pre })),
      );
      hab.interact({ data: [seal] });

      yield* anchor;
      assertEquals(messages.length, 2);
    } finally {
      yield* inquisitor.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("query command rejects malformed anchor files before opening a controller store", async () => {
  const root = await Deno.makeTempDir({ prefix: "query-anchor-" });
  const pre = "EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  try {
    for (
      const [value, error] of [
        [null, ValidationError],
        [[], ValidationError],
        [{}, ValidationError],
        [{ i: pre, s: "0" }, ValidationError],
        [{ i: pre, s: 0, d: pre }, ValidationError],
        [{ i: pre, s: "0", d: pre, extra: true }, ValidationError],
        [{ i: "", s: "0", d: pre }, ParserError],
        [{ i: pre, s: "not-hex", d: pre }, SyntaxError],
      ] as const
    ) {
      const anchor = `${root}/anchor.json`;
      await Deno.writeTextFile(anchor, JSON.stringify(value));
      await assertRejects(() =>
        run(() =>
          queryCommand({
            name: "unopened",
            alias: "controller",
            prefix: pre,
            headDirPath: `${root}/store`,
            anchor,
          })
        ), error);
      assertEquals((await Array.fromAsync(Deno.readDir(root))).map((entry) => entry.name), ["anchor.json"]);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ordinary inquiries randomly choose within the first eligible role and preserve explicit addressing", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const signer = hby.makeHab("signer"), subject = hby.makeHab("subject");
    const peers = ["controller-a", "controller-b", "agent"].map((name) => hby.makeHab(name));
    peers.forEach((peer, idx) => {
      hby.db.ends.pin([subject.pre, idx < 2 ? Roles.controller : Roles.agent, peer.pre], { allowed: true });
      hby.db.locs.pin([peer.pre, "http"], { url: `http://peer-${idx}.query.test/` });
    });
    const messages: Uint8Array[] = [], urls: string[] = [];
    const inquisitor = new WitnessInquisitor(hby, protocolFixture(hby), queryHttp(messages, urls), systemClock, signer);
    const random = Math.random;
    try {
      for (const fraction of [0, 0.999]) {
        // Exercise both selection boundaries without changing production randomness.
        Math.random = () => fraction;
        inquisitor.enqueue({ pre: subject.pre, route: "logs", q: {} });
        yield* inquisitor.deliverOnce();
      }
      Math.random = random;
      inquisitor.enqueue({ pre: subject.pre, src: peers[2].pre, route: "ksn", q: {} });
      inquisitor.enqueue({ pre: "unknown-subject", wits: [peers[2].pre], route: "logs", q: {} });

      yield* inquisitor.deliverOnce();
      const sent = messages.map((msg, index) => ({
        url: urls[index],
        src: (new SerderKERI({ raw: msg }).ked?.q as Record<string, unknown>).src,
      }));
      // Generated AIDs determine database order; both random extremes must select controllers.
      assertEquals(
        sent.slice(0, 2).sort((left, right) => left.url.localeCompare(right.url)),
        peers.slice(0, 2).map((peer, index) => ({ url: `http://peer-${index}.query.test/`, src: peer.pre })),
      );
      const addressed = { url: "http://peer-2.query.test/", src: peers[2].pre };
      assertEquals(sent.slice(2), [addressed, addressed]);
    } finally {
      Math.random = random;
      yield* inquisitor.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("selected roles keep missing locations visible instead of promoting another attester", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const signer = hby.makeHab("signer"), subject = hby.makeHab("subject"), agent = hby.makeHab("agent");
    hby.db.ends.pin([subject.pre, Roles.controller, subject.pre], { allowed: true });
    hby.db.ends.pin([subject.pre, Roles.agent, agent.pre], { allowed: true });
    hby.db.locs.pin([agent.pre, "http"], { url: "http://agent.query.test/" });
    const messages: Uint8Array[] = [];
    const inquisitor = new WitnessInquisitor(hby, protocolFixture(hby), queryHttp(messages), systemClock, signer);
    try {
      inquisitor.enqueue({ pre: subject.pre, route: "logs", q: {} });
      assertEquals(subject.endsFor(subject.pre)[Roles.controller], { [subject.pre]: {} });
      yield* call(() => assertRejects(() => run(() => inquisitor.deliverOnce()), ValidationError, "No endpoint URL"));
      assertEquals([inquisitor.pending.length, messages.length], [1, 0]);
      // A cut is retained in storage but excluded from routing; the agent can now answer.
      hby.db.ends.pin([subject.pre, Roles.controller, subject.pre], { allowed: false });

      yield* inquisitor.deliverOnce();
      assertEquals((new SerderKERI({ raw: messages[0] }).ked?.q as Record<string, unknown>).src, agent.pre);
    } finally {
      yield* inquisitor.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("query cues transfer once through the application owner after witness routing", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const witness = hby.makeHab("witness", undefined, { transferable: false, ncount: 0 });
    const subject = hby.makeHab("subject");
    const runtime = yield* createAgentRuntime(hby, queryHttp([]), systemClock);
    const queryCues = new Deck<AgentCue>();
    const notice: AgentCue = { kin: "keyStateSaved", ksn: subject.kever!.state() };
    const recovery: AgentCue = { kin: "query", pre: subject.pre, route: "logs", q: {} };
    try {
      runtime.cues.clear();
      runtime.cues.extend([notice, { kin: "receipt", serder: subject.kever!.serder }, recovery]);
      yield* drainWitnessCues(runtime, witness, runtime.cues);
      assertEquals(runtime.postman.evts.length, 1, "witness receipts still reach their output owner");
      assertEquals(runtime.querying.pending.length, 1, "recovery queries still reach their sender");
      assertEquals(
        runtime.cues.toArray(),
        [notice],
        "the witness drain leaves saved facts for the application cue owner",
      );
      yield* processCuesOnce(runtime, { hab: witness, queryCues });
      assertEquals(runtime.cues.empty, true);
      assertStrictEquals(queryCues.peekHead(), notice, "transfer the original record, without copying it");
      yield* processCuesOnce(runtime, { hab: witness, queryCues });
      assertEquals(queryCues.toArray(), [notice]);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("one noticer requeues unrelated and unavailable-state cues without blocking its caller", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), subject = remote.makeHab("subject");
    const runtime = yield* createAgentRuntime(hby, queryHttp([]), systemClock);
    const unrelated: AgentCue = { kin: "notice", serder: sender.kever!.serder };
    const otherSubject: AgentCue = { kin: "keyStateSaved", ksn: sender.kever!.state() };
    const notice: AgentCue = { kin: "keyStateSaved", ksn: subject.kever!.state() };
    const queryCues = new Deck<AgentCue>([unrelated, otherSubject, notice]);
    let completed = false;
    const task = yield* spawn(function*() {
      yield* new KeyStateNoticer(hby.db, runtime.querying, subject.pre, queryCues, { signer: sender.pre }).queryDo();
      completed = true;
    });
    try {
      // spawn starts its child through the first suspension: one head moved to the tail.
      assertEquals(queryCues.toArray(), [otherSubject, notice, unrelated]);
      yield* runtimeTurn();
      assertEquals(queryCues.toArray(), [notice, unrelated, otherSubject]);
      yield* runtimeTurn();
      assertEquals(queryCues.toArray(), [unrelated, otherSubject, notice]);
      assertEquals(completed, false, "matching notice remains usable when prerequisite KEL evidence arrives later");
      yield* runtime.reactor.processBytes(acceptedEventReplayMessage(remote, subject.pre, 0).message);
      yield* task;
      assertEquals(completed, true);
      assertEquals(queryCues.toArray(), [unrelated, otherSubject]);
    } finally {
      yield* task.halt();
      yield* runtime.close();
      yield* remote.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("query command fails its deadline when accepted evidence never arrives", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "query-deadline-" });
  try {
    let prefix = "";
    await run(function*() {
      const hby = yield* createHabery({ name: "deadline", headDirPath, temp: false, skipConfig: true });
      try {
        prefix = hby.makeHab("requester").pre;
      } finally {
        yield* hby.close();
      }
    });
    await assertRejects(
      () => run(() => queryCommand({ name: "deadline", alias: "requester", prefix, headDirPath })),
      ValidationError,
      "Query timed out before accepted evidence",
    );
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});
