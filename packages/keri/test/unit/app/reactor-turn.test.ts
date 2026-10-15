import { call, run, spawn, suspend } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { ResourceAdmissionError, ResourceLimitError, ResourcePolicy } from "../../../../cesr/mod.ts";
import { abortable } from "../../../src/app/abortable.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { chunkBytes } from "../../../src/app/byte-source.ts";
import { processCuesOnce } from "../../../src/app/cue-runtime.ts";
import { FrameIntake } from "../../../src/app/frame-intake.ts";
import { acceptedEventReplayMessage, createHabery } from "../../../src/app/habbing.ts";
import { Oobiery } from "../../../src/app/oobiery.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { defaultRuntimeServices } from "../../../src/app/runtime-services.ts";
import type { AgentCue, ReplayCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";

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
      const runtime = { hby, reactor, cues: reactor.cues, resources: reactor.resources } as AgentRuntime;
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
      assertStrictEquals(first.takeAll()?.cues[0], replayA);
      assertStrictEquals(second.takeAll()?.cues[0], replayB);
      first.close();
      second.close();
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("cue delivery owns one initial batch even when delivery appends more work", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `cue-batch-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const reactor = new Reactor(hby);
      const runtime = { hby, reactor, cues: reactor.cues, resources: reactor.resources } as AgentRuntime;
      // Exercise both the fallback interpreter and the habitat interpreter with the same sink.
      for (const withHab of [false, true]) {
        const hab = withHab ? hby.makeHab("recipient") : undefined;
        reactor.cues.push({ kin: "oobiQueued", url: "https://example.test/first" });
        let delivered = 0;
        yield* processCuesOnce(runtime, {
          hab,
          sink: {
            *send() {
              delivered++;
              // A producer can append more work during delivery; the current turn keeps its initial extent.
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

Deno.test("queued cues do not prevent KEL acceptance or out-of-order escrow recovery", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: `cue-source-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const target = yield* createHabery({ name: `cue-target-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const sender = source.makeHab("sender");
      const initial = acceptedEventReplayMessage(source, sender.pre, 0).message;
      const later = sender.interact();
      const reactor = new Reactor(target);
      yield* reactor.process((signal) => chunkBytes(later, { signal }));
      assertEquals(reactor.resources.used, { bytes: 0, streams: 0, decryptions: 0 });
      assertEquals(Array.from(target.db.ooes.getTopItemIter()).length, 1);
      reactor.cues.clear();
      reactor.cues.push({ kin: "replay", messages: [new Uint8Array()] });
      yield* reactor.process((signal) => chunkBytes(initial, { signal }));
      yield* reactor.processEscrowsOnce();
      assertEquals(target.db.getKever(sender.pre)!.sn, 1);
      assertEquals(Array.from(target.db.ooes.getTopItemIter()).length, 0);
      assertEquals(reactor.cues.peekHead()?.kin, "replay", "existing cues remain ahead of new protocol cues");
    } finally {
      yield* target.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("OOBI result publication preserves cues appended during HTTP fetch", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `cue-oobi-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const reactor = new Reactor(hby);
      const oobi = new Oobiery(hby, reactor, {
        cues: reactor.cues,
        services: {
          ...defaultRuntimeServices,
          http: {
            fetch() {
              // Model another producer filling the shared queue while this request is suspended in transport.
              reactor.cues.push({ kin: "replay", messages: [new Uint8Array()] });
              return Promise.resolve(new Response(null, { status: 404 }));
            },
          },
        },
      });
      const url = "http://example.test/oobi";
      reactor.cues.push({ kin: "replay", messages: [new Uint8Array()] });
      oobi.resolve(url);
      yield* oobi.processOnce();
      assertEquals(hby.db.oobis.get(url), null);
      assertEquals(hby.db.eoobi.get(url)?.state, "http-404");
      assertEquals(reactor.cues.toArray().map((cue) => cue.kin), ["replay", "oobiQueued", "replay", "oobiFailed"]);
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

Deno.test("external intake and protocol processing share one source concurrency owner", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const target = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const resources = new ResourcePolicy();
    const intake = new FrameIntake(resources, undefined, 1);
    const reactor = new Reactor(target, { resources, intake });
    const sender = source.makeHab("sender");
    const wire = acceptedEventReplayMessage(source, sender.pre, 0).message;
    const acquired = gate();
    let opened = 0;
    const occupied = yield* spawn(function*() {
      yield* intake.frames(async function*() {
        opened++;
        yield wire;
      });
      acquired.open();
      yield* suspend();
    });
    try {
      yield* call(() => acquired.wait);
      assertEquals(opened, 0, "admitted parser channels remain demand driven");
      const failure = yield* call(() =>
        assertRejects(() =>
          run(() =>
            reactor.process(async function*() {
              opened++;
              yield wire;
            })
          ), ResourceAdmissionError)
      );
      assertEquals(failure.reason, "busy");
      assertEquals(opened, 0, "shared source refusal precedes either source factory");
      assertEquals(target.db.getKever(sender.pre), null);
      yield* occupied.halt();
      yield* reactor.process((signal) => chunkBytes(wire, { signal }));
      assertEquals(target.db.getKever(sender.pre)?.sn, 0);
      assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
    } finally {
      yield* occupied.halt();
      yield* target.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("queued ingress resumes after parser admission without waiting for cue delivery", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const target = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const sender = source.makeHab("sender");
      const wire = acceptedEventReplayMessage(source, sender.pre, 0).message;
      const resources = new ResourcePolicy({ streams: 2 });
      const reactor = new Reactor(target, { resources, maxSources: 1 });
      reactor.ingest(wire);
      const occupied = resources.reserve({ streams: 2 });
      assertEquals(occupied.kind, "reserve");
      if (occupied.kind !== "reserve") throw new Error("stream reservation failed");
      yield* reactor.processOnce();
      assertEquals(reactor.hasIngress, true, "temporary parser admission retains queued work");
      assertEquals(resources.used.bytes, wire.length);
      occupied.reservation.release();
      reactor.cues.push({ kin: "replay", messages: [new Uint8Array()] });
      yield* reactor.processOnce();
      assertEquals(target.db.getKever(sender.pre)!.sn, 0);
      assertEquals(reactor.hasIngress, false);
      assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
      const limited = new Reactor(target, { resources: new ResourcePolicy({ bytes: wire.length }) });
      limited.ingest(wire);
      yield* call(() => assertRejects(() => run(() => limited.processOnce()), ResourceAdmissionError, "limit"));
      assertEquals(limited.hasIngress, false, "a configuration refusal is terminal for this record");
      assertEquals(limited.resources.used.bytes, 0);
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
        throw new Error("late processing failure");
      };
      yield* call(() => assertRejects(() => run(() => reactor.processOnce()), Error, "late processing failure"));
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

Deno.test("runtime explicit close and scope exit release queued ingress and cue ownership", async () => {
  const resources = new ResourcePolicy();
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, resources });
    try {
      yield* call(function*() {
        const runtime = yield* createAgentRuntime(hby, { resources });
        runtime.reactor.ingest(new Uint8Array(4));
        runtime.cues.push({ kin: "oobiQueued", url: "https://peer.test/" });
        assertEquals(resources.used.bytes, 4, "only ingress bytes are accounted; queued cues are ordinary records");
        yield* runtime.close();
        assertEquals(resources.used.bytes, 0);
      });
      yield* call(function*() {
        const runtime = yield* createAgentRuntime(hby, { resources });
        runtime.reactor.ingest(new Uint8Array(4));
        runtime.cues.push({ kin: "oobiQueued", url: "https://peer.test/" });
        assertEquals(resources.used.bytes, 4, "only ingress bytes are accounted; queued cues are ordinary records");
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

Deno.test("OOBI CESR intake accepts before EOF and retains partial work through joined cancellation or failure", async () => {
  const scenarios = [
    ["complete", "application/cesr+json"],
    ["cancel", "application/json+cesr"],
    ["failure", "application/cesr"],
  ] as const;
  const cases = scenarios.flatMap(([mode, contentType]) => [
    [mode, contentType, false] as const,
    [mode, contentType, true] as const,
  ]);
  for (const [mode, contentType, separateCues] of cases) {
    await run(function*() {
      const source = yield* createHabery({
        name: `oobi-source-${crypto.randomUUID()}`,
        temp: true,
        skipConfig: true,
      });
      const target = yield* createHabery({
        name: `oobi-target-${crypto.randomUUID()}`,
        temp: true,
        skipConfig: true,
      });
      const resources = new ResourcePolicy();
      const reactor = new Reactor(target, { resources });
      const resultCues = separateCues ? new Deck<AgentCue>() : reactor.cues;
      const hab = source.makeHab("source");
      const first = acceptedEventReplayMessage(source, hab.pre, 0).message;
      hab.interact();
      const second = acceptedEventReplayMessage(source, hab.pre, 1).message;
      const accepted = gate(), next = gate(), cancelling = gate(), cleanup = gate();
      let offset = 0, cancelled = false, requests = 0, finished = false, failure: unknown;
      let signal: AbortSignal | undefined;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (offset < first.length) {
            controller.enqueue(first.slice(offset, offset + 7));
            offset += 7;
            return;
          }
          await next.wait;
          if (cancelled) return;
          controller.enqueue(mode === "failure" ? Uint8Array.of(255) : second);
          controller.close();
        },
        cancel() {
          cancelled = true;
          next.open();
          cancelling.open();
          return cleanup.wait;
        },
      }, { highWaterMark: 0 });
      const oobi = new Oobiery(target, reactor, {
        cues: resultCues,
        services: {
          ...defaultRuntimeServices,
          http: {
            fetch(_url, init) {
              requests++;
              signal = init?.signal ?? undefined;
              return Promise.resolve(
                new Response(requests === 1 ? body : new Blob([first.slice().buffer, second.slice().buffer]), {
                  headers: { "Content-Type": contentType },
                }),
              );
            },
          },
        },
      });
      assertStrictEquals(oobi.services.resources, resources);
      const processEvent = reactor.kevery.processEvent;
      reactor.kevery.processEvent = function(envelope) {
        const decision = processEvent.call(this, envelope);
        if (decision.kind === "accept" && envelope.serder.sn === 0) accepted.open();
        return decision;
      };
      const url = `http://oobi.test/oobi/${hab.pre}/controller`;
      oobi.resolve(url);
      resultCues.clear();
      reactor.cues.clear();
      const worker = yield* spawn(function*() {
        try {
          yield* oobi.processOnce();
        } catch (error) {
          if (mode !== "failure") throw error;
          failure = error;
        } finally {
          finished = true;
        }
      });
      try {
        // A regression to whole-response collection must fail promptly rather than hang merge CI.
        yield* call(() =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("OOBI event was not verified before EOF")), 2000);
            accepted.wait.then(() => {
              clearTimeout(timer);
              resolve();
            });
          })
        );
        assertEquals(target.db.getState(hab.pre)?.s, "0");
        assertEquals([finished, target.db.roobi.get(url), target.db.eoobi.get(url)], [false, null, null]);
        assertEquals(target.db.oobis.get(url)?.state, "queued");
        assertEquals(target.db.coobi.get(url)?.state, "streaming");
        assertEquals(resultCues.toArray().some((cue) => cue.kin === "oobiResolved"), false);
        if (mode === "cancel") {
          let haltFinished = false;
          const halted = yield* spawn(function*() {
            yield* worker.halt();
            haltFinished = true;
          });
          yield* call(() => cancelling.wait);
          assertEquals(resources.used.streams, 1, "The parser stream owner outlives body cleanup");
          assertEquals(haltFinished, false);
          yield* oobi.processOnce();
          assertEquals(requests, 1, "In-flight durable work cannot be fetched twice");
          cleanup.open();
          yield* halted;
        } else {
          next.open();
          yield* worker;
        }
        if (separateCues && mode === "complete") assertEquals(resultCues.pull()?.kin, "oobiResolved");
        assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
        assertEquals(signal?.aborted, true);
        assertEquals(target.db.coobi.get(url), null);
        if (mode === "complete") {
          assertEquals(target.db.getState(hab.pre)?.s, "1");
          assertEquals(target.db.oobis.get(url), null);
          assertEquals(target.db.roobi.get(url)?.state, "resolved");
        } else {
          assertEquals(mode === "failure" ? failure instanceof Error : failure === undefined, true);
          assertEquals(target.db.getState(hab.pre)?.s, "0", "Earlier independently accepted events survive");
          assertEquals(target.db.roobi.get(url), null);
          assertEquals(target.db.oobis.get(url)?.state, "queued");
          reactor.cues.clear();
          yield* oobi.processOnce();
          assertEquals(target.db.getState(hab.pre)?.s, "1");
          assertEquals(target.db.roobi.get(url)?.state, "resolved");
          assertEquals(target.db.oobis.get(url), null);
          if (separateCues) assertEquals(resultCues.pull()?.kin, "oobiResolved");
          assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
        }
      } finally {
        next.open();
        cleanup.open();
        yield* worker.halt();
        resultCues.clear();
        yield* target.close(true);
        yield* source.close(true);
      }
    });
  }
});

Deno.test("OOBI refusal precedes fetch or finite document reads and releases response ownership", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `oobi-admission-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      for (const document of [false, true]) {
        const resources = new ResourcePolicy({ bytes: 2 * 1024 ** 2 });
        const reactor = new Reactor(hby, { resources });
        let requests = 0, reads = 0, cancelled = false;
        const oobi = new Oobiery(hby, reactor, {
          cues: reactor.cues,
          services: {
            ...defaultRuntimeServices,
            http: {
              fetch() {
                requests++;
                return Promise.resolve(
                  document
                    ? new Response(
                      new ReadableStream<Uint8Array>({
                        pull() {
                          reads++;
                          throw new Error("Inadmissible JSON was read");
                        },
                        cancel() {
                          cancelled = true;
                        },
                      }, { highWaterMark: 0 }),
                      { headers: { "Content-Type": "application/schema+json" } },
                    )
                    : new Response(null, { status: 404 }),
                );
              },
            },
          },
        });
        const url = `http://admission.test/oobi?document=${document}`;
        oobi.resolve(url);
        reactor.cues.clear();
        const occupied = document ? undefined : resources.reserve({ bytes: resources.limits.bytes });
        if (occupied && occupied.kind !== "reserve") throw new Error("Expected occupied byte budget");
        let refusal: unknown;
        try {
          yield* call(() => oobi.processOnce());
        } catch (error) {
          refusal = error;
        }
        assertEquals(document ? refusal instanceof ResourceAdmissionError : refusal === undefined, true);
        if (document) assertEquals((refusal as ResourceAdmissionError).reason, "limit");
        assertEquals([requests, reads, cancelled], document ? [1, 0, true] : [0, 0, false]);
        assertEquals([hby.db.roobi.get(url), hby.db.coobi.get(url)], [null, null]);
        assertEquals(hby.db.oobis.get(url)?.state, "queued");
        if (occupied?.kind === "reserve") {
          occupied.reservation.release();
          yield* oobi.processOnce();
          assertEquals(hby.db.eoobi.get(url)?.state, "http-404");
          assertEquals(requests, 1);
        }
        assertEquals(resources.used, { bytes: 0, streams: 0, decryptions: 0 });
        hby.db.oobis.rem(url);
      }
    } finally {
      yield* hby.close(true);
    }
  });
});
