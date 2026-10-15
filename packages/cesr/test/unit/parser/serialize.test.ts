import { assertEquals, assertExists, assertRejects, assertThrows } from "jsr:@std/assert";
import { b, concatBytes, decodeB64, t } from "../../../src/core/bytes.ts";
import { SerializeError } from "../../../src/core/errors.ts";
import { collectPayload, type OwnedPayload } from "../../../src/core/payload.ts";
import type { CesrFrame } from "../../../src/core/types.ts";
import { essrPayload } from "../../../src/parser/essr.ts";
import { parse } from "../../../src/parser/progressive.ts";
import { attachmentPayload, essrChunks, framePayload } from "../../../src/parser/serialize.ts";
import { Counter } from "../../../src/primitives/counter.ts";
import { Texter } from "../../../src/primitives/texter.ts";
import { CtrDexV1, CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { sigerToken, token } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_V1_JSON_ICP_BODY as json } from "../../fixtures/external-vectors.ts";

/** Build one admitted frame with a transferable signature group and two ESSR fragments. */
function fixture(major: 1 | 2) {
  // Count semantics come from genus even though the embedded JSON always declares protocol v1.
  const gvrsn = { major, minor: 0 } as const;
  const codes = major === 1 ? CtrDexV1 : CtrDexV2;
  /** Encode one counter from its semantic name and explicit count. */
  const head = (name: string, count: number) =>
    new Counter({ code: codes[name as keyof typeof codes], count, version: gvrsn }).qb64;
  /** Sized wrappers count text quadlets in either genus. */
  const wrap = (name: string, wire: string) => t(Counter.enclose({ code: name, qb64: wire, version: gvrsn }));
  // Real primitive qualification preserves the omitted inner controller counter on reconstruction.
  const signatures = head("ControllerIdxSigs", major === 1 ? 1 : 22) + sigerToken();
  const trans = token("B") + token("0A") + token("E") + signatures;
  const group = head("TransIdxSigGroups", major === 1 ? 1 : trans.length / 4) + trans;
  // Canonical wire contains token boundaries but never the enclosing ESSR counter.
  const wire = new Texter({ code: "4B", raw: b("abc") }).qb64 + new Texter({ code: "4B", raw: b("xyz") }).qb64;
  const essr = head("ESSRPayloadGroup", major === 1 ? 2 : wire.length / 4) + wire;
  const body = wrap("NonNativeBodyGroup", new Texter({ code: "4B", raw: b(json) }).qb64);
  const frame = t(Counter.makeGVC(gvrsn)) + wrap("BodyWithAttachmentGroup", body + group + essr);
  return { gvrsn, head, wrap, signatures, group, wire, essr, body, frame };
}

/** Feed owned irregular slices so source partitioning cannot decide token boundaries. */
async function* source(bytes: Uint8Array, width = 19): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += width) yield bytes.slice(offset, offset + width);
}

/** Read a single explicitly enclosed fixture and release only its upstream iterator. */
async function read(bytes: Uint8Array): Promise<CesrFrame> {
  // Returning the parser does not revoke the delivered payload owner.
  const parser = parse(source(bytes));
  try {
    const first = await parser.next();
    assertEquals(first.done, false);
    return first.value as CesrFrame;
  } finally {
    await parser.return(undefined);
  }
}

Deno.test("frame serialization normalizes both genera/domains and preserves inner signature counters", async () => {
  for (const incoming of [1, 2] as const) {
    // Both source qualifications hydrate identical semantic frames.
    const original = fixture(incoming);
    for (const encode of [b, decodeB64]) {
      const frame = await read(encode(original.frame));
      try {
        for (const major of [1, 2] as const) {
          const expected = fixture(major);
          for (const domain of ["txt", "bny"] as const) {
            // Only one admitted frame is collected here; production consumers iterate open().
            const output = framePayload(frame, { gvrsn: expected.gvrsn, domain });
            const roundtrip = await read(await collectPayload(output));
            try {
              assertEquals(roundtrip.body.raw, b(json));
              assertEquals(roundtrip.attachments.length, 1);
              assertEquals(roundtrip.attachments[0].version, expected.gvrsn);
              assertEquals(
                roundtrip.attachments[0].raw,
                domain === "txt" ? b(expected.group) : decodeB64(expected.group),
              );
              assertExists(roundtrip.essr);
              assertEquals(roundtrip.essr.count, 2);
              assertEquals(await collectPayload(roundtrip.essr.raw), b("abcxyz"));
            } finally {
              await roundtrip.essr?.discard();
            }
          }
        }
      } finally {
        await frame.essr?.discard();
      }
    }
  }
});

Deno.test("flattened wrapper-local genera serialize as one legal attachment genus", async () => {
  // Input accepts nested local selectors; output cannot place selectors between KERIpy attachment leaves.
  const one = fixture(1);
  const two = fixture(2);
  const nested = two.wrap("AttachmentGroup", t(Counter.makeGVC(one.gvrsn)) + one.group);
  const wire = t(Counter.makeGVC(two.gvrsn))
    + two.wrap("BodyWithAttachmentGroup", two.body + two.wrap("AttachmentGroup", nested + two.group + two.essr));
  const frame = await read(b(wire));
  try {
    for (const domain of ["txt", "bny"] as const) {
      const output = attachmentPayload(frame, { gvrsn: two.gvrsn, domain });
      const bytes = await collectPayload(output);
      // Exact bytes prove no hidden selectors and unchanged inner signature qualification.
      const expected = two.wrap("AttachmentGroup", two.group + two.group + two.essr);
      assertEquals(bytes, domain === "txt" ? b(expected) : decodeB64(expected));
    }
  } finally {
    await frame.essr?.discard();
  }
});

Deno.test("ESSR binary serialization carries split quadlets and cancels its source", async () => {
  // Every qualified character is a separate read, including headers and fragment boundaries.
  const value = fixture(1);
  let closed = false;
  const wire: OwnedPayload = {
    size: value.wire.length,
    /** Deliberately split canonical quadlets to exercise the bounded conversion carry. */
    async *open(signal?: AbortSignal) {
      try {
        for (const byte of b(value.wire)) {
          signal?.throwIfAborted();
          yield Uint8Array.of(byte);
        }
      } finally {
        closed = true;
      }
    },
    /** No external storage is owned by this small in-memory fixture. */
    discard: () => Promise.resolve(),
  };
  const essr = essrPayload(wire, 2, 6, value.gvrsn);
  const parts: Uint8Array[] = [];
  for await (const chunk of essrChunks(essr, { domain: "bny" })) parts.push(chunk);
  assertEquals(concatBytes(...parts), decodeB64(value.essr));
  assertEquals(closed, true);
  // Cancellation propagates to the reopened source; earlier reads cannot retain it.
  const controller = new AbortController();
  const iterator = essrChunks(essr, { domain: "bny", signal: controller.signal });
  await iterator.next();
  await iterator.next();
  closed = false;
  controller.abort(new Error("stop serialization"));
  await assertRejects(() => iterator.next(), Error, "stop serialization");
  assertEquals(closed, true);
});

Deno.test("opaque attachment content cannot be silently retagged to another genus", async () => {
  // Pathed content may itself contain counters; changing its enclosing genus does not decode those bytes.
  const value = fixture(1);
  const wire = t(Counter.makeGVC(value.gvrsn))
    + value.wrap("BodyWithAttachmentGroup", value.body + value.wrap("PathedMaterialCouples", "AAAA"));
  const frame = await read(b(wire));
  assertThrows(() => attachmentPayload(frame, { gvrsn: { major: 2, minor: 0 } }), SerializeError, "opaque");
  assertEquals(attachmentPayload(frame, { gvrsn: value.gvrsn }).size > 0, true);
});

Deno.test("detached HTTP attachments use body-inferred enclosure genus before one initial selector", async () => {
  // The JSON body declares v1 while its originally selected attachment stream uses v2.
  const one = fixture(1);
  const two = fixture(2);
  const frame = await read(b(two.frame));
  try {
    const payload = attachmentPayload(frame, { gvrsn: two.gvrsn, enclosingGvrsn: one.gvrsn });
    const expected = one.wrap("AttachmentGroup", t(Counter.makeGVC(two.gvrsn)) + two.group + two.essr);
    assertEquals(await collectPayload(payload), b(expected));
    const roundtrip = await read(concatBytes(b(json), b(expected)));
    try {
      assertEquals(roundtrip.attachments[0].version, two.gvrsn);
      assertExists(roundtrip.essr);
      assertEquals(await collectPayload(roundtrip.essr.raw), b("abcxyz"));
    } finally {
      await roundtrip.essr?.discard();
    }
  } finally {
    await frame.essr?.discard();
  }
});

Deno.test("genus conversion rejects a transferable signature tuple needing an unsupported big inner counter", async () => {
  // V1 counts signatures; v2 counts each signature's 22 quadlets, so 187 entries overflow its small counter.
  const value = fixture(1);
  const signatures = value.head("ControllerIdxSigs", 187) + sigerToken().repeat(187);
  const trans = value.head("TransIdxSigGroups", 1) + token("B") + token("0A") + token("E") + signatures;
  const frame = await read(
    b(t(Counter.makeGVC(value.gvrsn)) + value.wrap("BodyWithAttachmentGroup", value.body + trans)),
  );
  assertThrows(
    () => attachmentPayload(frame, { gvrsn: { major: 2, minor: 0 } }),
    SerializeError,
    "small inner counter",
  );
});

Deno.test("ESSR serialization rejects a tiny view retaining an oversized reader allocation", async () => {
  // A producer's short visible slice must not conceal an unbounded resident buffer.
  const value = fixture(1);
  const backing = new Uint8Array(1024 * 1024 + 1);
  backing.set(b(value.wire));
  const wire: OwnedPayload = {
    size: value.wire.length,
    /** Return the hostile view exactly as a foreign sink reader could. */
    async *open() {
      yield backing.subarray(0, value.wire.length);
    },
    /** The fixture owns no resource beyond the local allocation. */
    discard: () => Promise.resolve(),
  };
  const essr = essrPayload(wire, 2, 6, value.gvrsn);
  await assertRejects(
    async () => {
      for await (const _chunk of essrChunks(essr)) { /* Drain to the producer admission boundary. */ }
    },
    SerializeError,
    "backing allocation",
  );
});
