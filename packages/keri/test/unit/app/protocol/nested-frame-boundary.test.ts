import { run } from "effection";
import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { b, parseBytes, Texter } from "../../../../../cesr/mod.ts";
import vectors from "../../../../../cesr/test/fixtures/nested-vectors.json" with { type: "json" };
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { Reactor } from "../../../../src/app/protocol/reactor.ts";
import { inspectCesrStream } from "../../../../src/app/transport/cesr-http.ts";
import { reply } from "../../../../src/core/protocol-eventing.ts";
import { protocolFixture } from "../../../protocol-fixture.ts";

/** The refusal detail of a remote frame whose children no consumer owns. */
const NESTED_REFUSAL = "KERI runtime normalization does not yet support nested message trees";

Deno.test("nested runtime boundaries reject unsupported trees before processing", async () => {
  const [frame] = await parseBytes(b(vectors.rows[0].qb64));
  assertThrows(() => envelopeFromFrame(frame), Error, "nested message trees");
  await assertRejects(() => inspectCesrStream(b(vectors.rows[0].qb64)), Error, "nested message trees");
  frame.nests![0].essrs = [new Texter({ raw: b("abc"), code: "4B" })];
  await run(function*() {
    const hby = yield* createHabery({
      name: `nested-boundary-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    try {
      // A remote frame is refused as one invalid message; it does not end the input or the runtime.
      const { decision } = yield* protocolFixture(hby).dispatch(frame);
      assertEquals(decision, { kind: "drop", reason: "invalidMessage", detail: NESTED_REFUSAL });
    } finally {
      yield* hby.close();
    }
  });
  assertEquals(frame.nests![0].essrs[0].text, "abc");
});

Deno.test("a non-exn frame carrying a nested message is dropped", async () => {
  const [reference] = parseBytes(b(vectors.rows[0].qb64));
  await run(function*() {
    const hby = yield* createHabery({ name: `nested-boundary-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    try {
      const body = reply("/end/role/add", { cid: "", role: "mailbox", eid: "" });
      const { decision } = yield* protocolFixture(hby).dispatch({ ...reference, body });
      assertEquals(decision, { kind: "drop", reason: "invalidMessage", detail: NESTED_REFUSAL });
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("XIP child normalization belongs only to the existing IPEX disclosure routes", async () => {
  const { exincept } = await import("../../../../src/core/exchange/protocol-exchanging.ts");
  const [reference] = parseBytes(b(vectors.rows[0].qb64));
  for (const route of ["/fwd", "/multisig/icp", "/transaction", "/ipex/apply"]) {
    const body = exincept(route);
    assertThrows(() => envelopeFromFrame({ ...reference, body }), Error, "nested message trees");
  }
  for (const route of ["/ipex/offer", "/ipex/grant"]) {
    const body = exincept(route);
    assertEquals(envelopeFromFrame({ ...reference, body }).nests.length, reference.nests!.length);
  }
});
