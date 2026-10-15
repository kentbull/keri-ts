import { ResourceAdmissionError } from "cesr-ts";
import { call, resource, run, spawn, suspend } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { createAgentRuntime, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { CesrHttpRefusal } from "../../../src/app/cesr-egress.ts";
import { CueDelivery } from "../../../src/app/cue-delivery.ts";
import { prepareCueEmission } from "../../../src/app/cue-preparation.ts";
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
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
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
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
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
      assertEquals(active.resources.used.bytes, 0, "the remaining queued record holds no output credit");
      yield* processRuntimeTurn(active, { sink });
      assertEquals(active.resources.used.bytes, 0);
      active.cues.push({ kin: "oobiFailed", url: "http://peer.test/", reason: "gone" });
      const fault = new ResourceAdmissionError("foreign sink failure", "busy");
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
          ResourceAdmissionError,
          "foreign sink failure",
        )
      );
      assertEquals(active.resources.used.bytes, 0, "failed sink leaves no pending output");
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

Deno.test("cue interpretation publishes synchronously, preserves failures and leaves replay lazy", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("interpreter");
      const cue: AgentCue = {
        kin: "reply",
        serder: replyEvent("/loc/scheme", { eid: hab.pre, scheme: "http", url: "http://localhost" }),
      };
      const cues = new Deck([cue]);
      const fault = new Error("publication failed");
      const interpret = hab.interpretCue;
      hab.interpretCue = () => {
        throw fault;
      };
      assertStrictEquals(assertThrows(() => prepareCueEmission(hab, cues, () => undefined)), fault);
      assertStrictEquals(cues.peekHead(), cue);
      hab.interpretCue = interpret;
      assertStrictEquals(
        assertThrows(() =>
          prepareCueEmission(hab, cues, () => {
            throw fault;
          })
        ),
        fault,
      );
      assertStrictEquals(cues.peekHead(), cue);
      assertEquals(
        prepareCueEmission(hab, cues, (emission) => {
          assertStrictEquals(cues.peekHead(), cue, "publication precedes removal");
          assertEquals(emission?.kind, "wire");
          return undefined;
        }),
        true,
      );
      assertEquals(cues.empty, true);
      assertEquals(
        prepareCueEmission(hab, cues, () => {
          throw new Error("empty source published");
        }),
        false,
      );

      const wire = new Uint8Array(9 * 1024 ** 2);
      const messages = [wire];
      messages[Symbol.iterator] = () => {
        throw new Error("replay opened during preparation");
      };
      const replay = new Deck<AgentCue>([{ kin: "replay", messages }]);
      assertEquals(
        prepareCueEmission(hab, replay, (emission) => {
          assertStrictEquals(emission!.messages, messages);
          return undefined;
        }),
        true,
      );
      assertEquals(replay.empty, true);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("cue delivery accepts ordinary routes and preserves source on resolution failure", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const hab = hby.makeHab("sender");
    const runtime = yield* createAgentRuntime(hby, { mode: "local" });
    const cue: AgentCue = { kin: "query", pre: hab.pre, src: hab.pre, route: "logs", q: {} };
    const cues = new Deck([cue]);
    const failure = new Error("endpoint lookup failed");
    try {
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
    const runtime = yield* createAgentRuntime(hby, { mode: "local" });
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
      failed = new ResourceAdmissionError("foreign transport busy", "busy");
      const retained = runtime.resources.used.bytes, previousTurns = preparationTurns;
      assertStrictEquals(
        yield* call(() => assertRejects(() => run(() => runtime.deliveries.process(runtime)))),
        failed,
      );
      assertEquals(runtime.resources.used.bytes, retained, "foreign failure preserves pending delivery");
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
      const occupied = runtime.resources.reserve({ streams: runtime.resources.limits.streams });
      if (occupied.kind !== "reserve") throw new Error("Expected free stream capacity");
      assertEquals(yield* runtime.deliveries.process(runtime), { retiredOwners: 0, pending: true });
      occupied.reservation.release();
      acceptFirst = true;
      assertEquals(yield* runtime.deliveries.process(runtime), { retiredOwners: 1, pending: false });
      assertEquals(runtime.resources.used.bytes, 0);

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
      assertEquals([runtime.deliveries.hasPending, runtime.resources.used.bytes, returns], [false, 0, 1]);
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
      assertEquals([guarded, closed, runtime.resources.used.bytes > 0], [true, false, true]);
      release();
      yield* closing;
      yield* delivery;
      assertEquals([closed, runtime.deliveries.hasPending, runtime.resources.used.bytes], [true, false, 0]);
    } finally {
      release();
      yield* delivery.halt();
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
