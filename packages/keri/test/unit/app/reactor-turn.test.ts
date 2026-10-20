import { call, ensure, race, run, sleep, spawn, suspend } from "effection";
import { assertEquals, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import { concatBytes, parseBytes } from "../../../../cesr/mod.ts";
import { abortable } from "../../../src/app/abortable.ts";
import { type AgentRuntime, createAgentRuntime, runAgentRuntimeUntil } from "../../../src/app/agent-runtime.ts";
import { chunkBytes } from "../../../src/app/byte-source.ts";
import { processCuesOnce } from "../../../src/app/cue-runtime.ts";
import { acceptedEventReplayMessage, createHabery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { Oobiery } from "../../../src/app/oobiery.ts";
import { queryEnvelopeFromDispatch } from "../../../src/app/parsering.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";

import type { AgentCue, ReplayCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
import { MsgCacheRecord } from "../../../src/core/records.ts";
import { protocolFixture } from "../../protocol-fixture.ts";
import { httpClient } from "../../support/http-client.ts";

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
      const runtime = yield* createAgentRuntime(
        target,
        httpClient(() => {
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
        }),
        systemClock,
      );
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
        if (mode !== "deadline") {
          yield* runtime.reactor.processBytes(acceptedEventReplayMessage(source, sender.pre, 0).message);
        }
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
      const reactor = new Reactor(protocolFixture(hby));
      const started = gate();
      const cleanup = gate();
      let second = false;
      let passes = 0;
      reactor.protocol.exc.processEscrows = function*() {
        if (++passes > 1) {
          second = true;
          return false;
        }
        yield* abortable(async (signal) => {
          started.open();
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
          await cleanup.wait;
        });
        return false;
      };
      const first = yield* spawn(() => reactor.protocol.processEscrowsOnce());
      yield* call(() => started.wait);
      const next = yield* spawn(() => reactor.protocol.processEscrowsOnce());
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
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock),
      reactor = runtime.reactor;
    const first = reactor.protocol.replies.reserve("query-a"), second = reactor.protocol.replies.reserve("query-b");
    const ready = gate(), release = gate();
    const replayA: ReplayCue = { kin: "replay", querySaid: "query-a", msgs: [Uint8Array.of(1)] };
    const replayB: ReplayCue = { kin: "replay", querySaid: "query-b", msgs: [Uint8Array.of(2)] };
    const ordinary: ReplayCue = { kin: "replay", msgs: [Uint8Array.of(3)] };
    const seen: AgentCue[] = [];
    const observe = runtime.querying.observeCue.bind(runtime.querying);
    runtime.querying.observeCue = (cue) => {
      seen.push(cue);
      observe(cue);
    };
    try {
      reactor.protocol.exc.processEscrows = function*() {
        reactor.kvy.cues.push(replayB);
        ready.open();
        yield* call(() => release.wait);
        reactor.kvy.cues.push(ordinary);
        reactor.kvy.cues.push(replayA);
        return false;
      };
      const producing = yield* spawn(() => reactor.protocol.processEscrowsOnce());
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
      const recipient = hby.makeHab("recipient"), reactor = new Reactor(protocolFixture(hby));
      const [frame] = yield* call(() =>
        parseBytes(recipient.query(recipient.pre, recipient.pre, {
          route: "mbx",
          q: { topics: { "/reply": 0 } },
        }))
      );
      const result = yield* reactor.protocol.dispatch(frame);
      assertEquals(result.decision?.kind, "accept");
      assertEquals(result.mailboxQueryAuthorized, true);
      recipient.rotate();
      assertEquals(reactor.kvy.isMailboxQueryAuthorized(queryEnvelopeFromDispatch(result.envelope)), false);
      assertEquals(result.mailboxQueryAuthorized, true, "later key state cannot change this request's decision");
      const rejected = yield* reactor.protocol.dispatch(frame);
      assertEquals([rejected.decision?.kind, rejected.mailboxQueryAuthorized], ["drop", false]);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("cue routing keeps its initial extent when owner observation appends more work", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
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
      const reactor = new Reactor(protocolFixture(target));
      let exchangePasses = 0;
      const exchangeEscrows = reactor.protocol.exc.processEscrows.bind(reactor.protocol.exc);
      reactor.protocol.exc.processEscrows = function*() {
        exchangePasses++;
        return yield* exchangeEscrows();
      };
      yield* reactor.process((signal) => chunkBytes(later, { signal }));

      assertEquals(Array.from(target.db.ooes.getTopItemIter()).length, 1);
      reactor.protocol.cues.clear();
      reactor.protocol.cues.push({ kin: "replay", msgs: [new Uint8Array()] });
      yield* reactor.process((signal) => chunkBytes(initial, { signal }));
      assertEquals(yield* reactor.protocol.processEscrowsOnce(), true);
      assertEquals(exchangePasses, 1, "KEL progress must not skip later configured owners");
      assertEquals(target.db.getKever(sender.pre)!.sn, 1);
      assertEquals(Array.from(target.db.ooes.getTopItemIter()).length, 0);
      assertEquals(reactor.protocol.cues.peekHead()?.kin, "replay", "existing cues remain ahead of new protocol cues");
      assertEquals(yield* reactor.protocol.processEscrowsOnce(), false, "accepted cleanup does not repeat progress");
      assertEquals(exchangePasses, 2);
    } finally {
      yield* target.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("protocol sweeps retain KRAM pruning without counting cache removal as recovery", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const hab = hby.makeHab("controller");
      const protocol = protocolFixture(hby, { kram: {}, now: () => 10_000 });
      const key = [hab.pre, hab.kever!.said];
      hby.db.msgc.pin(
        key,
        new MsgCacheRecord({
          mdt: "1970-01-01T00:00:00.000000+00:00",
          d: 0,
          ml: 1,
          pml: 1,
          xl: 1,
          pxl: 1,
        }),
      );
      assertEquals(yield* protocol.processEscrowsOnce(), false);
      assertEquals(hby.db.msgc.get(key), null, "maintenance still removes expired cache evidence");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("OOBI result publication preserves cues appended during HTTP fetch", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: `cue-oobi-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const reactor = new Reactor(protocolFixture(hby));
      const oobi = new Oobiery(
        hby,
        reactor,
        reactor.protocol.rvy,
        httpClient(() => {
          // Model another producer filling the shared queue while this request is suspended in transport.
          reactor.protocol.cues.push({ kin: "replay", msgs: [new Uint8Array()] });
          return Promise.resolve(new Response(null, { status: 404 }));
        }),
        reactor.protocol.cues,
      );
      const url = "http://example.test/oobi";
      reactor.protocol.cues.push({ kin: "replay", msgs: [new Uint8Array()] });
      oobi.resolve(url);
      yield* oobi.processOnce();
      assertEquals(hby.db.oobis.get(url), null);
      assertEquals(hby.db.eoobi.get(url)?.state, "http-404");
      assertEquals(reactor.protocol.cues.toArray().map((cue) => cue.kin), [
        "replay",
        "oobiQueued",
        "replay",
        "oobiFailed",
      ]);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("direct ingress processes without waiting for cue delivery", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const target = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const sender = source.makeHab("sender");
      const wire = acceptedEventReplayMessage(source, sender.pre, 0).message;

      const reactor = new Reactor(protocolFixture(target));
      reactor.protocol.cues.push({ kin: "replay", msgs: [new Uint8Array()] });
      yield* reactor.processBytes(wire);

      assertEquals(target.db.getKever(sender.pre)!.sn, 0);
    } finally {
      yield* target.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("runtime explicit close and scope exit clear cues", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      let runtime!: AgentRuntime;
      for (const explicit of [true, false]) {
        yield* call(function*() {
          runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
          runtime.cues.push({ kin: "oobiQueued", url: "https://peer.test/" });
          if (explicit) {
            yield* runtime.close();
            assertEquals(runtime.cues.length, 0);
          }
        });
        assertEquals(runtime.cues.length, 0);
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
      const reactor = new Reactor(protocolFixture(hby)), failure = new Error("source construction failed");
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
      const hab = hby.makeHab("sender"), reactor = new Reactor(protocolFixture(hby));
      const bytes = acceptedEventReplayMessage(hby, hab.pre, 0).message;
      const held = gate(), release = gate(), queued = gate();
      const dispatch = reactor.protocol.dispatch;
      reactor.protocol.dispatch = function(frame, options) {
        queued.open();
        return dispatch.call(this, frame, options);
      };
      reactor.protocol.exc.processEscrows = function*() {
        held.open();
        yield* call(() => release.wait);
        return false;
      };
      yield* call(async () => {
        const holder = run(() => reactor.protocol.processEscrowsOnce());
        await held.wait;
        const controller = new AbortController(), reason = new Error("input stopped while waiting");
        let dispatched = false, closed = false;
        const processEvent = reactor.kvy.processEvent;
        reactor.kvy.processEvent = function(envelope) {
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
      const hab = hby.makeHab("sender"), reactor = new Reactor(protocolFixture(hby));
      const bytes = acceptedEventReplayMessage(hby, hab.pre, 0).message;
      for (const endAtSource of [false, true]) {
        const controller = new AbortController(), reason = new Error("stop input");
        let dispatches = 0, closed = false;
        const processEvent = reactor.kvy.processEvent.bind(reactor.kvy);
        reactor.kvy.processEvent = (envelope) => {
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
        reactor.kvy.processEvent = processEvent;
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
          const first = new Reactor(protocolFixture(hby));
          const second = new Reactor(protocolFixture(hby));
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
          const reactor = new Reactor(protocolFixture(hby));
          reactor.protocol.exc.processEscrows = function*() {
            yield* ensure(function*() {
              handlerClosed = true;
              if (mode === "handler-failure") throw expected;
            });
            started.open();
            yield* suspend();
            return false;
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

      const reactor = new Reactor(protocolFixture(target));
      const resultCues = separateCues ? new Deck<AgentCue>() : reactor.protocol.cues;
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
      const oobi = new Oobiery(
        target,
        reactor,
        reactor.protocol.rvy,
        httpClient((_url, init) => {
          requests++;
          signal = init?.signal ?? undefined;
          return Promise.resolve(
            new Response(requests === 1 ? body : new Blob([first.slice().buffer, second.slice().buffer]), {
              headers: { "Content-Type": contentType },
            }),
          );
        }),
        resultCues,
      );

      const processEvent = reactor.kvy.processEvent;
      reactor.kvy.processEvent = function(envelope) {
        const decision = processEvent.call(this, envelope);
        if (decision.kind === "accept" && envelope.serder.sn === 0) accepted.open();
        return decision;
      };
      const url = `http://oobi.test/oobi/${hab.pre}/controller`;
      oobi.resolve(url);
      resultCues.clear();
      reactor.protocol.cues.clear();
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
          reactor.protocol.cues.clear();
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
