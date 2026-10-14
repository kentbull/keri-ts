import { assertEquals, assertStrictEquals, assertThrows } from "jsr:@std/assert";
import { ResourceLimitError, ResourcePolicy } from "../../../../cesr/mod.ts";
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
