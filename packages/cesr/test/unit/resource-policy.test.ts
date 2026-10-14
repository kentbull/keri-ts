import { assertEquals, assertThrows } from "jsr:@std/assert";
import { ResourcePolicy } from "../../src/core/resource-policy.ts";

Deno.test("resource policy admits atomically and distinguishes capacity from configuration", () => {
  const policy = new ResourcePolicy({ bytes: 10, streams: 2, decryptions: 1 });
  const request = { bytes: 6, streams: 1, decryptions: 1 };
  const first = policy.reserve(request);
  if (first.kind !== "reserve") throw new Error("first owner must fit");
  request.bytes = 1; // The owner retains its original charge, independent of caller mutation.
  assertEquals(policy.reserve({ bytes: 5 }), { kind: "refuse", reason: "busy", resource: "bytes" });
  assertEquals(policy.reserve({ bytes: 4, decryptions: 1 }), {
    kind: "refuse",
    reason: "busy",
    resource: "decryptions",
  });
  assertEquals(policy.reserve({ bytes: 5, streams: 3 }), { kind: "refuse", reason: "limit", resource: "streams" });
  assertEquals(policy.used, { bytes: 6, streams: 1, decryptions: 1 });
  const second = policy.reserve({ bytes: 4, streams: 1 });
  if (second.kind !== "reserve") throw new Error("remaining exact credit must fit");
  assertEquals(policy.used, policy.limits);
  first.reservation.release();
  first.reservation.release();
  assertEquals(policy.used, { bytes: 4, streams: 1, decryptions: 0 });
  const later = policy.reserve({ bytes: 6, decryptions: 1 });
  if (later.kind !== "reserve") throw new Error("released capacity must be reusable");
  second.reservation.release();
  later.reservation.release();
  assertEquals(policy.used, { bytes: 0, streams: 0, decryptions: 0 });
});

Deno.test("resource policy validates credit and preserves exact arithmetic at its configured ceiling", () => {
  const policy = new ResourcePolicy({ bytes: Number.MAX_SAFE_INTEGER, streams: 0 });
  const held = policy.reserve({ bytes: Number.MAX_SAFE_INTEGER });
  if (held.kind !== "reserve") throw new Error("safe integer ceiling must fit");
  assertEquals(policy.reserve({ bytes: 1 }), { kind: "refuse", reason: "busy", resource: "bytes" });
  assertEquals(policy.reserve({ streams: 1 }), { kind: "refuse", reason: "limit", resource: "streams" });
  for (const invalid of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assertThrows(() => new ResourcePolicy({ bytes: invalid }), RangeError);
    assertThrows(() => policy.reserve({ bytes: invalid }), RangeError);
  }
  assertThrows(() => policy.reserve({}), RangeError);
  held.reservation.release();
  assertEquals(policy.used.bytes, 0);
  assertEquals(new ResourcePolicy().limits, { bytes: 256 * 1024 ** 2, streams: 8, decryptions: 1 });
});
