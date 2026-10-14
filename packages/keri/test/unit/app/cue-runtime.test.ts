import { ResourceAdmissionError, ResourceLimitError, ResourcePolicy } from "cesr-ts";
import { call, resource, run, suspend } from "effection";
import { assertEquals, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { createAgentRuntime, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { prepareCueEmission, type PreparedCueEmission } from "../../../src/app/cue-preparation.ts";
import { prepareCueRoute } from "../../../src/app/cue-route.ts";
import { type CueSink, processCuesOnce } from "../../../src/app/cue-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { CueDeck } from "../../../src/core/cue-admission.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";

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
        route: "/loc/scheme",
        data: { eid: hab.pre, scheme: "http", url: "http://127.0.0.1:7723" },
      });
      runtime.cues.push({
        kin: "query",
        pre: hab.pre,
        src: hab.pre,
        route: "ksn",
        query: {},
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

      yield* processRuntimeTurn(runtime, { sink });
    } finally {
      yield* hby.close();
    }
  });

  assertEquals(emissions, [
    { kind: "transport", kin: "stream" },
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
        route: "/loc/scheme",
        data: { eid: hab.pre, scheme: "http", url: "http://localhost" },
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
        const busy = assertThrows(
          () => prepareCueEmission(hab, ordinary, resources, () => undefined),
          ResourceAdmissionError,
        );
        assertEquals(busy.reason, "busy");
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
