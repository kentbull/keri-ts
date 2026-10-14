import { call, run, spawn } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { concatBytes, ResourceAdmissionError, ResourceLimitError, ResourcePolicy } from "../../../../cesr/mod.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { QueryReplies } from "../../../src/app/query-replies.ts";
import { ReplyStreams } from "../../../src/app/reply-streams.ts";
import { CueDeck } from "../../../src/core/cue-admission.ts";
import type { AgentCue, ReplayCue, ReplyCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";

Deno.test("query reply reservations isolate interleaved results from the background cue deck", () => {
  const replies = new QueryReplies(3);
  const first = replies.reserve("query-a");
  const duplicate = replies.reserve("query-a");
  const second = replies.reserve("query-b");
  const replay: ReplayCue = { kin: "replay", querySaid: "query-a", messages: [new Uint8Array([1])] };
  const other: ReplayCue = { kin: "replay", querySaid: "query-b", messages: [new Uint8Array([2])] };
  const background: ReplayCue = { kin: "replay", messages: [new Uint8Array([3])] };
  const cues = new Deck<AgentCue>([other, background, replay, replay]);
  let wakes = 0;
  const unobserve = first.observeReady(() => wakes++);
  assertEquals(first.ready, false);
  assertThrows(() => first.observeReady(() => {}), Error, "observer");
  // A background turn can drain its own cue after reservation capture without stealing either response.
  replies.capture(cues);
  assertEquals([...cues], [background]);
  assertEquals([first.ready, wakes], [true, 1]);
  unobserve();
  assertStrictEquals(first.take(), replay);
  assertStrictEquals(duplicate.take(), replay);
  assertStrictEquals(second.take(), other);
  // Duplicate arrivals occupy one slot and fanout shares the same replay byte reference.
  assertEquals(first.take(), undefined);
  first.close();
  duplicate.close();
  second.close();
});

Deno.test("query reply reservations bound pending requests and release cancellation slots", () => {
  const replies = new QueryReplies(1);
  const pending = replies.reserve("query-a");
  assertThrows(() => replies.reserve("query-b"), ResourceLimitError);
  pending.close();
  pending.close();
  const next = replies.reserve("query-b");
  const cue: ReplayCue = { kin: "replay", querySaid: "query-a", messages: [new Uint8Array([1])] };
  const cues = new Deck<AgentCue>([cue]);
  // Cancellation relinquishes ownership: later results resume normal background delivery.
  replies.capture(cues);
  assertStrictEquals(cues.pull(), cue);
  next.close();
});

Deno.test("admitted TSN pairs retain fanout credit until response cleanup", async () => {
  const resources = new ResourcePolicy(), cues = new CueDeck(resources, 8, 64), replies = new QueryReplies(2);
  const first = replies.reserve("tsn"), duplicate = replies.reserve("tsn");
  const registry: ReplyCue = { kin: "reply", querySaid: "tsn", route: "/tsn/registry", data: { i: "registry" } };
  const credential: ReplyCue = { kin: "reply", querySaid: "tsn", route: "/tsn/credential", data: { i: "credential" } };
  const background: ReplyCue = { kin: "reply", route: "/background", data: {} };
  cues.extend([background, registry, credential, credential]);
  replies.capture(cues);
  assertEquals([...cues], [background]);
  assertThrows(() => first.take(), Error, "batch");
  const batch = first.takeAll()!;
  assertEquals(batch.cues, [registry, credential]);
  first.close();
  duplicate.close();
  cues.clear();
  assertEquals(resources.used.bytes > 0, true, "Request closure cannot release transferred response credit");
  const streams = new ReplyStreams({ maxMessageBytes: 3 }, resources);
  const response = streams.open([], batch.release);
  assertEquals(resources.used.bytes > 0, true);
  await response.cancel();
  batch.release();
  streams.close();
  assertEquals(resources.used.bytes, 0);
  const next = replies.reserve("tsn");
  cues.push(registry);
  replies.capture(cues);
  const partial = next.takeAll()!;
  assertEquals(partial.cues, [registry], "A registry-only result is not credential acceptance");
  partial.release();
  next.close();
  assertEquals(resources.used.bytes, 0);
});

Deno.test("query fanout refusal keeps the original admitted cue for a later capture", () => {
  const resources = new ResourcePolicy(), cues = new CueDeck(resources, 1, 64), replies = new QueryReplies(2);
  const first = replies.reserve("tsn"), duplicate = replies.reserve("tsn");
  const cue: ReplyCue = { kin: "reply", querySaid: "tsn", route: "/tsn/registry", data: {} };
  cues.push(cue);
  assertThrows(() => replies.capture(cues), ResourceLimitError);
  assertEquals(first.takeAll(), undefined);
  assertEquals(duplicate.takeAll(), undefined);
  assertEquals([...cues], [cue], "Original owner remains queued when fanout cannot publish");
  duplicate.close();
  replies.capture(cues);
  const batch = first.takeAll()!;
  assertEquals(batch.cues, [cue]);
  batch.release();
  first.close();
  assertEquals(resources.used.bytes, 0);
});

Deno.test("direct reply pairs publish atomically and share exact signed wire through both consumers", async () => {
  let cleaning!: () => void, unblock!: () => void;
  const cleanup = new Promise<void>((resolve) => cleaning = resolve),
    gate = new Promise<void>((resolve) => unblock = resolve);
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
    const failure = new ResourceAdmissionError("foreign fetch busy", "busy"),
      preparation = new Error("second reply failure");
    let failSend = true, blocked = false, failPrepare = false, interpretations = 0;
    const packets: Uint8Array[] = [];
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: {
          async fetch(_url, init) {
            const body = new Uint8Array(await new Response(init!.body).arrayBuffer());
            packets.push(
              concatBytes(body, new TextEncoder().encode(new Headers(init!.headers).get("CESR-ATTACHMENT") ?? "")),
            );
            if (failSend) throw failure;
            return blocked
              ? new Response(
                new ReadableStream({
                  async cancel() {
                    cleaning();
                    await gate;
                  },
                }),
              )
              : new Response(null, { status: 204 });
          },
        },
      },
    });
    const interpret = sender.interpretCue.bind(sender);
    sender.interpretCue = (cue) => {
      interpretations++;
      if (failPrepare && cue.kin === "reply" && cue.route === "/tsn/credential") throw preparation;
      return interpret(cue);
    };
    const replies = new QueryReplies(1), slot = replies.reserve("tsn"), cues = new CueDeck(runtime.resources, 8, 64);
    const pair: ReplyCue[] = ["registry", "credential"].map((kind) => ({
      kin: "reply",
      querySaid: "tsn",
      route: `/tsn/${kind}`,
      data: { i: kind },
      src: sender.pre,
      dest: recipient.pre,
    }));
    try {
      yield* runtime.reactor.processBytes(recipient.makeEndRole(recipient.pre, "controller", true));
      yield* runtime.reactor.processBytes(recipient.makeLocScheme("https://peer.test/", recipient.pre, "https"));
      cues.extend(pair);
      replies.capture(cues);
      const retained = runtime.resources.used.bytes;
      const occupied = runtime.resources.reserve({ streams: 2 });
      if (occupied.kind !== "reserve") throw new Error("Expected receive slots");
      assertEquals(
        assertThrows(() => runtime.deliveries.openReply(runtime, sender, slot), ResourceAdmissionError).reason,
        "busy",
      );
      occupied.reservation.release();
      assertEquals([interpretations, runtime.deliveries.hasPending, runtime.resources.used.bytes], [
        0,
        false,
        retained,
      ]);
      failPrepare = true;
      assertStrictEquals(assertThrows(() => runtime.deliveries.openReply(runtime, sender, slot)), preparation);
      assertEquals(
        [runtime.deliveries.hasPending, runtime.resources.used.bytes],
        [false, retained],
        "No first-cue publication on second-cue failure",
      );
      failPrepare = false;
      const response = runtime.deliveries.openReply(runtime, sender, slot)!;
      assertEquals(slot.takeAll(), undefined);
      slot.close();
      const preparedCount = interpretations;
      const wire = yield* call(async () => new Uint8Array(await new Response(response).arrayBuffer()));
      assertEquals(runtime.resources.used.bytes > 0, true, "HTTP EOF cannot release the queued borrow");
      assertStrictEquals(
        yield* call(() => assertRejects(() => run(() => runtime.deliveries.process(runtime)))),
        failure,
      );
      sender.interact();
      failSend = false;
      for (let pass = 0; pass < 6; pass++) yield* runtime.deliveries.process(runtime);
      assertEquals(packets[0], packets[1], "Retry preserves the original proof after sender state changes");
      assertEquals(concatBytes(packets[1], packets[2]), wire, "Both consumers borrow the same once-interpreted pair");
      assertEquals([interpretations, runtime.resources.used.bytes], [preparedCount, 0]);
      const later = replies.reserve("tsn");
      cues.extend(pair);
      replies.capture(cues);
      const unread = runtime.deliveries.openReply(runtime, sender, later)!;
      later.close();
      blocked = true;
      const delivery = yield* spawn(function*() {
        try {
          yield* runtime.deliveries.process(runtime);
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
        }
      });
      yield* call(() => cleanup);
      let closed = false;
      const closing = yield* spawn(function*() {
        yield* runtime.deliveries.close();
        closed = true;
      });
      assertEquals(
        [closed, runtime.resources.used.bytes > 0],
        [false, true],
        "Late cancellation keeps the shared owner through HTTP cleanup",
      );
      unblock();
      yield* closing;
      yield* delivery;
      assertEquals(
        [runtime.deliveries.hasPending, runtime.resources.used.bytes > 0],
        [false, true],
        "Joined queued cleanup still borrows the unread response wire",
      );
      yield* call(() => unread.cancel());
      assertEquals(runtime.resources.used.bytes, 0);
    } finally {
      unblock();
      sender.interpretCue = interpret;
      slot.close();
      cues.clear();
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
