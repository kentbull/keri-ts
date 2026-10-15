import { ResourceAdmissionError, ResourceLimitError, ResourcePolicy } from "cesr-ts";
import { call, resource, run, spawn, suspend } from "effection";
import { assertEquals, assertObjectMatch, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { createAgentRuntime, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { CesrHttpRefusal } from "../../../src/app/cesr-egress.ts";
import { admitCueEmission, prepareCueEmission, type PreparedCueEmission } from "../../../src/app/cue-preparation.ts";
import { prepareCueRoute } from "../../../src/app/cue-route.ts";
import { type CueSink, processCuesOnce } from "../../../src/app/cue-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { CueDeck } from "../../../src/core/cue-admission.ts";
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
      const head = active.cues.peekHead(), before = active.resources.used.bytes;
      const occupied = active.resources.reserve({ bytes: active.resources.limits.bytes - before });
      if (occupied.kind !== "reserve") throw new Error("Expected remaining credit");
      yield* processRuntimeTurn(active, { sink });
      assertStrictEquals(active.cues.peekHead(), head, "busy preparation preserves the source head");
      occupied.reservation.release();
      yield* processRuntimeTurn(active, { sink });
      active.cues.extend([
        { kin: "stream", serder: event, pre: hab.pre, src: hab.pre, topics: { logs: 0 } },
        { kin: "oobiFailed", url: "http://127.0.0.1:9999/oobi/abc/controller", reason: "HTTP 404" },
      ]);
      const started = Promise.withResolvers<void>(), cleanup = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let held = 0;
      const draining = yield* spawn(() =>
        processRuntimeTurn(active, {
          sink: {
            *send(emission) {
              assertEquals(emission.kind, "transport");
              held = active.resources.used.bytes;
              assertEquals(held > before, true);
              yield* resource<void>(function*(provide) {
                try {
                  yield* provide();
                } finally {
                  cleanup.resolve();
                  yield* call(() => release.promise);
                  assertEquals(active.resources.used.bytes, held, "sink cleanup still owns input/output");
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
      assertEquals(active.resources.used.bytes, held);
      release.resolve();
      yield* halting;
      assertEquals(active.cues.length, 1);
      assertEquals(active.resources.used.bytes > 0, true, "the remaining cue retains its owner");
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
      assertEquals(active.resources.used.bytes, 0, "failed sink releases its transferred owner");
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

Deno.test("cue interpretation admits before transfer and retains evidence through joined cleanup", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `cue-preparation-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("interpreter");
      const cue: AgentCue = {
        kin: "reply",
        serder: replyEvent("/loc/scheme", { eid: hab.pre, scheme: "http", url: "http://localhost" }),
      };
      const resources = new ResourcePolicy();
      const ordinary = new Deck([cue], 1);
      const expected = hab.interpretCue(cue)!;
      const fault = new Error("destination admission failed");
      assertStrictEquals(
        assertThrows(() =>
          prepareCueEmission(hab, ordinary, resources, () => {
            throw fault;
          })
        ),
        fault,
      );
      assertStrictEquals(ordinary.peekHead(), cue);
      assertEquals(resources.used.bytes, 0);
      const occupied = resources.reserve({ bytes: resources.limits.bytes });
      if (occupied.kind !== "reserve") throw new Error("Expected free credit");
      const interpret = hab.interpretCue;
      let calls = 0;
      hab.interpretCue = (input) => {
        calls++;
        return interpret.call(hab, input);
      };
      try {
        const busy = admitCueEmission(hab, ordinary, resources, () => undefined);
        if (busy.kind !== "refuse") throw new Error("Expected byte capacity refusal");
        assertObjectMatch(busy, { kind: "refuse", error: { reason: "busy" } });
        const limit = assertThrows(
          () => prepareCueEmission(hab, ordinary, new ResourcePolicy({ bytes: 1 }), () => undefined),
          ResourceAdmissionError,
        );
        assertEquals(limit.reason, "limit");
        const combined = assertThrows(
          () => prepareCueEmission(hab, ordinary, new ResourcePolicy({ bytes: 32 * 1024 ** 2 }), () => undefined),
          ResourceAdmissionError,
        );
        assertEquals(combined.reason, "limit");
        const sourcePolicy = new ResourcePolicy({ bytes: 40 * 1024 ** 2 });
        const source = new CueDeck(sourcePolicy, 1);
        source.push({ kin: "replay", messages: [new Uint8Array(9 * 1024 ** 2)] });
        const sourceBytes = sourcePolicy.used.bytes;
        const ownedFloor = assertThrows(
          () => prepareCueEmission(hab, source, sourcePolicy, () => undefined),
          ResourceAdmissionError,
        );
        assertEquals(ownedFloor.reason, "limit");
        assertEquals(source.length, 1);
        assertEquals(sourcePolicy.used.bytes, sourceBytes);
        source.clear();
        assertEquals(sourcePolicy.used.bytes, 0);
        assertEquals(calls, 0);
        assertStrictEquals(ordinary.peekHead(), cue);
      } finally {
        occupied.reservation.release();
      }
      assertThrows(() =>
        prepareCueEmission(null, ordinary, resources, () => undefined, undefined, (emission) => ({
          ...emission,
          messages: [new Uint8Array(9 * 1024 ** 2)],
          kind: "wire",
        })), ResourceLimitError);
      assertStrictEquals(ordinary.peekHead(), cue);
      assertEquals(resources.used.bytes, 0, "transformed output remains subject to finite wire admission");
      const floorPolicy = new ResourcePolicy({ bytes: 33 * 1024 ** 2 }), floorDeck = new Deck<AgentCue>([cue]);
      let selected = 0;
      const floorError = assertThrows(() =>
        prepareCueEmission(hab, floorDeck, floorPolicy, (owner) => {
          prepareCueRoute(floorPolicy, owner, () => {
            selected++;
            throw fault;
          });
          return undefined;
        }), ResourceAdmissionError);
      assertEquals([floorError.reason, selected, floorPolicy.used.bytes], ["limit", 0, 0]);
      assertStrictEquals(floorDeck.peekHead(), cue);
      for (const deck of [ordinary, new CueDeck(resources, 1)]) {
        if (deck instanceof CueDeck) {
          deck.push(cue);
          assertThrows(
            () => prepareCueEmission(hab, deck, new ResourcePolicy(), () => undefined),
            RangeError,
            "exact policy",
          );
        }
        const retained = resources.used.bytes;
        const currentInterpretation = hab.interpretCue;
        hab.interpretCue = () => {
          throw fault;
        };
        assertStrictEquals(assertThrows(() => prepareCueEmission(hab, deck, resources, () => undefined)), fault);
        hab.interpretCue = currentInterpretation;
        assertStrictEquals(deck.peekHead(), cue);
        assertEquals(resources.used.bytes, retained);
        assertStrictEquals(
          assertThrows(() =>
            prepareCueEmission(hab, deck, resources, () => {
              throw fault;
            })
          ),
          fault,
        );
        assertStrictEquals(deck.peekHead(), cue);
        assertEquals(resources.used.bytes, retained, "failed transfer preserves source credit");
        const refusal = { kind: "refuse" as const, error: new ResourceAdmissionError("destination busy", "busy") };
        assertStrictEquals(admitCueEmission(hab, deck, resources, () => refusal), refusal);
        assertStrictEquals(deck.peekHead(), cue);
        assertEquals(resources.used.bytes, retained, "expected refusal restores source ownership too");
        let owner!: PreparedCueEmission;
        prepareCueEmission(hab, deck, resources, (prepared) => {
          owner = prepared;
          return undefined;
        });
        assertEquals(deck.length, 0);
        assertEquals(owner.emission?.kind, expected.kind);
        assertEquals(resources.used.bytes >= 8 * 1024 ** 2, true);
        const baseline = resources.used.bytes;
        let captures = 0;
        const resolve = () => {
          captures++;
          return {
            sender: hab.pre,
            recipient: hab.pre,
            topic: "/reply",
            kind: "direct" as const,
            bodyMode: "header" as const,
            targets: [{ eid: hab.pre, url: "https://peer.test/" }],
          };
        };
        assertThrows(() => prepareCueRoute(new ResourcePolicy(), owner, resolve), RangeError, "exact policy");
        const blocked = resources.reserve({ bytes: resources.limits.bytes - baseline });
        if (blocked.kind !== "reserve") throw new Error("Expected remaining credit");
        assertEquals(
          assertThrows(() => prepareCueRoute(resources, owner, resolve), ResourceAdmissionError).reason,
          "busy",
        );
        assertEquals(captures, 0, "refusal precedes endpoint acquisition");
        blocked.reservation.release();
        assertStrictEquals(
          assertThrows(() =>
            prepareCueRoute(resources, owner, () => {
              throw fault;
            })
          ),
          fault,
        );
        assertThrows(
          () =>
            prepareCueRoute(
              resources,
              owner,
              () => ({
                ...resolve(),
                targets: Array.from({ length: 4097 }, () => ({ eid: hab.pre, url: "https://peer.test/" })),
              }),
            ),
          ResourceLimitError,
        );
        assertThrows(
          () => prepareCueRoute(resources, owner, () => ({ ...resolve(), topic: "x".repeat(1024 ** 2) })),
          ResourceLimitError,
        );
        assertEquals(resources.used.bytes, baseline);
        const captured = prepareCueRoute(resources, owner, resolve);
        assertEquals([captured.route.targets.length, resources.used.bytes - baseline], [1, 1024 ** 2]);
        captured.release();
        captured.release();
        assertEquals(resources.used.bytes, baseline);
        assertThrows(() => captured.route, Error, "released");
        if (!(deck instanceof CueDeck)) {
          deck.push(cue);
          deck.pull();
        }
        const ready = Promise.withResolvers<void>(),
          returning = Promise.withResolvers<void>(),
          release = Promise.withResolvers<void>();
        const consuming = run(function*() {
          yield* resource<void>(function*(provide) {
            try {
              yield* provide();
            } finally {
              owner.release();
            }
          });
          yield* resource<void>(function*(provide) {
            try {
              yield* provide();
            } finally {
              returning.resolve();
              yield* call(() => release.promise);
            }
          });
          ready.resolve();
          yield* suspend();
        });
        try {
          yield* call(() => ready.promise);
          let joined = false;
          const halted = consuming.halt().then(() => joined = true);
          yield* call(() => returning.promise);
          assertEquals(joined, false);
          assertEquals(resources.used.bytes >= 8 * 1024 ** 2, true);
          release.resolve();
          yield* call(() => halted);
          assertEquals(resources.used.bytes, 0);
        } finally {
          release.resolve();
          yield* call(() => consuming.halt());
        }
        owner.release();
        assertThrows(() => owner.emission, Error, "released");
      }
      const replay = new Deck<AgentCue>([{ kin: "replay", messages: [Uint8Array.of(1)] }]);
      const messages = replay.peekHead()!.kin === "replay"
        ? (replay.peekHead() as Extract<AgentCue, { kin: "replay" }>).messages
        : [];
      const iterator = messages[Symbol.iterator];
      messages[Symbol.iterator] = () => {
        throw new Error("replay opened during admission");
      };
      try {
        prepareCueEmission(hab, replay, resources, (owner) => {
          assertStrictEquals(owner.emission!.messages, messages);
          queueMicrotask(() => owner.release());
          return undefined;
        });
        yield* call(() => Promise.resolve());
      } finally {
        messages[Symbol.iterator] = iterator;
      }
      assertEquals(resources.used.bytes, 0);
      const oversized = new Deck<AgentCue>([{ kin: "replay", messages: [new Uint8Array(8 * 1024 ** 2 + 1)] }]);
      assertThrows(() => prepareCueEmission(hab, oversized, resources, () => undefined), ResourceLimitError);
      assertEquals(oversized.length, 1);
      assertEquals(resources.used.bytes, 0);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("runtime cue delivery retains exact failed wire while admitted fanout and query owners progress", async () => {
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
      for (let index = 0; index < 7; index++) {
        runtime.deliveries.enqueue(() => ({
          url: "https://query.test/",
          body: query,
          bodyMode: "header",
          destination: sender.pre,
        }));
      }
      runtime.cues.push(cue);
      const full = runtime.deliveries.enqueueCue(sender, runtime.cues, route);
      if (full.kind !== "refuse") throw new Error("Expected occupied delivery queue");
      assertObjectMatch(full, { kind: "refuse", error: { message: "Deck capacity exceeded" } });
      assertEquals([runtime.cues.length, routes], [1, 1], "item refusal precedes interpretation/route acquisition");
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
      assertEquals(runtime.resources.used.bytes, retained, "foreign busy retains the prepared cue owner");
      assertEquals(preparationTurns, previousTurns, "an exact packet retry cannot recapture protocol reply cues");
      injected = false;
      assertEquals(yield* runtime.deliveries.process(runtime), { retiredOwners: 7, pending: true });
      assertEquals(
        packets.query.length,
        7,
        "the full eight-slot queue retains first-target failure and drains queries",
      );
      for (let pass = 0; pass < 4; pass++) yield* runtime.deliveries.process(runtime);
      assertEquals([packets.second.length, packets.third.length], [1, 1], "failed first target does not stop siblings");
      const original = runtime.cues instanceof CueDeck ? runtime.cues.takeOwned()! : undefined;
      if (!original) throw new Error("Expected admitted runtime source");
      assertStrictEquals(original.cue, cue, "the capacity-refused original cue is still present");
      original.release();
      assertEquals(runtime.resources.used.bytes, 24 * 1024 ** 2, "only independent failed packet credit remains");
      for (const wire of packets.first) assertEquals(wire, packets.first[0], "retries preserve the exact wire");
      injected = true;
      assertStrictEquals(
        yield* call(() => assertRejects(() => run(() => runtime.deliveries.process(runtime)))),
        failed,
      );
      assertEquals(runtime.resources.used.bytes, 24 * 1024 ** 2, "foreign busy retains the independent failed packet");
      injected = false;
      const occupied = runtime.resources.reserve({ streams: runtime.resources.limits.streams });
      if (occupied.kind !== "reserve") throw new Error("Expected free stream capacity");
      assertEquals(yield* runtime.deliveries.process(runtime), { retiredOwners: 0, pending: true });
      assertEquals(runtime.resources.used.bytes, 24 * 1024 ** 2, "engine busy retains the packet for a later pass");
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
      runtime.deliveries.enqueue(() => ({
        url: "https://query.test/",
        body: query,
        bodyMode: "header",
        destination: sender.pre,
      }));
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
      assertEquals([guarded, closed, runtime.resources.used.bytes >= 33 * 1024 ** 2], [true, false, true]);
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
