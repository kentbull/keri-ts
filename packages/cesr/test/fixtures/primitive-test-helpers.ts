import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import { b, codeB64ToB2, t } from "../../src/core/bytes.ts";
import {
  type CounterGroupLike,
  type GroupEntry,
  isCounterGroupLike,
  isPrimitiveTuple,
  type Primitive,
} from "../../src/primitives/primitive.ts";
import { Counter } from "../../src/primitives/counter.ts";
import { UnknownPrimitive } from "../../src/primitives/unknown.ts";

/** Encode UTF-8 fixture text into parser input bytes. */
export function txt(input: string): Uint8Array {
  return b(input);
}

/** Generic txt/qb2 qb64 parity helper for parse functions with domain switch. */
export function assertTxtBnyQb64Parity<T extends { qb64: string }>(
  qb64: string,
  parse: (input: Uint8Array, cold: "txt" | "bny") => T,
): { txtValue: T; bnyValue: T } {
  const txtValue = parse(txt(qb64), "txt");
  const bnyValue = parse(codeB64ToB2(qb64), "bny");
  assertEquals(bnyValue.qb64, txtValue.qb64);
  return { txtValue, bnyValue };
}

/** Assert strict qb64 + qb2 roundtrip parity for primitive instances. */
export function assertQb64Qb2Parity(
  primitive: { qb64: string; qb2: Uint8Array },
): void {
  assertEquals(primitive.qb64, t(b(primitive.qb64)));
  assertEquals([...primitive.qb2], [...codeB64ToB2(primitive.qb64)]);
}

/** Narrow one group entry to counter-group node. */
export function expectCounterGroup(entry: GroupEntry): CounterGroupLike {
  assertEquals(isCounterGroupLike(entry), true);
  return entry as CounterGroupLike;
}

/** Narrow one group entry to primitive tuple node. */
export function expectPrimitiveTuple(entry: GroupEntry): readonly GroupEntry[] {
  assertEquals(isPrimitiveTuple(entry), true);
  return entry as readonly GroupEntry[];
}

/** Assert one entry is an unknown primitive placeholder. */
export function expectUnknownPrimitive(entry: GroupEntry): UnknownPrimitive {
  assertEquals(Array.isArray(entry), false);
  assertEquals(isCounterGroupLike(entry), false);
  assertInstanceOf(entry as Primitive, UnknownPrimitive);
  return entry as UnknownPrimitive;
}

/** Assert one entry is a counter primitive (non-group node allowed). */
export function expectCounterPrimitive(entry: GroupEntry): Counter {
  assertEquals(Array.isArray(entry), false);
  assertEquals(isCounterGroupLike(entry), false);
  assertInstanceOf(entry as Primitive, Counter);
  return entry as Counter;
}
