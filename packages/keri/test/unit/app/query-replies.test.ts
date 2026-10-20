import { assertEquals, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { QueryReplies } from "../../../src/app/query-replies.ts";
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
