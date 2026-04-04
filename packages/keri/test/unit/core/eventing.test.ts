import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { ed25519 } from "npm:@noble/curves@1.9.7/ed25519";
import { Diger, SerderKERI, Siger, type Tier } from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { saltySigner } from "../../../src/app/keeping.ts";
import { SourceSealCouple } from "../../../src/core/dispatch.ts";
import { Kevery } from "../../../src/core/eventing.ts";

const textEncoder = new TextEncoder();

function eventSeal(serder: SerderKERI) {
  assertExists(serder.pre);
  assertExists(serder.snh);
  assertExists(serder.said);
  return { i: serder.pre, s: serder.snh, d: serder.said };
}

function sourceSealFor(serder: SerderKERI): SourceSealCouple {
  assertExists(serder.sner);
  assertExists(serder.said);
  return new SourceSealCouple(serder.sner, new Diger({ qb64: serder.said }));
}

function nextKeyDigest(verferQb64: string): Diger {
  return new Diger({
    code: "E",
    raw: Diger.digest(textEncoder.encode(verferQb64), "E"),
  });
}

function rotationPrm(
  hby: {
    mgr: {
      ks: {
        getPrms(pre: string): {
          pidx: number;
          stem: string;
          salt: string;
          tier: Tier;
        } | null;
      };
    };
  },
  pre: string,
) {
  const prm = hby.mgr.ks.getPrms(pre);
  assertExists(prm);
  return {
    salt: prm.salt,
    tier: prm.tier,
    rootStem: prm.stem || prm.pidx.toString(16),
  };
}

function deriveRotationSigner(
  hby: Parameters<typeof rotationPrm>[0],
  pre: string,
  pathSuffix: string,
) {
  const prm = rotationPrm(hby, pre);
  return saltySigner(
    prm.salt,
    `${prm.rootStem}${pathSuffix}`,
    true,
    prm.tier,
    false,
  );
}

function findCommittedRotationSigner(
  hby: Parameters<typeof rotationPrm>[0],
  pre: string,
  committedDig: string,
) {
  for (let ridx = 0; ridx < 16; ridx++) {
    for (let kidx = 0; kidx < 16; kidx++) {
      const signer = deriveRotationSigner(
        hby,
        pre,
        `${ridx.toString(16)}${kidx.toString(16)}`,
      );
      if (nextKeyDigest(signer.verfer.qb64).qb64 === committedDig) {
        return signer;
      }
    }
  }
  throw new Error(`Unable to derive committed rotation key for ${pre}.`);
}

function signRotation(serder: SerderKERI, seed: Uint8Array): Siger[] {
  const sigRaw = ed25519.sign(serder.raw, seed);
  return [new Siger({ code: "2A", raw: sigRaw, index: 0, ondex: 0 })];
}

function makeDelegatingInteraction(
  pre: string,
  sn: number,
  prior: string,
  seals: ReturnType<typeof eventSeal>[],
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: "ixn",
      i: pre,
      s: sn.toString(16),
      p: prior,
      a: seals,
    },
    makify: true,
  });
}

function makeDelegatedRotation(
  pre: string,
  sn: number,
  prior: string,
  currentKey: string,
  nextDig: string,
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: "drt",
      i: pre,
      s: sn.toString(16),
      p: prior,
      kt: "1",
      k: [currentKey],
      nt: "1",
      n: [nextDig],
      bt: "0",
      br: [],
      ba: [],
      a: [],
    },
    makify: true,
  });
}

Deno.test("Kevery.processEvent returns accept for an in-order local ixn", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-accept-${crypto.randomUUID()}`,
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

      const serder = new SerderKERI({
        sad: {
          t: "ixn",
          i: hab.pre,
          s: "1",
          p: kever.said,
          a: [],
        },
        makify: true,
      });

      const kvy = new Kevery(hby.db, { local: true });
      const decision = kvy.processEvent({
        serder,
        sigers: hab.sign(serder.raw, true),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: true,
      });

      assertEquals(decision.kind, "accept");
      assertEquals(hby.db.getKever(hab.pre)?.sn, 1);
      assertEquals(hby.db.getKever(hab.pre)?.said, serder.said);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.decideEvent returns duplicate for the same accepted inception SAID", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-dup-${crypto.randomUUID()}`,
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
      const serder = hby.db.getEvtSerder(hab.pre, kever.said);
      assertExists(serder);

      const kvy = new Kevery(hby.db);
      const decision = kvy.decideEvent({
        serder,
        sigers: hby.db.sigs.get([hab.pre, kever.said]),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: false,
      });

      assertEquals(decision.kind, "duplicate");
      if (decision.kind !== "duplicate") {
        throw new Error("Expected duplicate decision.");
      }
      assertEquals(decision.duplicate, "sameSaid");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.decideEvent returns ooo escrow for out-of-order ixn", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-ooo-${crypto.randomUUID()}`,
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

      const serder = new SerderKERI({
        sad: {
          t: "ixn",
          i: hab.pre,
          s: "2",
          p: kever.said,
          a: [],
        },
        makify: true,
      });

      const kvy = new Kevery(hby.db);
      const decision = kvy.decideEvent({
        serder,
        sigers: hab.sign(serder.raw, true),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: false,
      });

      assertEquals(decision.kind, "escrow");
      if (decision.kind !== "escrow") {
        throw new Error("Expected escrow decision.");
      }
      assertEquals(decision.reason, "ooo");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.processEvent rejects invalid local ixn without throwing normal control exceptions", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-reject-${crypto.randomUUID()}`,
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

      const serder = new SerderKERI({
        sad: {
          t: "ixn",
          i: hab.pre,
          s: "1",
          p: kever.said,
          a: [],
        },
        makify: true,
      });

      const kvy = new Kevery(hby.db, { local: true });
      const decision = kvy.processEvent({
        serder,
        sigers: [],
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: true,
      });

      assertEquals(decision.kind, "reject");
      if (decision.kind !== "reject") {
        throw new Error("Expected reject decision.");
      }
      assertEquals(decision.code, "invalidThreshold");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery applies weighted threshold satisfaction to local ixn signatures", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-weighted-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const nested = [{ "1": ["1/2", "1/2"] }];
      const hab = hby.makeHab("weighted", undefined, {
        transferable: true,
        icount: 2,
        isith: nested,
        ncount: 2,
        nsith: nested,
        toad: 0,
      });
      const kever = hab.kever;
      assertExists(kever);

      const serder = new SerderKERI({
        sad: {
          t: "ixn",
          i: hab.pre,
          s: "1",
          p: kever.said,
          a: [],
        },
        makify: true,
      });
      const sigers = hab.sign(serder.raw, true);
      const kvy = new Kevery(hby.db, { local: true });

      const partial = kvy.decideEvent({
        serder,
        sigers: [sigers[0]],
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: true,
      });
      assertEquals(partial.kind, "escrow");
      if (partial.kind !== "escrow") {
        throw new Error("Expected weighted partial signature escrow.");
      }
      assertEquals(partial.reason, "partialSigs");

      const accepted = kvy.processEvent({
        serder,
        sigers,
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: true,
      });
      assertEquals(accepted.kind, "accept");
      assertEquals(hby.db.getKever(hab.pre)?.sn, 1);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery accepts superseding delegated recovery when the newer delegating event is later", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-delegated-b1-source-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-delegated-b1-remote-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const delegator = source.makeHab("delegator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const delegate = source.makeHab("delegate", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
        delpre: delegator.pre,
      });
      const kvy = new Kevery(remote.db);
      const delegatorKever = delegator.kever;
      const delegateKever = delegate.kever;
      assertExists(delegatorKever);
      assertExists(delegateKever);

      const delegatorIcp = source.db.getEvtSerder(
        delegator.pre,
        delegatorKever.said,
      );
      const dip = source.db.getEvtSerder(delegate.pre, delegateKever.said);
      assertExists(delegatorIcp);
      assertExists(dip);

      const dipAnchor = makeDelegatingInteraction(
        delegator.pre,
        1,
        delegatorKever.said,
        [eventSeal(dip)],
      );
      const firstRotationSigner = findCommittedRotationSigner(
        source,
        delegate.pre,
        delegateKever.ndigs[0],
      );
      const secondRotationSigner = deriveRotationSigner(
        source,
        delegate.pre,
        "r2",
      );
      const thirdRotationSigner = deriveRotationSigner(
        source,
        delegate.pre,
        "r3",
      );
      const drt1 = makeDelegatedRotation(
        delegate.pre,
        1,
        dip.said!,
        firstRotationSigner.verfer.qb64,
        nextKeyDigest(secondRotationSigner.verfer.qb64).qb64,
      );
      const drt1Anchor = makeDelegatingInteraction(
        delegator.pre,
        2,
        dipAnchor.said!,
        [eventSeal(drt1)],
      );
      const drt2 = makeDelegatedRotation(
        delegate.pre,
        1,
        dip.said!,
        secondRotationSigner.verfer.qb64,
        nextKeyDigest(thirdRotationSigner.verfer.qb64).qb64,
      );
      const drt2Anchor = makeDelegatingInteraction(
        delegator.pre,
        3,
        drt1Anchor.said!,
        [eventSeal(drt2)],
      );

      assertEquals(
        kvy.processEvent({
          serder: delegatorIcp,
          sigers: source.db.sigs.get([delegator.pre, delegatorKever.said]),
          wigers: [],
          frcs: [],
          sscs: [],
          ssts: [],
          local: false,
        }).kind,
        "accept",
      );
      assertEquals(
        kvy.processEvent({
          serder: dipAnchor,
          sigers: delegator.sign(dipAnchor.raw, true),
          wigers: [],
          frcs: [],
          sscs: [],
          ssts: [],
          local: false,
        }).kind,
        "accept",
      );
      assertEquals(
        kvy.processEvent({
          serder: dip,
          sigers: source.db.sigs.get([delegate.pre, delegateKever.said]),
          wigers: [],
          frcs: [],
          sscs: [sourceSealFor(dipAnchor)],
          ssts: [],
          local: false,
        }).kind,
        "accept",
      );
      assertEquals(
        kvy.processEvent({
          serder: drt1Anchor,
          sigers: delegator.sign(drt1Anchor.raw, true),
          wigers: [],
          frcs: [],
          sscs: [],
          ssts: [],
          local: false,
        }).kind,
        "accept",
      );
      assertEquals(
        kvy.processEvent({
          serder: drt1,
          sigers: signRotation(drt1, firstRotationSigner.signer.seed),
          wigers: [],
          frcs: [],
          sscs: [sourceSealFor(drt1Anchor)],
          ssts: [],
          local: false,
        }).kind,
        "accept",
      );
      assertEquals(
        kvy.processEvent({
          serder: drt2Anchor,
          sigers: delegator.sign(drt2Anchor.raw, true),
          wigers: [],
          frcs: [],
          sscs: [],
          ssts: [],
          local: false,
        }).kind,
        "accept",
      );

      const decision = kvy.processEvent({
        serder: drt2,
        sigers: signRotation(drt2, secondRotationSigner.signer.seed),
        wigers: [],
        frcs: [],
        sscs: [sourceSealFor(drt2Anchor)],
        ssts: [],
        local: false,
      });

      assertEquals(decision.kind, "accept");
      assertEquals(remote.db.getKever(delegate.pre)?.sn, 1);
      assertEquals(remote.db.getKever(delegate.pre)?.said, drt2.said);
      assertEquals(remote.db.getKever(delegate.pre)?.lastEst.d, drt2.said);
    } finally {
      yield* source.close(true);
      yield* remote.close(true);
    }
  });
});

Deno.test("Kevery accepts superseding delegated recovery when the later seal is in the same delegating event", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-delegated-b2-source-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-delegated-b2-remote-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const delegator = source.makeHab("delegator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const delegate = source.makeHab("delegate", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
        delpre: delegator.pre,
      });
      const kvy = new Kevery(remote.db);
      const delegatorKever = delegator.kever;
      const delegateKever = delegate.kever;
      assertExists(delegatorKever);
      assertExists(delegateKever);

      const delegatorIcp = source.db.getEvtSerder(
        delegator.pre,
        delegatorKever.said,
      );
      const dip = source.db.getEvtSerder(delegate.pre, delegateKever.said);
      assertExists(delegatorIcp);
      assertExists(dip);

      const dipAnchor = makeDelegatingInteraction(
        delegator.pre,
        1,
        delegatorKever.said,
        [eventSeal(dip)],
      );
      const firstRotationSigner = findCommittedRotationSigner(
        source,
        delegate.pre,
        delegateKever.ndigs[0],
      );
      const secondRotationSigner = deriveRotationSigner(
        source,
        delegate.pre,
        "r2",
      );
      const thirdRotationSigner = deriveRotationSigner(
        source,
        delegate.pre,
        "r3",
      );
      const drt1 = makeDelegatedRotation(
        delegate.pre,
        1,
        dip.said!,
        firstRotationSigner.verfer.qb64,
        nextKeyDigest(secondRotationSigner.verfer.qb64).qb64,
      );
      const drt2 = makeDelegatedRotation(
        delegate.pre,
        1,
        dip.said!,
        secondRotationSigner.verfer.qb64,
        nextKeyDigest(thirdRotationSigner.verfer.qb64).qb64,
      );
      const sharedAnchor = makeDelegatingInteraction(
        delegator.pre,
        2,
        dipAnchor.said!,
        [eventSeal(drt1), eventSeal(drt2)],
      );

      assertEquals(
        kvy.processEvent({
          serder: delegatorIcp,
          sigers: source.db.sigs.get([delegator.pre, delegatorKever.said]),
          wigers: [],
          frcs: [],
          sscs: [],
          ssts: [],
          local: false,
        }).kind,
        "accept",
      );
      assertEquals(
        kvy.processEvent({
          serder: dipAnchor,
          sigers: delegator.sign(dipAnchor.raw, true),
          wigers: [],
          frcs: [],
          sscs: [],
          ssts: [],
          local: false,
        }).kind,
        "accept",
      );
      assertEquals(
        kvy.processEvent({
          serder: dip,
          sigers: source.db.sigs.get([delegate.pre, delegateKever.said]),
          wigers: [],
          frcs: [],
          sscs: [sourceSealFor(dipAnchor)],
          ssts: [],
          local: false,
        }).kind,
        "accept",
      );
      assertEquals(
        kvy.processEvent({
          serder: sharedAnchor,
          sigers: delegator.sign(sharedAnchor.raw, true),
          wigers: [],
          frcs: [],
          sscs: [],
          ssts: [],
          local: false,
        }).kind,
        "accept",
      );
      assertEquals(
        kvy.processEvent({
          serder: drt1,
          sigers: signRotation(drt1, firstRotationSigner.signer.seed),
          wigers: [],
          frcs: [],
          sscs: [sourceSealFor(sharedAnchor)],
          ssts: [],
          local: false,
        }).kind,
        "accept",
      );

      const decision = kvy.processEvent({
        serder: drt2,
        sigers: signRotation(drt2, secondRotationSigner.signer.seed),
        wigers: [],
        frcs: [],
        sscs: [sourceSealFor(sharedAnchor)],
        ssts: [],
        local: false,
      });

      assertEquals(decision.kind, "accept");
      assertEquals(remote.db.getKever(delegate.pre)?.sn, 1);
      assertEquals(remote.db.getKever(delegate.pre)?.said, drt2.said);
      assertEquals(remote.db.getKever(delegate.pre)?.lastEst.d, drt2.said);
    } finally {
      yield* source.close(true);
      yield* remote.close(true);
    }
  });
});
