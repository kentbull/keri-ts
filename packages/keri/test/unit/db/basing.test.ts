// @file-test-lane db-fast

import { run } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { CtrDexV1, parseCounterFromText, Siger, Signer, Vrsn_1_0 } from "../../../../cesr/mod.ts";
import { incept } from "../../../src/core/protocol-eventing.ts";
import { Baser, BaserDoer, createBaser } from "../../../src/db/basing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { encodeDateTimeToDater } from "../../../src/time/mod.ts";

Deno.test("db/basing - Baser binds DB-backed state and record stores", async () => {
  await run(function*() {
    const baser = yield* createBaser({
      name: `baser-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const dater = encodeDateTimeToDater("2026-03-16T12:34:56.000000+00:00");
      assertEquals(baser.kels.add("Epre", 0, "Esaid"), true);
      assertEquals(baser.kels.add("Epre", 1, "Esaid1"), true);
      assertEquals(baser.appendFel("Epre", "Esaid"), 0);
      assertEquals(baser.putDts("Epre", "Esaid", dater), true);
      assertEquals(
        baser.pinState("Epre", { i: "Epre", d: "Esaid", k: ["Dkey"], n: [] }),
        true,
      );
      assertEquals(baser.pinHab("Epre", { hid: "Epre", name: "alice" }), true);
      assertEquals(
        baser.ends.pin(["cid", "watcher", "eid"], { allowed: true }),
        true,
      );
      assertEquals(
        baser.oobis.pin("https://example.com/oobi", { cid: "Epre" }),
        true,
      );
      assertEquals(
        baser.wkas.put("Epre", [{
          url: "https://example.com/.well-known/keri/oobi/Epre",
          dt: "2026-03-16T12:34:56.000000+00:00",
        }]),
        true,
      );

      assertEquals(baser.kels.getLast("Epre", 0), "Esaid");
      assertEquals([...baser.getKelItemIter("Epre")], [
        [0, "Esaid"],
        [1, "Esaid1"],
      ]);
      assertEquals(baser.getFel("Epre", 0), "Esaid");
      assertEquals(baser.getFelFn("Epre", "Esaid"), 0);
      assertEquals(baser.getDts("Epre", "Esaid"), dater);
      assertEquals(baser.getState("Epre")?.d, "Esaid");
      assertEquals(baser.getHab("Epre")?.name, "alice");
      assertEquals(baser.ends.get(["cid", "watcher", "eid"])?.allowed, true);
      assertEquals(baser.oobis.get("https://example.com/oobi")?.cid, "Epre");
      assertEquals(
        baser.wkas.get("Epre")[0]?.url.includes("/.well-known/"),
        true,
      );
    } finally {
      yield* baser.close(true);
    }
  });
});

Deno.test("db/basing - BaserDoer reopens closed basers and clears temp stores on exit", async () => {
  let tempPath: string | null = null;

  await run(function*() {
    const baser = new Baser({
      name: `baser-doer-${crypto.randomUUID()}`,
      temp: true,
    });
    const doer = new BaserDoer(baser);

    assertEquals(baser.opened, false);
    yield* doer.enter();
    assertEquals(baser.opened, true);
    tempPath = baser.path;
    assertExists(tempPath);

    yield* doer.exit();
    assertEquals(baser.opened, false);
    assertEquals(baser.path, null);
  });

  await assertRejects(() => Deno.stat(tempPath!));
});

Deno.test("db/basing - cloneEvtMsg emits v1 replay counters", async () => {
  await run(function*() {
    const baser = yield* createBaser({
      name: `baser-clone-evt-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const signer = Signer.random({ transferable: true });
      const serder = incept([signer.verfer.qb64]);
      const pre = serder.pre!;
      const said = serder.said!;
      const key = dgKey(pre, said);
      const siger = signer.sign(serder.raw, { index: 0 }) as Siger;
      const dater = encodeDateTimeToDater("2026-03-16T12:34:56.000000+00:00");

      assertEquals(baser.evts.put(key, serder), true);
      assertEquals(baser.sigs.put(key, [siger]), true);
      assertEquals(baser.appendFel(pre, said), 0);
      assertEquals(baser.putDts(pre, said, dater), true);

      const message = baser.cloneEvtMsg(pre, 0, said);
      let offset = serder.raw.length;
      const group = parseCounterFromText(message.slice(offset), Vrsn_1_0);
      offset += group.fullSize;
      const signatures = parseCounterFromText(message.slice(offset), Vrsn_1_0);
      offset += signatures.fullSize + siger.qb64b.length;
      const firstSeen = parseCounterFromText(message.slice(offset), Vrsn_1_0);

      assertEquals(group.code, CtrDexV1.AttachmentGroup);
      assertEquals(signatures.code, CtrDexV1.ControllerIdxSigs);
      assertEquals(firstSeen.code, CtrDexV1.FirstSeenReplayCouples);
    } finally {
      yield* baser.close(true);
    }
  });
});
