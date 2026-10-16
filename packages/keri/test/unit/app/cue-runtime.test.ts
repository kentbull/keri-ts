import { call, resource, run, spawn, suspend } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { createAgentRuntime, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { CesrHttpRefusal } from "../../../src/app/cesr-egress.ts";
import { type CueSink, processCuesOnce } from "../../../src/app/cue-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
import { reply as replyEvent } from "../../../src/core/protocol-eventing.ts";

Deno.test("Cue runtime - processCuesOnce emits structured wire, notify, and transport cues", async () => {
  const name = `cue-runtime-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-cue-runtime-${crypto.randomUUID()}`;
  const emissions: Array<{ kind: string; messages: number; kin: string }> = [];

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const state = hby.db.getState(hab.pre)!;
      const said = state.d!;
      const event = hby.db.getEvtSerder(hab.pre, said)!;
      const runtime = yield* createAgentRuntime(hby);
      runtime.cues.push({
        kin: "receipt",
        serder: event,
      });
      runtime.cues.push({
        kin: "reply",
        serder: replyEvent("/loc/scheme", { eid: hab.pre, scheme: "http", url: "http://127.0.0.1:7723" }),
      });
      runtime.cues.push({
        kin: "query",
        pre: hab.pre,
        src: hab.pre,
        route: "ksn",
        q: {},
      });
      runtime.cues.push({
        kin: "stream",
        serder: event,
        pre: hab.pre,
        src: hab.pre,
        topics: { logs: 0 },
      });
      runtime.cues.push({
        kin: "keyStateSaved",
        ksn: state,
      });

      const sink: CueSink = {
        *send(emission) {
          emissions.push({
            kind: emission.kind,
            messages: [...emission.messages].length,
            kin: emission.cue.kin,
          });
        },
      };

      yield* processCuesOnce(runtime, { hab, sink });
    } finally {
      yield* hby.close();
    }
  });

  assertEquals(emissions, [
    { kind: "wire", messages: 1, kin: "receipt" },
    { kind: "wire", messages: 1, kin: "reply" },
    { kind: "wire", messages: 1, kin: "query" },
    { kind: "transport", messages: 0, kin: "stream" },
    { kind: "notify", messages: 0, kin: "keyStateSaved" },
  ]);
});

Deno.test("Cue runtime - runtime turn preserves cues without a local habitat interpreter", async () => {
  const name = `cue-runtime-fallback-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-cue-runtime-fallback-${crypto.randomUUID()}`;
  const emissions: Array<{ kind: string; kin: string }> = [];

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const state = hby.db.getState(hab.pre)!;
      const said = state.d!;
      const event = hby.db.getEvtSerder(hab.pre, said)!;
      hby.makeHab("bob", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const runtime = yield* createAgentRuntime(hby);
      runtime.cues.push({
        kin: "stream",
        serder: event,
        pre: hab.pre,
        src: hab.pre,
        topics: { logs: 0 },
      });
      runtime.cues.push({
        kin: "oobiFailed",
        url: "http://127.0.0.1:9999/oobi/abc/controller",
        reason: "HTTP 404",
      });

      const sink: CueSink = {
        *send(emission) {
          emissions.push({ kind: emission.kind, kin: emission.cue.kin });
        },
      };

      // The real default runtime owns both normal sends and cancellation through QueryCoordinator.
      const active = runtime;
      yield* processRuntimeTurn(active, { sink });
      active.cues.extend([
        { kin: "stream", serder: event, pre: hab.pre, src: hab.pre, topics: { logs: 0 } },
        { kin: "oobiFailed", url: "http://127.0.0.1:9999/oobi/abc/controller", reason: "HTTP 404" },
      ]);
      const started = Promise.withResolvers<void>(), cleanup = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const draining = yield* spawn(() =>
        processRuntimeTurn(active, {
          sink: {
            *send(emission) {
              assertEquals(emission.kind, "transport");
              yield* resource<void>(function*(provide) {
                try {
                  yield* provide();
                } finally {
                  cleanup.resolve();
                  yield* call(() => release.promise);
                  assertEquals(emission.kind, "transport", "emission remains available through joined cleanup");
                }
              });
              started.resolve();
              yield* suspend();
            },
          },
        })
      );
      yield* call(() => started.promise);
      // No outer host/query guard may serialize this turn behind the suspended sink.
      yield* active.reactor.settle();
      const halting = yield* spawn(() => draining.halt());
      yield* call(() => cleanup.promise);
      release.resolve();
      yield* halting;
      assertEquals(active.cues.length, 1);

      yield* processRuntimeTurn(active, { sink });

      active.cues.push({ kin: "oobiFailed", url: "http://peer.test/", reason: "gone" });
      const fault = new Error("foreign sink failure");
      yield* call(() =>
        assertRejects(
          () =>
            run(() =>
              processCuesOnce(active, {
                sink: {
                  *send() {
                    throw fault;
                  },
                },
              })
            ),
          Error,
          "foreign sink failure",
        )
      );
    } finally {
      yield* hby.close();
    }
  });

  assertEquals(emissions, [
    { kind: "transport", kin: "stream" },
    { kind: "notify", kin: "oobiFailed" },
    { kind: "notify", kin: "oobiFailed" },
  ]);
});

Deno.test("Respondant preserves source on interpretation/routing failure and opens replay only during delivery", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    const runtime = yield* createAgentRuntime(hby);
    const wire = hab.query(hab.pre, hab.pre, { route: "logs", q: {} });
    const cue: AgentCue = { kin: "replay", messages: [wire], src: hab.pre, dest: hab.pre };
    const cues = new Deck([cue]);
    const failure = new Error("endpoint lookup failed");
    const interpret = hab.interpretCue.bind(hab);
    const route = {
      sender: hab.pre,
      recipient: hab.pre,
      topic: "/reply",
      kind: "direct" as const,
      bodyMode: "header" as const,
      targets: [] as { eid: string; url: string }[],
    };
    try {
      hab.interpretCue = () => {
        throw failure;
      };
      runtime.poster.findBytesRoute = () => {
        throw new Error("routing must follow interpretation");
      };
      assertStrictEquals(assertThrows(() => runtime.respondant.enqueueCue(hab, cues)), failure);
      assertStrictEquals(cues.peekHead(), cue);
      assertEquals(runtime.respondant.hasPending, false);
      hab.interpretCue = interpret;
      runtime.poster.findBytesRoute = () => {
        throw failure;
      };
      assertStrictEquals(assertThrows(() => runtime.respondant.enqueueCue(hab, cues)), failure);
      assertStrictEquals(cues.peekHead(), cue);
      assertEquals(runtime.respondant.hasPending, false);
      runtime.poster.findBytesRoute = () => route;
      assertEquals(runtime.respondant.enqueueCue(hab, cues), true);
      assertEquals([cues.empty, runtime.respondant.hasPending], [true, false]);
      cues.push(cue);
      let resolutions = 0;
      runtime.poster.findBytesRoute = () => {
        resolutions++;
        return { ...route, targets: [{ eid: hab.pre, url: "https://peer.test/" }] };
      };
      assertEquals(runtime.respondant.enqueueCue(hab, cues), true);
      assertEquals([resolutions, cues.empty, runtime.respondant.hasPending], [1, true, true]);
      const messages = {
        [Symbol.iterator](): Iterator<Uint8Array> {
          throw new Error("replay opened during queue publication");
        },
      };
      const replay = new Deck<AgentCue>([{ kin: "replay", messages, src: hab.pre, dest: hab.pre }]);
      runtime.respondant.enqueueCue(hab, replay);
      assertEquals(replay.empty, true);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("Respondant retains a wire view across retry and closes its actual iterator once", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    const failure = new Error("transport unavailable");
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: {
          fetch: () => {
            throw failure;
          },
        },
      },
    });
    const wire = hab.query(hab.pre, hab.pre, { route: "logs", q: {} });
    const backing = new Uint8Array(9 * 1024 ** 2);
    backing.set(wire);
    let closed = 0, preparations = 0;
    const messages = {
      *[Symbol.iterator]() {
        try {
          yield backing.subarray(0, wire.length);
        } finally {
          closed++;
        }
      },
    };
    runtime.poster.findBytesRoute = () => ({
      sender: hab.pre,
      recipient: hab.pre,
      topic: "/reply",
      kind: "direct",
      bodyMode: "header",
      targets: [{ eid: hab.pre, url: "https://peer.test/" }],
    });
    const prepare = runtime.poster.prepareBytesTarget.bind(runtime.poster);
    runtime.poster.prepareBytesTarget = (...args) => {
      preparations++;
      const packet = prepare(...args);
      if (packet.kind !== "http") throw new Error("Expected HTTP packet");
      assertEquals(packet.message, wire);
      return packet;
    };
    try {
      runtime.cues.push({ kin: "replay", messages, src: hab.pre, dest: hab.pre });
      assertEquals(runtime.respondant.enqueueCue(hab, runtime.cues), true);
      for (let attempt = 0; attempt < 2; attempt++) {
        assertStrictEquals(yield* call(() => assertRejects(() => run(() => runtime.respondant.process()))), failure);
      }
      assertEquals([preparations, closed], [1, 0]);
      yield* runtime.respondant.close();
      yield* runtime.respondant.close();
      assertEquals(closed, 1);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("runtime cue delivery retains exact failed wire while other recipients and queries progress", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), second = hby.makeHab("second"), third = hby.makeHab("third");
    let failed: Error = new CesrHttpRefusal("injected transport failure", 503);
    let injected = true, acceptFirst = false, routes = 0;
    const packets: Record<string, Uint8Array[]> = { first: [], second: [], third: [], query: [] };
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: {
          async fetch(url, init) {
            const target = new URL(url).hostname.split(".")[0];
            packets[target].push(new Uint8Array(await new Response(init!.body).arrayBuffer()));
            if (target === "first" && injected) throw failed;
            return new Response(null, { status: target === "first" && !acceptFirst ? 503 : 204 });
          },
        },
      },
    });
    let preparationTurns = 0;
    const settle = runtime.reactor.settle.bind(runtime.reactor);
    runtime.reactor.settle = (...args) => {
      preparationTurns++;
      return settle(...args);
    };
    const cue = {
      kin: "replay" as const,
      messages: [sender.query(sender.pre, sender.pre, { route: "logs", q: {} })],
      src: sender.pre,
      dest: second.pre,
    };
    const route = () => {
      routes++;
      return {
        sender: sender.pre,
        recipient: second.pre,
        topic: "/reply",
        kind: "direct" as const,
        bodyMode: "header" as const,
        targets: [sender, second, third].map((hab, index) => ({
          eid: hab.pre,
          url: `https://${["first", "second", "third"][index]}.test/`,
        })),
      };
    };
    try {
      runtime.cues.push(cue);
      runtime.poster.findBytesRoute = route;
      assertEquals(runtime.respondant.enqueueCue(sender, runtime.cues), true);
      const query = sender.query(sender.pre, sender.pre, { route: "logs" as const, q: {} });
      for (let index = 0; index < 9; index++) {
        runtime.querying.enqueueDelivery({
          url: "https://query.test/",
          body: query,
          bodyMode: "header",
          destination: sender.pre,
        });
      }
      assertStrictEquals(
        yield* call(() => assertRejects(() => run(() => runtime.respondant.process()))),
        failed,
      );
      assertEquals(runtime.respondant.hasPending, true, "an unobserved typed transport failure preserves progress");
      failed = new Error("foreign transport busy");
      const previousTurns = preparationTurns;
      assertStrictEquals(
        yield* call(() => assertRejects(() => run(() => runtime.respondant.process()))),
        failed,
      );
      assertEquals(runtime.respondant.hasPending, true, "foreign failure preserves pending delivery");
      assertEquals(preparationTurns, previousTurns, "an exact packet retry cannot recapture protocol reply cues");
      injected = false;
      yield* runtime.respondant.process();
      assertEquals(runtime.respondant.hasPending, true);
      yield* runtime.querying.deliverOnce();
      assertEquals(runtime.querying.hasPendingDelivery, false);
      assertEquals(
        packets.query.length,
        9,
        "more than eight queued deliveries retain first-target failure and drain queries",
      );
      for (let pass = 0; pass < 4; pass++) yield* runtime.respondant.process();
      assertEquals([packets.second.length, packets.third.length], [1, 1], "failed first target does not stop siblings");
      for (const wire of packets.first) assertEquals(wire, packets.first[0], "retries preserve the exact wire");
      injected = true;
      assertStrictEquals(
        yield* call(() => assertRejects(() => run(() => runtime.respondant.process()))),
        failed,
      );
      injected = false;
      acceptFirst = true;
      yield* runtime.respondant.process();
      assertEquals(runtime.respondant.hasPending, false);

      const cleanupFailure = new Error("iterator cleanup failed");
      let returns = 0;
      const messages = [query], iterator = messages[Symbol.iterator].bind(messages);
      messages[Symbol.iterator] = () => {
        const source = iterator();
        return Object.assign(source, {
          return() {
            returns++;
            throw cleanupFailure;
          },
        });
      };
      runtime.cues.push({ kin: "replay", messages, src: sender.pre, dest: second.pre });
      runtime.poster.findBytesRoute = () => ({ ...route(), targets: route().targets.slice(0, 1) });
      runtime.respondant.enqueueCue(sender, runtime.cues);
      injected = true;
      assertStrictEquals(
        yield* call(() => assertRejects(() => run(() => runtime.respondant.process()))),
        failed,
      );
      runtime.querying.enqueueDelivery({
        url: "https://query.test/",
        body: query,
        bodyMode: "header",
        destination: sender.pre,
      });
      const attempts = packets.first.length;
      assertStrictEquals(yield* call(() => assertRejects(() => run(() => runtime.respondant.close()))), cleanupFailure);
      assertEquals([runtime.respondant.hasPending, returns], [false, 1]);
      yield* runtime.respondant.close();
      assertEquals(
        [packets.first.length, returns],
        [attempts, 1],
        "failed finalization cannot repeat transport or return",
      );
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("cue delivery releases its guarded turn but retains owners until HTTP cleanup joins", async () => {
  let cleaning!: () => void, release!: () => void;
  const cleanup = new Promise<void>((resolve) => cleaning = resolve);
  const gate = new Promise<void>((resolve) => release = resolve);
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: {
          async fetch(_url, init) {
            await new Response(init!.body).arrayBuffer();
            return new Response(
              new ReadableStream<Uint8Array>({
                async cancel() {
                  cleaning();
                  await gate;
                },
              }),
            );
          },
        },
      },
    });
    runtime.cues.push({
      kin: "replay",
      messages: [hab.query(hab.pre, hab.pre, { route: "logs", q: {} })],
      src: hab.pre,
      dest: hab.pre,
    });
    runtime.poster.findBytesRoute = () => ({
      sender: hab.pre,
      recipient: hab.pre,
      topic: "/reply",
      kind: "direct",
      bodyMode: "header",
      targets: [{ eid: hab.pre, url: "https://peer.test/" }],
    });
    runtime.respondant.enqueueCue(hab, runtime.cues);
    const delivery = yield* spawn(function*() {
      try {
        yield* runtime.respondant.process();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
      }
    });
    try {
      yield* call(() => cleanup);
      let guarded = false, closed = false;
      yield* runtime.reactor.settle(undefined, {}, function*() {
        guarded = true;
      });
      const closing = yield* spawn(function*() {
        yield* runtime.respondant.close();
        closed = true;
      });
      assertEquals([guarded, closed, runtime.respondant.hasPending], [true, false, true]);
      release();
      yield* closing;
      yield* delivery;
      assertEquals([closed, runtime.respondant.hasPending], [true, false]);
    } finally {
      release();
      yield* delivery.halt();
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
