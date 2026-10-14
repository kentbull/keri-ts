import { call, run, spawn } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { ResourceLimitError, ResourcePolicy } from "../../../../cesr/mod.ts";
import { abortable } from "../../../src/app/abortable.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { chunkBytes } from "../../../src/app/byte-source.ts";
import { processCuesOnce } from "../../../src/app/cue-runtime.ts";
import { acceptedEventReplayMessage, createHabery } from "../../../src/app/habbing.ts";
import { Oobiery } from "../../../src/app/oobiery.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { defaultRuntimeServices } from "../../../src/app/runtime-services.ts";
import type { AgentCue, ReplayCue } from "../../../src/core/cues.ts";
import { DeckFullError } from "../../../src/core/deck.ts";

/** Explicit test gates make turn ordering observable without timing sleeps. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

Deno.test("runtime turns retain admission until cancelled work finishes cleanup", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `turn-cleanup-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const reactor = new Reactor(hby, { maxSources: 1 });
      const started = gate();
      const cleanup = gate();
      let second = false;
      const first = yield* spawn(() =>
        reactor.settle(undefined, {}, function*() {
          yield* abortable(async (signal) => {
            started.open();
            await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
            await cleanup.wait;
          });
        })
      );
      yield* call(() => started.wait);
      const next = yield* spawn(() =>
        reactor.settle(undefined, {}, function*() {
          second = true;
        })
      );
      // One owner and one waiter fill admission; a third turn must fail without queueing.
      yield* call(() => assertRejects(() => run(() => reactor.settle()), ResourceLimitError));
      const halted = yield* spawn(() => first.halt());
      yield* call(() => Promise.resolve());
      assertEquals(second, false);
      cleanup.open();
      yield* halted;
      yield* next;
      assertEquals(second, true);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("two request reservations survive an interleaved background cue drain", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `turn-replies-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const reactor = new Reactor(hby);
      const first = reactor.replies.reserve("query-a");
      const second = reactor.replies.reserve("query-b");
      const ready = gate();
      const release = gate();
      const replayA: ReplayCue = { kin: "replay", querySaid: "query-a", messages: [new Uint8Array([1])] };
      const replayB: ReplayCue = { kin: "replay", querySaid: "query-b", messages: [new Uint8Array([2])] };
      const ordinary: ReplayCue = { kin: "replay", messages: [new Uint8Array([3])] };
      const seen: AgentCue[] = [];
      const runtime = { hby, reactor, cues: reactor.cues } as AgentRuntime;
      const producing = yield* spawn(() =>
        reactor.settle(undefined, {}, function*() {
          // These model deferred query results produced after another turn has already begun waiting.
          reactor.cues.push(replayB);
          ready.open();
          yield* call(() => release.wait);
          reactor.cues.push(ordinary);
          reactor.cues.push(replayA);
        })
      );
      yield* call(() => ready.wait);
      const background = yield* spawn(() =>
        processCuesOnce(runtime, {
          sink: {
            *send(emission) {
              seen.push(emission.cue);
            },
          },
        })
      );
      assertEquals(seen, []);
      release.open();
      yield* producing;
      yield* background;
      // The actual background consumer runs under the guard and captures both reservations first.
      assertEquals(seen, [ordinary]);
      assertStrictEquals(first.take(), replayA);
      assertStrictEquals(second.take(), replayB);
      first.close();
      second.close();
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("a full cue deck pauses escrow work but still permits a draining turn", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `turn-cue-limit-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const reactor = new Reactor(hby, { maxPendingCues: 1 });
      reactor.cues.push({ kin: "replay", messages: [new Uint8Array([1])] });
      // Existing durable work waits for delivery instead of terminating its background worker.
      yield* reactor.settle(undefined, { escrows: true });
      assertEquals(reactor.cues.length, 1);
      // Draining needs no new protocol admission, otherwise a full deck could never recover.
      yield* reactor.settle(undefined, {}, function*() {
        assertEquals(reactor.cues.pull()?.kin, "replay");
      });
      yield* reactor.settle(undefined, { escrows: true });
      assertEquals(reactor.cues.length, 0);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("cue delivery owns one initial batch even when delivery appends more work", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `cue-batch-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const reactor = new Reactor(hby, { maxPendingCues: 1 });
      const runtime = { hby, reactor, cues: reactor.cues } as AgentRuntime;
      // Exercise both the fallback interpreter and the habitat interpreter with the same bounded sink.
      for (const withHab of [false, true]) {
        const hab = withHab ? hby.makeHab("recipient") : undefined;
        reactor.cues.push({ kin: "oobiQueued", url: "https://example.test/first" });
        let delivered = 0;
        yield* processCuesOnce(runtime, {
          hab,
          sink: {
            *send() {
              delivered++;
              // The completed delivery frees one slot; a concurrent producer can refill it immediately.
              reactor.cues.push({ kin: "oobiQueued", url: "https://example.test/next" });
              yield* call(() => Promise.resolve());
            },
          },
        });
        assertEquals(delivered, 1);
        assertEquals(reactor.cues.length, 1);
        reactor.cues.clear();
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("cue capacity preserves unaccepted KEL and escrow retry ownership", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: `cue-source-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const target = yield* createHabery({ name: `cue-target-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const sender = source.makeHab("sender");
      const initial = acceptedEventReplayMessage(source, sender.pre, 0).message;
      const later = sender.interact();
      const reactor = new Reactor(target, { maxPendingCues: 4 });
      yield* reactor.process((signal) => chunkBytes(later, { signal }));
      assertEquals(Array.from(target.db.ooes.getTopItemIter()).length, 1);
      reactor.cues.clear();
      reactor.cues.push({ kin: "replay", messages: [new Uint8Array()] });
      // Even a partly filled deck cannot accept a transition whose complete cue batch may not fit.
      yield* call(() =>
        assertRejects(() => run(() => reactor.process((signal) => chunkBytes(initial, { signal }))), DeckFullError)
      );
      assertEquals(target.db.getKever(sender.pre), null);
      reactor.cues.clear();
      yield* reactor.process((signal) => chunkBytes(initial, { signal }));
      yield* reactor.processEscrowsOnce();
      assertEquals(target.db.getKever(sender.pre)!.sn, 0);
      assertEquals(Array.from(target.db.ooes.getTopItemIter()).length, 1);
      // Draining restores capacity; retry now accepts the interaction and only then removes its row.
      reactor.cues.clear();
      yield* reactor.processEscrowsOnce();
      assertEquals(target.db.getKever(sender.pre)!.sn, 1);
      assertEquals(Array.from(target.db.ooes.getTopItemIter()).length, 0);
      assertEquals(reactor.cues.length <= 4, true);
    } finally {
      yield* target.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("OOBI notification overload retains durable work until delivery frees capacity", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `cue-oobi-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const reactor = new Reactor(hby, { maxPendingCues: 1 });
      let fillDuringFetch = true;
      const oobi = new Oobiery(hby, reactor, {
        cues: reactor.cues,
        services: {
          ...defaultRuntimeServices,
          http: {
            fetch() {
              // Model another producer filling the shared queue while this request is suspended in transport.
              if (fillDuringFetch) reactor.cues.push({ kin: "replay", messages: [new Uint8Array()] });
              return Promise.resolve(new Response(null, { status: 404 }));
            },
          },
        },
      });
      const url = "http://example.test/oobi";
      reactor.cues.push({ kin: "replay", messages: [new Uint8Array()] });
      assertThrows(() => oobi.resolve(url), DeckFullError);
      assertEquals(hby.db.oobis.get(url), null);
      reactor.cues.clear();
      oobi.resolve(url);
      reactor.cues.clear();
      yield* oobi.processOnce();
      assertEquals(hby.db.oobis.get(url)?.state, "queued");
      assertEquals(hby.db.eoobi.get(url), null);
      reactor.cues.clear();
      fillDuringFetch = false;
      yield* oobi.processOnce();
      assertEquals(hby.db.oobis.get(url), null);
      assertEquals(hby.db.eoobi.get(url)?.state, "http-404");
      assertEquals(reactor.cues.peekHead()?.kin, "oobiFailed");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("queued ingress reserves shared bytes before copying and releases allocation failures", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const resources = new ResourcePolicy({ bytes: 4 });
      const first = new Reactor(hby, { resources }), second = new Reactor(hby, { resources });
      first.ingest(new Uint8Array(4));
      let copied = false;
      const bytes = new Uint8Array(4);
      bytes.slice = () => {
        copied = true;
        throw new Error("copy failed");
      };
      assertThrows(() => second.ingest(bytes), ResourceLimitError, "busy");
      assertEquals(copied, false);
      first.clearIngress();
      assertThrows(() => second.ingest(bytes), Error, "copy failed");
      assertEquals(resources.used.bytes, 0);
      assertEquals(second.hasIngress, false);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("queued retry retains its byte lease until a real cue-capacity retry completes", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const target = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const sender = source.makeHab("sender");
      const wire = acceptedEventReplayMessage(source, sender.pre, 0).message;
      const resources = new ResourcePolicy();
      const reactor = new Reactor(target, { resources, maxSources: 1, maxPendingCues: 4 });
      reactor.ingest(wire);
      reactor.cues.push({ kin: "replay", messages: [new Uint8Array()] });
      yield* reactor.processOnce();
      assertEquals(reactor.hasIngress, true);
      assertEquals(resources.used.bytes, wire.length);
      assertThrows(() => reactor.ingest(wire), ResourceLimitError, "queue is full");
      assertEquals(target.db.getKever(sender.pre), null);
      reactor.cues.clear();
      yield* reactor.processOnce();
      assertEquals(target.db.getKever(sender.pre)!.sn, 0);
      assertEquals(reactor.hasIngress, false);
      assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
    } finally {
      yield* target.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("queued processing holds local and shared capacity through joined cancellation and late retry", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const resources = new ResourcePolicy({ bytes: 16 });
      const reactor = new Reactor(hby, { resources, maxSources: 1, maxQueuedBytes: 4 });
      const started = gate(), cleaning = gate(), cleanup = gate();
      reactor.processBytes = function*() {
        yield* abortable(async (signal) => {
          started.open();
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
          cleaning.open();
          await cleanup.wait;
          signal.throwIfAborted();
        });
      };
      reactor.ingest(new Uint8Array(4));
      const task = yield* spawn(() => reactor.processOnce());
      yield* call(() => started.wait);
      assertEquals(reactor.hasIngress, false, "record transfers out of queued ownership before yielding");
      assertThrows(() => reactor.ingest(new Uint8Array(1)), ResourceLimitError);
      reactor.clearIngress();
      const halted = yield* spawn(() => task.halt());
      yield* call(() => cleaning.wait);
      try {
        assertEquals(resources.used.bytes, 4);
        assertThrows(() => reactor.ingest(new Uint8Array(1)), ResourceLimitError);
      } finally {
        cleanup.open();
      }
      yield* halted;
      assertEquals(resources.used.bytes, 0);
      reactor.ingest(new Uint8Array(4));
      reactor.processBytes = function*() {
        reactor.clearIngress();
        throw new DeckFullError("late retry");
      };
      yield* reactor.processOnce();
      assertEquals(reactor.hasIngress, false);
      assertEquals(resources.used.bytes, 0);
      reactor.ingest(new Uint8Array(4));
      reactor.processBytes = function*() {
        throw new Error("processing failed");
      };
      yield* call(() => assertRejects(() => run(() => reactor.processOnce()), Error, "processing failed"));
      assertEquals(resources.used.bytes, 0);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("runtime explicit close and scope exit release queued ingress ownership", async () => {
  const resources = new ResourcePolicy();
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      yield* call(function*() {
        const runtime = yield* createAgentRuntime(hby, { resources });
        runtime.reactor.ingest(new Uint8Array(4));
        yield* runtime.close();
        assertEquals(resources.used.bytes, 0);
      });
      yield* call(function*() {
        const runtime = yield* createAgentRuntime(hby, { resources });
        runtime.reactor.ingest(new Uint8Array(4));
        assertEquals(resources.used.bytes, 4);
      });
      assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("stream credit is shared before reads and held until cancelled source cleanup joins", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `stream-credit-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const resources = new ResourcePolicy({ streams: 1, bytes: 128 });
      const first = new Reactor(hby, { resources });
      const second = new Reactor(hby, { resources });
      const started = gate();
      const cleaning = gate();
      const cleanup = gate();
      const limits = { maxChunkBytes: 16, maxBufferedBytes: 64 };
      const task = yield* spawn(() =>
        first.process(async function*(signal) {
          try {
            started.open();
            await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
            signal.throwIfAborted();
            yield new Uint8Array();
          } finally {
            cleaning.open();
            await cleanup.wait;
          }
        }, limits)
      );
      yield* call(() => started.wait);
      let opened = false;
      const source = async function*() {
        opened = true;
        yield new Uint8Array();
      };
      assertEquals(resources.used, { bytes: 80, streams: 1, decryptions: 0 });
      yield* call(() => assertRejects(() => run(() => second.process(source, limits)), ResourceLimitError, "busy"));
      yield* call(() => assertRejects(() => run(() => second.process(source)), ResourceLimitError, "limit"));
      for (const maxBufferedBytes of [0, Infinity, Number.MAX_SAFE_INTEGER]) {
        yield* call(() =>
          assertRejects(() => run(() => second.process(source, { ...limits, maxBufferedBytes })), RangeError)
        );
      }
      assertEquals(opened, false);
      const halted = yield* spawn(() => task.halt());
      yield* call(() => cleaning.wait);
      assertEquals(resources.used.streams, 1);
      yield* call(() => assertRejects(() => run(() => second.process(source, limits)), ResourceLimitError, "busy"));
      cleanup.open();
      yield* halted;
      assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
      yield* second.process(source, limits);
      assertEquals(opened, true);
      assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
    } finally {
      yield* hby.close(true);
    }
  });
});
