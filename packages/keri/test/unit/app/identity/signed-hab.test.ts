import { type Operation, run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import {
  b,
  Cigar,
  Diger,
  MtrDex,
  SerderKERI,
  Siger,
  Signer,
  type ThresholdSith,
  Vrsn_2_0,
} from "../../../../../cesr/mod.ts";
import { signLocalGroupEvent } from "../../../../src/app/identity/endpoint-roleing.ts";
import { type Habery, openHabery } from "../../../../src/app/identity/habbing.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { incept, interact, rotate } from "../../../../src/core/protocol-eventing.ts";
import { Baser } from "../../../../src/db/basing.ts";
import { MemStoreOpener } from "../../../../src/db/core/memstore.ts";
import { openOwner } from "../../../../src/db/core/store-owner.ts";
import { Keeper } from "../../../../src/db/keeping.ts";

const message = b("pre-signed hab proof");

interface Stores {
  db: Baser;
  ks: Keeper;
}

/** In-memory stores whose contents outlive any one Habery borrowing them. */
function* openStores(): Operation<Stores> {
  const opener = new MemStoreOpener();
  const identity = { name: crypto.randomUUID(), temp: true, reopen: true };
  return {
    db: yield* openOwner(new Baser(opener.create(Baser.Family, identity)), "Baser", identity),
    ks: yield* openOwner(new Keeper(opener.create(Keeper.Family, identity)), "Keeper", identity),
  };
}

function* openOn(stores: Stores): Operation<Habery> {
  return yield* openHabery({ name: "signed", temp: true, skipConfig: true, skipSignator: true, stores });
}

/** A Habery on its own in-memory stores. */
function* openFresh(): Operation<{ hby: Habery; stores: Stores }> {
  const stores = yield* openStores();
  return { hby: yield* openOn(stores), stores };
}

function dig(signer: Signer): string {
  return new Diger({ code: MtrDex.Blake3_256, raw: Diger.digest(b(signer.verfer.qb64), MtrDex.Blake3_256) }).qb64;
}

interface PreSigned {
  signers: Signer[];
  serder: SerderKERI;
  sigers: Siger[];
}

/** An inception built and signed outside any Habery, as an embedding application would. */
function preSigned(
  { transferable = true, count = 1, isith, signing = count }: {
    transferable?: boolean;
    count?: number;
    isith?: ThresholdSith;
    signing?: number;
  } = {},
): PreSigned {
  const signers = Array.from({ length: count }, () => Signer.random({ code: MtrDex.Ed25519_Seed, transferable }));
  const next = transferable ? signers.map(() => Signer.random({ code: MtrDex.Ed25519_Seed })) : [];
  const serder = incept(signers.map((signer) => signer.verfer.qb64), {
    version: Vrsn_2_0,
    code: transferable ? "E" : signers[0].verfer.code,
    isith,
    ndigs: next.map(dig),
    nsith: transferable ? undefined : "0",
    toad: 0,
  });
  const sigers = signers.slice(0, signing).map((signer, index) => signer.sign(serder.raw, { index }) as Siger);
  return { signers, serder, sigers };
}

/** The rows a refused inception must not have created. */
function traceOf(hby: Habery, pre: string, name: string): unknown[] {
  return [
    hby.habs.has(pre),
    hby.db.getHab(pre),
    hby.db.getName("", name),
    hby.db.getKever(pre),
    hby.db.prefixes.has(pre),
    [...hby.db.getKelItemIter(pre)].length,
    hby.ks.getPrms(pre),
    hby.ks.getSits(pre),
  ];
}

const untouched = [false, null, null, null, false, 0, null, null];

Deno.test("a pre-signed inception becomes a keyless hab that signs only while held", async () => {
  await run(function*() {
    const { hby, stores } = yield* openFresh();
    try {
      for (const transferable of [true, false]) {
        const input = preSigned({ transferable });
        const before = hby.ks.getGbls("pidx");
        const hab = hby.makeSignedHab(`keyless-${transferable}`, undefined, input);

        assertEquals(hab.pre, input.serder.pre);
        assertEquals(hab.kever!.transferable, transferable);
        assertEquals(hby.habByName(`keyless-${transferable}`)?.pre, hab.pre);
        assertEquals(hby.db.getHab(hab.pre)?.name, `keyless-${transferable}`);
        assert(hby.db.prefixes.has(hab.pre));
        // No Keeper state of any kind: not the parameters, the situation, nor an advanced pidx.
        assertEquals([hby.ks.getPrms(hab.pre), hby.ks.getSits(hab.pre), hby.ks.getGbls("pidx")], [null, null, before]);
        assertEquals([...stores.ks.pris.getTopItemIter()].length, 0);

        assertThrows(() => hab.sign(message, true), Error, "Missing prikey in db for pubkey=");
        hby.mgr.hold(input.signers);
        const verfer = hab.kever!.verfers[0];
        if (transferable) {
          const [siger] = hab.sign(message, true);
          assert(verfer.verify(siger.raw, message));
          hab.interact();
          assertEquals(hab.kever!.sn, 1);
        } else {
          const [cigar] = hab.sign(message, false) as Cigar[];
          assert(verfer.verify(cigar.raw, message));
        }
        hby.mgr.release();
        assertThrows(() => hab.sign(message, false), Error, "Missing prikey in db for pubkey=");
        assertEquals([...stores.ks.pris.getTopItemIter()].length, 0);
      }
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("a refused pre-signed inception leaves no trace", async () => {
  await run(function*() {
    const { hby } = yield* openFresh();
    try {
      const underSigned = preSigned({ count: 2, isith: "2", signing: 1 });
      const wrongKey = preSigned();
      wrongKey.sigers = [Signer.random({ code: MtrDex.Ed25519_Seed }).sign(wrongKey.serder.raw, { index: 0 }) as Siger];
      const unsigned = preSigned();
      unsigned.sigers = [];
      const good = preSigned();
      const rotation = rotate(good.serder.pre!, good.signers.map((s) => s.verfer.qb64), good.serder.said!, {
        version: Vrsn_2_0,
        sn: 1,
        ndigs: [],
        nsith: "0",
      });

      const cases: [string, SerderKERI, Siger[]][] = [
        ["under-signed", underSigned.serder, underSigned.sigers],
        ["wrong signer", wrongKey.serder, wrongKey.sigers],
        ["unsigned", unsigned.serder, unsigned.sigers],
        ["signatures for another event", good.serder, preSigned().sigers],
        ["not an inception", rotation, good.signers.map((s, index) => s.sign(rotation.raw, { index }) as Siger)],
      ];
      for (const [label, serder, sigers] of cases) {
        const pre = serder.pre!;
        assertEquals(traceOf(hby, pre, label), untouched, `${label} precondition`);
        assertThrows(() => hby.makeSignedHab(label, undefined, { serder, sigers }), ValidationError, undefined, label);
        assertEquals(traceOf(hby, pre, label), untouched, label);
      }
      assertEquals(hby.habs.size, 0);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("a taken name or prefix is refused without disturbing the existing hab", async () => {
  await run(function*() {
    const { hby } = yield* openFresh();
    try {
      const first = preSigned();
      const hab = hby.makeSignedHab("taken", undefined, first);
      const kelBefore = [...hby.db.getKelItemIter(hab.pre)].length;

      assertThrows(() => hby.makeSignedHab("other", undefined, first), ValidationError, "already exists");
      assertEquals(hby.db.getName("", "other"), null);

      const second = preSigned();
      assertThrows(() => hby.makeSignedHab("taken", undefined, second), ValidationError, "name taken already exists");
      assertEquals(hby.db.getName("", "taken"), hab.pre);
      assertEquals(traceOf(hby, second.serder.pre!, "elsewhere").slice(1, 2), [null]);
      assertEquals(hby.db.getHab(second.serder.pre!), null);
      assertEquals([...hby.db.getKelItemIter(hab.pre)].length, kelBefore);
      assertEquals(hby.habs.size, 1);

      // The same name in another namespace is a different name.
      assertEquals(hby.makeSignedHab("taken", "ns", second).pre, second.serder.pre);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("a keyless hab reloads on reopen and signs again only after the host holds its signer", async () => {
  await run(function*() {
    const stores = yield* openStores();
    const input = preSigned();
    let hby = yield* openOn(stores);
    hby.makeSignedHab("reopened", undefined, input);
    hby.mgr.hold(input.signers);
    yield* hby.close();

    hby = yield* openOn(stores);
    try {
      const hab = hby.habByName("reopened")!;
      assertEquals(hab.pre, input.serder.pre);
      assertEquals(hab.accepted, true);
      assertEquals([...stores.ks.pris.getTopItemIter()].length, 0);
      assertThrows(
        () => hab.sign(message, true),
        Error,
        `Missing prikey in db for pubkey=${input.signers[0].verfer.qb64}`,
      );
      hby.mgr.hold(input.signers);
      assert(hab.kever!.verfers[0].verify(hab.sign(message, true)[0].raw, message));
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("rotating a keyless hab is refused even while its signer is held", async () => {
  await run(function*() {
    const { hby } = yield* openFresh();
    try {
      const input = preSigned();
      const hab = hby.makeSignedHab("fixed", undefined, input);
      for (const held of [false, true]) {
        if (held) hby.mgr.hold(input.signers);
        assertThrows(() => hab.rotate(), ValidationError, `Missing keeper state for ${hab.pre}.`);
        assertEquals(hab.kever!.sn, 0);
      }
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("a held keyless member signs at index 3 of a five-member group", async () => {
  await run(function*() {
    const remote = (yield* openFresh()).hby;
    const { hby: local } = yield* openFresh();
    try {
      const peers = [0, 1, 2, 4].map((i) => remote.makeHab(`peer${i}`));
      const input = preSigned();
      const member = local.makeSignedHab("user", undefined, input);
      local.mgr.hold(input.signers);
      for (const peer of peers) {
        for (const [, said] of remote.db.getKelItemIter(peer.pre)) {
          local.kevery.processEvent({
            serder: remote.db.getEvtSerder(peer.pre, said)!,
            sigers: remote.db.sigs.get([peer.pre, said]),
            wigers: [],
            frcs: [],
            sscs: [],
            ssts: [],
            local: false,
          });
        }
      }
      const mids = [peers[0].pre, peers[1].pre, peers[2].pre, member.pre, peers[3].pre];
      const created = local.makeGroupHab("group", member, mids, mids, undefined, {
        isith: ["0", "0", "0", "1", "0"],
        nsith: "1",
        toad: 0,
      });
      const group = created.hab;
      const keys = group.kever!.verfers;
      assertEquals(keys[3].qb64, input.signers[0].verfer.qb64);

      // Group inception contribution.
      assertEquals(created.sigers.map((siger) => siger.index), [3]);
      assert(keys[3].verify(created.sigers[0].raw, created.serder.raw));
      assert(group.kever!.tholder!.satisfy([3]));

      // Group interaction.
      const interaction = local.interactGroupHab("group");
      assertEquals(interaction.sigers.map((siger) => siger.index), [3]);
      assert(keys[3].verify(interaction.sigers[0].raw, interaction.serder.raw));
      assertEquals(group.kever!.sn, 1);

      // Hab.sign group branch, indexed and not.
      const [indexed] = group.sign(message, true);
      assertEquals(indexed.index, 3);
      assert(keys[3].verify(indexed.raw, message));
      assert(keys[3].verify(group.sign(message, false)[0].raw, message));

      // Endpoint-role style signing of a group event with every local member.
      const forged = interact(group.pre, group.kever!.said, 2, [], { version: group.kever!.serder.pvrsn });
      const sigers = signLocalGroupEvent(local, forged, mids, keys.map((verfer) => verfer.qb64));
      assertEquals(sigers.map((siger) => siger.index), [3]);
      assert(keys[3].verify(sigers[0].raw, forged.raw));

      // Without the held signer the group cannot sign as this member.
      local.mgr.release();
      assertThrows(() => group.sign(message, true), Error, "Missing prikey in db for pubkey=");
    } finally {
      yield* local.close();
      yield* remote.close();
    }
  });
});
