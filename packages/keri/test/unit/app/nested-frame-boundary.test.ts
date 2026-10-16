import { run } from "effection";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { b, parseBytes, Texter } from "../../../../cesr/mod.ts";
import vectors from "../../../../cesr/test/fixtures/nested-vectors.json" with { type: "json" };
import { inspectCesrStream } from "../../../src/app/cesr-http.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { envelopeFromFrame } from "../../../src/app/parsering.ts";
import { Reactor } from "../../../src/app/reactor.ts";

Deno.test("nested runtime boundaries reject unsupported trees before processing", async () => {
  const [frame] = await parseBytes(b(vectors.rows[0].qb64));
  assertThrows(() => envelopeFromFrame(frame), Error, "nested message trees");
  await assertRejects(() => inspectCesrStream(b(vectors.rows[0].qb64)), Error, "nested message trees");
  frame.nests![0].essrs = [new Texter({ raw: b("abc"), code: "4B" })];
  await assertRejects(
    () =>
      run(function*() {
        const hby = yield* createHabery({
          name: `nested-boundary-${crypto.randomUUID()}`,
          temp: true,
          skipConfig: true,
        });
        try {
          yield* new Reactor(hby).dispatch(frame);
        } finally {
          yield* hby.close();
        }
      }),
    Error,
    "nested message trees",
  );
  assertEquals(frame.nests![0].essrs[0].text, "abc");
});
