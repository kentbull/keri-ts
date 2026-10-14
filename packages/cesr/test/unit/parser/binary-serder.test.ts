import { DecodeError, Decoder, encode as encodeMsgpack, ExtData, ExtensionCodec } from "@msgpack/msgpack";
import { Decoder as CborDecoder } from "cbor-x/decode";
import { Encoder as CborEncoder } from "cbor-x/encode";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { decodeHex } from "jsr:@std/encoding/hex";
import { concatBytes } from "../../../src/core/bytes.ts";
import { cborSyntaxFailure, decodeKeriCbor, encodeKeriCbor } from "../../../src/core/cbor.ts";
import { CborAdmissionError, ResourceAdmissionError, ResourceLimitError } from "../../../src/core/errors.ts";
import { discardFrame } from "../../../src/core/frame.ts";
import { ResourcePolicy } from "../../../src/core/resource-policy.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { Texter } from "../../../src/primitives/texter.ts";
import { SerderKERI } from "../../../src/serder/serder.ts";
import { reapSerder } from "../../../src/serder/serdery.ts";
import { groupV2 } from "../../fixtures/counter-token-fixtures.ts";
import saidVectors from "../../fixtures/current-said-vectors.json" with { type: "json" };

/** Values supported by both independent binary fixture encoders. */
type Encodable =
  | string
  | number
  | boolean
  | null
  | Encodable[]
  | { [key: string]: Encodable };

// Real KERI inception event fixture (from repository sample streams).
const REAL_ICP_EVENT: Record<string, Encodable> = {
  v: "KERI10JSON000229_",
  t: "icp",
  d: "EGq24VD48smR5JzSV2PnW9i_g1cdwzpSyZwNAse6JwkH",
  i: "EGq24VD48smR5JzSV2PnW9i_g1cdwzpSyZwNAse6JwkH",
  s: "0",
  kt: ["1/2", "1/2"],
  k: [
    "DHGF1NUOc-vwViJHL5vQ4pwJK2a41rRonZ4kJlMUZ-xF",
    "DFtTn4J6D8SIe8TXtEX12ce06obMjWaV-jncEV1Goypd",
  ],
  nt: ["1/2", "1/2"],
  n: [
    "EGKa8UzUyVkfZmNi3bRwFm0lB8KJwYahjKwcMEbLNcq0",
    "EJzwX8-rUGej2owHHc9P3-ELUjl-oHkFPQo4bHLLllId",
  ],
  bt: "3",
  b: [
    "BIfjEfe_3R6Svl6M9qcek9XIK0E7_DAJXRnWF-_feU98",
    "BHfT1Re4STNP8yPOvf4BpIAvQ0uBQND-4tCJzBV-RDG3",
    "BGnxtp6cV-37FU4eV6ZfOQGJBRirhlD_mtrazYNmfhBo",
  ],
  c: [],
  a: [],
};

/** Encode the same v1 body with a byte-accurate serialization header. */
function buildV1Serder(kind: "MGPK" | "CBOR"): Uint8Array {
  const body = structuredClone(REAL_ICP_EVENT);
  body.v = `KERI10${kind}000000_`;
  const encode = kind === "MGPK"
    ? (obj: Record<string, Encodable>) => encodeMsgpack(obj)
    : (obj: Record<string, Encodable>) => encodeKeriCbor(obj);
  let raw = encode(body);
  body.v = `KERI10${kind}${raw.length.toString(16).padStart(6, "0")}_`;
  raw = encode(body);
  return raw;
}

/** Require one hydrated body from complete input, preserving thrown parser failures. */
async function parseSingle(raw: Uint8Array) {
  const frames = await parseBytes(raw);
  assertEquals(frames.length, 1);
  return frames[0];
}

Deno.test("cold-start MGPK Serder body populates ked/ilk/said", async () => {
  const frame = await parseSingle(buildV1Serder("MGPK"));
  assertEquals(frame.body.kind, "MGPK");
  assertEquals(frame.body.ilk, "icp");
  assertEquals(frame.body.said, REAL_ICP_EVENT.d);
  assertEquals(frame.body.pvrsn.major, 1);
  assertEquals(frame.body.ked?.t, "icp");
  assertEquals(frame.body.ked?.d, REAL_ICP_EVENT.d);
  assertEquals((frame.body.ked?.k as unknown[])?.length ?? 0, 2);
});

Deno.test("cold-start CBOR Serder body populates ked/ilk/said", async () => {
  const frame = await parseSingle(buildV1Serder("CBOR"));
  assertEquals(frame.body.kind, "CBOR");
  assertEquals(frame.body.ilk, "icp");
  assertEquals(frame.body.said, REAL_ICP_EVENT.d);
  assertEquals(frame.body.pvrsn.major, 1);
  assertEquals(frame.body.ked?.t, "icp");
  assertEquals(frame.body.ked?.d, REAL_ICP_EVENT.d);
  assertEquals((frame.body.ked?.k as unknown[])?.length ?? 0, 2);
});

Deno.test("weighted threshold accessors survive binary serder parsing", async () => {
  const frame = await parseSingle(buildV1Serder("CBOR"));
  const serder = frame.body as SerderKERI;
  assertEquals(serder.tholder?.sith, ["1/2", "1/2"]);
  assertEquals(serder.ntholder?.sith, ["1/2", "1/2"]);
});

/** Make a finite binary body whose last field carries the supplied serialized token. */
function tokenBody(token: Uint8Array, kind: "MGPK" | "CBOR" = "MGPK"): Uint8Array {
  const encoder = kind === "MGPK" ? encodeMsgpack : encodeKeriCbor;
  const prefix = encoder({ v: `KERI10${kind}000000_`, a: null }).slice(0, -1);
  const raw = concatBytes(prefix, token);
  raw.set(new TextEncoder().encode(raw.length.toString(16).padStart(6, "0")), 14);
  return raw;
}

Deno.test("MGPK/CBOR declared array/map capacity refuses before native decoding or array allocation", async () => {
  const count = 4194304;
  const native = Decoder.prototype.decode;
  const nativeCbor = CborDecoder.prototype.decode;
  const OriginalArray = Array;
  let decoded = 0, allocated = 0;
  Decoder.prototype.decode = function(...args) {
    decoded++;
    return native.apply(this, args);
  };
  CborDecoder.prototype.decode = function(...args) {
    decoded++;
    return nativeCbor.apply(this, args);
  };
  globalThis.Array = new Proxy(OriginalArray, {
    construct(target, args, newTarget) {
      if (args[0] === count) allocated++;
      return Reflect.construct(target, args, newTarget);
    },
  });
  try {
    for (
      const [kind, token] of [
        ["MGPK", 0xdd],
        ["MGPK", 0xdf],
        ["CBOR", 0x9a],
        ["CBOR", 0xba],
        ["CBOR", 0x9b],
        ["CBOR", 0xbb],
        ["CBOR", 0x5a],
        ["CBOR", 0x7a],
      ] as const
    ) {
      const declaration = token === 0x9b || token === 0xbb
        ? [0, 0, 0, 0, 0, 64, 0, 0]
        : token === 0x5a || token === 0x7a
        ? [1, 0, 0, 0]
        : [0, 64, 0, 0];
      const raw = tokenBody(Uint8Array.of(token, ...declaration), kind); // All declared members are absent.
      const wrapped = new TextEncoder().encode(groupV2("-H", new Texter({ raw, code: "4B" }).qb64));
      for (const input of [raw, wrapped]) {
        const resources = new ResourcePolicy({ bytes: 16 * 1024 ** 2 });
        await assertRejects(() => parseBytes(input, { resources, classifyWireErrors: true }), ResourceLimitError);
        assertEquals(resources.used.bytes, 0);
      }
    }
    assertEquals([decoded, allocated], [0, 0]);
  } finally {
    Decoder.prototype.decode = native;
    CborDecoder.prototype.decode = nativeCbor;
    globalThis.Array = OriginalArray;
  }
});

Deno.test("admitted MGPK keeps pinned 714 bytes/SAIDs and standard binary/extension semantics", async () => {
  assertEquals(saidVectors.reference, "7143832813cac6a394ab1faf9be83bb3372be87c");
  for (const row of saidVectors.rows.filter((row) => row.sad.v.includes("MGPK"))) {
    const raw = decodeHex(row.raw);
    const resources = new ResourcePolicy();
    const [frame] = await parseBytes(raw, { resources });
    assertEquals(frame.body.raw, raw);
    assertEquals(frame.body.ked, row.sad);
    assertEquals(frame.body.said, row.sad.d);
    assert(resources.used.bytes > raw.length);
    await discardFrame(frame);
    assertEquals(resources.used.bytes, 0);
  }
  // Payload bytes that resemble a huge array header are opaque to resource token inspection.
  const value = {
    bin: Uint8Array.of(0xdd, 255, 255, 255, 255),
    ext: new ExtData(31, Uint8Array.of(0xdf, 255)),
    date: new Date(0),
    str: "é[]{}",
    nums: [-1, 128, 65536, 2 ** 40, -129, 1.5],
  };
  const raw = tokenBody(encodeMsgpack(value));
  const [frame] = await parseBytes(raw);
  assertEquals(frame.body.ked?.a, value);
  const globalCodec = ExtensionCodec.defaultCodec as ExtensionCodec;
  const globalDecode = globalCodec.decode;
  globalCodec.decode = () => {
    throw new Error("global extension must stay outside admitted decode");
  };
  try {
    assertEquals((await parseSingle(raw)).body.ked?.a, value);
  } finally {
    globalCodec.decode = globalDecode;
  }
});

Deno.test("wrapped MGPK preserves intrinsic opaque fallback and foreign same-class failure identity", async () => {
  const raw = tokenBody(Uint8Array.of(0xc1));
  const wrap = (raw: Uint8Array) => new TextEncoder().encode(groupV2("-H", new Texter({ raw, code: "4B" }).qb64));
  assertEquals((await parseSingle(wrap(raw))).body.ked, null);
  const native = Decoder.prototype.decode;
  const foreign = new DecodeError("caller decoder failed");
  Decoder.prototype.decode = () => {
    throw foreign;
  };
  try {
    assert(
      await assertRejects(() => parseBytes(wrap(buildV1Serder("MGPK")), { classifyWireErrors: true })) === foreign,
    );
  } finally {
    Decoder.prototype.decode = native;
  }
  const decodeText = TextDecoder.prototype.decode;
  const textBody = wrap(tokenBody(encodeMsgpack("x".repeat(201))));
  for (const textFailure of [new RangeError("foreign UTF8 failure"), new DecodeError("foreign UTF8 failure")]) {
    TextDecoder.prototype.decode = () => {
      throw textFailure;
    };
    try {
      assert(await assertRejects(() => parseBytes(textBody, { classifyWireErrors: true })) === textFailure);
    } finally {
      TextDecoder.prototype.decode = decodeText;
    }
  }
  const reservationFailure = new ResourceAdmissionError("caller reservation failed", "busy");
  class FailingPolicy extends ResourcePolicy {
    override reserve(request: Parameters<ResourcePolicy["reserve"]>[0]) {
      if (request.bytes !== 1024) throw reservationFailure;
      return super.reserve(request);
    }
  }
  const resources = new FailingPolicy();
  assert(
    await assertRejects(() =>
      parseBytes(wrap(buildV1Serder("MGPK")), {
        resources,
        maxFrameBytes: 1024,
        classifyWireErrors: true,
      })
    ) === reservationFailure,
  );
  assertEquals(resources.used.bytes, 0);
});

Deno.test("admitted CBOR preserves pinned 714 bytes/SAIDs, indefinite shapes and standard tags", async () => {
  for (const row of saidVectors.rows.filter((row) => row.sad.v.includes("CBOR"))) {
    const raw = decodeHex(row.raw), resources = new ResourcePolicy();
    const [frame] = await parseBytes(raw, { resources });
    assertEquals([frame.body.raw.slice(), frame.body.ked, frame.body.said], [raw, row.sad, row.sad.d]);
    assert(resources.used.bytes > raw.length);
    await discardFrame(frame);
    assertEquals(resources.used.bytes, 0);
  }
  const rootMap = concatBytes(Uint8Array.of(0xd9, 1, 3), tokenBody(Uint8Array.of(0x80), "CBOR"));
  rootMap.set(new TextEncoder().encode(rootMap.length.toString(16).padStart(6, "0")), 17);
  assertEquals(reapSerder(rootMap).serder.ked, { v: "KERI10CBOR00001b_", a: [] });
  await assertRejects(() => parseBytes(rootMap), CborAdmissionError);
  const indefinite = Uint8Array.of(0x9f, 1, 0xbf, 0x61, 0x6b, 0x82, 2, 3, 0xff, 0xff);
  assertEquals((await parseSingle(tokenBody(indefinite, "CBOR"))).body.ked?.a, [1, { k: [2, 3] }]);
  // Binary bytes resembling length declarations are payload; known/unknown tags retain codec shapes.
  for (
    const token of [
      Uint8Array.of(0xd8, 64, 0x45, 0x9a, 255, 255, 255, 255), // Uint8Array
      Uint8Array.of(0xc1, 0), // Date epoch
      Uint8Array.of(0xc2, 0x41, 1),
      Uint8Array.of(0xc3, 0x41, 1), // Bignum values remain supported.
      Uint8Array.of(0xc4, 0x82, 0, 1),
      Uint8Array.of(0xc5, 0x82, 0, 1), // Decimal/bigfloat behavior remains.
      Uint8Array.of(0xd9, 1, 2, 0x82, 1, 2), // Set
      Uint8Array.of(0xd9, 1, 3, 0xa1, 0x61, 0x78, 1), // Explicit Map
      Uint8Array.of(0xd9, 0xd9, 0xf7, 1), // Self-describing CBOR
      Uint8Array.of(0xd9, 3, 0xe8, 1), // Unknown Tag
      Uint8Array.of(0xc6, 1), // Packed reference without a table is a bounded Tag.
      Uint8Array.of(0xce, 1),
      Uint8Array.of(0xcf, 1), // Bundle refs without a bundle are Tags.
      Uint8Array.of(0xd9, 0xe0, 0, 1),
      Uint8Array.of(0xd9, 255, 255, 1), // Record IDs without definitions.
      Uint8Array.of(0xda, 0, 1, 0, 0, 1), // Higher tag/schema lookup without definitions.
    ]
  ) {
    const raw = tokenBody(token, "CBOR");
    if (token[0] === 0xd9 && token[1] === 1 && token[2] === 3) {
      assertEquals(reapSerder(raw).serder.ked?.a, new Map([["x", 1]]));
      await assertRejects(() => parseBytes(raw), CborAdmissionError);
    } else assertEquals((await parseSingle(raw)).body.ked, decodeKeriCbor(raw));
  }
});

Deno.test("wrapped CBOR distinguishes known syntax boundaries from foreign decoder/resource failures", async () => {
  const wrap = (token: Uint8Array) =>
    new TextEncoder().encode(groupV2("-H", new Texter({ raw: tokenBody(token, "CBOR"), code: "4B" }).qb64));
  for (const token of [Uint8Array.of(0x81), Uint8Array.of(0x9a, 0), Uint8Array.of(0x5f, 0xff), Uint8Array.of(0x1c)]) {
    assertEquals((await parseSingle(wrap(token))).body.ked, null);
  }
  const native = CborDecoder.prototype.decode;
  for (const foreign of [new RangeError("caller decoder failed"), new Error("caller decoder failed")]) {
    CborDecoder.prototype.decode = () => {
      throw foreign;
    };
    try {
      assert(
        await assertRejects(() => parseBytes(wrap(Uint8Array.of(0x81)), { classifyWireErrors: true })) === foreign,
      );
    } finally {
      CborDecoder.prototype.decode = native;
    }
  }
  await assertRejects(() =>
    parseBytes(wrap(Uint8Array.of(0xd8, 29, 0)), {
      classifyWireErrors: true,
    }), TypeError); // Unqualified tag failure is not mislabeled malformed wire.
  const decodeText = TextDecoder.prototype.decode;
  const input = wrap(encodeKeriCbor("x".repeat(65)));
  for (const foreign of [new RangeError("caller UTF8 failed"), new Error("caller UTF8 failed")]) {
    TextDecoder.prototype.decode = () => {
      throw foreign;
    };
    try {
      assert(await assertRejects(() => parseBytes(input, { classifyWireErrors: true })) === foreign);
    } finally {
      TextDecoder.prototype.decode = decodeText;
    }
  }
  const foreign = new ResourceAdmissionError("caller reservation failed", "busy");
  class FailingPolicy extends ResourcePolicy {
    override reserve(request: Parameters<ResourcePolicy["reserve"]>[0]) {
      if (request.bytes !== 1024) throw foreign;
      return super.reserve(request);
    }
  }
  const resources = new FailingPolicy();
  assert(
    await assertRejects(() =>
      parseBytes(wrap(Uint8Array.of(0x80)), {
        resources,
        maxFrameBytes: 1024,
        classifyWireErrors: true,
      })
    ) === foreign,
  );
  assertEquals(resources.used.bytes, 0);
});

Deno.test("CBOR reset failures preserve identity and intrinsic primary errors without opaque fallback", async () => {
  const native = CborDecoder.prototype.decode;
  const cleanup = cborSyntaxFailure("foreign reset failed"); // Even a previously owned syntax error is foreign here.
  let receiver: CborDecoder | undefined, primary: unknown;
  const wrap = (token: Uint8Array) =>
    new TextEncoder().encode(groupV2(
      "-H",
      new Texter({
        raw: tokenBody(token, "CBOR"),
        code: "4B",
      }).qb64,
    ));
  for (const malformed of [false, true]) {
    CborDecoder.prototype.decode = function(...args) {
      receiver = this;
      try {
        return native.apply(this, args);
      } catch (error) {
        primary = error;
        throw error;
      } finally {
        // Inject through the actual payload method's receiver; reset calls the captured native leaf.
        Object.defineProperty(this, "sharedValues", {
          configurable: true,
          get: () => {
            throw cleanup;
          },
        });
      }
    };
    const resources = new ResourcePolicy();
    try {
      const failure = await assertRejects(() =>
        parseBytes(wrap(Uint8Array.of(malformed ? 0x81 : 0x80)), {
          resources,
          classifyWireErrors: true,
        })
      );
      if (malformed) {
        assert(failure instanceof AggregateError);
        assertEquals(failure.errors, [primary, cleanup]);
      } else assert(failure === cleanup);
      assertEquals(resources.used.bytes, 0);
    } finally {
      CborDecoder.prototype.decode = native;
      if (receiver) Reflect.deleteProperty(receiver, "sharedValues");
    }
  }
  assertEquals(decodeKeriCbor(Uint8Array.of(1)), 1);
});

Deno.test("runtime CBOR refuses unqualified JS expansion before decoding while standalone remains unchanged", async () => {
  const native = CborDecoder.prototype.decode;
  let decoded = 0;
  CborDecoder.prototype.decode = function(...args) {
    decoded++;
    return native.apply(this, args);
  };
  const tags = [
    27,
    51,
    105,
    259,
    0xdff9,
    0xdffe,
    0xdfff,
    0x53687264,
    216,
    223,
    225,
    255,
    27647,
    28671,
    28704,
    32767,
    1811940352,
    1879048191,
    1879052288,
    2147483647,
  ];
  try {
    for (const tag of tags) {
      const token = Uint8Array.of(0xda, tag >>> 24, tag >>> 16, tag >>> 8, tag, 0);
      const raw = tokenBody(token, "CBOR");
      const wrapped = new TextEncoder().encode(groupV2("-H", new Texter({ raw, code: "4B" }).qb64));
      for (const input of [raw, wrapped]) {
        const resources = new ResourcePolicy();
        const error = await assertRejects(
          () => parseBytes(input, { resources, classifyWireErrors: true }),
          CborAdmissionError,
        );
        assertEquals([error.reason, error.tag, resources.used.bytes], ["unqualified-format", tag, 0]);
      }
    }
    assertEquals(decoded, 0);
  } finally {
    CborDecoder.prototype.decode = native;
  }
  // Payload bytes resembling guarded tags remain binary; genuine unknown tags stay Tags.
  for (const tag of [224, 256, 27646, 28672, 28703, 32768, 1811940351, 1879048192, 1879052287, 2147483648]) {
    const raw = tokenBody(Uint8Array.of(0xda, tag >>> 24, tag >>> 16, tag >>> 8, tag, 0), "CBOR");
    assertEquals((await parseSingle(raw)).body.ked?.a, decodeKeriCbor<{ a: unknown }>(raw).a);
  }
  const shared = tokenBody(Uint8Array.of(0xd8, 28, 0x82, 1, 0xd8, 29, 0), "CBOR");
  const sharedValue = (await parseSingle(shared)).body.ked?.a as unknown[];
  assert(sharedValue[1] === sharedValue); // Standard shareable/self-reference behavior is preserved.
  const binary = tokenBody(Uint8Array.of(0x45, 0xda, 0, 0, 0, 51), "CBOR");
  assertEquals((await parseSingle(binary)).body.ked?.a, Uint8Array.of(0xda, 0, 0, 0, 51));
  const packed = tokenBody(Uint8Array.of(0xd8, 51, 0x84, 0x81, 1, 0x81, 0x61, 0x70, 0x80, 0x61, 0x71), "CBOR");
  assertEquals(reapSerder(packed).serder.ked?.a, "q"); // Standalone still expands packed table/rump.
  for (
    const [encoder, value] of [
      [new CborEncoder({ useRecords: true }), { x: 1 }],
      [new CborEncoder({ useRecords: false, pack: true }), ["repeat", "repeat", "repeat"]],
      [new CborEncoder({ useRecords: false, bundleStrings: true }), ["hello", "world"]],
      [new CborEncoder({ useRecords: false, mapsAsObjects: true }), new Map([["x", 1]])],
      [new CborEncoder({ useRecords: false }), /a/i],
    ] as const
  ) {
    const raw = tokenBody(encoder.encode(value).slice(), "CBOR");
    assertEquals(reapSerder(raw).serder.ked?.a, value); // Real library producers retain standalone shapes.
    await assertRejects(() => parseBytes(raw), CborAdmissionError);
  }
  const recordFallback = (await parseSingle(tokenBody(Uint8Array.of(0xd9, 0xe0, 0, 1), "CBOR"))).body.ked?.a;
  assertEquals(recordFallback, decodeKeriCbor<{ a: unknown }>(tokenBody(Uint8Array.of(0xd9, 0xe0, 0, 1), "CBOR")).a);
  const foreign = new CborAdmissionError(27);
  class FailingPolicy extends ResourcePolicy {
    override reserve(request: Parameters<ResourcePolicy["reserve"]>[0]) {
      if (request.bytes !== 1024) throw foreign;
      return super.reserve(request);
    }
  }
  const resources = new FailingPolicy();
  assert(
    await assertRejects(() =>
      parseBytes(tokenBody(Uint8Array.of(0x80), "CBOR"), {
        resources,
        maxFrameBytes: 1024,
        classifyWireErrors: true,
      })
    ) === foreign,
  );
  assertEquals(resources.used.bytes, 0);
});
