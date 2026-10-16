import { call, ensure, race, run, sleep, spawn, suspend } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { concatBytes, parseBytes } from "../../../../cesr/mod.ts";
import { abortable } from "../../../src/app/abortable.ts";
import { type AgentRuntime, createAgentRuntime, runAgentRuntimeUntil } from "../../../src/app/agent-runtime.ts";
import { chunkBytes } from "../../../src/app/byte-source.ts";
import { processCuesOnce } from "../../../src/app/cue-runtime.ts";
import { acceptedEventReplayMessage, createHabery } from "../../../src/app/habbing.ts";
import { Oobiery } from "../../../src/app/oobiery.ts";
import { queryEnvelopeFromDispatch } from "../../../src/app/parsering.ts";
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

Deno.test("finite runtime workers progress independently and join blocked HTTP cleanup on completion or deadline", async () => {
  for (const mode of ["complete", "deadline"] as const) {
    await run(function*() {
      const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const target = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const sender = source.makeHab("sender"), fetched = gate(), cancelling = gate(), cleanup = gate();
      let finished = false, failure: unknown;
      const runtime = yield* createAgentRuntime(target, {
        services: {
          http: {
            fetch() {
              fetched.open();
              return Promise.resolve(
                new Response(
                  new ReadableStream<Uint8Array>({
                    cancel() {
                      cancelling.open();
                      return cleanup.wait;
                    },
                  }),
                  { headers: { "Content-Type": "application/cesr" } },
                ),
              );
            },
          },
        },
      });
      runtime.oobiery.resolve(`http://blocked.test/oobi/${sender.pre}/controller`);
      const worker = yield* spawn(function*() {
        try {
          yield* runAgentRuntimeUntil(runtime, () => target.db.getKever(sender.pre) !== null, {
            pollMailbox: false,
            timeoutMs: mode === "deadline" ? 100 : 2000,
          });
        } catch (error) {
          failure = error;
        } finally {
          finished = true;
        }
      });
      try {
        yield* call(() => fetched.wait);
        if (mode !== "deadline") runtime.reactor.ingest(acceptedEventReplayMessage(source, sender.pre, 0).message);
        yield* race([
          call(() => cancelling.wait),
          call(function*() {
            yield* sleep(3000);
            throw new Error("runtime did not stop its blocked HTTP source");
          }),
        ]);
        assertEquals(finished, false, "the caller cannot resume before source cancellation joins");
        cleanup.open();
        yield* worker;
        assertEquals(finished, true);
        if (mode === "complete") {
          assertEquals(failure, undefined);
          assertEquals(target.db.getKever(sender.pre)?.sn, 0, "ingress progresses while OOBI input is blocked");
        } else {
          assertEquals(failure instanceof Error && failure.message, "Runtime did not converge within 100ms.");
        }
      } finally {
        cleanup.open();
        yield* worker.halt();
        yield* runtime.close();
        yield* target.close(true);
        yield* source.close(true);
      }
    });
  }
});

Deno.test("protocol processing waits for cancelled handler cleanup before the next pass", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `turn-cleanup-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const reactor = new Reactor(hby);
      const started = gate();
      const cleanup = gate();
      let second = false;
      let passes = 0;
      reactor.exchanger.processEscrows = function*() {
        if (++passes > 1) {
          second = true;
          return;
        }
        yield* abortable(async (signal) => {
          started.open();
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
          await cleanup.wait;
        });
      };
      const first = yield* spawn(() => reactor.processEscrowsOnce());
      yield* call(() => started.wait);
      const next = yield* spawn(() => reactor.processEscrowsOnce());
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
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby), reactor = runtime.reactor;
    const first = reactor.replies.reserve("query-a"), second = reactor.replies.reserve("query-b");
    const ready = gate(), release = gate();
    const replayA: ReplayCue = { kin: "replay", querySaid: "query-a", messages: [Uint8Array.of(1)] };
    const replayB: ReplayCue = { kin: "replay", querySaid: "query-b", messages: [Uint8Array.of(2)] };
    const ordinary: ReplayCue = { kin: "replay", messages: [Uint8Array.of(3)] };
    const seen: AgentCue[] = [];
    const observe = runtime.querying.observeCue.bind(runtime.querying);
    runtime.querying.observeCue = (cue) => {
      seen.push(cue);
      observe(cue);
    };
    try {
      reactor.exchanger.processEscrows = function*() {
        reactor.kevery.cues.push(replayB);
        ready.open();
        yield* call(() => release.wait);
        reactor.kevery.cues.push(ordinary);
        reactor.kevery.cues.push(replayA);
      };
      const producing = yield* spawn(() => reactor.processEscrowsOnce());
      yield* call(() => ready.wait);
      yield* processCuesOnce(runtime);
      assertEquals(seen, [], "unfinished protocol output is not exposed to application consumers");
      release.open();
      yield* producing;
      yield* processCuesOnce(runtime);
      assertEquals(seen, [ordinary]);
      assertStrictEquals(first.takeAll()?.cues[0], replayA);
      assertStrictEquals(second.takeAll()?.cues[0], replayB);
    } finally {
      first.close();
      second.close();
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("dispatch returns mailbox authorization from its exact protocol state", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const recipient = hby.makeHab("recipient"), reactor = new Reactor(hby);
      const [frame] = yield* call(() =>
        parseBytes(recipient.query(recipient.pre, recipient.pre, {
          route: "mbx",
          q: { topics: { "/reply": 0 } },
        }))
      );
      const result = yield* reactor.dispatch(frame);
      assertEquals(result.decision?.kind, "accept");
      assertEquals(result.mailboxQueryAuthorized, true);
      recipient.rotate();
      assertEquals(reactor.kevery.isMailboxQueryAuthorized(queryEnvelopeFromDispatch(result.envelope)), false);
      assertEquals(result.mailboxQueryAuthorized, true, "later key state cannot change this request's decision");
      const rejected = yield* reactor.dispatch(frame);
      assertEquals([rejected.decision?.kind, rejected.mailboxQueryAuthorized], ["drop", false]);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("cue routing keeps its initial extent when owner observation appends more work", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby);
    const observe = runtime.querying.observeCue.bind(runtime.querying);
    try {
      for (const withHab of [false, true]) {
        const hab = withHab ? hby.makeHab("recipient") : undefined;
        runtime.cues.push({ kin: "oobiQueued", url: "https://example.test/first" });
        let observed = 0;
        runtime.querying.observeCue = (cue) => {
          observed++;
          observe(cue);
          runtime.cues.push({ kin: "oobiQueued", url: "https://example.test/next" });
        };
        yield* processCuesOnce(runtime, { hab });
        assertEquals([observed, runtime.cues.length], [1, 1]);
        runtime.cues.clear();
        runtime.querying.observeCue = observe;
      }
    } finally {
      runtime.querying.observeCue = observe;
      yield* runtime.close();
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

Deno.test("queued ingress copies producer bytes and does not publish failed copies", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const reactor = new Reactor(hby);
      const producer = Uint8Array.of(1, 2);
      let received: Uint8Array | undefined;
      reactor.processBytes = function*(bytes) {
        received = bytes;
      };
      reactor.ingest(producer);
      producer.fill(0);
      yield* reactor.processOnce();
      assertEquals(received, Uint8Array.of(1, 2));
      const bytes = new Uint8Array(4);
      bytes.slice = () => {
        throw new Error("copy failed");
      };
      assertThrows(() => reactor.ingest(bytes), Error, "copy failed");
      assertEquals(reactor.hasIngress, false);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("queued ingress processes without waiting for cue delivery", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const target = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const sender = source.makeHab("sender");
      const wire = acceptedEventReplayMessage(source, sender.pre, 0).message;

      const reactor = new Reactor(target);
      reactor.ingest(wire);
      reactor.cues.push({ kin: "replay", messages: [new Uint8Array()] });
      yield* reactor.processOnce();
      assertEquals(target.db.getKever(sender.pre)!.sn, 0);
      assertEquals(reactor.hasIngress, false);
    } finally {
      yield* target.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("queued processing joins cancellation and does not reinsert failed records", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const reactor = new Reactor(hby);
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
      reactor.clearIngress();
      let joined = false;
      const halted = yield* spawn(function*() {
        yield* task.halt();
        joined = true;
      });
      yield* call(() => cleaning.wait);
      try {
        assertEquals(joined, false);
      } finally {
        cleanup.open();
      }
      yield* halted;
      assertEquals(joined, true);
      reactor.ingest(new Uint8Array(4));
      reactor.processBytes = function*() {
        reactor.clearIngress();
        throw new Error("late processing failure");
      };
      yield* call(() => assertRejects(() => run(() => reactor.processOnce()), Error, "late processing failure"));
      assertEquals(reactor.hasIngress, false);

      reactor.ingest(new Uint8Array(4));
      reactor.processBytes = function*() {
        throw new Error("processing failed");
      };
      yield* call(() => assertRejects(() => run(() => reactor.processOnce()), Error, "processing failed"));
      assertEquals(reactor.hasIngress, false);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("runtime explicit close and scope exit clear queued ingress and cues", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      let runtime!: AgentRuntime;
      for (const explicit of [true, false]) {
        yield* call(function*() {
          runtime = yield* createAgentRuntime(hby);
          runtime.reactor.ingest(new Uint8Array(4));
          runtime.cues.push({ kin: "oobiQueued", url: "https://peer.test/" });
          assertEquals(runtime.reactor.hasIngress, true);
          if (explicit) {
            yield* runtime.close();
            assertEquals([runtime.reactor.hasIngress, runtime.cues.length], [false, 0]);
          }
        });
        assertEquals([runtime.reactor.hasIngress, runtime.cues.length], [false, 0]);
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("input cancellation is owned before source construction", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const reactor = new Reactor(hby), failure = new Error("source construction failed");
      let invoked = false, sourceSignal: AbortSignal | undefined;
      const source = (signal: AbortSignal): AsyncIterable<Uint8Array> => {
        invoked = true;
        sourceSignal = signal;
        throw failure;
      };
      const stopped = AbortSignal.abort(new Error("input already stopped"));
      assertStrictEquals(
        yield* call(() => assertRejects(() => run(() => reactor.process(source, { signal: stopped })))),
        stopped.reason,
      );
      assertEquals(invoked, false);
      assertStrictEquals(yield* call(() => assertRejects(() => run(() => reactor.process(source)))), failure);
      assertEquals(sourceSignal?.aborted, true);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("external cancellation removes an input waiting for the protocol turn", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("sender"), reactor = new Reactor(hby);
      const bytes = acceptedEventReplayMessage(hby, hab.pre, 0).message;
      const held = gate(), release = gate(), queued = gate();
      const dispatch = reactor.dispatch;
      reactor.dispatch = function(frame, options) {
        queued.open();
        return dispatch.call(this, frame, options);
      };
      reactor.exchanger.processEscrows = function*() {
        held.open();
        yield* call(() => release.wait);
      };
      yield* call(async () => {
        const holder = run(() => reactor.processEscrowsOnce());
        await held.wait;
        const controller = new AbortController(), reason = new Error("input stopped while waiting");
        let dispatched = false, closed = false;
        const processEvent = reactor.kevery.processEvent;
        reactor.kevery.processEvent = function(envelope) {
          dispatched = true;
          return processEvent.call(this, envelope);
        };
        const input = run(() =>
          reactor.process(
            async function*() {
              try {
                yield concatBytes(bytes, bytes);
              } finally {
                closed = true;
              }
            },
            { signal: controller.signal },
          )
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await queued.wait;
          controller.abort(reason);
          const failure = await assertRejects(() =>
            Promise.race([
              input,
              new Promise<never>((_, reject) =>
                timer = setTimeout(() => reject(new Error("cancel waited for the turn")), 1000)
              ),
            ])
          );
          assertStrictEquals(failure, reason);
          assertEquals([dispatched, closed], [false, true]);
        } finally {
          clearTimeout(timer);
          await input.halt();
          release.open();
          await holder;
        }
        assertEquals(dispatched, false);
      });
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("input cancellation stops buffered dispatch and cannot become successful source EOF", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("sender"), reactor = new Reactor(hby);
      const bytes = acceptedEventReplayMessage(hby, hab.pre, 0).message;
      for (const endAtSource of [false, true]) {
        const controller = new AbortController(), reason = new Error("stop input");
        let dispatches = 0, closed = false;
        const processEvent = reactor.kevery.processEvent.bind(reactor.kevery);
        reactor.kevery.processEvent = (envelope) => {
          const decision = processEvent(envelope);
          dispatches++;
          controller.abort(reason);
          return decision;
        };
        const input = run(() =>
          reactor.process(
            async function*() {
              try {
                if (endAtSource) {
                  controller.abort(reason);
                  return;
                }
                yield concatBytes(bytes, bytes, bytes);
              } finally {
                closed = true;
              }
            },
            { signal: controller.signal },
          )
        );
        assertStrictEquals(yield* call(() => assertRejects(() => input)), reason);
        assertEquals([dispatches, closed], [endAtSource ? 0 : 1, true]);
        reactor.kevery.processEvent = processEvent;
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("stream cancellation joins the actual source cleanup", async () => {
  for (const fail of [false, true]) {
    const expected = fail ? new Error("late source cleanup failure") : undefined;
    let failure: unknown;
    try {
      await run(function*() {
        const hby = yield* createHabery({
          name: `stream-cleanup-${crypto.randomUUID()}`,
          temp: true,
          skipConfig: true,
        });
        try {
          const first = new Reactor(hby);
          const second = new Reactor(hby);
          const started = gate();
          const cleaning = gate();
          const cleanup = gate();
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
                // deno-lint-ignore no-unsafe-finally -- Inject a real cleanup failure after cancellation.
                if (fail) throw expected;
              }
            })
          );
          yield* call(() => started.wait);
          let opened = false;
          const source = async function*() {
            opened = true;
            yield new Uint8Array();
          };
          let joined = false;
          const halted = yield* spawn(function*() {
            yield* task.halt();
            joined = true;
          });
          yield* call(() => cleaning.wait);
          try {
            assertEquals(joined, false);
          } finally {
            cleanup.open();
          }
          yield* halted;
          yield* second.process(source);
          assertEquals(opened, true);
        } finally {
          yield* hby.close(true);
        }
      });
    } catch (error) {
      failure = error;
    }
    assertStrictEquals(failure, expected);
  }
});

Deno.test("input cancellation during dispatch joins source and handler cleanup without resuming the caller", async () => {
  for (const mode of ["clean", "source-failure", "handler-failure"] as const) {
    const expected = mode === "clean" ? undefined : new Error(mode);
    let failure: unknown;
    try {
      await run(function*() {
        const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
        try {
          const hab = hby.makeHab("sender");
          const bytes = acceptedEventReplayMessage(hby, hab.pre, 0).message;
          const started = gate(), cleaning = gate(), cleanup = gate();
          let resumed = false, joined = false, handlerClosed = false;
          const reactor = new Reactor(hby);
          reactor.exchanger.processEscrows = function*() {
            yield* ensure(function*() {
              handlerClosed = true;
              if (mode === "handler-failure") throw expected;
            });
            started.open();
            yield* suspend();
          };
          const task = yield* spawn(function*() {
            yield* reactor.process(
              async function*() {
                try {
                  yield concatBytes(bytes, bytes); // The second body closes the first without source EOF.
                  throw new Error("input read ahead of dispatch");
                } finally {
                  cleaning.open();
                  await cleanup.wait;
                  // deno-lint-ignore no-unsafe-finally -- Cleanup failure must survive dispatch cancellation.
                  if (mode === "source-failure") throw expected;
                }
              },
              { escrows: true },
            );
            resumed = true;
          });
          yield* call(() => started.wait);
          const halted = yield* spawn(function*() {
            yield* task.halt();
            joined = true;
          });
          yield* call(() => cleaning.wait);
          try {
            assertEquals([handlerClosed, joined, resumed], [true, false, false]);
          } finally {
            cleanup.open();
          }
          yield* halted;
          assertEquals([joined, resumed], [true, false]);
        } finally {
          yield* hby.close(true);
        }
      });
    } catch (error) {
      failure = error;
    }
    assertStrictEquals(failure, expected);
  }
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

      const reactor = new Reactor(target);
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
