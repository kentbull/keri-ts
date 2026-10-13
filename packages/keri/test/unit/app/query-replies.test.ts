import { assertEquals, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { ResourceLimitError } from "../../../../cesr/mod.ts";
import { QueryReplies } from "../../../src/app/query-replies.ts";
import type { AgentCue, ReplayCue } from "../../../src/core/cues.ts";
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
  // A background turn can drain its own cue after reservation capture without stealing either response.
  replies.capture(cues);
  assertEquals([...cues], [background]);
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
