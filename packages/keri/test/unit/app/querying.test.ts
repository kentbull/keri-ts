import { call, run } from "effection";
import { assert, assertEquals, assertExists, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { parseBytes, ParserError, SerderKERI } from "../../../../cesr/mod.ts";
import {
  createAgentRuntime,
  runAgentRuntimeUntil,
  runtimeHasPendingWork,
  runtimeOobiConverged,
  runtimePendingState,
} from "../../../src/app/agent-runtime.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { queryCommand } from "../../../src/app/cli/query.ts";
import { processCuesOnce } from "../../../src/app/cue-runtime.ts";
import { acceptedEventReplayMessage, createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { envelopeFromFrame, queryEnvelopeFromDispatch } from "../../../src/app/parsering.ts";
import { type AnchorQuerier, QueryCoordinator } from "../../../src/app/querying.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { defaultRuntimeClock, type RuntimeServices } from "../../../src/app/runtime-services.ts";
import type { QueryCue, QueryInstruction, QueryRequest, TelQueryCue } from "../../../src/core/cues.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { Roles } from "../../../src/core/roles.ts";
import { protocolFixture } from "../../protocol-fixture.ts";

// @ts-expect-error There is one query body; the legacy alias cannot coexist with q.
void ({ kin: "query", pre: "aid", route: "logs", q: {}, query: {} } satisfies QueryCue);
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
// @ts-expect-error Recovery sequences use the canonical wire filter s.
void ({ route: "logs", q: { sn: "1" } } satisfies QueryInstruction);
// @ts-expect-error The route is authoritative; there is no redundant body route.
void ({ route: "logs", q: { r: "logs" } } satisfies QueryInstruction);
// @ts-expect-error Queued work identifies its signer instead of retaining a component.
void ({ pre: "aid", route: "logs", q: {}, hab: {} } satisfies QueryRequest);
// @ts-expect-error A schema notice is not a signed outbound request.
void ({ kin: "query", signer: "aid", q: { r: "schema", said: "schema" } } satisfies QueryCue);
// @ts-expect-error TEL recovery must identify its registry and credential.
void ({ kin: "telquery", q: { i: "credential" } } satisfies TelQueryCue);
// @ts-expect-error Anchor queries require the event digest, not an optional payload bag.
void ({ i: "prefix", s: "0" } satisfies ConstructorParameters<typeof AnchorQuerier>[1]);
// @ts-expect-error Event-seal ordinals are hex text; credential KEL anchors use another shape.
void ({ i: "prefix", s: 0, d: "digest" } satisfies ConstructorParameters<typeof AnchorQuerier>[1]);
// @ts-expect-error Event seals have no diagnostic extension slot.
void ({ i: "prefix", s: "0", d: "digest", extra: true } satisfies ConstructorParameters<typeof AnchorQuerier>[1]);

/** Capture actual HTTP query wire after production framing; introductions are not queries. */
function queryHttp(messages: Uint8Array[], urls: string[] = []): RuntimeServices {
  return {
    clock: defaultRuntimeClock,
    http: {
      async fetch(url, init) {
        const bytes = await readCesrRequestBytes(new Request(url, init));
        const serder = new SerderKERI({ raw: bytes });
        if (serder.ilk === "qry") {
          messages.push(bytes);
          urls.push(url);
        }
        return new Response(null, { status: 204 });
      },
    },
  };
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

Deno.test("default runtime sends queued and cue queries through its concrete owner without host sink wiring", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), subject = hby.makeHab("subject");
    const messages: Uint8Array[] = [];
    seedControllerEndpoint(hby, subject.pre);
    const runtime = yield* createAgentRuntime(hby, { services: queryHttp(messages) });
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
      assertEquals(messages.map((wire) => new SerderKERI({ raw: wire }).route), ["ksn", "logs"]);
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
    const coordinator = new QueryCoordinator(hby, {
      reactor: new Reactor(protocolFixture(hby)),
      services: queryHttp(messages),
      hab: ambient,
    });
    try {
      const request = { pre: subject.pre, signer: selected.pre, src: subject.pre, route: "logs" as const, q: {} };
      coordinator.enqueue(request);
      const pending = coordinator.pending.peekHead();
      hby.habs.delete(selected.pre);
      yield* coordinator.processPending();
      assertStrictEquals(coordinator.pending.peekHead(), pending);
      assertEquals(coordinator.hasPendingDelivery, false);
      hby.habs.set(selected.pre, selected);
      yield* coordinator.processPending();
      coordinator.enqueueCue({ kin: "query", ...request }, ambient);
      yield* coordinator.deliverOnce();
      assertEquals([messages.length, coordinator.pending.length], [2, 0]);
      for (const message of messages) yield* call(() => assertQuerySigner(message, selected));
    } finally {
      yield* coordinator.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("unrouted notices create no requests; ambiguous identities and missing endpoints remain deferred", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), subject = hby.makeHab("subject");
    const messages: Uint8Array[] = [];
    const runtime = yield* createAgentRuntime(hby, { services: queryHttp(messages) });
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
      yield* runtime.querying.processPending();
      assertStrictEquals(runtime.querying.pending.peekHead(), pending);
      assertEquals(messages.length, 0);
      seedControllerEndpoint(hby, subject.pre);
      yield* runtime.querying.processPending();
      yield* runtime.querying.deliverOnce();
      assertEquals([runtime.querying.pending.length, messages.length], [0, 1]);
      yield* call(() => assertQuerySigner(messages[0], sender));
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("mailbox-only query transport retains the controller as attester", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"),
      subject = hby.makeHab("subject"),
      mailbox = hby.makeHab("mailbox", undefined, { transferable: false, ncount: 0 });
    hby.db.locs.pin([mailbox.pre, "http"], { url: "http://mailbox.test/" });
    hby.db.ends.pin([subject.pre, Roles.mailbox, mailbox.pre], { allowed: true });
    const messages: Uint8Array[] = [], urls: string[] = [];
    const runtime = yield* createAgentRuntime(hby, { services: queryHttp(messages, urls) });
    try {
      runtime.cues.push({ kin: "query", pre: subject.pre, route: "logs", q: {} });
      yield* processCuesOnce(runtime, { hab: sender });
      yield* runtime.querying.deliverOnce();
      assertEquals(urls, ["http://mailbox.test/"]);
      assertEquals(new SerderKERI({ raw: messages[0] }).ked?.q, { i: subject.pre, src: subject.pre });
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
    const runtime = yield* createAgentRuntime(hby, { services: queryHttp(messages) });
    try {
      yield* runtime.reactor.processBytes(acceptedEventReplayMessage(remote, subject.pre, 0).message);
      runtime.cues.clear();
      seedControllerEndpoint(hby, subject.pre);
      const resolvedUrl = "http://controller.test/oobi";
      hby.db.roobi.pin(resolvedUrl, {
        date: new Date().toISOString(),
        state: "resolved",
        cid: subject.pre,
        role: Roles.controller,
      });
      runtime.querying.configure({ hab: sender });
      const current = runtime.querying.watchKeyState(subject.pre, { signer: sender.pre });
      yield* processCuesOnce(runtime, { hab: sender });
      yield* runtime.querying.processPending();
      yield* runtime.querying.deliverOnce();
      assertEquals(new SerderKERI({ raw: messages[0] }).route, "ksn");
      runtime.cues.push({ kin: "keyStateSaved", ksn: subject.kever!.state() });
      yield* processCuesOnce(runtime, { hab: sender });
      yield* runtime.querying.processPending();
      yield* runtime.querying.deliverOnce();
      assertEquals([current.done, messages.length], [true, 1]);
      const ahead = runtime.querying.watchKeyState(subject.pre, { signer: sender.pre });
      yield* processCuesOnce(runtime, { hab: sender });
      yield* runtime.querying.processPending();
      yield* runtime.querying.deliverOnce();
      const interaction = subject.interact();
      runtime.cues.push({ kin: "keyStateSaved", ksn: subject.kever!.state() });
      yield* processCuesOnce(runtime, { hab: sender });
      yield* runtime.querying.processPending();
      yield* runtime.querying.deliverOnce();
      assertEquals(messages.map((wire) => new SerderKERI({ raw: wire }).route), ["ksn", "ksn", "logs"]);
      assertEquals([
        ahead.done,
        runtimePendingState(runtime).queriesPending,
        runtimeHasPendingWork(runtime),
        runtimeOobiConverged(runtime, resolvedUrl),
      ], [false, true, true, false]);
      yield* runtime.reactor.processBytes(interaction);
      yield* processCuesOnce(runtime, { hab: sender });
      yield* runtime.querying.processPending();
      yield* runtime.querying.deliverOnce();
      assertEquals(runtimePendingState(runtime).deliveriesPending, true);
      assertEquals([ahead.done, runtime.querying.hasPendingWork(), runtimeOobiConverged(runtime, resolvedUrl)], [
        true,
        false,
        true,
      ]);
    } finally {
      yield* runtime.close();
      yield* remote.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("sequence and anchor continuations preserve the seal snapshot and complete on accepted evidence", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), subject = remote.makeHab("subject");
    const messages: Uint8Array[] = [];
    const runtime = yield* createAgentRuntime(hby, { services: queryHttp(messages) });
    try {
      yield* runtime.reactor.processBytes(acceptedEventReplayMessage(remote, subject.pre, 0).message);
      runtime.cues.clear();
      seedControllerEndpoint(hby, subject.pre);
      const original = { d: subject.kever!.said, s: "0", i: subject.pre };
      const expected = { i: subject.pre, s: "0", d: subject.kever!.said };
      const sequence = runtime.querying.watchSeqNo(subject.pre, 1, { signer: sender.pre });
      const anchor = runtime.querying.watchAnchor(subject.pre, original, { signer: sender.pre });
      original.d = sender.pre;
      yield* runtime.querying.processPending();
      yield* runtime.querying.deliverOnce();
      assertEquals(messages.length, 2);
      const query = new SerderKERI({ raw: messages[1] }).ked?.q as { a: object };
      assertEquals(query.a, expected);
      assertEquals(Object.keys(query.a), ["i", "s", "d"]);
      assertEquals([sequence.done, anchor.done], [false, false]);
      yield* runtime.reactor.processBytes(subject.interact({ data: [expected] }));
      yield* runtime.querying.processPending();
      yield* runtime.querying.deliverOnce();
      assertEquals([sequence.done, anchor.done, runtime.querying.hasPendingWork()], [true, true, false]);
    } finally {
      yield* runtime.close();
      yield* remote.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("query preparation retains failed heads and limits one pass to its initial work", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    seedControllerEndpoint(hby, hab.pre);
    const messages: Uint8Array[] = [];
    const coordinator = new QueryCoordinator(hby, {
      reactor: new Reactor(protocolFixture(hby)),
      hab,
      services: queryHttp(messages),
    });
    const request = { pre: hab.pre, src: hab.pre, route: "logs" as const, q: {} };
    const sign = hab.query, fault = new Error("signing failed");
    try {
      coordinator.enqueue(request);
      const head = coordinator.pending.peekHead();
      hab.query = () => {
        throw fault;
      };
      assertStrictEquals(yield* call(() => assertRejects(() => run(() => coordinator.processPending()))), fault);
      assertStrictEquals(coordinator.pending.peekHead(), head);
      hab.query = function(...args) {
        coordinator.enqueue(request);
        return sign.apply(this, args);
      };
      yield* coordinator.processPending();
      assertEquals([coordinator.pending.length, coordinator.hasPendingDelivery], [1, true]);
      hab.query = sign;
      yield* coordinator.deliverOnce();
      assertEquals(messages.length, 1);
      yield* coordinator.processPending();
      yield* coordinator.deliverOnce();
      assertEquals([messages.length, coordinator.pending.length], [2, 0]);
    } finally {
      hab.query = sign;
      yield* coordinator.close();
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
    const coordinator = new QueryCoordinator(hby, {
      reactor: new Reactor(protocolFixture(hby)),
      hab,
      services: queryHttp(messages),
    });
    const seal = { i: hab.pre, s: "0", d: hab.pre };
    const anchor = coordinator.watchAnchor(hab.pre, seal, { wits: [first.pre, second.pre] });
    try {
      yield* coordinator.processPending();
      yield* coordinator.deliverOnce();
      yield* coordinator.processPending();
      yield* coordinator.deliverOnce();
      assertEquals(
        messages.map((wire) => new SerderKERI({ raw: wire }).ked?.q),
        [first, second].map((attester) => ({ fn: "0", s: "0", a: seal, i: hab.pre, src: attester.pre })),
      );
      hab.interact({ data: [seal] });
      yield* coordinator.processPending();
      assertEquals([anchor.done, messages.length], [true, 2]);
    } finally {
      yield* coordinator.close();
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
