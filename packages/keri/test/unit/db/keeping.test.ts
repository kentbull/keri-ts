import { run } from "effection";
import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import {
  Cigar,
  Diger,
  NumberPrimitive,
  Prefixer,
  Siger,
  Verfer,
} from "../../../../cesr/mod.ts";
import {
  encodeHugeNumber,
  Manager,
  saltySigner,
} from "../../../src/app/keeping.ts";
import { createKeeper } from "../../../src/db/keeping.ts";

Deno.test("db/keeping - Keeper round-trips group member tuple stores", async () => {
  await run(function* () {
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
        ).verfer.qb64,
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

Deno.test("app/keeping - Manager returns narrow CESR primitives for inception and signing", async () => {
  await run(function* () {
    const keeper = yield* createKeeper({
      name: `manager-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const manager = new Manager({
        ks: keeper,
        salt: "0AAwMTIzNDU2Nzg5YWJjZGVm",
      });
      const [verfers, digers] = manager.incept({
        icount: 1,
        ncount: 1,
        transferable: true,
        temp: true,
      });
      const ser = new TextEncoder().encode("keri-ts");
      const sigers = manager.sign(ser, [verfers[0].qb64], true);
      const cigars = manager.sign(ser, [verfers[0].qb64], false);

      assertInstanceOf(verfers[0], Verfer);
      assertInstanceOf(digers[0], Diger);
      assertInstanceOf(sigers[0], Siger);
      assertInstanceOf(cigars[0], Cigar);
    } finally {
      yield* keeper.close(true);
    }
  });
});
