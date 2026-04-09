// @file-test-lane core-fast

import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { Dater, Diger, Prefixer, SerderKERI } from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { Revery, unverifiedReplyDecision } from "../../../src/core/routing.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../../../src/time/mod.ts";
import { expectKind, routingTestApi } from "../../private-access.ts";

function createEscrowedReplyFixture(
  hby: {
    db: Revery["db"];
    makeHab(
      name: string,
      transferable?: unknown,
      options?: {
        transferable: true;
        icount: number;
        isith: string;
        ncount: number;
        nsith: string;
        toad: number;
      },
    ): {
      pre: string;
      kever: { sner: TransIdxSigGroup["seqner"]; said: string } | null;
      sign: (ser: Uint8Array, indexed: true) => TransIdxSigGroup["sigers"];
    };
  },
  name: string,
  route: string,
) {
  const hab = hby.makeHab(name, undefined, {
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
      r: route,
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
    route,
    prefixer: new Prefixer({ qb64: hab.pre }),
    seqner: kever.sner,
    diger: new Diger({ qb64: kever.said }),
    sigers: hab.sign(serder.raw, true),
  });

  return { hab, kever, serder, saider, replyVerifier };
}

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

      const firstDecision = replyVerifier.acceptReply({
        serder,
        saider,
        route: "/weighted/reply",
        aid: hab.pre,
        tsgs: [makeGroup([sigers[0]])],
      });
      assertEquals(firstDecision.kind, "unverified");
      assertEquals(
        hby.db.ssgs.get([saider.qb64, hab.pre, kever.sner.numh, kever.said])
          .length,
        1,
      );

      const secondDecision = replyVerifier.acceptReply({
        serder,
        saider,
        route: "/weighted/reply",
        aid: hab.pre,
        tsgs: [makeGroup([sigers[1]])],
      });
      assertEquals(secondDecision.kind, "accept");
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

      const decision = replyVerifier.acceptReply({
        serder,
        saider,
        route: "/ecdsa/nontrans",
        aid: hab.pre,
        cigars: [cigars[0]],
      });

      assertEquals(decision.kind, "accept");
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

      const decision = replyVerifier.acceptReply({
        serder,
        saider,
        route: "/ecdsa/mismatch",
        aid: "BAD-AID",
        cigars: [cigars[0]],
      });

      assertEquals(decision.kind, "unverified");
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

      const decision = replyVerifier.acceptReply({
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

      assertEquals(decision.kind, "accept");
      assertExists(hby.db.rpys.get([saider.qb64]));
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Revery.processEscrowReply keeps replies on recoverable unverified replay decisions", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `revery-escrow-keep-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const { replyVerifier, saider } = createEscrowedReplyFixture(
        hby,
        "reply-keep",
        "/escrow/reply",
      );
      replyVerifier.rtr.addRoute("/escrow/reply", {
        processReply() {
          return unverifiedReplyDecision("retry later");
        },
      });
      replyVerifier.processEscrowReply();

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
      const { replyVerifier, saider } = createEscrowedReplyFixture(
        hby,
        "reply-drop",
        "/escrow/reply",
      );

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

Deno.test("Revery escrow replay preserves processing error detail on drop decisions", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `revery-escrow-processing-detail-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const { replyVerifier, saider } = createEscrowedReplyFixture(
        hby,
        "reply-detail",
        "/escrow/reply/detail",
      );
      replyVerifier.rtr.addRoute("/escrow/reply/detail", {
        processReply() {
          throw new Error("boom");
        },
      });
      const decision = routingTestApi(replyVerifier).reprocessEscrowedReply(
        saider,
      );

      const drop = expectKind(decision, "drop");
      assertEquals(drop.reason, "processingError");
      assertEquals(drop.message, "boom");
      assertEquals(drop.context?.said, saider.qb64);
    } finally {
      yield* hby.close(true);
    }
  });
});
