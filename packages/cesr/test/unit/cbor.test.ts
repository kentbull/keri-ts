import { decode as decodeMsgpack, encode as encodeMsgpack } from "@msgpack/msgpack";
import { encode as encodeDefaultCbor } from "cbor-x/encode";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { decodeKeriCbor, encodeKeriCbor } from "../../src/core/cbor.ts";

type CborVector = {
  name: string;
  value: unknown;
  expected: Uint8Array;
};

const vectors: CborVector[] = [
  {
    name: "small map",
    value: { a: 1 },
    expected: new Uint8Array([0xa1, 0x61, 0x61, 0x01]),
  },
  {
    name: "nested map",
    value: { nested: { a: 1, b: [2, 3] }, flag: true },
    // dprint-ignore-start
    expected: new Uint8Array([
      0xa2,
      0x66,
      0x6e,
      0x65,
      0x73,
      0x74,
      0x65,
      0x64,
      0xa2,
      0x61,
      0x61,
      0x01,
      0x61,
      0x62,
      0x82,
      0x02,
      0x03,
      0x64,
      0x66,
      0x6c,
      0x61,
      0x67,
      0xf5,
    ]),
    // dprint-ignore-end
  },
  {
    name: "array",
    value: [1, 2, 3],
    expected: new Uint8Array([0x83, 0x01, 0x02, 0x03]),
  },
  {
    name: "booleans and null",
    value: [true, false, null],
    expected: new Uint8Array([0x83, 0xf5, 0xf4, 0xf6]),
  },
  {
    name: "integer boundaries",
    value: [23, 24, -24, -25],
    expected: new Uint8Array([0x84, 0x17, 0x18, 0x18, 0x37, 0x38, 0x18]),
  },
  {
    name: "komer record",
    value: {
      first: "Jim",
      last: "Black",
      street: "100 Main Street",
      city: "Riverton",
      state: "UT",
      zip: 84058,
    },
    // dprint-ignore-start
    expected: new Uint8Array([
      0xa6,
      0x65,
      0x66,
      0x69,
      0x72,
      0x73,
      0x74,
      0x63,
      0x4a,
      0x69,
      0x6d,
      0x64,
      0x6c,
      0x61,
      0x73,
      0x74,
      0x65,
      0x42,
      0x6c,
      0x61,
      0x63,
      0x6b,
      0x66,
      0x73,
      0x74,
      0x72,
      0x65,
      0x65,
      0x74,
      0x6f,
      0x31,
      0x30,
      0x30,
      0x20,
      0x4d,
      0x61,
      0x69,
      0x6e,
      0x20,
      0x53,
      0x74,
      0x72,
      0x65,
      0x65,
      0x74,
      0x64,
      0x63,
      0x69,
      0x74,
      0x79,
      0x68,
      0x52,
      0x69,
      0x76,
      0x65,
      0x72,
      0x74,
      0x6f,
      0x6e,
      0x65,
      0x73,
      0x74,
      0x61,
      0x74,
      0x65,
      0x62,
      0x55,
      0x54,
      0x63,
      0x7a,
      0x69,
      0x70,
      0x1a,
      0x00,
      0x01,
      0x48,
      0x5a,
    ]),
    // dprint-ignore-end
  },
];

/**
 * Assert that a decoded payload stays within the JSON-compatible object/list
 * model that KERIpy shares across JSON, MGPK, and CBOR serializers.
 *
 * This is intentionally stronger than "not a Map at the top level". The point
 * of the contract test is to catch any nested decode drift where CBOR or MGPK
 * could start materializing richer container types than the JSON path can
 * represent. If that ever changes, it should happen via an explicit protocol
 * decision, not through quiet library defaults.
 */
function assertPlainObjectListShape(value: unknown): void {
  if (
    value === null || typeof value === "string" || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      assertPlainObjectListShape(item);
    }
    return;
  }

  assertEquals(value instanceof Map, false);
  assertEquals(Object.getPrototypeOf(value), Object.prototype);

  for (const item of Object.values(value as Record<string, unknown>)) {
    assertPlainObjectListShape(item);
  }
}

for (const vector of vectors) {
  Deno.test(`cbor parity - ${vector.name} matches cbor2 bytes`, () => {
    assertEquals(encodeKeriCbor(vector.value), vector.expected);
  });

  Deno.test(`cbor parity - ${vector.name} decode/re-encode is byte-stable`, () => {
    assertEquals(
      Array.from(encodeKeriCbor(decodeKeriCbor(vector.expected))),
      Array.from(vector.expected),
    );
  });
}

Deno.test("cbor parity - project helper differs from raw cbor-x default for small objects", () => {
  const value = { a: 1 };
  assertEquals(encodeKeriCbor(value), new Uint8Array([0xa1, 0x61, 0x61, 0x01]));
  assertEquals(
    new Uint8Array(encodeDefaultCbor(value)),
    new Uint8Array([0xb9, 0x00, 0x01, 0x61, 0x61, 0x01]),
  );
});

Deno.test("cbor contract - KERI/ACDC helper rejects JavaScript Map values", () => {
  assertThrows(
    () => encodeKeriCbor(new Map([["a", 1]])),
    TypeError,
    "JSON-compatible plain objects/arrays",
  );
});

Deno.test("cbor contract - JSON, MGPK, and CBOR all round-trip the same plain object/list shape", () => {
  // KERIpy serializes the same SAD/record structures through JSON, MGPK, and
  // CBOR, so the decoded value shape should remain plain object/list data.
  const payload = {
    v: "KERI10JSON000000_",
    t: "ixn",
    a: [
      { i: "EA...", s: "0", d: "EB..." },
      { i: "EC...", s: "1", d: "ED..." },
    ],
    meta: {
      flags: [true, false, null],
      threshold: 2,
    },
  };

  const jsonDecoded = JSON.parse(JSON.stringify(payload));
  const mgpkDecoded = decodeMsgpack(encodeMsgpack(payload));
  const cborDecoded = decodeKeriCbor(encodeKeriCbor(payload));

  assertEquals(jsonDecoded, payload);
  assertEquals(mgpkDecoded, payload);
  assertEquals(cborDecoded, payload);

  assertPlainObjectListShape(jsonDecoded);
  assertPlainObjectListShape(mgpkDecoded);
  assertPlainObjectListShape(cborDecoded);
});

Deno.test("cbor scope restores default map shapes after a malformed forced-map operand", () => {
  decodeKeriCbor(Uint8Array.of(0xd9, 1, 3, 1)); // Native259 sets mapsAsObjects=false even for scalar input.
  assertEquals(decodeKeriCbor(encodeKeriCbor({ a: { b: 1 } })), { a: { b: 1 } });
});

Deno.test("cbor scope releases actual source backing after successful and malformed decode", async () => {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) throw new Error("CBOR retention probe requires --expose-gc");

  /** Only a two-byte view is decoded; the backing makes an accidentally retained DataView observable. */
  function decodeSource(malformed: boolean): WeakRef<ArrayBuffer> {
    const backing = new ArrayBuffer(16 * 1024 ** 2);
    const raw = new Uint8Array(backing, 0, 2);
    raw.set(malformed ? [0x82, 1] : [0x61, 0x78]);
    if (malformed) {
      let failed = false;
      try {
        decodeKeriCbor(raw);
      } catch {
        failed = true;
      }
      if (!failed) throw new Error("Expected truncated CBOR array failure");
    } else if (decodeKeriCbor(raw) !== "x") throw new Error("Unexpected CBOR string");
    return new WeakRef(backing);
  }

  for (const malformed of [false, true]) {
    const backing = decodeSource(malformed);
    // End the WeakRef creation job before explicit collections; do not dereference during collection.
    for (let pass = 0; pass < 5; pass++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      gc();
    }
    if (backing.deref()) throw new Error(`CBOR decoder retains ${malformed ? "failed" : "successful"} source backing`);
  }
});
