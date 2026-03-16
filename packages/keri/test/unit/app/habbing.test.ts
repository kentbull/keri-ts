import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { createHabery } from "../../../src/app/habbing.ts";

Deno.test("Habery eagerly loads persisted habitats on open", async () => {
  const name = `habery-load-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
  const alias = "alice";

  await run(function* () {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const hab = hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      assertEquals(hby.habs.get(hab.pre)?.name, alias);
    } finally {
      yield* hby.close();
    }
  });

  await run(function* () {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      assertEquals(hby.habs.size, 1);
      const hab = [...hby.habs.values()][0];
      assertEquals(hab?.name, alias);
      assertEquals(hby.habByName(alias)?.pre, hab?.pre);
    } finally {
      yield* hby.close();
    }
  });
});
