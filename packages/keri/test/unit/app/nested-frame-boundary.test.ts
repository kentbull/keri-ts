import { run } from "effection";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { b, essrPayload, MemoryPayloadSink, parseBytes } from "../../../../cesr/mod.ts";
import vectors from "../../../../cesr/test/fixtures/nested-vectors.json" with { type: "json" };
import { inspectCesrStream } from "../../../src/app/cesr-http.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { envelopeFromFrame } from "../../../src/app/parsering.ts";
import { Reactor } from "../../../src/app/reactor.ts";

Deno.test("nested runtime boundaries reject before processing and release child-only ESSR", async () => {
  const [frame] = await parseBytes(b(vectors.rows[0].qb64));
  assertThrows(() => envelopeFromFrame(frame), Error, "nested message trees");
  await assertRejects(() => inspectCesrStream(b(vectors.rows[0].qb64)), Error, "nested message trees");
  const sink = new MemoryPayloadSink(32);
  await sink.write(b("4BABYWJj"));
  const owner = await sink.finish();
  let discarded = 0;
  frame.nests![0].essr = essrPayload(
    {
      size: owner.size,
      /** Delegate reads to the real finite owner. */
      open: (signal) => owner.open(signal),
      /** Confirm runtime scope teardown releases the child exactly once. */
      async discard() {
        discarded++;
        await owner.discard();
      },
    },
    1,
    3,
    { major: 2, minor: 0 },
  );
  await assertRejects(
    () =>
      run(function*() {
        const hby = yield* createHabery({
          name: `nested-boundary-${crypto.randomUUID()}`,
          temp: true,
          skipConfig: true,
        });
        try {
          yield* new Reactor(hby).settle(frame);
        } finally {
          yield* hby.close();
        }
      }),
    Error,
    "nested message trees",
  );
  assertEquals(discarded, 1);
});
