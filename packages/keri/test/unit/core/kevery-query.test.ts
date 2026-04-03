import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { Diger, Prefixer, SerderKERI } from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { Kevery } from "../../../src/core/eventing.ts";
import { Revery } from "../../../src/core/routing.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";

function replySigGroup(
  hab: {
    pre: string;
    kever: { sner: TransIdxSigGroup["seqner"]; said: string };
    sign: (ser: Uint8Array) => TransIdxSigGroup["sigers"];
  },
  serder: SerderKERI,
): TransIdxSigGroup {
  return new TransIdxSigGroup(
    new Prefixer({ qb64: hab.pre }),
    hab.kever.sner,
    new Diger({ qb64: hab.kever.said }),
    hab.sign(serder.raw),
  );
}

Deno.test("Kevery.processQuery emits a key-state reply cue for the queried prefix", async () => {
  await run(function* () {
    const hby = yield* createHabery({
      name: `kevery-ksn-qry-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const kvy = new Kevery(hby.db);
      const serder = new SerderKERI({
        sad: {
          t: "qry",
          dt: makeNowIso8601(),
          r: "ksn",
          rr: "",
          q: { i: hab.pre, src: hab.pre },
        },
        makify: true,
      });

      kvy.processQuery({
        serder,
        cigars: [],
        tsgs: [],
      });

      const cue = kvy.cues.pull();
      assertExists(cue);
      assertEquals(cue.kin, "reply");
      if (cue.kin !== "reply") {
        throw new Error("Expected reply cue.");
      }
      assertEquals(cue.route, `/ksn/${hab.pre}`);
      assertEquals(cue.data?.i, hab.pre);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery reply routing persists `/ksn` key-state notices through `knas.` and `ksns.`", async () => {
  await run(function* () {
    const hby = yield* createHabery({
      name: `kevery-ksn-rpy-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const kever = hab.kever;
      assertExists(kever);

      const rvy = new Revery(hby.db);
      const kvy = new Kevery(hby.db, { rvy });
      kvy.registerReplyRoutes(rvy.rtr);

      const serder = new SerderKERI({
        sad: {
          t: "rpy",
          dt: makeNowIso8601(),
          r: `/ksn/${hab.pre}`,
          a: kever.state().asDict(),
        },
        makify: true,
      });

      rvy.processReply({
        serder,
        tsgs: [replySigGroup({
          pre: hab.pre,
          kever,
          sign: (ser) => hab.sign(ser, true),
        }, serder)],
      });

      const ksnSaid = kever.state().d ?? "";
      assertExists(hby.db.kdts.get([ksnSaid]));
      assertEquals(hby.db.ksns.get([ksnSaid])?.i, hab.pre);
      assertEquals(hby.db.knas.get([hab.pre, hab.pre])?.qb64, ksnSaid);
    } finally {
      yield* hby.close(true);
    }
  });
});
