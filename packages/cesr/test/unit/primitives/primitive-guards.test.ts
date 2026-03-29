import { assertEquals } from "jsr:@std/assert";
import { b } from "../../../src/index.ts";
import { Counter, CounterGroup } from "../../../src/primitives/counter.ts";
import { Indexer } from "../../../src/primitives/indexer.ts";
import { Matter } from "../../../src/primitives/matter.ts";
import {
  type GroupEntry,
  isCounterGroupLike,
  isQualifiedPrimitive,
  isPrimitiveTuple,
} from "../../../src/primitives/primitive.ts";
import { UnknownPrimitive } from "../../../src/primitives/unknown.ts";
import {
  KERIPY_COUNTER_VECTORS,
  KERIPY_INDEXER_VECTORS,
  KERIPY_MATTER_VECTORS,
} from "../../fixtures/keripy-primitive-vectors.ts";

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

Deno.test("primitive guards: unknown primitive is not tuple/group", () => {
  const unknown = UnknownPrimitive.fromPayload(
    b("ABCD"),
    "txt",
  );
  assertEquals(isPrimitiveTuple(unknown), false);
  assertEquals(isCounterGroupLike(unknown), false);
  assertEquals(isQualifiedPrimitive(unknown), false);
});
