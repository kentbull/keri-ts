import { call, run, spawn } from "effection";
import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { concatBytes } from "../../../../cesr/mod.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { QueryReplies } from "../../../src/app/query-replies.ts";
import { ReplyStreams } from "../../../src/app/reply-streams.ts";
import type { AgentCue, ReplayCue, ReplyCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
import { reply as replyEvent } from "../../../src/core/protocol-eventing.ts";
import { state as registryState, vcstate as credentialState } from "../../../src/core/protocol-vdr-eventing.ts";

/** Complete owned TSN records exercise the actual reply contract and pair lifetime. */
function tsnPair(querySaid: string, dest = "recipient", src?: string): [ReplyCue, ReplyCue] {
  return [
    {
      kin: "reply",
      querySaid,
      dest,
      src,
      route: "/tsn/registry",
      data: registryState("issuer", "registry", 0, "registry", "vcp"),
    },
    {
      kin: "reply",
      querySaid,
      dest,
      src,
      route: "/tsn/credential",
      data: credentialState("credential", "credential-event", 0, "registry", "iss", { s: 0, d: "anchor" }),
    },
  ];
}

Deno.test("query reply reservations isolate interleaved results from the background cue deck", () => {
  const replies = new QueryReplies();
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
  assertStrictEquals(first.takeAll()?.cues[0], replay);
  assertStrictEquals(duplicate.takeAll()?.cues[0], replay);
  assertStrictEquals(second.takeAll()?.cues[0], other);
  // Duplicate arrivals occupy one slot and fanout shares the same replay byte reference.
  assertEquals(first.takeAll()?.cues[0], undefined);
  first.close();
  duplicate.close();
  second.close();
});

Deno.test("query reply cancellation returns later results to background delivery", () => {
  const replies = new QueryReplies();
  const pending = replies.reserve("query-a");
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

Deno.test("TSN pairs share ordinary records across matching requests", () => {
  const cues = new Deck<AgentCue>(), replies = new QueryReplies();
  const first = replies.reserve("tsn"), duplicate = replies.reserve("tsn");
  const [registry, credential] = tsnPair("tsn");
  const background: ReplyCue = { kin: "reply", serder: replyEvent("/background", {}) };
  cues.extend([background, registry, credential, credential]);
  replies.capture(cues);
  assertEquals([...cues], [background]);
  assertEquals(first.takeAll()?.cues, [registry, credential]);
  assertEquals(duplicate.takeAll()?.cues, [registry, credential]);
  first.close();
  duplicate.close();
  const next = replies.reserve("tsn");
  cues.push(registry);
  replies.capture(cues);
  assertEquals(next.takeAll()?.cues, [registry], "A registry-only result is not credential acceptance");
  next.close();
});

Deno.test("direct reply pairs publish atomically and share exact signed wire through both consumers", async () => {
  let cleaning!: () => void, unblock!: () => void;
  const cleanup = new Promise<void>((resolve) => cleaning = resolve),
    gate = new Promise<void>((resolve) => unblock = resolve);
  await run(function*() {
    const hby = yield* createHabery({
      name: crypto.randomUUID(),
      temp: true,
      skipConfig: true,
    });
    const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
    const failure = new Error("foreign fetch failure"),
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
    const replies = new QueryReplies(), slot = replies.reserve("tsn"), cues = new Deck<AgentCue>();
    const pair = tsnPair("tsn", recipient.pre, sender.pre);
    try {
      yield* runtime.reactor.processBytes(recipient.makeEndRole(recipient.pre, "controller", true));
      yield* runtime.reactor.processBytes(recipient.makeLocScheme("https://peer.test/", recipient.pre, "https"));
      cues.extend(pair);
      replies.capture(cues);
      failPrepare = true;
      assertStrictEquals(assertThrows(() => runtime.deliveries.openReply(runtime, sender, slot)), preparation);
      assertEquals(
        runtime.deliveries.hasPending,
        false,
        "No first-cue publication on second-cue failure",
      );
      failPrepare = false;
      const response = runtime.deliveries.openReply(runtime, sender, slot)!;
      assertEquals(slot.takeAll(), undefined);
      slot.close();
      const preparedCount = interpretations;
      const wire = yield* call(async () => new Uint8Array(await new Response(response).arrayBuffer()));
      assertEquals(runtime.deliveries.hasPending, true, "HTTP EOF leaves the independent queued delivery available");
      assertStrictEquals(
        yield* call(() => assertRejects(() => run(() => runtime.deliveries.process(runtime)))),
        failure,
      );
      sender.interact();
      failSend = false;
      for (let pass = 0; pass < 6; pass++) yield* runtime.deliveries.process(runtime);
      assertEquals(packets[0], packets[1], "Retry preserves the original proof after sender state changes");
      assertEquals(concatBytes(packets[1], packets[2]), wire, "Both consumers borrow the same once-interpreted pair");
      assertEquals(interpretations, preparedCount);
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
        closed,
        false,
        "Late cancellation waits for HTTP cleanup",
      );
      unblock();
      yield* closing;
      yield* delivery;
      assertEquals(runtime.deliveries.hasPending, false);
      const unreadWire = yield* call(() => new Response(unread).arrayBuffer());
      assertEquals(unreadWire.byteLength > 0, true, "Queued cleanup leaves the independent response readable");
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

Deno.test("queued replies preserve atomic slots and once-signed wire", async () => {
  let cleaning!: () => void, unblock!: () => void;
  const cleanup = new Promise<void>((resolve) => cleaning = resolve),
    gate = new Promise<void>((resolve) => unblock = resolve);
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
    const failure = new Error("foreign queued fetch failure"),
      preparation = new Error("second queued reply failure");
    let failSend = true, failPrepare = true, blocked = false, interpretations = 0;
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
    const replies = new QueryReplies(), slot = replies.reserve("tsn"), cues = new Deck<AgentCue>();
    const pair = tsnPair("tsn", recipient.pre, sender.pre);
    try {
      yield* runtime.reactor.processBytes(recipient.makeEndRole(recipient.pre, "controller", true));
      yield* runtime.reactor.processBytes(recipient.makeLocScheme("https://peer.test/", recipient.pre, "https"));
      cues.extend(pair);
      replies.capture(cues);
      assertStrictEquals(assertThrows(() => runtime.deliveries.enqueueReply(runtime, sender, slot)), preparation);
      assertEquals(runtime.deliveries.hasPending, false);
      failPrepare = false;
      assertEquals(runtime.deliveries.enqueueReply(runtime, sender, slot), true);
      assertEquals(slot.takeAll(), undefined);
      slot.close();
      const preparedCount = interpretations;
      assertStrictEquals(
        yield* call(() => assertRejects(() => run(() => runtime.deliveries.process(runtime)))),
        failure,
      );
      sender.interact();
      failSend = false;
      for (let pass = 0; pass < 6; pass++) yield* runtime.deliveries.process(runtime);
      assertEquals(packets[0], packets[1], "Queue-only retry retains its original signed proof");
      assertEquals(interpretations, preparedCount);

      const absent = replies.reserve("tsn");
      // Unaddressed prebuilt replies remain valid for local/direct interpretation; TSN data requires a destination.
      cues.append({ kin: "reply", querySaid: "tsn", serder: replyEvent("/background", {}) });
      replies.capture(cues);
      assertEquals(runtime.deliveries.enqueueReply(runtime, sender, absent), true);
      absent.close();
      assertEquals(runtime.deliveries.hasPending, false);

      const later = replies.reserve("tsn");
      cues.extend(pair);
      replies.capture(cues);
      assertEquals(runtime.deliveries.enqueueReply(runtime, sender, later), true);
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
      assertEquals(closed, false);
      unblock();
      yield* closing;
      yield* delivery;
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
