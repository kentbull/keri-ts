import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { b } from "../../../src/core/bytes.ts";
import { ShortageError } from "../../../src/core/errors.ts";
import { collectPayload, MemoryPayloadSink, type PayloadSink } from "../../../src/core/payload.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { Counter } from "../../../src/primitives/counter.ts";
import { Texter } from "../../../src/primitives/texter.ts";
import { CtrDexV1 } from "../../../src/tables/counter-codex.ts";
import { KERIPY_V1_JSON_ICP_BODY } from "../../fixtures/external-vectors.ts";

/** Enclose one real protocol body and one ESSR item with an explicit frame boundary. */
function frame(raw: Uint8Array): string {
  // Qualify the JSON body so counted enclosure lengths stay quadlet-aligned.
  const body = new Texter({ raw: b(KERIPY_V1_JSON_ICP_BODY), code: "4B" }).qb64;
  const bodyHeader = new Counter({
    code: CtrDexV1.NonNativeBodyGroup,
    count: body.length / 4,
    version: { major: 1, minor: 0 },
  }).qb64;
  // v1 ESSR counts items, while the surrounding frame counts text quadlets.
  const essrHeader = new Counter({ code: CtrDexV1.ESSRPayloadGroup, count: 1, version: { major: 1, minor: 0 } }).qb64;
  const payload = bodyHeader + body + essrHeader + new Texter({ raw, code: "4B" }).qb64;
  const count = payload.length / 4;
  // The small counter holds two count sextets; longer frames need its big form.
  const code = count > 4095 ? CtrDexV1.BigBodyWithAttachmentGroup : CtrDexV1.BodyWithAttachmentGroup;
  return new Counter({ code, count, version: { major: 1, minor: 0 } }).qb64 + payload;
}

/** Record result ownership using real memory payloads and an optional cleanup failure. */
function observed(onFinish: (count: number) => void = () => {}, failFirstDiscard = false) {
  // Finished and released ordinals distinguish collector ownership from unfinished stages.
  let finished = 0;
  const discarded: number[] = [];
  /** Wrap one real stage without changing its size, write or abort behavior. */
  function factory(signal?: AbortSignal): PayloadSink {
    const sink = new MemoryPayloadSink(signal);
    return {
      /** Preserve awaited copying and cancellation at the storage boundary. */
      write: (chunk) => sink.write(chunk),
      /** Observe completed ownership and optionally cancel during result handoff. */
      async finish() {
        const payload = await sink.finish();
        const ordinal = ++finished;
        onFinish(ordinal);
        return {
          size: payload.size,
          /** Keep actual reopenable bytes available until the owner releases them. */
          open: (signal?: AbortSignal) => payload.open(signal),
          /** Record every cleanup attempt, even when one owner reports a failure. */
          async discard() {
            discarded.push(ordinal);
            await payload.discard();
            if (failFirstDiscard && ordinal === 1) throw new Error("storage cleanup failed");
          },
        };
      },
      /** Leave unfinished-stage cleanup with the progressive parser. */
      abort: () => sink.abort(),
    };
  }
  return { factory, discarded };
}

Deno.test("complete input parsing accepts large backing buffers and transfers ordered payloads", async () => {
  // A large input remains valid without a parser backing-allocation quota.
  const raw = new Uint8Array(1024 ** 2 + 1).fill(37);
  const frames = await parseBytes(b(frame(raw) + frame(b("second"))));
  try {
    assertEquals(frames.length, 2);
    assertExists(frames[0].essr);
    assertExists(frames[1].essr);
    assertEquals(await collectPayload(frames[0].essr.raw), raw);
    assertEquals(await collectPayload(frames[1].essr.raw), b("second"));
    assertEquals(await parseBytes(new Uint8Array()), []);
  } finally {
    // Successful collection transfers ownership to the finite-input caller.
    for (const parsed of frames) await parsed.essr?.discard();
  }
});

Deno.test("complete input failure releases all collected siblings despite a cleanup failure", async () => {
  // A later truncated counter fails only after two independently complete children.
  const owners = observed(undefined, true);
  const failure = await assertRejects(
    () => parseBytes(b(frame(b("first")) + frame(b("second")) + "-A"), { payloadSink: owners.factory }),
    AggregateError,
  );
  assertEquals(failure.cause instanceof ShortageError, true);
  assertEquals(failure.errors.length, 2);
  assertEquals(owners.discarded, [1, 2]);
});

Deno.test("complete input cancellation releases both collected and not-yet-delivered payloads", async () => {
  const controller = new AbortController();
  // Cancel the second result during finish: the parser owns it, while collection owns the first.
  const owners = observed((count) => {
    if (count === 2) controller.abort(new Error("collection cancelled"));
  });
  await assertRejects(
    () =>
      parseBytes(b(frame(b("first")) + frame(b("second"))), {
        signal: controller.signal,
        payloadSink: owners.factory,
      }),
    Error,
    "collection cancelled",
  );
  assertEquals(owners.discarded, [2, 1]);
});
