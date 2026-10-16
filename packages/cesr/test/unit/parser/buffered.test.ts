import { encode as encodeMsgpack } from "@msgpack/msgpack";
import { assert, assertEquals, assertInstanceOf, assertRejects, assertThrows } from "jsr:@std/assert";
import { concatBytes, decodeB64, decoder, t } from "../../../src/core/bytes.ts";
import { encodeKeriCbor } from "../../../src/core/cbor.ts";
import {
  ColdStartError,
  DeserializeError,
  GroupSizeError,
  ParserError,
  ShortageError,
  WireParseError,
} from "../../../src/core/errors.ts";
import type { CesrFrame } from "../../../src/core/types.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { parse } from "../../../src/parser/parser.ts";
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
  const body = major === 1 ? group("NonNativeBodyGroup", new Texter({ raw: encode(json), code: "4B" }).qb64) : native;
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
  for await (const frame of source) {
    result.push(frame);
  }
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
Deno.test("buffered wire classification preserves source failure identity", async () => {
  const wire = encode(vector(2).selector + vector(2).frame.slice(0, -4));
  const classified = await assertRejects(() => collect(parse(chunks(wire))), WireParseError);
  assertInstanceOf(classified.cause, ShortageError);
  const external = new ParserError("source contract failure");
  const source = async function*() {
    yield await Promise.reject(external);
  };
  assert(await assertRejects(() => collect(parse(source()))) === external);
});
Deno.test("buffered GenericGroup waits for the complete enclosure in both genera/domains", async () => {
  for (const major of [1, 2] as const) {
    const { group, frame, selector } = vector(major);
    for (const bytes of [encode, decodeB64]) {
      // The gate withholds B while all enclosing counters and complete A arrive.
      for (const depth of [1, 3]) {
        let wire = frame + frame;
        for (let i = 0; i < depth; i++) {
          wire = group("GenericGroup", wire);
        }
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
          let delivered = false;
          const pending = parser.next().then((result) => {
            delivered = true;
            return result;
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
          assertEquals(delivered, false);
          assertEquals(pulled, 1);
          gate.resolve();
          assertEquals((await promptly(pending)).done, false);
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
Deno.test("buffered traversal matches finite frames with partial edges and single-byte chunks", async () => {
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
      // Byte-at-a-time below exercises each token boundary; these two partitions
      // cover resuming a partial opening token and finishing a partial final token.
      for (const split of [1, input.length - 1]) {
        assertEquals(
          await collect(parse(chunks(input.slice(0, split), new Uint8Array(), input.slice(split)))),
          expected,
        );
      }
      assertEquals(
        await collect(parse(chunks(
          new Uint8Array(),
          ...Array.from(input, (byte) => Uint8Array.of(byte)),
          new Uint8Array(),
        ))),
        expected,
      );
    }
  }
});
Deno.test("complete groups retain earlier children on malformed siblings; truncated groups deliver none", async () => {
  const { group, frame, body } = vector(2);
  for (const bytes of [encode, decodeB64]) {
    // -LAW counts an 88-character signature, but only four payload characters fit.
    const bad = parse(
      chunks(bytes(group("GenericGroup", frame + group("BodyWithAttachmentGroup", body + "-LAWAAAA")))),
    );
    assertEquals((await bad.next()).done, false);
    await assertRejects(() => bad.next(), WireParseError);
    assertEquals((await bad.next()).done, true);
    // An incomplete outer extent is never entered, even if its first child is complete.
    const truncated = parse(chunks(bytes(group("GenericGroup", frame + frame).slice(0, -4))));
    await assertRejects(() => truncated.next(), WireParseError);
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
  await assertRejects(() => parser.next(), WireParseError);
  assertEquals((await parser.next()).done, true);
});
Deno.test("single-frame enclosures validate exact contents before exposing any child", async () => {
  for (const major of [1, 2] as const) {
    const { selector, group, frame } = vector(major);
    for (const bytes of [encode, decodeB64]) {
      // An outer one-frame promise applies even when its payload nests a generic list.
      for (const payload of ["", frame + frame, group("GenericGroup", frame + frame)]) {
        const parser = parse(chunks(bytes(selector + group("BodyWithAttachmentGroup", payload))));
        await assertRejects(() => parser.next(), WireParseError);
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
  await assertRejects(() => promptly(parse(source).next()), WireParseError);
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
  await assertRejects(() => collect(parse(chunks(encode(body + sig + "-LAWAAAA")))), WireParseError);
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
    await assertRejects(() => collect(parse(chunks(bytes(one.selector + native)))), WireParseError);
    await assertRejects(() => collect(parse(chunks(bytes(two.selector + two.body + one.sig)))), WireParseError);
    // Explicit v2 counters remain v2 even when each body declares protocol v1.
    const mixed = concatBytes(bytes(two.selector), encode(one.json), bytes(two.sig), encode(one.json), bytes(two.sig));
    assertEquals((await collect(parse(chunks(mixed)))).map((frame) => frame.attachments[0].code), ["-K", "-K"]);
  }
});
Deno.test("cancellation joins a cooperating source and consumer return stops pulling", async () => {
  const { group, frame } = vector(2);
  const controller = new AbortController();
  const waiting = Promise.withResolvers<void>();
  let closes = 0;
  const blocked: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          waiting.resolve();
          return new Promise<IteratorResult<Uint8Array>>((_, reject) => {
            controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
          });
        },
        return() {
          closes++;
          return Promise.resolve({ done: true as const, value: undefined });
        },
      };
    },
  };
  const parser = parse(blocked);
  // The actual input owner aborts its pending read. Parsing joins source cleanup.
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
      yield encode(group("GenericGroup", frame + frame));
      pulls++;
      yield encode(frame);
    } finally {
      ended = true;
    }
  }
  // Returning after A skips the remaining decoded sibling and closes upstream.
  const early = parse(source());
  assertEquals((await early.next()).done, false);
  await early.return(undefined);
  assertEquals(pulls, 1);
  assertEquals(ended, true);
});
/** Build a small versioned JSON body shared by mixed-codec framing cases. */
function tinyJson(count: number): string {
  return v1ify("{\"v\":\"KERI10JSON000000_\",\"a\":[" + Array(count).fill("0").join(",") + "]}");
}
Deno.test("JSON parent and descendants preserve framing through cancellation", async () => {
  const body = tinyJson(0);
  const wrap = (value: string) =>
    vector(1).group("NonNativeBodyGroup", new Texter({ raw: encode(value), code: "4B" }).qb64);
  const parent = wrap(body);
  const child = vector(1).group("BodyWithAttachmentGroup", parent);
  const wire = vector(1).group("BodyWithAttachmentGroup", parent + child);
  const parser = parse(chunks(encode(wire)));
  const frame = (await parser.next()).value!;
  assertEquals(frame.nests?.length, 1);
  assertEquals([frame.body.ked, frame.nests![0].body.ked], [{ v: "KERI10JSON000020_", a: [] }, {
    v: "KERI10JSON000020_",
    a: [],
  }]);
  await parser.return(undefined);
  assertThrows(() => parseBytes(encode(wire.slice(0, -4))), ShortageError);
  const controller = new AbortController();
  const cancellation = new Error("cancel after admitted JSON parent");
  const source = async function*() {
    yield encode(wire.slice(0, -4));
    controller.abort(cancellation);
    controller.signal.throwIfAborted();
  };
  assert(
    await assertRejects(() => collect(parse(source()))) === cancellation,
  );
});
Deno.test("wrapped JSON retains intrinsic opaque fallback and propagates decoder failures unchanged", async () => {
  const wrap = (body: string) =>
    vector(1).group("NonNativeBodyGroup", new Texter({ raw: encode(body), code: "4B" }).qb64);
  const wire = wrap(json);
  const infrastructure = new DeserializeError("decoder infrastructure failed");
  const original = JSON.parse;
  JSON.parse = () => {
    throw infrastructure;
  };
  try {
    assert(assertThrows(() => parseBytes(encode(wire))) === infrastructure);
  } finally {
    JSON.parse = original;
  }
  const [opaque] = await parseBytes(encode(wrap(v1ify("{\"v\":\"KERI10JSON000000_\",\"a\":]"))));
  assertEquals(opaque.body.ked, null);
  const [accepted] = await parseBytes(encode(wire));
  assertEquals(accepted.body.raw, encode(json));
  assertEquals(accepted.body.ked, original(json));
  assertEquals(accepted.body.said, original(json).d);
});
Deno.test("JSON and MGPK descendants hydrate mixed codec children and cancel incomplete attachments", async () => {
  const jsonBody = tinyJson(0);
  const msgpackBody = encodeMsgpack({ v: "KERI10MGPK000018_", a: [] });
  const v = vector(1);
  const wrap = (raw: Uint8Array) => v.group("NonNativeBodyGroup", new Texter({ raw, code: "4B" }).qb64);
  const child = v.group("BodyWithAttachmentGroup", wrap(msgpackBody));
  const wire = v.group("BodyWithAttachmentGroup", wrap(encode(jsonBody)) + child);
  const parser = parse(chunks(encode(wire)));
  const frame = (await parser.next()).value!;
  assertEquals(frame.nests?.length, 1);
  assertEquals(frame.nests![0].body.raw, msgpackBody);
  assertEquals(frame.body.ked?.a, []);
  assertEquals(frame.nests![0].body.ked?.a, []);
  await parser.return(undefined);
  const controller = new AbortController();
  const cancellation = new Error("cancel after admitted binary child");
  // Child body is complete; its declared attachment tail is deliberately withheld.
  const waitingChild = v.group("BodyWithAttachmentGroup", wrap(msgpackBody) + v.sig);
  const pending = v.group("BodyWithAttachmentGroup", wrap(encode(jsonBody)) + waitingChild);
  const source = async function*() {
    yield encode(pending.slice(0, -v.sig.length));
    controller.abort(cancellation);
    controller.signal.throwIfAborted();
  };
  assert(
    await assertRejects(() => collect(parse(source()))) === cancellation,
  );
});
Deno.test("JSON and CBOR descendants hydrate mixed codec children and cancel incomplete attachments", async () => {
  const jsonBody = tinyJson(0);
  const cborBody = encodeKeriCbor({ v: "KERI10CBOR000018_", a: [] });
  const v = vector(1);
  const wrap = (raw: Uint8Array) => v.group("NonNativeBodyGroup", new Texter({ raw, code: "4B" }).qb64);
  const child = v.group("BodyWithAttachmentGroup", wrap(cborBody));
  const wire = v.group("BodyWithAttachmentGroup", wrap(encode(jsonBody)) + child);
  const parser = parse(chunks(encode(wire)));
  const frame = (await parser.next()).value!;
  assertEquals(frame.nests?.length, 1);
  assertEquals(frame.nests![0].body.raw.slice(), cborBody);
  assertEquals(frame.body.ked?.a, []);
  assertEquals(frame.nests![0].body.ked?.a, []);
  await parser.return(undefined);
  const controller = new AbortController();
  const cancellation = new Error("cancel after admitted binary child");
  // Child body is complete; its declared attachment tail is deliberately withheld.
  const waitingChild = v.group("BodyWithAttachmentGroup", wrap(cborBody) + v.sig);
  const pending = v.group("BodyWithAttachmentGroup", wrap(encode(jsonBody)) + waitingChild);
  const source = async function*() {
    yield encode(pending.slice(0, -v.sig.length));
    controller.abort(cancellation);
    controller.signal.throwIfAborted();
  };
  assert(
    await assertRejects(() => collect(parse(source()))) === cancellation,
  );
});
