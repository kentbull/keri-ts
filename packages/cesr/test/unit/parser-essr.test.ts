import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { b, concatBytes, decodeB64, t } from "../../src/core/bytes.ts";
import { DeserializeError, GroupSizeError, ResourceLimitError, ShortageError } from "../../src/core/errors.ts";
import { collectPayload, MemoryPayloadSink, type PayloadSink } from "../../src/core/payload.ts";
import type { CesrFrame } from "../../src/core/types.ts";
import { parse } from "../../src/parser/progressive.ts";
import { Counter } from "../../src/primitives/counter.ts";
import { Texter } from "../../src/primitives/texter.ts";
import { CtrDexV1, CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { sigerToken } from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_V1_JSON_ICP_BODY } from "../fixtures/external-vectors.ts";

/** Build genus-specific counters around one shared protocol-v1 JSON body. */
function vector(major: 1 | 2) {
  const gvrsn = { major, minor: 0 } as const;
  const codes = major === 1 ? CtrDexV1 : CtrDexV2;
  const counter = (code: string, count: number) => {
    // Counter construction requires explicit promotion once its two soft sextets overflow.
    const name = Object.entries(codes).find(([, value]) => value === code)![0];
    if (count > 4095) code = codes[`Big${name}` as keyof typeof codes];
    return new Counter({ code, count, version: gvrsn }).qb64;
  };
  const group = (
    name: "GenericGroup" | "BodyWithAttachmentGroup" | "NonNativeBodyGroup" | "AttachmentGroup",
    wire: string,
  ) => counter(codes[name], wire.length / 4) + wire;
  const body = group("NonNativeBodyGroup", new Texter({ raw: b(KERIPY_V1_JSON_ICP_BODY), code: "4B" }).qb64);
  const sig = counter(codes.ControllerIdxSigs, major === 1 ? 1 : sigerToken().length / 4) + sigerToken();
  const essr = (wire: string, count: number) =>
    counter(codes.ESSRPayloadGroup, major === 1 ? count : wire.length / 4) + wire;
  return { gvrsn, body, sig, group, essr, selector: t(Counter.makeGVC(gvrsn)) };
}

/** Owned input slices model producer chunks without pinning a large backing buffer. */
async function* chunks(bytes: Uint8Array, size = 31): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.slice(offset, offset + size);
}

/** Observe ownership boundaries while retaining a real bounded in-memory sink. */
function tracking() {
  let finished = 0;
  let aborted = 0;
  const factory = (limit: number, signal?: AbortSignal): PayloadSink => {
    const sink = new MemoryPayloadSink(limit, signal);
    return {
      write: (bytes) => sink.write(bytes),
      finish() {
        finished++;
        return sink.finish();
      },
      abort(reason) {
        aborted++;
        return sink.abort();
      },
    };
  };
  return {
    factory,
    get finished() {
      return finished;
    },
    get aborted() {
      return aborted;
    },
  };
}

Deno.test("ESSR streams mixed Texter lengths in both genera/domains and reopens canonical wire", async () => {
  // All lead counts, an empty item, and a big-code item cross decoding block boundaries.
  const raw = [new Uint8Array(), b("a"), b("bc"), b("def"), new Uint8Array(49157).fill(213)];
  const wire = raw.map((part) => new Texter({ raw: part, code: "4B" }).qb64).join("");
  for (const major of [1, 2] as const) {
    const v = vector(major);
    for (const encode of [b, decodeB64]) {
      const input = v.selector
        + v.group("BodyWithAttachmentGroup", v.body + v.group("AttachmentGroup", v.sig + v.essr(wire, raw.length)));
      // ESSR exceeds the resident metadata cap but has its own finite decoded budget.
      const parser = parse(chunks(encode(input), 1021), { maxFrameBytes: v.body.length + v.sig.length });
      const first = await parser.next();
      assertEquals(first.done, false);
      const frame = first.value as CesrFrame;
      const essr = frame.essr;
      assertExists(essr);
      assertEquals(frame.attachments.map((group) => group.name), ["ControllerIdxSigs"]);
      assertEquals(essr.gvrsn, v.gvrsn); // Explicit stream genus wins over the JSON protocol version.
      assertEquals(essr.count, raw.length);
      assertEquals(await collectPayload(essr.wire, wire.length), b(wire));
      assertEquals(await collectPayload(essr.raw, 50000), concatBytes(...raw));
      assertEquals(await collectPayload(essr.raw, 50000), concatBytes(...raw));
      assertEquals((await parser.next()).done, true);
      await essr.discard();
      await assertRejects(() => collectPayload(essr.raw, 50000), Error, "discarded");
    }
  }
});

Deno.test("ESSR headers survive every source split and small and big codes preserve canonical wire", async () => {
  for (const major of [1, 2] as const) {
    const v = vector(major);
    // Big code with a small payload is legal; normalization must retain its qualified code.
    const wire = "7AABAAABYWJj" + new Texter({ raw: b("xy"), code: "4B" }).qb64;
    for (const encode of [b, decodeB64]) {
      const bytes = encode(v.selector + v.group("BodyWithAttachmentGroup", v.body + v.essr(wire, 2)));
      // Header and payload starts are exercised byte by byte in one pass.
      for await (const frame of parse(chunks(bytes, 1))) {
        assertExists(frame.essr);
        assertEquals(await collectPayload(frame.essr.wire, 32), b(wire));
        assertEquals(await collectPayload(frame.essr.raw, 8), b("abcxy"));
        await frame.essr.discard();
      }
    }
  }
});

Deno.test("ESSR rejects invalid alphabet, nonzero lead padding, impossible extents, and truncation", async () => {
  const v = vector(2);
  for (const token of ["5BABAQAA", "6BABAAEA", "4BABYW=J", "5BAA"]) {
    const observed = tracking();
    const parser = parse(chunks(b(v.selector + v.group("BodyWithAttachmentGroup", v.body + v.essr(token, 1)))), {
      payloadSink: observed.factory,
    });
    await assertRejects(() => parser.next(), DeserializeError);
    assertEquals(observed.finished, 0);
    assertEquals(observed.aborted, 1);
  }
  // The token declares six decoded bytes but only one quadlet fits in its v2 group.
  for (const encode of [b, decodeB64]) {
    await assertRejects(
      () => parse(chunks(encode(v.selector + v.body + v.essr("4BACAAAA", 1)))).next(),
      GroupSizeError,
    );
    const complete = encode(v.selector + v.group("BodyWithAttachmentGroup", v.body + v.essr("4BACAAAAAAAA", 1)));
    await assertRejects(() => parse(chunks(complete.slice(0, -1))).next(), ShortageError);
  }
});

Deno.test("ESSR per-frame byte and item budgets include empty Texters and multiple groups", async () => {
  const v = vector(1);
  const item = new Texter({ raw: b("abc"), code: "4B" }).qb64;
  // Limits accumulate across separate groups instead of resetting at each counter.
  const bytes = b(v.selector + v.body + v.essr(item, 1) + v.essr(item, 1));
  await assertRejects(() => parse(chunks(bytes), { maxEssrBytes: 5 }).next(), ResourceLimitError);
  await assertRejects(() => parse(chunks(bytes), { maxEssrItems: 1 }).next(), ResourceLimitError);
  const empty = b(v.selector + v.body + v.essr("4BAA4BAA", 2));
  await assertRejects(() => parse(chunks(empty), { maxEssrBytes: 0, maxEssrItems: 1 }).next(), ResourceLimitError);
});

Deno.test("single-frame enclosure failure aborts every staged candidate before any finish", async () => {
  const v = vector(2);
  const child = v.group("BodyWithAttachmentGroup", v.body + v.essr("4BABYWJj", 1));
  const observed = tracking();
  // Both nested candidates carry owned stages; neither internal yield is delivery.
  const parser = parse(chunks(b(v.selector + v.group("BodyWithAttachmentGroup", child + child))), {
    payloadSink: observed.factory,
  });
  await assertRejects(() => parser.next(), Error, "more than one frame");
  assertEquals(observed.finished, 0);
  assertEquals(observed.aborted, 2);
});

Deno.test("delivered ESSR survives a later sibling error while undelivered stages abort", async () => {
  const v = vector(2);
  const good = v.group("BodyWithAttachmentGroup", v.body + v.essr("4BABYWJj", 1));
  const bad = v.group("BodyWithAttachmentGroup", v.body + v.essr("5BABAQAA", 1));
  const observed = tracking();
  const parser = parse(chunks(b(v.selector + v.group("GenericGroup", good + bad))), { payloadSink: observed.factory });
  const first = (await parser.next()).value!;
  assertExists(first.essr);
  await assertRejects(() => parser.next(), DeserializeError);
  assertEquals(observed.finished, 1);
  assertEquals(observed.aborted, 1);
  assertEquals(await collectPayload(first.essr.raw, 3), b("abc"));
  await first.essr.discard();
});

Deno.test("awaited ESSR sink writes stop source pulls until credit returns", async () => {
  const v = vector(1);
  const gate = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  const bytes = b(v.selector + v.body + v.essr("4BABYWJj", 1));
  let pulls = 0;
  async function* source() {
    // The final body quadlet stays upstream while its Texter header is staged.
    pulls++;
    yield bytes.slice(0, -4);
    pulls++;
    yield bytes.slice(-4);
  }
  const parser = parse(source(), {
    payloadSink(limit) {
      const sink = new MemoryPayloadSink(limit);
      return {
        async write(bytes) {
          waiting.resolve();
          await gate.promise;
          await sink.write(bytes);
        },
        finish: () => sink.finish(),
        abort: () => sink.abort(),
      };
    },
  });
  const pending = parser.next();
  await waiting.promise;
  assertEquals(pulls, 1);
  gate.resolve();
  const first = (await pending).value!;
  assertExists(first.essr);
  assertEquals(await collectPayload(first.essr.raw, 3), b("abc"));
  await first.essr.discard();
  await parser.return(undefined);
});

Deno.test("cancellation during an ESSR token aborts its unfinished stage", async () => {
  const v = vector(2);
  const bytes = b(v.selector + v.body + v.essr("4BACAAAAAAAA", 1));
  const waiting = Promise.withResolvers<void>();
  const controller = new AbortController();
  const observed = tracking();
  let reads = 0;
  const source: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (reads++ === 0) return Promise.resolve({ done: false as const, value: bytes.slice(0, -4) });
          waiting.resolve();
          return new Promise<IteratorResult<Uint8Array>>(() => {});
        },
        return: () => Promise.resolve({ done: true as const, value: undefined }),
      };
    },
  };
  const parser = parse(source, { payloadSink: observed.factory, signal: controller.signal });
  const pending = parser.next();
  await waiting.promise; // The header has been staged; the rest of the token is still upstream.
  controller.abort(new Error("cancel ESSR"));
  await assertRejects(() => pending, Error, "cancel ESSR");
  assertEquals(observed.finished, 0);
  assertEquals(observed.aborted, 1);
});

Deno.test("sink failure aborts staged ESSR and binary lead padding remains strict", async () => {
  const v = vector(2);
  const observed = tracking();
  const parser = parse(chunks(b(v.selector + v.body + v.essr("4BABYWJj", 1))), {
    payloadSink(limit, signal) {
      const sink = observed.factory(limit, signal);
      return { ...sink, write: () => Promise.reject(new Error("disk full")) };
    },
  });
  await assertRejects(() => parser.next(), Error, "disk full");
  assertEquals(observed.finished, 0);
  assertEquals(observed.aborted, 1);
  // Binary input has no base64 alphabet to reject, but zero lead bytes are still mandatory.
  await assertRejects(
    () => parse(chunks(decodeB64(v.selector + v.body + v.essr("5BABAQAA", 1)))).next(),
    DeserializeError,
  );
});

Deno.test("attachment wrapper selectors restore genus and empty leaves obey a metadata count cap", async () => {
  const one = vector(1);
  const two = vector(2);
  const inner = two.group("AttachmentGroup", one.selector + one.essr("4BABYWJj", 1) + one.sig);
  // The nested selector is local; the following v2 ESSR counter counts quadlets, not items.
  const wire = two.selector
    + two.group(
      "BodyWithAttachmentGroup",
      two.body + two.group("AttachmentGroup", inner + two.essr("4BABeHl6", 1) + two.sig),
    );
  for (const encode of [b, decodeB64]) {
    for await (const frame of parse(chunks(encode(wire)))) {
      assertExists(frame.essr);
      assertEquals(frame.attachments.map((group) => group.code), [
        CtrDexV1.ControllerIdxSigs,
        CtrDexV2.ControllerIdxSigs,
      ]);
      assertEquals(await collectPayload(frame.essr.raw, 6), b("abcxyz"));
      await frame.essr.discard();
    }
  }
  const empty = new Counter({ code: CtrDexV2.ControllerIdxSigs, count: 0, version: two.gvrsn }).qb64;
  // Empty groups still allocate leaf objects, so a byte-only budget is insufficient.
  await assertRejects(
    () => parse(chunks(b(two.selector + two.body + empty + empty)), { maxAttachmentGroups: 1 }).next(),
    ResourceLimitError,
  );
});
