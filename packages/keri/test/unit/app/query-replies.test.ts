import { call, run, spawn } from "effection";
import { assertEquals, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { concatBytes, SerderKERI } from "../../../../cesr/mod.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { QueryReplies } from "../../../src/app/query-replies.ts";
import type { AgentCue, ReplayCue, ReplyCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
import { reply as replyEvent } from "../../../src/core/protocol-eventing.ts";
import { state as registryState, vcstate as credentialState } from "../../../src/core/protocol-vdr-eventing.ts";
import { httpClient } from "../../support/http-client.ts";

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
  const replies = new QueryReplies(new Deck());
  const first = replies.reserve("query-a");
  const duplicate = replies.reserve("query-a");
  const second = replies.reserve("query-b");
  const replay: ReplayCue = { kin: "replay", querySaid: "query-a", msgs: [new Uint8Array([1])] };
  const other: ReplayCue = { kin: "replay", querySaid: "query-b", msgs: [new Uint8Array([2])] };
  const background: ReplayCue = { kin: "replay", msgs: [new Uint8Array([3])] };
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
  const replies = new QueryReplies(new Deck());
  const pending = replies.reserve("query-a");
  pending.close();
  pending.close();
  const next = replies.reserve("query-b");
  const cue: ReplayCue = { kin: "replay", querySaid: "query-a", msgs: [new Uint8Array([1])] };
  const cues = new Deck<AgentCue>([cue]);
  // Cancellation relinquishes ownership: later results resume normal background delivery.
  replies.capture(cues);
  assertStrictEquals(cues.pull(), cue);
  next.close();
});

Deno.test("TSN pairs share ordinary records across matching requests", () => {
  const cues = new Deck<AgentCue>(), replies = new QueryReplies(new Deck());
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

Deno.test("direct reply pairs publish atomically and keep independent HTTP and queued consumers", async () => {
  let reading!: () => void, cleaning!: () => void, unblock!: () => void;
  const started = new Promise<void>((resolve) => reading = resolve);
  const cleanup = new Promise<void>((resolve) => cleaning = resolve),
    gate = new Promise<void>((resolve) => unblock = resolve);
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
    const preparation = new Error("second reply failure");
    let refuse = true, blocked = false, failPrepare = false, constructions = 0;
    const packets: Uint8Array[] = [];
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: httpClient(async (_url, init) => {
          const body = new Uint8Array(await new Response(init!.body).arrayBuffer());
          packets.push(
            concatBytes(body, new TextEncoder().encode(new Headers(init!.headers).get("CESR-ATTACHMENT") ?? "")),
          );
          return blocked
            ? new Response(
              new ReadableStream({
                pull() {
                  reading();
                },
                async cancel() {
                  cleaning();
                  await gate;
                },
              }, { highWaterMark: 0 }),
            )
            : new Response(null, { status: refuse && packets.length === 1 ? 503 : 204 });
        }),
      },
    });
    const produce = sender.processCuesIter.bind(sender);
    sender.processCuesIter = function*(cues) {
      for (const cue of cues) {
        constructions++;
        if (failPrepare && cue.kin === "reply" && cue.route === "/tsn/credential") throw preparation;
        yield* produce([cue]);
      }
    };
    const replies = new QueryReplies(new Deck()), slot = replies.reserve("tsn"), cues = new Deck<AgentCue>();
    const pair = tsnPair("tsn", recipient.pre, sender.pre);
    try {
      yield* runtime.reactor.processBytes(recipient.makeEndRole(recipient.pre, "controller", true));
      yield* runtime.reactor.processBytes(recipient.makeLocScheme("https://peer.test/", recipient.pre, "https"));
      cues.extend(pair);
      replies.capture(cues);
      failPrepare = true;
      assertStrictEquals(assertThrows(() => runtime.respondant.openReply(sender, slot)), preparation);
      assertEquals(runtime.postman.evts.length, 0, "no first reply escapes when construction of its companion fails");
      assertEquals(slot.peekAll()?.cues, pair, "failed construction leaves the whole pair visible");
      failPrepare = false;
      const response = runtime.respondant.openReply(sender, slot)!;
      assertEquals(slot.peekAll(), undefined);
      assertEquals(slot.takeAll(), undefined);
      slot.close();
      const constructed = constructions, evts = [...runtime.postman.evts];
      assertEquals(evts.length, 2);
      const wire = yield* call(async () => new Uint8Array(await new Response(response).arrayBuffer()));
      assertEquals(
        wire,
        concatBytes(...evts.map(({ msg }) => msg)),
        "both consumers receive the once-constructed pair",
      );
      assertEquals(runtime.postman.hasPending, true, "HTTP EOF leaves queued delivery available");
      yield* runtime.postman.process();
      assertEquals(packets, evts.map(({ msg }) => msg), "the registry and credential replies are attempted in order");
      assertStrictEquals(runtime.postman.failures[0].evt, evts[0]);
      sender.interact();
      refuse = false;
      const retried = runtime.postman.retry(evts[0]);
      assertEquals(retried.msg, evts[0].msg, "explicit retry reuses the signed source reply");
      yield* runtime.postman.process();
      assertEquals(constructions, constructed, "delivery does not reinterpret protocol cues");
      assertEquals(runtime.postman.failures.length, 0);

      const later = replies.reserve("tsn");
      cues.extend(pair);
      replies.capture(cues);
      const unread = runtime.respondant.openReply(sender, later)!;
      later.close();
      blocked = true;
      const delivery = yield* spawn(function*() {
        try {
          yield* runtime.postman.process();
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
        }
      });
      yield* call(() => started);
      let closed = false;
      const closing = yield* spawn(function*() {
        yield* runtime.postman.close();
        closed = true;
      });
      yield* call(() => cleanup);
      assertEquals(closed, false, "late cancellation waits for HTTP cleanup");
      unblock();
      yield* closing;
      yield* delivery;
      assertEquals(runtime.postman.hasPending, false);
      const unreadWire = yield* call(() => new Response(unread).arrayBuffer());
      assertEquals(unreadWire.byteLength > 0, true, "queued cleanup leaves the independent response readable");
    } finally {
      unblock();
      sender.processCuesIter = produce;
      slot.close();
      cues.clear();
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("queue-only reply pairs retain their atomic slot until complete construction", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender"), recipient = hby.makeHab("recipient");
    const preparation = new Error("second queued reply failure");
    let failPrepare = true;
    const packets: SerderKERI[] = [];
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: httpClient(async (_url, init) => {
          packets.push(new SerderKERI({ raw: new Uint8Array(await new Response(init!.body).arrayBuffer()) }));
          return new Response(null, { status: 204 });
        }),
      },
    });
    const produce = sender.processCuesIter.bind(sender);
    sender.processCuesIter = function*(cues) {
      for (const cue of cues) {
        if (failPrepare && cue.kin === "reply" && cue.route === "/tsn/credential") throw preparation;
        yield* produce([cue]);
      }
    };
    const replies = new QueryReplies(new Deck()), slot = replies.reserve("tsn"), cues = new Deck<AgentCue>();
    const pair = tsnPair("tsn", recipient.pre, sender.pre);
    try {
      yield* runtime.reactor.processBytes(recipient.makeEndRole(recipient.pre, "controller", true));
      yield* runtime.reactor.processBytes(recipient.makeLocScheme("https://peer.test/", recipient.pre, "https"));
      cues.extend(pair);
      replies.capture(cues);
      assertStrictEquals(assertThrows(() => runtime.respondant.enqueueReply(sender, slot)), preparation);
      assertEquals(runtime.postman.evts.length, 0);
      assertEquals(slot.peekAll()?.cues, pair);
      failPrepare = false;
      assertEquals(runtime.respondant.enqueueReply(sender, slot), true);
      assertEquals(slot.takeAll(), undefined);
      slot.close();
      assertEquals(runtime.postman.evts.length, 2);
      yield* runtime.postman.process();
      assertEquals(packets.map((packet) => packet.route), [
        `/tsn/registry/${sender.pre}`,
        `/tsn/credential/${sender.pre}`,
      ]);
      assertEquals(runtime.postman.hasPending, false);

      const absent = replies.reserve("tsn");
      // Unaddressed prebuilt replies remain valid for direct interpretation without an outbound destination.
      cues.append({ kin: "reply", querySaid: "tsn", serder: replyEvent("/background", {}) });
      replies.capture(cues);
      assertEquals(runtime.respondant.enqueueReply(sender, absent), true);
      absent.close();
      assertEquals(runtime.postman.evts.length, 0);
    } finally {
      sender.processCuesIter = produce;
      slot.close();
      cues.clear();
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
