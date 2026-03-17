import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { encodeDateTimeToDater } from "../../../src/app/keeping.ts";
import { createBaser } from "../../../src/db/basing.ts";

Deno.test("db/basing - Baser binds DB-backed state and record stores", async () => {
  await run(function* () {
    const baser = yield* createBaser({
      name: `baser-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const dater = encodeDateTimeToDater("2026-03-16T12:34:56.000000+00:00");
      assertEquals(baser.putKel("Epre", 0, "Esaid"), true);
      assertEquals(baser.appendFel("Epre", "Esaid"), 0);
      assertEquals(baser.putDts("Epre", "Esaid", dater), true);
      assertEquals(baser.pinState("Epre", { i: "Epre", d: "Esaid", k: ["Dkey"], n: [] }), true);
      assertEquals(baser.pinHab("Epre", { hid: "Epre", name: "alice" }), true);
      assertEquals(baser.ends.pin(["cid", "watcher", "eid"], { allowed: true }), true);
      assertEquals(baser.oobis.pin("https://example.com/oobi", { cid: "Epre" }), true);
      assertEquals(baser.wkas.put("Epre", [{ url: "https://example.com/.well-known/keri/oobi/Epre", dt: "2026-03-16T12:34:56.000000+00:00" }]), true);

      assertEquals(baser.getKel("Epre", 0), "Esaid");
      assertEquals(baser.getFel("Epre", 0), "Esaid");
      assertEquals(baser.getFelFn("Epre", "Esaid"), 0);
      assertEquals(baser.getDts("Epre", "Esaid"), dater);
      assertEquals(baser.getState("Epre")?.d, "Esaid");
      assertEquals(baser.getHab("Epre")?.name, "alice");
      assertEquals(baser.ends.get(["cid", "watcher", "eid"])?.allowed, true);
      assertEquals(baser.oobis.get("https://example.com/oobi")?.cid, "Epre");
      assertEquals(baser.wkas.get("Epre")[0]?.url.includes("/.well-known/"), true);
    } finally {
      yield* baser.close(true);
    }
  });
});
