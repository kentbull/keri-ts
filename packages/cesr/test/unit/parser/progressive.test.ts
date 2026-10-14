import { encode as encodeMsgpack } from "@msgpack/msgpack";
import { assert, assertEquals, assertInstanceOf, assertRejects } from "jsr:@std/assert";
import { toAsyncFrames } from "../../../src/adapters/async-iterable.ts";
import { concatBytes, decodeB64, decoder, t } from "../../../src/core/bytes.ts";
import { encodeKeriCbor } from "../../../src/core/cbor.ts";
import {
  ColdStartError,
  DeserializeError,
  GroupSizeError,
  ParserError,
  ResourceAdmissionError,
  ResourceLimitError,
  ShortageError,
  WireParseError,
} from "../../../src/core/errors.ts";
import { discardFrame } from "../../../src/core/frame.ts";
import { ResourcePolicy } from "../../../src/core/resource-policy.ts";
import type { CesrFrame } from "../../../src/core/types.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { parse } from "../../../src/parser/progressive.ts";
import { Counter } from "../../../src/primitives/counter.ts";
import { Siger } from "../../../src/primitives/siger.ts";
import { Texter } from "../../../src/primitives/texter.ts";
import { CtrDexV1, CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { counterV1, counterV2, groupV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import {
  KERIPY_NATIVE_V2_ICP_FIX_BODY as native,
  KERIPY_V1_JSON_ICP_BODY as json,
} from "../../fixtures/external-vectors.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";
import { v1ify } from "../../fixtures/versioned-body-fixtures.ts";

/** Build a real wrapped message with version-specific attachment count semantics. */
function vector(major: 1 | 2) {
  const gvrsn = { major, minor: 0 } as const;
  const codes = major === 1 ? CtrDexV1 : CtrDexV2;
  const counter = major === 1 ? counterV1 : counterV2;
  // Enclosing counters count text quadlets in both genera; binary conversion preserves those units.
  const group = (name: "GenericGroup" | "BodyWithAttachmentGroup" | "NonNativeBodyGroup", payload: string) =>
    counter(codes[name], payload.length / 4) + payload;
  // Wrapping the KERIpy JSON body permits whole-stream text/binary conversion.
  const body = major === 1
    ? group("NonNativeBodyGroup", new Texter({ raw: encode(json), code: "4B" }).qb64)
    : native;
  // Only the v1 signature counter counts items; v2 counts its 88-character payload / 4.
  const sig = counter(codes.ControllerIdxSigs, major === 1 ? 1 : sigerToken().length / 4) + sigerToken();
  return {
    group,
    body,
    json,
    sig,
    frame: group("BodyWithAttachmentGroup", body + sig),
    selector: t(Counter.makeGVC(gvrsn)),
  };
}

/** Yield supplied chunks as a finite record, including deliberate empty chunks. */
async function* chunks(...values: Uint8Array[]): AsyncGenerator<Uint8Array> {
  yield* values;
}

/** Collect small test results explicitly; production bulk consumers iterate. */
async function collect(source: AsyncIterable<CesrFrame>): Promise<CesrFrame[]> {
  const result: CesrFrame[] = [];
  for await (const frame of source) result.push(frame);
  return result;
}

/** Bound a deterministic blocked-input assertion without hanging a failed test. */
async function promptly<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Parser waited for unavailable sibling")), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

Deno.test("progressive wire classification preserves source, cancellation and policy failure identity", async () => {
  const wire = encode(vector(2).selector + vector(2).frame.slice(0, -4));
  const original = await assertRejects(() => collect(parse(chunks(wire))), ParserError);
  assert(!(original instanceof WireParseError));
  const classified = await assertRejects(
    () => collect(parse(chunks(wire), { classifyWireErrors: true })),
    WireParseError,
  );
  assertInstanceOf(classified.cause, original.constructor as typeof ParserError);
  const external = new ParserError("source contract failure");
  const source = async function*() {
    yield await Promise.reject(external);
  };
  assert(await assertRejects(() => collect(parse(source(), { classifyWireErrors: true }))) === external);
  const controller = new AbortController();
  controller.abort(external);
  assert(
    await assertRejects(
      () => collect(parse(chunks(wire), { classifyWireErrors: true, signal: controller.signal })),
    ) === external,
  );
  const policy = await assertRejects(
    () => collect(parse(chunks(wire), { classifyWireErrors: true, maxFrameBytes: 1 })),
    ResourceLimitError,
  );
  assert(!(policy instanceof WireParseError));
});

Deno.test("progressive GenericGroup emits a complete child before receiving its siblings in both genera/domains", async () => {
  for (const major of [1, 2] as const) {
    const { group, frame, selector } = vector(major);
    for (const bytes of [encode, decodeB64]) {
      // The gate withholds B while all enclosing counters and complete A arrive.
      for (const depth of [1, 3]) {
        let wire = frame + frame;
        for (let i = 0; i < depth; i++) wire = group("GenericGroup", wire);
        const prefix = bytes(selector + wire.slice(0, -frame.length)); // Remove only B, retaining its declared extent.
        let pulled = 0;
        let closed = 0;
        const gate = Promise.withResolvers<void>();
        const source = async function*() {
          try {
            pulled++;
            yield prefix;
            await gate.promise;
            pulled++;
            yield bytes(frame);
          } finally {
            closed++;
          }
        };
        const parser = parse(source());
        try {
          // A must resolve while the source cannot supply B.
          const first = await promptly(parser.next());
          assertEquals(first.done, false);
          assertEquals(pulled, 1);
          gate.resolve();
          assertEquals((await parser.next()).done, false);
          assertEquals((await parser.next()).done, true);
          assertEquals(closed, 1);
        } finally {
          gate.resolve();
          await parser.return(undefined);
        }
      }
    }
  }
});

Deno.test("progressive traversal matches finite successful frames at every text/binary split", async () => {
  for (const major of [1, 2] as const) {
    const { selector, group, frame, body, sig } = vector(major);
    const wire = selector + group("GenericGroup", frame + group("GenericGroup", body + sig)) + frame;
    for (const bytes of [encode, decodeB64]) {
      const input = bytes(wire);
      const expected = await parseBytes(input);
      // Independent wire facts constrain the baseline before comparing chunk partitions.
      assertEquals(expected.length, 3);
      for (const parsed of expected) {
        assertEquals(parsed.body.kind, major === 1 ? "JSON" : "CESR");
        assertEquals(parsed.body.ilk, "icp");
        assertEquals(parsed.attachments.map((group) => [group.code, group.count]), [
          [major === 1 ? "-A" : "-K", major === 1 ? 1 : sigerToken().length / 4],
        ]);
        const tuple = parsed.attachments[0].items[0];
        assert(Array.isArray(tuple));
        assertInstanceOf(tuple[0], Siger);
        assertEquals(tuple[0].qb64, sigerToken());
      }
      for (let split = 0; split <= input.length; split++) {
        assertEquals(
          await collect(parse(chunks(input.slice(0, split), new Uint8Array(), input.slice(split)))),
          expected,
        );
      }
      assertEquals(await collect(toAsyncFrames(chunks(...Array.from(input, (byte) => Uint8Array.of(byte))))), expected);
    }
  }
});

Deno.test("earlier children survive malformed siblings and truncated enclosures", async () => {
  const { group, frame, body } = vector(2);
  for (const bytes of [encode, decodeB64]) {
    // -LAW counts an 88-character signature, but only four payload characters fit.
    const bad = parse(
      chunks(bytes(group("GenericGroup", frame + group("BodyWithAttachmentGroup", body + "-LAWAAAA")))),
    );
    assertEquals((await bad.next()).done, false);
    await assertRejects(() => bad.next(), GroupSizeError);
    assertEquals((await bad.next()).done, true);
    // A survives even when actual input ends before B's declared extent.
    const truncated = parse(chunks(bytes(group("GenericGroup", frame + frame).slice(0, -4))));
    assertEquals((await truncated.next()).done, false);
    await assertRejects(() => truncated.next(), ShortageError);
    assertEquals((await truncated.next()).done, true);
  }
});

Deno.test("completed enclosed siblings remain delivered before a truncated following body", async () => {
  const signed = native + groupV2("-K", sigerToken());
  const complete = groupV2("-A", native + signed);
  const parser = parse(chunks(encode(complete + native.slice(0, -4))));
  // The first body's boundary is the next body; the second closes with its GenericGroup.
  assertEquals((await parser.next()).value?.attachments.length, 0);
  assertEquals((await parser.next()).value?.attachments.length, 1);
  await assertRejects(() => parser.next(), ShortageError);
  assertEquals((await parser.next()).done, true);
});

Deno.test("single-frame enclosures validate exact contents before exposing any child", async () => {
  for (const major of [1, 2] as const) {
    const { selector, group, frame } = vector(major);
    for (const bytes of [encode, decodeB64]) {
      // An outer one-frame promise applies even when its payload nests a generic list.
      for (const payload of ["", frame + frame, group("GenericGroup", frame + frame)]) {
        const parser = parse(chunks(bytes(selector + group("BodyWithAttachmentGroup", payload))));
        await assertRejects(() => parser.next(), ColdStartError);
        assertEquals((await parser.next()).done, true);
      }
    }
  }
});

Deno.test("impossible child extents fail without pulling missing outer bytes", async () => {
  const { group } = vector(2);
  let reads = 0;
  let closes = 0;
  // The outer group has four payload bytes; its inner -B counter promises much more.
  const source: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          reads++;
          return reads === 1
            ? Promise.resolve({ done: false as const, value: encode(group("GenericGroup", "-BB_").slice(0, 8)) })
            : new Promise<IteratorResult<Uint8Array>>(() => {});
        },
        return() {
          closes++;
          return Promise.resolve({ done: true as const, value: undefined });
        },
      };
    },
  };
  await assertRejects(() => promptly(parse(source).next()), GroupSizeError);
  assertEquals(reads, 1);
  assertEquals(closes, 1);
});

Deno.test("open attachment sets wait for lookahead or real EOF, never a network chunk", async () => {
  const { body, sig } = vector(2);
  const gate = Promise.withResolvers<void>();
  let pulls = 0;
  async function* source() {
    pulls++;
    yield encode(body + sig);
    await gate.promise;
    pulls++;
    yield encode(body);
  }
  const parser = parse(source());
  let delivered = false;
  // A complete signature group does not by itself terminate the frame.
  const first = parser.next().then((result) => {
    delivered = true;
    return result;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(delivered, false);
  assertEquals(pulls, 1);
  gate.resolve(); // The following body provides attachment-boundary lookahead.
  assertEquals((await first).done, false);
  assertEquals((await parser.next()).done, false);
  assertEquals((await parser.next()).done, true);
  await assertRejects(() => collect(parse(chunks(encode(body + sig + "-LAWAAAA")))), ShortageError);
});

Deno.test("nested selectors restore the enclosing genus and selected failures never retry", async () => {
  const one = vector(1);
  const two = vector(2);
  const wire = two.selector
    + two.group("GenericGroup", two.frame + two.group("GenericGroup", one.selector + one.frame) + two.frame)
    + two.frame;
  for (const bytes of [encode, decodeB64]) {
    const frames = await collect(parse(chunks(bytes(wire))));
    assertEquals(frames.map((frame) => frame.attachments[0].code), ["-K", "-A", "-K", "-K"]);
    // Selected v1 must reject the v2 body code without alternate-major retry.
    await assertRejects(() => collect(parse(chunks(bytes(one.selector + native)))), ColdStartError);
    await assertRejects(() => collect(parse(chunks(bytes(two.selector + two.body + one.sig)))), ParserError);
    // Explicit v2 counters remain v2 even when each body declares protocol v1.
    const mixed = concatBytes(bytes(two.selector), encode(one.json), bytes(two.sig), encode(one.json), bytes(two.sig));
    assertEquals((await collect(parse(chunks(mixed)))).map((frame) => frame.attachments[0].code), ["-K", "-K"]);
  }
});

Deno.test("progressive cancellation interrupts blocked input and consumer return stops pulling", async () => {
  const { group, frame } = vector(2);
  const controller = new AbortController();
  const waiting = Promise.withResolvers<void>();
  let closes = 0;
  const blocked: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          waiting.resolve();
          return new Promise<IteratorResult<Uint8Array>>(() => {});
        },
        return() {
          closes++;
          return Promise.resolve({ done: true as const, value: undefined });
        },
      };
    },
  };
  const parser = parse(blocked, { signal: controller.signal });
  // The source deliberately never settles next(); local abort must still settle parsing.
  const pending = parser.next();
  await waiting.promise;
  const reason = new Error("cancel blocked parser");
  controller.abort(reason);
  await assertRejects(() => promptly(pending), Error, reason.message);
  assertEquals(closes, 1);
  let pulls = 0;
  let ended = false;
  async function* source() {
    try {
      pulls++;
      yield encode(group("GenericGroup", frame + frame).slice(0, -frame.length));
      pulls++;
      yield encode(frame);
    } finally {
      ended = true;
    }
  }
  // Returning after A closes upstream without ever pulling B.
  const early = parse(source());
  assertEquals((await early.next()).done, false);
  await early.return(undefined);
  assertEquals(pulls, 1);
  assertEquals(ended, true);
});

Deno.test("progressive scope depth uses an explicit resource limit", async () => {
  const { group, frame } = vector(2);
  let wire = frame;
  // Reject before opening a fourth nested cursor under a depth-three budget.
  for (let i = 0; i < 4; i++) wire = group("GenericGroup", wire);
  await assertRejects(() => collect(parse(chunks(encode(wire)), { maxDepth: 3 })), ResourceLimitError);
});

Deno.test("materialized frame admission includes all attachment groups before yielding", async () => {
  const { body, sig } = vector(2);
  const wire = encode(body + sig + sig);
  // Each group fits independently; the second exceeds the total frame budget.
  const parser = parse(chunks(wire), { maxFrameBytes: body.length + sig.length });
  await assertRejects(() => parser.next(), ResourceLimitError);
  assertEquals((await parser.next()).done, true);
  await assertRejects(
    () => collect(parse(chunks(encode(body)), { maxFrameBytes: body.length - 1 })),
    ResourceLimitError,
  );
});

/** JSON values whose short wire requires much more decoded logical credit. */
function tinyJson(count: number): string {
  return v1ify("{\"v\":\"KERI10JSON000000_\",\"a\":[" + Array(count).fill("0").join(",") + "]}");
}

Deno.test("JSON tiny values admit or refuse before text/JSON decoding and preserve policy provenance", async () => {
  const body = tinyJson(100);
  const decoded = 278 + 24 * 100; // Object, two fields/labels, version string, array and scalar references.
  const held = 512 + 64 + 2 * body.length + decoded;
  const policy = new ResourcePolicy({ bytes: held });
  const originalParse = JSON.parse;
  const originalDecode = decoder.decode;
  let parses = 0;
  let texts = 0;
  JSON.parse = (...args) => {
    parses++;
    return originalParse(...args);
  };
  decoder.decode = (...args) => {
    texts++;
    return originalDecode.apply(decoder, args);
  };
  try {
    const blocker = policy.reserve({ bytes: 1 });
    assert(blocker.kind === "reserve");
    await assertRejects(
      () => parseBytes(encode(body), { resources: policy, maxFrameBytes: 512, classifyWireErrors: true }),
      ResourceAdmissionError,
      "busy",
    );
    assertEquals([parses, texts, policy.used.bytes], [0, 0, 1]);
    blocker.reservation.release();
    const configured = new ResourcePolicy({ bytes: decoded - 1 });
    await assertRejects(
      () => parseBytes(encode(body), { resources: configured, maxFrameBytes: 512, classifyWireErrors: true }),
      ResourceLimitError,
      "decoded tree credit",
    );
    assertEquals([parses, texts, configured.used.bytes], [0, 0, 0]);
    const [frame] = await parseBytes(encode(body), { resources: policy, maxFrameBytes: 512 });
    assertEquals([parses, texts, policy.used.bytes], [1, 1, held]);
    assertEquals(frame.body.raw, encode(body));
    assertEquals(frame.body.ked?.a, Array(100).fill(0));
    await discardFrame(frame);
    assertEquals(policy.used.bytes, 0);
  } finally {
    JSON.parse = originalParse;
    decoder.decode = originalDecode;
  }
});

Deno.test("JSON parent and descendants share credit through suspension, disposal, failure and cancellation", async () => {
  const body = tinyJson(0);
  const wrap = (value: string) =>
    vector(1).group("NonNativeBodyGroup", new Texter({ raw: encode(value), code: "4B" }).qb64);
  const parent = wrap(body);
  const child = vector(1).group("BodyWithAttachmentGroup", parent);
  const wire = vector(1).group("BodyWithAttachmentGroup", parent + child);
  const charge = 64 + 2 * body.length + 278;
  const held = 512 + 2 * charge;
  class TrackingPolicy extends ResourcePolicy {
    reserved = 0;
    released = 0;
    override reserve(request: Parameters<ResourcePolicy["reserve"]>[0]) {
      const decision = super.reserve(request);
      if (decision.kind === "refuse") return decision;
      this.reserved++;
      return {
        kind: "reserve" as const,
        reservation: {
          release: () => {
            this.released++;
            decision.reservation.release();
          },
        },
      };
    }
  }
  const policy = new TrackingPolicy({ bytes: held });
  const options = { resources: policy, maxFrameBytes: 512 };
  const parser = parse(chunks(encode(wire)), options);
  const frame = (await parser.next()).value!;
  assertEquals(frame.nests?.length, 1);
  assertEquals([frame.body.ked, frame.nests![0].body.ked], [{ v: "KERI10JSON000020_", a: [] }, {
    v: "KERI10JSON000020_",
    a: [],
  }]);
  assertEquals(policy.used.bytes, held);
  await discardFrame(frame.nests![0]);
  await discardFrame(frame);
  await discardFrame(frame);
  assertEquals(policy.used.bytes, held, "the suspended parser keeps parent and child credit");
  await parser.return(undefined);
  assertEquals(policy.used.bytes, 0);
  const insufficient = new ResourcePolicy({ bytes: held - 1 });
  const configuredFloor = await assertRejects(
    () => parseBytes(encode(wire), { ...options, resources: insufficient }),
    ResourceAdmissionError,
  );
  assertEquals(configuredFloor.reason, "limit", "the tree cannot fit even without competing owners");
  assertEquals(insufficient.used.bytes, 0, "failed descendant releases parent credit");
  await assertRejects(() => parseBytes(encode(wire.slice(0, -4)), options), ShortageError);
  assertEquals(policy.used.bytes, 0);
  const controller = new AbortController();
  const cancellation = new Error("cancel after admitted JSON parent");
  const source = async function*() {
    yield encode(wire.slice(0, -4));
    controller.abort(cancellation);
  };
  assert(
    await assertRejects(() => collect(parse(source(), { ...options, signal: controller.signal }))) === cancellation,
  );
  assertEquals(policy.used.bytes, 0);
  assertEquals(policy.released, policy.reserved, "each admitted parent/child reservation releases exactly once");

  const staged = new TrackingPolicy({ bytes: held + 16 });
  const essr = counterV1(CtrDexV1.ESSRPayloadGroup, 1) + "4BABYWJj";
  const payloadWire = vector(1).group(
    "BodyWithAttachmentGroup",
    parent
      + vector(1).group("BodyWithAttachmentGroup", parent + essr),
  );
  const [owned] = await parseBytes(encode(payloadWire), {
    ...options,
    resources: staged,
    maxEssrBytes: 3,
    maxEssrItems: 1,
  });
  const gate = Promise.withResolvers<void>();
  const failure = new Error("child disposal failed");
  const discard = owned.nests![0].essr!.discard;
  owned.nests![0].essr!.discard = async () => {
    await gate.promise;
    await discard();
    throw failure;
  };
  const disposal = discardFrame(owned);
  assertEquals(staged.used.bytes, held + 16, "JSON and stage credit survive awaited descendant disposal");
  gate.resolve();
  const cleanup = await assertRejects(() => disposal, AggregateError);
  assertEquals(cleanup.errors, [failure]);
  await discardFrame(owned);
  assertEquals(staged.used.bytes, 0);
  assertEquals(staged.released, staged.reserved);
});

Deno.test("wrapped JSON retains intrinsic opaque fallback and propagates resource/decoder failures unchanged", async () => {
  const wrap = (body: string) =>
    vector(1).group("NonNativeBodyGroup", new Texter({ raw: encode(body), code: "4B" }).qb64);
  const wire = wrap(json);
  const infrastructure = new DeserializeError("decoder infrastructure failed");
  const original = JSON.parse;
  JSON.parse = () => {
    throw infrastructure;
  };
  try {
    assert(await assertRejects(() => parseBytes(encode(wire), { classifyWireErrors: true })) === infrastructure);
  } finally {
    JSON.parse = original;
  }
  const policyFailure = new ResourceAdmissionError("injected resource failure", "busy");
  class FailingPolicy extends ResourcePolicy {
    override reserve(request: Parameters<ResourcePolicy["reserve"]>[0]) {
      if (request.bytes !== 1024) throw policyFailure;
      return super.reserve(request);
    }
  }
  const resources = new FailingPolicy();
  assert(
    await assertRejects(() =>
      parseBytes(encode(wire), {
        resources,
        maxFrameBytes: 1024,
        classifyWireErrors: true,
      })
    ) === policyFailure,
  );
  assertEquals(resources.used.bytes, 0);
  const [opaque] = await parseBytes(encode(wrap(v1ify("{\"v\":\"KERI10JSON000000_\",\"a\":]"))));
  assertEquals(opaque.body.ked, null);
  const [accepted] = await parseBytes(encode(wire));
  assertEquals(accepted.body.raw, encode(json));
  assertEquals(accepted.body.ked, original(json));
  assertEquals(accepted.body.said, original(json).d);
});

Deno.test("JSON and MGPK descendants share decoded credit through refusal, suspension and cancellation", async () => {
  const jsonBody = tinyJson(0);
  const msgpackBody = encodeMsgpack({ v: "KERI10MGPK000018_", a: [] });
  const v = vector(1);
  const wrap = (raw: Uint8Array) => v.group("NonNativeBodyGroup", new Texter({ raw, code: "4B" }).qb64);
  const child = v.group("BodyWithAttachmentGroup", wrap(msgpackBody));
  const wire = v.group("BodyWithAttachmentGroup", wrap(encode(jsonBody)) + child);
  // JSON charge406; pinned MGPK scanner64 +working1394 +declared decoded342.
  const held = 512 + 406 + 64 + 1394 + 342;
  const resources = new ResourcePolicy({ bytes: held });
  const options = { resources, maxFrameBytes: 512, classifyWireErrors: true };
  const occupied = resources.reserve({ bytes: 1 });
  assert(occupied.kind === "reserve");
  const busy = await assertRejects(() => parseBytes(encode(wire), options), ResourceAdmissionError);
  assertEquals(busy.reason, "busy");
  assertEquals(resources.used.bytes, 1);
  occupied.reservation.release();
  const configured = new ResourcePolicy({ bytes: held - 1 });
  const limit = await assertRejects(() =>
    parseBytes(encode(wire), {
      ...options,
      resources: configured,
    }), ResourceAdmissionError);
  assertEquals(limit.reason, "limit");
  assertEquals(configured.used.bytes, 0);
  const parser = parse(chunks(encode(wire)), options);
  const frame = (await parser.next()).value!;
  assertEquals(frame.nests?.length, 1);
  assertEquals(frame.nests![0].body.raw, msgpackBody);
  assertEquals(frame.body.ked?.a, []);
  assertEquals(frame.nests![0].body.ked?.a, []);
  assertEquals(resources.used.bytes, held);
  await discardFrame(frame.nests![0]);
  await discardFrame(frame);
  await discardFrame(frame);
  assertEquals(resources.used.bytes, held, "suspended parser owns both codecs' credit");
  await parser.return(undefined);
  assertEquals(resources.used.bytes, 0);
  const controller = new AbortController();
  const cancellation = new Error("cancel after admitted binary child");
  // Child body is complete; its declared attachment tail is deliberately withheld.
  const waitingChild = v.group("BodyWithAttachmentGroup", wrap(msgpackBody) + v.sig);
  const pending = v.group("BodyWithAttachmentGroup", wrap(encode(jsonBody)) + waitingChild);
  const source = async function*() {
    yield encode(pending.slice(0, -v.sig.length));
    controller.abort(cancellation);
  };
  assert(
    await assertRejects(() => collect(parse(source(), { ...options, signal: controller.signal }))) === cancellation,
  );
  assertEquals(resources.used.bytes, 0);
});
Deno.test("JSON and CBOR descendants share decoded credit through refusal, suspension and cancellation", async () => {
  const jsonBody = tinyJson(0);
  const cborBody = encodeKeriCbor({ v: "KERI10CBOR000018_", a: [] });
  const v = vector(1);
  const wrap = (raw: Uint8Array) => v.group("NonNativeBodyGroup", new Texter({ raw, code: "4B" }).qb64);
  const child = v.group("BodyWithAttachmentGroup", wrap(cborBody));
  const wire = v.group("BodyWithAttachmentGroup", wrap(encode(jsonBody)) + child);
  // JSON charge406; CBOR scanner64 +working938 +base decoded502.
  const held = 512 + 406 + 64 + 938 + 502;
  class TrackingPolicy extends ResourcePolicy {
    reserved = 0;
    released = 0;
    override reserve(request: Parameters<ResourcePolicy["reserve"]>[0]) {
      const decision = super.reserve(request);
      if (decision.kind === "refuse") return decision;
      this.reserved++;
      return {
        kind: "reserve" as const,
        reservation: {
          release: () => {
            this.released++;
            decision.reservation.release();
          },
        },
      };
    }
  }
  const resources = new TrackingPolicy({ bytes: held });
  const options = { resources, maxFrameBytes: 512, classifyWireErrors: true };
  const occupied = resources.reserve({ bytes: 1 });
  assert(occupied.kind === "reserve");
  const busy = await assertRejects(() => parseBytes(encode(wire), options), ResourceAdmissionError);
  assertEquals(busy.reason, "busy");
  assertEquals(resources.used.bytes, 1);
  occupied.reservation.release();
  const configured = new ResourcePolicy({ bytes: held - 1 });
  const limit = await assertRejects(() =>
    parseBytes(encode(wire), {
      ...options,
      resources: configured,
    }), ResourceAdmissionError);
  assertEquals(limit.reason, "limit");
  assertEquals(configured.used.bytes, 0);
  const parser = parse(chunks(encode(wire)), options);
  const frame = (await parser.next()).value!;
  assertEquals(frame.nests?.length, 1);
  assertEquals(frame.nests![0].body.raw.slice(), cborBody);
  assertEquals(frame.body.ked?.a, []);
  assertEquals(frame.nests![0].body.ked?.a, []);
  assertEquals(resources.used.bytes, held);
  await discardFrame(frame.nests![0]);
  await discardFrame(frame);
  await discardFrame(frame);
  assertEquals(resources.used.bytes, held, "suspended parser owns both codecs' credit");
  await parser.return(undefined);
  assertEquals(resources.used.bytes, 0);
  assertEquals(resources.released, resources.reserved);
  const controller = new AbortController();
  const cancellation = new Error("cancel after admitted binary child");
  // Child body is complete; its declared attachment tail is deliberately withheld.
  const waitingChild = v.group("BodyWithAttachmentGroup", wrap(cborBody) + v.sig);
  const pending = v.group("BodyWithAttachmentGroup", wrap(encode(jsonBody)) + waitingChild);
  const source = async function*() {
    yield encode(pending.slice(0, -v.sig.length));
    controller.abort(cancellation);
  };
  assert(
    await assertRejects(() => collect(parse(source(), { ...options, signal: controller.signal }))) === cancellation,
  );
  assertEquals(resources.used.bytes, 0);
  assertEquals(resources.released, resources.reserved);
});
