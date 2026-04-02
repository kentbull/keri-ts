import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { Diger, Prefixer, SerderKERI } from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { Revery } from "../../../src/core/routing.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";

Deno.test("Revery.acceptReply aggregates weighted reply signatures until the threshold is met", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `revery-weighted-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("weighted", undefined, {
        transferable: true,
        icount: 2,
        isith: ["1/2", "1/2"],
        ncount: 2,
        nsith: ["1/2", "1/2"],
        toad: 0,
      });
      const kever = hab.kever;
      assertExists(kever);

      const serder = new SerderKERI({
        sad: {
          t: "rpy",
          dt: makeNowIso8601(),
          r: "/weighted/reply",
          a: {
            aid: hab.pre,
          },
        },
        makify: true,
      });
      const saider = new Diger({ qb64: serder.said ?? "" });
      const sigers = hab.sign(serder.raw, true);
      const makeGroup = (groupSigs: typeof sigers) =>
        new TransIdxSigGroup(
          new Prefixer({ qb64: hab.pre }),
          kever.sner,
          new Diger({ qb64: kever.said }),
          groupSigs,
        );
      const replyVerifier = new Revery(hby.db);

      const firstAccepted = replyVerifier.acceptReply({
        serder,
        saider,
        route: "/weighted/reply",
        aid: hab.pre,
        tsgs: [makeGroup([sigers[0]])],
      });
      assertEquals(firstAccepted, false);
      assertEquals(
        hby.db.ssgs.get([saider.qb64, hab.pre, kever.sner.numh, kever.said]).length,
        1,
      );

      const secondAccepted = replyVerifier.acceptReply({
        serder,
        saider,
        route: "/weighted/reply",
        aid: hab.pre,
        tsgs: [makeGroup([sigers[1]])],
      });
      assertEquals(secondAccepted, true);
      assertExists(hby.db.rpys.get([saider.qb64]));
      assertEquals(
        hby.db.ssgs.get([saider.qb64, hab.pre, kever.sner.numh, kever.said]).length,
        2,
      );
    } finally {
      yield* hby.close(true);
    }
  });
});
