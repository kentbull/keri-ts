import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { Dater, Diger, Prefixer, SerderKERI } from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { UnverifiedReplyError } from "../../../src/core/errors.ts";
import { Revery } from "../../../src/core/routing.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../../../src/time/mod.ts";

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
        hby.db.ssgs.get([saider.qb64, hab.pre, kever.sner.numh, kever.said])
          .length,
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
        hby.db.ssgs.get([saider.qb64, hab.pre, kever.sner.numh, kever.said])
          .length,
        2,
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery.acceptReply verifies non-transferable ECDSA reply cigars via verifier dispatch", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `revery-ecdsa-nontrans-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("nontrans-r1", undefined, {
        transferable: false,
        icode: "Q",
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const serder = new SerderKERI({
        sad: {
          t: "rpy",
          dt: makeNowIso8601(),
          r: "/ecdsa/nontrans",
          a: { aid: hab.pre },
        },
        makify: true,
      });
      const saider = new Diger({ qb64: serder.said ?? "" });
      const cigars = hab.sign(serder.raw, false);
      const replyVerifier = new Revery(hby.db);

      const accepted = replyVerifier.acceptReply({
        serder,
        saider,
        route: "/ecdsa/nontrans",
        aid: hab.pre,
        cigars: [cigars[0]],
      });

      assertEquals(accepted, true);
      assertExists(hby.db.rpys.get([saider.qb64]));
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery.acceptReply still rejects non-transferable replies whose authorizing AID does not match the verifier", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `revery-ecdsa-mismatch-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("nontrans-r1", undefined, {
        transferable: false,
        icode: "Q",
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const serder = new SerderKERI({
        sad: {
          t: "rpy",
          dt: makeNowIso8601(),
          r: "/ecdsa/mismatch",
          a: { aid: hab.pre },
        },
        makify: true,
      });
      const saider = new Diger({ qb64: serder.said ?? "" });
      const cigars = hab.sign(serder.raw, false);
      const replyVerifier = new Revery(hby.db);

      const accepted = replyVerifier.acceptReply({
        serder,
        saider,
        route: "/ecdsa/mismatch",
        aid: "BAD-AID",
        cigars: [cigars[0]],
      });

      assertEquals(accepted, false);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery.acceptReply verifies transferable ECDSA reply signature groups via establishment verfers", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `revery-ecdsa-trans-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("trans-k1", undefined, {
        transferable: true,
        icode: "J",
        icount: 1,
        isith: "1",
        ncode: "J",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const kever = hab.kever;
      assertExists(kever);

      const serder = new SerderKERI({
        sad: {
          t: "rpy",
          dt: makeNowIso8601(),
          r: "/ecdsa/trans",
          a: { aid: hab.pre },
        },
        makify: true,
      });
      const saider = new Diger({ qb64: serder.said ?? "" });
      const sigers = hab.sign(serder.raw, true);
      const replyVerifier = new Revery(hby.db);

      const accepted = replyVerifier.acceptReply({
        serder,
        saider,
        route: "/ecdsa/trans",
        aid: hab.pre,
        tsgs: [
          new TransIdxSigGroup(
            new Prefixer({ qb64: hab.pre }),
            kever.sner,
            new Diger({ qb64: kever.said }),
            sigers,
          ),
        ],
      });

      assertEquals(accepted, true);
      assertExists(hby.db.rpys.get([saider.qb64]));
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery.processEscrowReply keeps replies on recoverable UnverifiedReplyError replay", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `revery-escrow-keep-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("reply-keep", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const kever = hab.kever;
      assertExists(kever);

      const serder = new SerderKERI({
        sad: {
          t: "rpy",
          dt: makeNowIso8601(),
          r: "/escrow/reply",
          a: { aid: hab.pre },
        },
        makify: true,
      });
      const saider = new Diger({ qb64: serder.said ?? "" });
      const replyVerifier = new Revery(hby.db);
      replyVerifier.escrowReply({
        serder,
        saider,
        dater: new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) }),
        route: "/escrow/reply",
        prefixer: new Prefixer({ qb64: hab.pre }),
        seqner: kever.sner,
        diger: new Diger({ qb64: kever.said }),
        sigers: hab.sign(serder.raw, true),
      });

      const original = replyVerifier.processReply.bind(replyVerifier);
      (
        replyVerifier as unknown as {
          processReply(
            args: { serder: SerderKERI; tsgs: TransIdxSigGroup[] },
          ): void;
        }
      ).processReply = () => {
        throw new UnverifiedReplyError("retry later");
      };

      try {
        replyVerifier.processEscrowReply();
      } finally {
        (
          replyVerifier as unknown as {
            processReply: typeof original;
          }
        ).processReply = original;
      }

      assertEquals(hby.db.rpes.get(["/escrow/reply"]).length, 1);
      assertExists(hby.db.rpys.get([saider.qb64]));
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery.processEscrowReply drops malformed escrow artifacts and removes stored reply state", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `revery-escrow-drop-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("reply-drop", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const kever = hab.kever;
      assertExists(kever);

      const serder = new SerderKERI({
        sad: {
          t: "rpy",
          dt: makeNowIso8601(),
          r: "/escrow/reply",
          a: { aid: hab.pre },
        },
        makify: true,
      });
      const saider = new Diger({ qb64: serder.said ?? "" });
      const replyVerifier = new Revery(hby.db);
      replyVerifier.escrowReply({
        serder,
        saider,
        dater: new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) }),
        route: "/escrow/reply",
        prefixer: new Prefixer({ qb64: hab.pre }),
        seqner: kever.sner,
        diger: new Diger({ qb64: kever.said }),
        sigers: hab.sign(serder.raw, true),
      });

      hby.db.rpys.rem([saider.qb64]);
      replyVerifier.processEscrowReply();

      assertEquals(hby.db.rpes.get(["/escrow/reply"]).length, 0);
      assertEquals(hby.db.rpys.get([saider.qb64]), null);
      assertEquals(hby.db.sdts.get([saider.qb64]), null);
      assertEquals(hby.db.ssgs.get([saider.qb64]).length, 0);
    } finally {
      yield* hby.close(true);
    }
  });
});
