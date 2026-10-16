import { call, resource, run, spawn, suspend } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { createAgentRuntime, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { CesrHttpRefusal } from "../../../src/app/cesr-egress.ts";
import { CueDelivery } from "../../../src/app/cue-delivery.ts";
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

Deno.test("cue delivery accepts ordinary routes and preserves source on resolution failure", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    const runtime = yield* createAgentRuntime(hby);
    const cue: AgentCue = { kin: "query", pre: hab.pre, src: hab.pre, route: "logs", q: {} };
    const cues = new Deck([cue]);
    const failure = new Error("endpoint lookup failed");
    try {
      const interpret = hab.interpretCue;
      hab.interpretCue = () => {
        throw failure;
      };
      assertStrictEquals(
        assertThrows(() =>
          runtime.deliveries.enqueueCue(hab, cues, () => {
            throw new Error("routing must follow interpretation");
          })
        ),
        failure,
      );
      assertStrictEquals(cues.peekHead(), cue);
      assertEquals(runtime.deliveries.hasPending, false);
      hab.interpretCue = interpret;
      assertStrictEquals(
        assertThrows(() =>
          runtime.deliveries.enqueueCue(hab, cues, () => {
            throw failure;
          })
        ),
        failure,
      );
      assertStrictEquals(cues.peekHead(), cue);
      assertEquals(runtime.deliveries.hasPending, false);
      const route = {
        sender: hab.pre,
        recipient: hab.pre,
        topic: "/reply",
        kind: "direct" as const,
        bodyMode: "header" as const,
        targets: [],
      };
      assertEquals(runtime.deliveries.enqueueCue(hab, cues, () => route), { kind: "prepared" });
      assertEquals([cues.empty, runtime.deliveries.hasPending], [true, false]);
      cues.push(cue);
      let resolutions = 0;
      assertEquals(
        runtime.deliveries.enqueueCue(hab, cues, () => {
          resolutions++;
          return {
            ...route,
            topic: "x".repeat(1024 ** 2),
            targets: Array.from({ length: 4097 }, () => ({ eid: hab.pre, url: "https://peer.test/" })),
          };
        }),
        { kind: "prepared" },
      );
      assertEquals([resolutions, cues.empty, runtime.deliveries.hasPending], [1, true, true]);
      const messages = {
        [Symbol.iterator](): Iterator<Uint8Array> {
          throw new Error("replay opened during queue publication");
        },
      };
      const replay = new Deck<AgentCue>([{ kin: "replay", messages }]);
      runtime.deliveries.enqueueCue(hab, replay, () => ({
        ...route,
        targets: [{ eid: hab.pre, url: "https://peer.test/" }],
      }));
      assertEquals(replay.empty, true);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("cue target preparation accepts wire views without backing quotas and closes its iterator", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    const runtime = yield* createAgentRuntime(hby);
    const wire = hab.query(hab.pre, hab.pre, { route: "logs", q: {} });
    const backing = new Uint8Array(9 * 1024 ** 2);
    backing.set(wire);
    let closed = 0;
    const messages = {
      *[Symbol.iterator]() {
        try {
          yield backing.subarray(0, wire.length);
        } finally {
          closed++;
        }
      },
    };
    const delivery = new CueDelivery({ cue: { kin: "replay", messages }, messages, kind: "wire" }, hab, {
      sender: hab.pre,
      recipient: hab.pre,
      topic: "/reply",
      kind: "direct",
      bodyMode: "header",
      targets: [{ eid: hab.pre, url: "https://peer.test/" }],
    });
    try {
      const prepared = delivery.prepareTarget(runtime.poster);
      if (prepared.kind !== "target" || prepared.target.kind !== "http") throw new Error("Expected HTTP packet");
      assertEquals(prepared.target.message, wire);
      assertEquals(delivery.prepareTarget(runtime.poster), prepared);
      assertEquals(closed, 0);
      delivery.release();
      delivery.release();
      assertEquals(closed, 1);
    } finally {
      delivery.release();
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
    const cue = { kin: "query" as const, pre: sender.pre, src: sender.pre, route: "logs" as const, q: {} };
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
      assertEquals(runtime.deliveries.enqueueCue(sender, runtime.cues, route), { kind: "prepared" });
      const query = sender.query(sender.pre, sender.pre, { route: "logs" as const, q: {} });
      for (let index = 0; index < 9; index++) {
        runtime.deliveries.enqueue({
          url: "https://query.test/",
          body: query,
          bodyMode: "header",
          destination: sender.pre,
        });
      }
      assertStrictEquals(
        yield* call(() => assertRejects(() => run(() => runtime.deliveries.process(runtime)))),
        failed,
      );
      assertEquals(runtime.deliveries.hasPending, true, "an unobserved typed transport failure preserves progress");
      failed = new Error("foreign transport busy");
      const previousTurns = preparationTurns;
      assertStrictEquals(
        yield* call(() => assertRejects(() => run(() => runtime.deliveries.process(runtime)))),
        failed,
      );
      assertEquals(runtime.deliveries.hasPending, true, "foreign failure preserves pending delivery");
      assertEquals(preparationTurns, previousTurns, "an exact packet retry cannot recapture protocol reply cues");
      injected = false;
      assertEquals(yield* runtime.deliveries.process(runtime), { retiredOwners: 9, pending: true });
      assertEquals(
        packets.query.length,
        9,
        "more than eight queued deliveries retain first-target failure and drain queries",
      );
      for (let pass = 0; pass < 4; pass++) yield* runtime.deliveries.process(runtime);
      assertEquals([packets.second.length, packets.third.length], [1, 1], "failed first target does not stop siblings");
      for (const wire of packets.first) assertEquals(wire, packets.first[0], "retries preserve the exact wire");
      injected = true;
      assertStrictEquals(
        yield* call(() => assertRejects(() => run(() => runtime.deliveries.process(runtime)))),
        failed,
      );
      injected = false;
      acceptFirst = true;
      assertEquals(yield* runtime.deliveries.process(runtime), { retiredOwners: 1, pending: false });

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
      runtime.deliveries.enqueueCue(sender, runtime.cues, () => ({ ...route(), targets: route().targets.slice(0, 1) }));
      injected = true;
      assertStrictEquals(
        yield* call(() => assertRejects(() => run(() => runtime.deliveries.process(runtime)))),
        failed,
      );
      runtime.deliveries.enqueue({
        url: "https://query.test/",
        body: query,
        bodyMode: "header",
        destination: sender.pre,
      });
      const attempts = packets.first.length;
      assertStrictEquals(yield* call(() => assertRejects(() => run(() => runtime.deliveries.close()))), cleanupFailure);
      assertEquals([runtime.deliveries.hasPending, returns], [false, 1]);
      yield* runtime.deliveries.close();
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
    runtime.cues.push({ kin: "query", pre: hab.pre, src: hab.pre, route: "logs" as const, q: {} });
    runtime.deliveries.enqueueCue(hab, runtime.cues, () => ({
      sender: hab.pre,
      recipient: hab.pre,
      topic: "/reply",
      kind: "direct",
      bodyMode: "header",
      targets: [{ eid: hab.pre, url: "https://peer.test/" }],
    }));
    const delivery = yield* spawn(function*() {
      try {
        yield* runtime.deliveries.process(runtime);
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
        yield* runtime.deliveries.close();
        closed = true;
      });
      assertEquals([guarded, closed, runtime.deliveries.hasPending], [true, false, true]);
      release();
      yield* closing;
      yield* delivery;
      assertEquals([closed, runtime.deliveries.hasPending], [true, false]);
    } finally {
      release();
      yield* delivery.halt();
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
