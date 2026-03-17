import { assertEquals } from "jsr:@std/assert";
import { Counter, CounterGroup } from "../../../src/primitives/counter.ts";
import {
  type GroupEntry,
  isCounterGroupLike,
  isPrimitiveTuple,
} from "../../../src/primitives/primitive.ts";
import { UnknownPrimitive } from "../../../src/primitives/unknown.ts";
import { KERIPY_COUNTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { b } from "../../../src/index.ts";

Deno.test("primitive guards: detects tuple and counter-group entries", () => {
  const counter = new Counter({
    qb64: KERIPY_COUNTER_VECTORS.v2ControllerIdxSigsCount1,
    version: { major: 2, minor: 0 },
  });
  const group = new CounterGroup(counter, counter.qb64b, [counter]);
  const tuple: GroupEntry = [counter];

  assertEquals(isCounterGroupLike(group), true);
  assertEquals(isPrimitiveTuple(tuple), true);
  assertEquals(isCounterGroupLike(tuple), false);
});

Deno.test("primitive guards: unknown primitive is not tuple/group", () => {
  const unknown = UnknownPrimitive.fromPayload(
    b("ABCD"),
    "txt",
  );
  assertEquals(isPrimitiveTuple(unknown), false);
  assertEquals(isCounterGroupLike(unknown), false);
});
