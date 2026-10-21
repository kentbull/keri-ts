import { assertEquals } from "jsr:@std/assert";
import { b } from "../../../../src/index.ts";
import { Counter, CounterGroup } from "../../../../src/primitives/base/counter.ts";
import { Indexer } from "../../../../src/primitives/base/indexer.ts";
import { Matter } from "../../../../src/primitives/base/matter.ts";
import { OpaqueSpan } from "../../../../src/primitives/base/opaque.ts";
import {
  type GroupEntry,
  isCounterGroupLike,
  isGroupTuple,
  isQualifiedPrimitive,
} from "../../../../src/primitives/base/primitive.ts";
import {
  KERIPY_COUNTER_VECTORS,
  KERIPY_INDEXER_VECTORS,
  KERIPY_MATTER_VECTORS,
} from "../../../fixtures/keripy-primitive-vectors.ts";

Deno.test("primitive guards: detects tuple and counter-group entries", () => {
  const counter = new Counter({
    qb64: KERIPY_COUNTER_VECTORS.v2ControllerIdxSigsCount1,
    version: { major: 2, minor: 0 },
  });
  const group = new CounterGroup(counter, counter.qb64b, [counter]);
  const tuple: GroupEntry = [counter];

  assertEquals(isCounterGroupLike(group), true);
  assertEquals(isGroupTuple(tuple), true);
  assertEquals(isCounterGroupLike(tuple), false);
  assertEquals(isQualifiedPrimitive(group), false);
  assertEquals(isQualifiedPrimitive(tuple), false);
});

Deno.test("primitive guards: detects rehydratable qualified primitives", () => {
  const matter = new Matter({ qb64: KERIPY_MATTER_VECTORS.verferEcdsaR1 });
  const indexer = new Indexer({ qb64: KERIPY_INDEXER_VECTORS.ed25519SigIdx5 });
  const counter = new Counter({
    qb64: KERIPY_COUNTER_VECTORS.v2ControllerIdxSigsCount1,
    version: { major: 2, minor: 0 },
  });

  assertEquals(isQualifiedPrimitive(matter), true);
  assertEquals(isQualifiedPrimitive(indexer), true);
  assertEquals(isQualifiedPrimitive(counter), true);
});

Deno.test("primitive guards: opaque span is not a primitive, tuple, or group", () => {
  const unknown = new OpaqueSpan(
    b("ABCD"),
    "txt",
  );
  assertEquals(isGroupTuple(unknown), false);
  assertEquals(isCounterGroupLike(unknown), false);
  assertEquals(isQualifiedPrimitive(unknown), false);
});
