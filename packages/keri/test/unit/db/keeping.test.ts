import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { NumberPrimitive, Prefixer } from "../../../../cesr/mod.ts";
import { encodeHugeNumber, saltySigner } from "../../../src/app/keeping.ts";
import { createKeeper } from "../../../src/db/keeping.ts";

Deno.test("db/keeping - Keeper round-trips group member tuple stores", async () => {
  await run(function*() {
    const keeper = yield* createKeeper({
      name: `keeper-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const member = new Prefixer({
        qb64: saltySigner(
          "0AAwMTIzNDU2Nzg5YWJjZGVm",
          "member-a",
          true,
          "low",
          true,
        ).verferQb64,
      });
      const ordinal = new NumberPrimitive({ qb64: encodeHugeNumber(1) });

      assertEquals(keeper.putSmids("group-a", [[member, ordinal]]), true);
      assertEquals(keeper.putRmids("group-a", [[member, ordinal]]), true);
      assertEquals(keeper.getSmids("group-a")[0]?.[0].qb64, member.qb64);
      assertEquals(keeper.getSmids("group-a")[0]?.[1].num, 1n);
      assertEquals(keeper.getRmids("group-a")[0]?.[0].qb64, member.qb64);
      assertEquals(keeper.getRmids("group-a")[0]?.[1].num, 1n);
    } finally {
      yield* keeper.close(true);
    }
  });
});
