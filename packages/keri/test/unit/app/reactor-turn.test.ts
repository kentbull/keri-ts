import { call, run, spawn } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { ResourceLimitError } from "../../../../cesr/mod.ts";
import { abortable } from "../../../src/app/abortable.ts";
import type { AgentRuntime } from "../../../src/app/agent-runtime.ts";
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
      const replayA: ReplayCue = { kin: "replay", querySaid: "query-a", msgs: new Uint8Array([1]) };
      const replayB: ReplayCue = { kin: "replay", querySaid: "query-b", msgs: new Uint8Array([2]) };
      const ordinary: ReplayCue = { kin: "replay", msgs: new Uint8Array([3]) };
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
      reactor.cues.push({ kin: "replay", msgs: new Uint8Array([1]) });
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
      reactor.cues.push({ kin: "replay", msgs: new Uint8Array() });
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
              if (fillDuringFetch) reactor.cues.push({ kin: "replay", msgs: new Uint8Array() });
              return Promise.resolve(new Response(null, { status: 404 }));
            },
          },
        },
      });
      const url = "http://example.test/oobi";
      reactor.cues.push({ kin: "replay", msgs: new Uint8Array() });
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
