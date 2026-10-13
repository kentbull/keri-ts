import { assertEquals, assertRejects } from "jsr:@std/assert";
import { toAsyncFrames } from "../../src/adapters/async-iterable.ts";
import { concatBytes, decodeB64, t } from "../../src/core/bytes.ts";
import {
  ColdStartError,
  GroupSizeError,
  ParserError,
  ResourceLimitError,
  ShortageError,
} from "../../src/core/errors.ts";
import type { CesrFrame } from "../../src/core/types.ts";
import { parse } from "../../src/parser/progressive.ts";
import { parseBytes } from "../../src/parser/stream.ts";
import { Counter } from "../../src/primitives/counter.ts";
import { Texter } from "../../src/primitives/texter.ts";
import { CtrDexV1, CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { counterV1, counterV2, sigerToken } from "../fixtures/counter-token-fixtures.ts";
import {
  KERIPY_NATIVE_V2_ICP_FIX_BODY as native,
  KERIPY_V1_JSON_ICP_BODY as json,
} from "../fixtures/external-vectors.ts";
import { encode } from "../fixtures/stream-byte-fixtures.ts";

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
      // Keep the atomic parser as a successful-result oracle during migration.
      const expected = parseBytes(input).map((event) => {
        if (event.type === "error") throw event.error;
        return event.frame;
      });
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
