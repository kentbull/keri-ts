import { run } from "effection";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { b, parseBytes, Texter } from "../../../../../cesr/mod.ts";
import vectors from "../../../../../cesr/test/fixtures/nested-vectors.json" with { type: "json" };
import { createHabery } from "../../../../src/app/identity/habbing.ts";
import { envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { Reactor } from "../../../../src/app/protocol/reactor.ts";
import { inspectCesrStream } from "../../../../src/app/transport/cesr-http.ts";
import { protocolFixture } from "../../../protocol-fixture.ts";

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
          yield* protocolFixture(hby).dispatch(frame);
        } finally {
          yield* hby.close();
        }
      }),
    Error,
    "nested message trees",
  );
  assertEquals(frame.nests![0].essrs[0].text, "abc");
});
