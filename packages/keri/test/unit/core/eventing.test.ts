import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { ed25519 } from "npm:@noble/curves@1.9.7/ed25519";
import {
  Cigar,
  Diger,
  NumberPrimitive,
  SealSource,
  SerderKERI,
  Siger,
  type Tier,
  Tiers,
} from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { saltySigner } from "../../../src/app/keeping.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { TransIdxSigGroup, TransReceiptQuadruple } from "../../../src/core/dispatch.ts";
import { Kevery } from "../../../src/core/eventing.ts";
import { makeReceiptSerder } from "../../../src/core/messages.ts";
import { dgKey, snKey } from "../../../src/db/core/keys.ts";
import { eventingTestApi, expectKind, withPatchedMethod } from "../../private-access.ts";

const textEncoder = new TextEncoder();

interface EscrowReplayCall {
  escrow: string;
  pre: string;
  on: number | null;
  said: string;
}

function captureEscrowReplays(
  kvy: Kevery,
  run: () => void,
): EscrowReplayCall[] {
  const calls: EscrowReplayCall[] = [];
  const target = kvy as unknown as Record<string, unknown>;
  return withPatchedMethod(
    target,
    "replayEscrowEntry",
    ((escrow: string, pre: string, on: number | null, said: string) => {
      calls.push({ escrow, pre, on, said });
    }) as never,
    () => {
      run();
      return calls;
    },
  );
}

function eventSeal(serder: SerderKERI) {
  assertExists(serder.pre);
  assertExists(serder.snh);
  assertExists(serder.said);
  return { i: serder.pre, s: serder.snh, d: serder.said };
}

function sourceSealFor(serder: SerderKERI): SealSource {
  assertExists(serder.sner);
  assertExists(serder.said);
  return SealSource.fromTuple([
    serder.sner,
    new Diger({ qb64: serder.said }),
  ]);
}

function makeAcceptedReceiptReference(
  db: {
    putEvtSerder(pre: string, said: string, raw: Uint8Array): boolean;
    kels: { add(keys: string, on: number, val: string): boolean };
  },
  serder: SerderKERI,
): void {
  assertExists(serder.pre);
  assertExists(serder.said);
  const sn = serder.sn;
  if (sn === null) {
    throw new Error("Expected receipted event sn.");
  }
  assertEquals(db.putEvtSerder(serder.pre, serder.said, serder.raw), true);
  assertEquals(db.kels.add(serder.pre, sn, serder.said), true);
}

function nonTransReceiptEnvelope(
  receiptor: { sign: (ser: Uint8Array, indexed: false) => Cigar[] },
  event: SerderKERI,
  local: boolean,
) {
  assertExists(event.pre);
  assertExists(event.said);
  const sn = event.sn;
  if (sn === null) {
    throw new Error("Expected receipted event sn.");
  }
  return {
    serder: makeReceiptSerder(event.pre, sn, event.said),
    cigars: receiptor.sign(event.raw, false),
    wigers: [],
    tsgs: [],
    local,
  };
}

function witnessReceiptEnvelope(
  witness: { sign: (ser: Uint8Array, indexed: true) => Siger[] },
  event: SerderKERI,
  local: boolean,
) {
  assertExists(event.pre);
  assertExists(event.said);
  const sn = event.sn;
  if (sn === null) {
    throw new Error("Expected receipted event sn.");
  }
  return {
    serder: makeReceiptSerder(event.pre, sn, event.said),
    cigars: [],
    wigers: witness.sign(event.raw, true),
    tsgs: [],
    local,
  };
}

function transferableReceiptEnvelope(
  validator: {
    pre: string;
    db: { getEvtSerder(pre: string, said: string): SerderKERI | null };
    kever: {
      said: string;
      lastEst: { d?: string };
      prefixer: TransIdxSigGroup["prefixer"];
    } | null;
    sign: (ser: Uint8Array, indexed: true) => Siger[];
  },
  event: SerderKERI,
  local: boolean,
) {
  assertExists(event.pre);
  assertExists(event.said);
  const sn = event.sn;
  if (sn === null) {
    throw new Error("Expected receipted event sn.");
  }
  const kever = validator.kever;
  assertExists(kever);
  const estSaid = kever.lastEst.d || kever.said;
  assertExists(estSaid);
  const estEvent = validator.db.getEvtSerder(validator.pre, estSaid);
  assertExists(estEvent);
  const seqner = estEvent.sner;
  if (!seqner) {
    throw new Error("Expected establishment event seqner.");
  }
  const tsgs = [
    new TransIdxSigGroup(
      kever.prefixer,
      seqner,
      new Diger({ qb64: estSaid }),
      validator.sign(event.raw, true),
    ),
  ];
  return {
    serder: makeReceiptSerder(event.pre, sn, event.said),
    cigars: [],
    wigers: [],
    tsgs,
    local,
  };
}

function transferableReceiptQuintuple(
  validator: Parameters<typeof transferableReceiptEnvelope>[0],
  event: SerderKERI,
): [
  Diger,
  TransIdxSigGroup["prefixer"],
  NumberPrimitive,
  Diger,
  Siger,
] {
  assertExists(event.said);
  const envelope = transferableReceiptEnvelope(validator, event, false);
  const group = envelope.tsgs[0];
  assertExists(group);
  const siger = group.sigers[0];
  assertExists(siger);
  return [
    new Diger({ qb64: event.said }),
    group.prefixer,
    group.seqner instanceof NumberPrimitive
      ? group.seqner
      : new NumberPrimitive({ qb64b: group.seqner.qb64b }),
    new Diger({ qb64: group.said }),
    siger,
  ];
}

function attachedTransferableReceiptQuadruple(
  validator: Parameters<typeof transferableReceiptEnvelope>[0],
  event: SerderKERI,
): TransReceiptQuadruple {
  const [, prefixer, snumber, diger, siger] = transferableReceiptQuintuple(
    validator,
    event,
  );
  return new TransReceiptQuadruple(prefixer, snumber, diger, siger);
}

function acceptEvent(
  kvy: Kevery,
  signer: { sign: (ser: Uint8Array, indexed: true) => Siger[] },
  serder: SerderKERI,
  local = false,
) {
  kvy.processEvent({
    serder,
    sigers: signer.sign(serder.raw, true),
    wigers: [],
    frcs: [],
    sscs: [],
    ssts: [],
    local,
  });
}

function withValidatorEstEventVerfers<Result>(
  kvy: Kevery,
  validatorPre: string,
  estSaid: string,
  validatorEvent: SerderKERI,
  verfers: SerderKERI["verfers"],
  fn: () => Result,
): Result {
  const original = kvy.db.getEvtSerder.bind(kvy.db);
  return withPatchedMethod(
    kvy.db,
    "getEvtSerder",
    (pre: string, said: string) => {
      if (pre === validatorPre && said === estSaid) {
        return { ...validatorEvent, verfers } as SerderKERI;
      }
      return original(pre, said);
    },
    fn,
  );
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
          tier: Tier | "";
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
    tier: prm.tier || Tiers.low,
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

function makeRotation(
  pre: string,
  sn: number,
  prior: string,
  currentKey: string,
  nextDig: string,
  cuts: string[] = [],
  adds: string[] = [],
  toad = adds.length > 0 ? 1 : 0,
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: "rot",
      i: pre,
      s: sn.toString(16),
      p: prior,
      kt: "1",
      k: [currentKey],
      nt: "1",
      n: [nextDig],
      bt: toad.toString(16),
      br: cuts,
      ba: adds,
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

Deno.test("Kevery stores non-transferable receipt escrows under snKey and replays them into dgKey receipt stores", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-ures-snkey-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-ures-snkey-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const receiptor = source.makeHab("receiptor", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);

      const reactor = new Reactor(remote);
      reactor.ingest(receiptor.receipt(event));
      reactor.processOnce();

      const kvy = reactor.kevery;
      assertEquals(remote.db.ures.cnt(), 1);
      assertEquals(
        remote.db.ures.get(snKey(controller.pre, Number(event.sn))).length,
        1,
      );

      kvy.processEvent({
        serder: event,
        sigers: controller.sign(event.raw, true),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: false,
      });
      kvy.processEscrowUnverNonTrans();

      assertEquals(remote.db.ures.cnt(), 0);
      assertEquals(
        remote.db.rcts.get(dgKey(controller.pre, event.said)).length,
        1,
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processEscrowUnverWitness keeps missing-event witness receipts, then accepts them once the event arrives", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-uwes-keep-accept-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-uwes-keep-accept-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const witness = source.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);

      const kvy = new Kevery(remote.db);
      kvy.processReceipt(witnessReceiptEnvelope(witness, event, false));
      assertEquals(remote.db.uwes.cnt(), 1);

      kvy.processEscrowUnverWitness();
      assertEquals(remote.db.uwes.cnt(), 1);
      assertEquals(
        remote.db.wigs.get(dgKey(controller.pre, event.said)).length,
        0,
      );

      kvy.processEvent({
        serder: event,
        sigers: controller.sign(event.raw, true),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: false,
      });
      kvy.processEscrowUnverWitness();

      assertEquals(remote.db.uwes.cnt(), 0);
      assertEquals(
        remote.db.wigs.get(dgKey(controller.pre, event.said)).length,
        1,
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processEscrowUnverWitness drops malformed witness receipt escrows with missing daters", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-uwes-drop-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-uwes-drop-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const witness = source.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);

      const kvy = new Kevery(remote.db);
      kvy.processReceipt(witnessReceiptEnvelope(witness, event, false));
      assertEquals(remote.db.uwes.cnt(), 1);

      remote.db.dtss.rem(dgKey(controller.pre, event.said));
      kvy.processEscrowUnverWitness();

      assertEquals(remote.db.uwes.cnt(), 0);
      assertEquals(
        remote.db.wigs.get(dgKey(controller.pre, event.said)).length,
        0,
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processEscrowUnverWitness reconstructs rotation witness lists from pwes", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-uwes-rotation-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-uwes-rotation-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const witness = source.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const inception = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(inception);
      assertExists(inception.said);

      const kvy = new Kevery(remote.db);
      assertEquals(
        kvy.processEvent({
          serder: inception,
          sigers: source.db.sigs.get([controller.pre, inception.said]),
          wigers: [],
          frcs: [],
          sscs: [],
          ssts: [],
          local: false,
        }).kind,
        "accept",
      );

      const controllerKever = controller.kever;
      assertExists(controllerKever);
      const firstRotationSigner = findCommittedRotationSigner(
        source,
        controller.pre,
        controllerKever.ndigs[0],
      );
      const secondRotationSigner = deriveRotationSigner(
        source,
        controller.pre,
        "r2",
      );
      const rotation = makeRotation(
        controller.pre,
        1,
        inception.said,
        firstRotationSigner.verfer.qb64,
        nextKeyDigest(secondRotationSigner.verfer.qb64).qb64,
        [],
        [witness.pre],
        1,
      );
      assertExists(rotation.said);

      const decision = kvy.processEvent({
        serder: rotation,
        sigers: signRotation(rotation, firstRotationSigner.signer.seed),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: false,
      });
      assertEquals(decision.kind, "escrow");
      assertEquals(
        [...remote.db.pwes.getOnIter([controller.pre], Number(rotation.sn))],
        [rotation.said],
      );

      kvy.processReceipt(witnessReceiptEnvelope(witness, rotation, false));
      assertEquals(remote.db.uwes.cnt(), 1);

      kvy.processEscrowUnverWitness();
      assertEquals(remote.db.uwes.cnt(), 0);
      assertEquals(
        remote.db.wigs.get(dgKey(controller.pre, rotation.said)).length,
        1,
      );

      kvy.processEscrowPartialWigs();
      assertEquals(remote.db.getKever(controller.pre)?.said, rotation.said);
      assertEquals(remote.db.getKever(controller.pre)?.wits, [witness.pre]);
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processEscrowUnverNonTrans keeps non-witness receipts escrowed until the receipted event leaves pwes", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-ures-partial-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-ures-partial-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const witness = source.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const receiptor = source.makeHab("receiptor", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);

      const kvy = new Kevery(remote.db);
      kvy.processReceipt(nonTransReceiptEnvelope(receiptor, event, false));
      assertEquals(remote.db.ures.cnt(), 1);

      assertEquals(
        kvy.processEvent({
          serder: event,
          sigers: source.db.sigs.get([controller.pre, event.said]),
          wigers: [],
          frcs: [],
          sscs: [],
          ssts: [],
          local: false,
        }).kind,
        "escrow",
      );

      kvy.processEscrowUnverNonTrans();
      assertEquals(remote.db.ures.cnt(), 1);
      assertEquals(
        [...remote.db.pwes.getOnIter([controller.pre], Number(event.sn))],
        [event.said],
      );
      assertEquals(
        remote.db.rcts.get(dgKey(controller.pre, event.said)).length,
        0,
      );

      kvy.processReceipt(witnessReceiptEnvelope(witness, event, false));
      kvy.processEscrowUnverWitness();
      kvy.processEscrowPartialWigs();
      assertEquals(remote.db.getKever(controller.pre)?.said, event.said);

      kvy.processEscrowUnverNonTrans();
      assertEquals(remote.db.ures.cnt(), 0);
      assertEquals(
        remote.db.rcts.get(dgKey(controller.pre, event.said)).length,
        1,
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processEscrowUnverNonTrans promotes witness cigars from pwes into wigs", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-ures-witness-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-ures-witness-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const witness = source.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);

      const kvy = new Kevery(remote.db);
      kvy.processReceipt(nonTransReceiptEnvelope(witness, event, false));
      assertEquals(remote.db.ures.cnt(), 1);

      assertEquals(
        kvy.processEvent({
          serder: event,
          sigers: source.db.sigs.get([controller.pre, event.said]),
          wigers: [],
          frcs: [],
          sscs: [],
          ssts: [],
          local: false,
        }).kind,
        "escrow",
      );

      kvy.processEscrowUnverNonTrans();
      assertEquals(remote.db.ures.cnt(), 0);
      assertEquals(
        remote.db.wigs.get(dgKey(controller.pre, event.said)).length,
        1,
      );
      assertEquals(
        remote.db.rcts.get(dgKey(controller.pre, event.said)).length,
        0,
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processAttachedReceiptCouples stores accepted replayed witness and non-witness couples", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-attached-couples-accept-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-attached-couples-accept-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const witness = source.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const receiptor = source.makeHab("receiptor", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);
      makeAcceptedReceiptReference(remote.db, event);

      const kvy = new Kevery(remote.db);
      kvy.processAttachedReceiptCouples({
        serder: event,
        cigars: [
          ...witness.sign(event.raw, false),
          ...receiptor.sign(event.raw, false),
        ],
        local: false,
      });

      assertEquals(
        remote.db.wigs.get(dgKey(controller.pre, event.said)).length,
        1,
      );
      assertEquals(
        remote.db.rcts.get(dgKey(controller.pre, event.said)).length,
        1,
      );
      assertEquals(remote.db.ures.cnt(), 0);
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processAttachedReceiptCouples escrows missing replay targets into ures", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-attached-couples-escrow-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-attached-couples-escrow-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const receiptor = source.makeHab("receiptor", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);

      const kvy = new Kevery(remote.db);
      kvy.processAttachedReceiptCouples({
        serder: event,
        cigars: receiptor.sign(event.raw, false),
        local: false,
      });

      assertEquals(
        remote.db.ures.get(snKey(controller.pre, Number(event.sn))).length,
        1,
      );
      assertEquals(
        remote.db.rcts.get(dgKey(controller.pre, event.said)).length,
        0,
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processAttachedReceiptQuadruples stores accepted replayed validator receipts", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-attached-trqs-accept-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-attached-trqs-accept-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const validator = source.makeHab("validator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      const validatorEvent = source.db.getEvtSerder(
        validator.pre,
        validator.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);
      assertExists(validatorEvent);
      assertExists(validatorEvent.said);
      makeAcceptedReceiptReference(remote.db, event);
      makeAcceptedReceiptReference(remote.db, validatorEvent);

      const kvy = new Kevery(remote.db);
      kvy.processAttachedReceiptQuadruples({
        serder: event,
        trqs: [attachedTransferableReceiptQuadruple(validator, event)],
        local: false,
      });

      assertEquals(
        remote.db.vrcs.get(dgKey(controller.pre, event.said)).length,
        1,
      );
      assertEquals(remote.db.vres.cnt(), 0);
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processAttachedReceiptQuadruples escrows missing validator establishment and drops bad signatures", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-attached-trqs-escrow-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-attached-trqs-escrow-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const validator = source.makeHab("validator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);
      makeAcceptedReceiptReference(remote.db, event);

      const kvy = new Kevery(remote.db);
      kvy.processAttachedReceiptQuadruples({
        serder: event,
        trqs: [attachedTransferableReceiptQuadruple(validator, event)],
        local: false,
      });

      assertEquals(
        remote.db.vres.get(snKey(controller.pre, Number(event.sn))).length,
        1,
      );
      assertEquals(
        remote.db.vrcs.get(dgKey(controller.pre, event.said)).length,
        0,
      );

      const validatorEvent = source.db.getEvtSerder(
        validator.pre,
        validator.kever?.said ?? "",
      );
      assertExists(validatorEvent);
      assertExists(validatorEvent.said);
      makeAcceptedReceiptReference(remote.db, validatorEvent);

      const valid = attachedTransferableReceiptQuadruple(validator, event);
      const badSignature = new Siger({
        code: valid.siger.code,
        raw: new Uint8Array(valid.siger.raw.length),
        index: valid.siger.index,
        ondex: valid.siger.ondex,
      });
      kvy.processAttachedReceiptQuadruples({
        serder: event,
        trqs: [
          new TransReceiptQuadruple(
            valid.prefixer,
            valid.seqner,
            valid.diger,
            badSignature,
          ),
        ],
        local: false,
      });

      assertEquals(
        remote.db.vrcs.get(dgKey(controller.pre, event.said)).length,
        0,
      );
      assertEquals(
        remote.db.vres.get(snKey(controller.pre, Number(event.sn))).length,
        1,
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.reprocessEscrowedWitnessReceipt drops bad witness indexes against pwes state", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-uwe-bad-index-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-uwe-bad-index-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const witness = source.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);

      const kvy = new Kevery(remote.db);
      assertEquals(
        kvy.processEvent({
          serder: event,
          sigers: source.db.sigs.get([controller.pre, event.said]),
          wigers: [],
          frcs: [],
          sscs: [],
          ssts: [],
          local: false,
        }).kind,
        "escrow",
      );

      const valid = witness.sign(event.raw, true)[0];
      const invalid = new Siger({
        code: valid.code,
        raw: valid.raw,
        index: valid.index + 1,
        ondex: (valid.ondex ?? valid.index) + 1,
      });
      const decision = eventingTestApi(kvy).reprocessEscrowedWitnessReceipt(
        controller.pre,
        Number(event.sn),
        event.said,
        invalid,
      );

      const drop = expectKind(decision, "drop");
      assertEquals(drop.reason, "invalidWitnessIndex");
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processEscrowUnverTrans keeps missing-establishment receipts and drops bad receiptor seals", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-vres-keep-drop-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-vres-keep-drop-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const validator = source.makeHab("validator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);

      const kvy = new Kevery(remote.db);
      kvy.processEvent({
        serder: event,
        sigers: controller.sign(event.raw, true),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: false,
      });
      kvy.processReceipt(transferableReceiptEnvelope(validator, event, false));

      const escrowKey = snKey(controller.pre, Number(event.sn));
      assertEquals(remote.db.vres.get(escrowKey).length, 1);
      kvy.processEscrowUnverTrans();
      assertEquals(remote.db.vres.get(escrowKey).length, 1);

      const validatorEvent = source.db.getEvtSerder(
        validator.pre,
        validator.kever?.said ?? "",
      );
      assertExists(validatorEvent);
      kvy.processEvent({
        serder: validatorEvent,
        sigers: validator.sign(validatorEvent.raw, true),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: false,
      });

      const escrowed = remote.db.vres.get(escrowKey);
      assertEquals(escrowed.length, 1);
      const corrupted: [
        Diger,
        typeof escrowed[0][1],
        typeof escrowed[0][2],
        Diger,
        Siger,
      ] = [
        escrowed[0][0],
        escrowed[0][1],
        escrowed[0][2],
        new Diger({ qb64: event.said }),
        escrowed[0][4],
      ];
      remote.db.vres.rem(escrowKey, escrowed[0]);
      remote.db.vres.add(escrowKey, corrupted);

      kvy.processEscrowUnverTrans();

      assertEquals(remote.db.vres.get(escrowKey).length, 0);
      assertEquals(
        remote.db.vrcs.get(dgKey(controller.pre, event.said)).length,
        0,
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery receipt replay distinguishes missing accepted events, bad references, and bad digests", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-lookup-replay-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-lookup-replay-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);

      const kvy = new Kevery(remote.db);
      const api = eventingTestApi(kvy);
      const lookup = api.lookupAcceptedReceiptedEvent(
        "URE",
        controller.pre,
        Number(event.sn),
        event.said,
      );

      assertEquals(expectKind(lookup, "keep").reason, "missingReceiptedEvent");

      assertEquals(
        remote.db.kels.add(controller.pre, Number(event.sn), event.said),
        true,
      );
      const missingRef = api.lookupAcceptedReceiptedEvent(
        "URE",
        controller.pre,
        Number(event.sn),
        event.said,
      );

      assertEquals(
        expectKind(missingRef, "drop").reason,
        "invalidReceiptedEventReference",
      );

      assertEquals(
        remote.db.putEvtSerder(controller.pre, event.said, event.raw),
        true,
      );
      const badDigest = api.lookupAcceptedReceiptedEvent(
        "URE",
        controller.pre,
        Number(event.sn),
        new Diger({ qb64: controller.kever?.ndigers[0].qb64 ?? event.said })
          .qb64,
      );

      assertEquals(
        expectKind(badDigest, "drop").reason,
        "invalidReceiptDigest",
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processEscrowUnverTrans distinguishes missing receiptor keys from index overflow", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-vre-key-split-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-vre-key-split-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const validator = source.makeHab("validator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      const validatorEvent = source.db.getEvtSerder(
        validator.pre,
        validator.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);
      assertExists(validatorEvent);
      assertExists(validatorEvent.said);

      const kvy = new Kevery(remote.db);
      acceptEvent(kvy, controller, event);
      acceptEvent(kvy, validator, validatorEvent);

      const api = eventingTestApi(kvy);
      const goodQuintuple = transferableReceiptQuintuple(validator, event);
      const noKeysDecision = withValidatorEstEventVerfers(
        kvy,
        validator.pre,
        validatorEvent.said,
        validatorEvent,
        [],
        () =>
          api.reprocessEscrowedTransferableReceipt(
            controller.pre,
            Number(event.sn),
            goodQuintuple,
          ),
      );

      assertEquals(
        expectKind(noKeysDecision, "drop").reason,
        "missingReceiptorKeys",
      );

      const highIndex = new Siger({
        code: goodQuintuple[4].code,
        raw: goodQuintuple[4].raw,
        index: 4,
        ondex: 4,
      });
      const indexDecision = api.reprocessEscrowedTransferableReceipt(
        controller.pre,
        Number(event.sn),
        [
          goodQuintuple[0],
          goodQuintuple[1],
          goodQuintuple[2],
          goodQuintuple[3],
          highIndex,
        ],
      );

      assertEquals(
        expectKind(indexDecision, "drop").reason,
        "receiptorIndexOutOfRange",
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery receipt replay helpers expose typed keep/drop/accept decisions", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-replay-vocab-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-replay-vocab-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const witness = source.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);

      const kvy = new Kevery(remote.db);
      kvy.processReceipt(witnessReceiptEnvelope(witness, event, false));
      const decision = eventingTestApi(kvy).reprocessEscrowedWitnessReceipt(
        controller.pre,
        Number(event.sn),
        event.said,
        witness.sign(event.raw, true)[0],
      );

      assertEquals(
        expectKind(decision, "keep").reason,
        "missingReceiptedEvent",
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery partial-witness replay labels duplicate cuts distinctly", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-pwe-reason-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-pwe-reason-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const witness1 = source.makeHab("witness-1", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const witness2 = source.makeHab("witness-2", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness1.pre, witness2.pre],
        toad: 1,
      });
      const kvy = new Kevery(source.db);
      const current = controller.kever;
      assertExists(current);
      const rotation = makeRotation(
        controller.pre,
        1,
        current.said,
        controller.kever?.verfers[0].qb64 ?? "",
        controller.kever?.ndigers[0].qb64 ?? "",
        [witness1.pre, witness1.pre],
        [],
        1,
      );

      const decision = eventingTestApi(kvy)
        .resolvePartialWitnessEscrowWitnesses(
          rotation,
        );

      assertEquals(expectKind(decision, "drop").reason, "duplicateCuts");
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processReceipt skips own non-transferable receipts on own events unless lax is enabled", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-own-nontrans-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const receiptor = hby.makeHab("receiptor", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = hby.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const event = hby.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);

      const strict = new Kevery(hby.db, { lax: false, local: true });
      strict.processReceipt(nonTransReceiptEnvelope(receiptor, event, true));
      assertEquals(
        hby.db.rcts.get(dgKey(controller.pre, event.said)).length,
        0,
      );

      const lax = new Kevery(hby.db, { lax: true, local: true });
      lax.processReceipt(nonTransReceiptEnvelope(receiptor, event, true));
      assertEquals(
        hby.db.rcts.get(dgKey(controller.pre, event.said)).length,
        1,
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.processReceipt only accepts own non-transferable receipts for remote events when the source is local", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-own-nontrans-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-own-nontrans-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const receiptor = remote.makeHab("receiptor", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);
      makeAcceptedReceiptReference(remote.db, event);

      const kvy = new Kevery(remote.db, { lax: false, local: true });
      kvy.processReceipt(nonTransReceiptEnvelope(receiptor, event, false));
      assertEquals(
        remote.db.rcts.get(dgKey(controller.pre, event.said)).length,
        0,
      );

      kvy.processReceipt(nonTransReceiptEnvelope(receiptor, event, true));
      assertEquals(
        remote.db.rcts.get(dgKey(controller.pre, event.said)).length,
        1,
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("Kevery.processReceipt skips own witness receipts on own and nonlocal events when lax is false", async () => {
  await run(function*() {
    const localHby = yield* createHabery({
      name: `kevery-own-witness-local-${crypto.randomUUID()}`,
      temp: true,
    });
    const source = yield* createHabery({
      name: `kevery-own-witness-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-own-witness-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const localWitness = localHby.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const localController = localHby.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [localWitness.pre],
        toad: 1,
      });
      const localEvent = localHby.db.getEvtSerder(
        localController.pre,
        localController.kever?.said ?? "",
      );
      assertExists(localEvent);
      assertExists(localEvent.said);

      const strictLocal = new Kevery(localHby.db, { lax: false, local: true });
      strictLocal.processReceipt(
        witnessReceiptEnvelope(localWitness, localEvent, true),
      );
      assertEquals(
        localHby.db.wigs.get(dgKey(localController.pre, localEvent.said))
          .length,
        0,
      );

      const remoteWitness = remote.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const remoteController = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [remoteWitness.pre],
        toad: 1,
      });
      const remoteEvent = source.db.getEvtSerder(
        remoteController.pre,
        remoteController.kever?.said ?? "",
      );
      assertExists(remoteEvent);
      assertExists(remoteEvent.said);
      makeAcceptedReceiptReference(remote.db, remoteEvent);

      const strictRemote = new Kevery(remote.db, { lax: false, local: true });
      strictRemote.processReceipt(
        witnessReceiptEnvelope(remoteWitness, remoteEvent, false),
      );
      assertEquals(
        remote.db.wigs.get(dgKey(remoteController.pre, remoteEvent.said))
          .length,
        0,
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
      yield* localHby.close(true);
    }
  });
});

Deno.test("Kevery.processReceipt drops own transferable receipts on own and nonlocal events unless lax is enabled", async () => {
  await run(function*() {
    const localHby = yield* createHabery({
      name: `kevery-own-trq-local-${crypto.randomUUID()}`,
      temp: true,
    });
    const source = yield* createHabery({
      name: `kevery-own-trq-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-own-trq-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const validator = localHby.makeHab("validator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const controller = localHby.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const localEvent = localHby.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(localEvent);
      assertExists(localEvent.said);

      const strictLocal = new Kevery(localHby.db, { lax: false, local: true });
      strictLocal.processReceipt(
        transferableReceiptEnvelope(validator, localEvent, true),
      );
      assertEquals(
        localHby.db.vrcs.get(dgKey(controller.pre, localEvent.said)).length,
        0,
      );

      const laxLocal = new Kevery(localHby.db, { lax: true, local: true });
      laxLocal.processReceipt(
        transferableReceiptEnvelope(validator, localEvent, true),
      );
      assertEquals(
        localHby.db.vrcs.get(dgKey(controller.pre, localEvent.said)).length,
        1,
      );

      const remoteValidator = remote.makeHab("validator", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const remoteController = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const remoteEvent = source.db.getEvtSerder(
        remoteController.pre,
        remoteController.kever?.said ?? "",
      );
      assertExists(remoteEvent);
      assertExists(remoteEvent.said);
      makeAcceptedReceiptReference(remote.db, remoteEvent);

      const strictRemote = new Kevery(remote.db, { lax: false, local: true });
      strictRemote.processReceipt(
        transferableReceiptEnvelope(remoteValidator, remoteEvent, false),
      );
      assertEquals(
        remote.db.vrcs.get(dgKey(remoteController.pre, remoteEvent.said))
          .length,
        0,
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
      yield* localHby.close(true);
    }
  });
});

Deno.test("Kevery.processReceipt drops stale live receipts without escrowing or storing them", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-stale-rct-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-stale-rct-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const receiptor = source.makeHab("receiptor", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      assertExists(event);
      assertExists(event.said);
      makeAcceptedReceiptReference(remote.db, event);

      const staleSaid = new Diger({
        code: "E",
        raw: Diger.digest(textEncoder.encode(`${event.said}-stale`), "E"),
      }).qb64;
      assertEquals(
        remote.db.kels.add(controller.pre, Number(event.sn), staleSaid),
        true,
      );

      const kvy = new Kevery(remote.db);
      kvy.processReceipt(nonTransReceiptEnvelope(receiptor, event, false));

      assertEquals(
        remote.db.rcts.get(dgKey(controller.pre, event.said)).length,
        0,
      );
      assertEquals(
        remote.db.ures.get(snKey(controller.pre, Number(event.sn))).length,
        0,
      );
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
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

Deno.test("Kevery.processEscrowOutOfOrders replays stored `ooo` entries through the generic escrow path", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-ooo-replay-${crypto.randomUUID()}`,
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
      hby.db.ooes.addOn(hab.pre, 1, "Eooo");

      const kvy = new Kevery(hby.db);
      assertEquals(
        captureEscrowReplays(kvy, () => kvy.processEscrowOutOfOrders()),
        [{ escrow: "ooo", pre: hab.pre, on: 1, said: "Eooo" }],
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.processEscrowPartialDels replays stored `partialDels` entries through the generic escrow path", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-pdes-replay-${crypto.randomUUID()}`,
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
      hby.db.pdes.addOn(hab.pre, 1, "Epde");

      const kvy = new Kevery(hby.db);
      assertEquals(
        captureEscrowReplays(kvy, () => kvy.processEscrowPartialDels()),
        [{ escrow: "partialDels", pre: hab.pre, on: 1, said: "Epde" }],
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.processEscrowDuplicitous replays stored `duplicitous` entries through the generic escrow path", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-ldes-replay-${crypto.randomUUID()}`,
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
      hby.db.ldes.addOn(hab.pre, 1, "Edup");

      const kvy = new Kevery(hby.db);
      assertEquals(
        captureEscrowReplays(kvy, () => kvy.processEscrowDuplicitous()),
        [{ escrow: "duplicitous", pre: hab.pre, on: 1, said: "Edup" }],
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.processEscrowDelegables replays stored `delegables` entries through the generic escrow path", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-delegables-replay-${crypto.randomUUID()}`,
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
      hby.db.delegables.add([hab.pre], "Edel");

      const kvy = new Kevery(hby.db);
      assertEquals(
        captureEscrowReplays(kvy, () => kvy.processEscrowDelegables()),
        [{ escrow: "delegables", pre: hab.pre, on: null, said: "Edel" }],
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.processEscrowMisfits replays stored `misfit` entries through the generic escrow path", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-misfit-replay-${crypto.randomUUID()}`,
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
      hby.db.misfits.add([hab.pre], "Emis");

      const kvy = new Kevery(hby.db);
      assertEquals(
        captureEscrowReplays(kvy, () => kvy.processEscrowMisfits()),
        [{ escrow: "misfit", pre: hab.pre, on: null, said: "Emis" }],
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Kevery.processEscrows preserves the full Gate E Chunk 8 sweep order", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `kevery-sweep-order-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const kvy = new Kevery(hby.db);
      const order: string[] = [];
      const methods = [
        "processEscrowOutOfOrders",
        "processEscrowUnverWitness",
        "processEscrowUnverNonTrans",
        "processEscrowUnverTrans",
        "processEscrowPartialDels",
        "processEscrowPartialWigs",
        "processEscrowPartialSigs",
        "processEscrowDuplicitous",
        "processEscrowDelegables",
        "processEscrowMisfits",
        "processQueryNotFound",
      ] as const;
      const target = kvy as unknown as Record<string, unknown>;
      const originals = new Map<string, unknown>();

      try {
        for (const method of methods) {
          originals.set(method, target[method]);
          target[method] = (() => {
            order.push(method);
          }) as never;
        }
        kvy.processEscrows();
      } finally {
        for (const method of methods) {
          target[method] = originals.get(method);
        }
      }

      assertEquals(order, [...methods]);
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
