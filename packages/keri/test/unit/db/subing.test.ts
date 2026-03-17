import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { createLMDBer } from "../../../src/db/core/lmdber.ts";
import { Suber } from "../../../src/db/subing.ts";

Deno.test("db/subing - Suber uses the configured separator and iterates keys", async () => {
  await run(function* () {
    const lmdber = yield* createLMDBer({
      name: `suber-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const suber = new Suber(lmdber, { subkey: "names.", sep: "^" });
      assertEquals(suber.put(["", "alice"], "EPrefix"), true);
      assertEquals(suber.get(["", "alice"]), "EPrefix");
      assertEquals(suber.get("^alice"), "EPrefix");
      assertEquals([...suber.getItemIter("")], [[["", "alice"], "EPrefix"]]);
    } finally {
      yield* lmdber.close(true);
    }
  });
});
