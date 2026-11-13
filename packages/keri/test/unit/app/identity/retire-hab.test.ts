/**
 * `Habery.retireHab` and `Manager.forget`: a local non-group habitat stops being local, its stored private
 * keys are deleted, and every KEL and BADA record about it stays. LMDB-backed reopen runs in Docker.
 */
import { run } from "effection";
import { assert, assertEquals, assertExists, assertNotEquals, assertThrows } from "jsr:@std/assert";
import { b, Diger, MtrDex, SerderKERI, type Siger, Signer, Vrsn_2_0 } from "../../../../../cesr/mod.ts";
import { type Hab, type Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { incept, reply } from "../../../../src/core/protocol-eventing.ts";

const temp = () => createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, skipSignator: true });

const single = (hby: Habery, name: string, delpre?: string): Hab =>
  hby.makeHab(name, undefined, { transferable: true, icount: 1, isith: "1", ncount: 1, nsith: "1", toad: 0, delpre });

/** Every public key the Keeper's `pubs.` lots name under any of `aliases`. */
function keeperPubs(hby: Habery, aliases: readonly string[]): string[] {
  const pubs = new Set<string>();
  for (const alias of aliases) {
    for (const [, lot] of hby.ks.pubs.getTopItemIter(alias, { topive: true })) lot.pubs.forEach((pub) => pubs.add(pub));
  }
  return [...pubs];
}

/** Keeper `pres.` rows that resolve to `pre`, including the inception key alias `move()` left. */
function presAliases(hby: Habery, pre: string): string[] {
  return [...hby.ks.pres.getTopItemIter()].filter(([, prefixer]) => prefixer.qb64 === pre).map(([keys]) =>
    keys.join(".")
  );
}

/** The durable and live rows a refused retirement must leave as they were. */
function localTrace(hby: Habery, pre: string): unknown[] {
  const record = hby.db.getHab(pre);
  return [
    record?.name,
    record ? hby.db.getName(record.domain ?? "", record.name!) : null,
    hby.db.prefixes.has(pre),
    hby.habs.has(pre),
    hby.ks.getPrms(pre) !== null,
    hby.ks.getSits(pre) !== null,
    keeperPubs(hby, presAliases(hby, pre)).filter((pub) => hby.ks.getPris(pub) !== null).length,
  ];
}

interface PreSigned {
  serder: SerderKERI;
  sigers: Siger[];
  signer: Signer;
}

/** A transferable inception built and signed outside any Habery. */
function preSigned(): PreSigned {
  const signer = Signer.random({ code: MtrDex.Ed25519_Seed, transferable: true });
  const next = Signer.random({ code: MtrDex.Ed25519_Seed });
  const serder = incept([signer.verfer.qb64], {
    version: Vrsn_2_0,
    code: "E",
    ndigs: [new Diger({ code: MtrDex.Blake3_256, raw: Diger.digest(b(next.verfer.qb64), MtrDex.Blake3_256) }).qb64],
    toad: 0,
  });
  return { serder, sigers: [signer.sign(serder.raw, { index: 0 }) as Siger], signer };
}

interface SignedReply {
  serder: SerderKERI;
  tsgs: TransIdxSigGroup[];
}

/** One `/end/role/add` reply by `hab`, signed now at its latest establishment event, stamped `stamp`. */
function signedEndRole(hab: Hab, eid: string, stamp: string): SignedReply {
  const serder = reply("/end/role/add", { cid: hab.pre, role: "mailbox", eid }, {
    pre: hab.pre,
    stamp,
    pvrsn: Vrsn_2_0,
  });
  const kever = hab.kever!;
  const est = hab.db.getEvtSerder(hab.pre, kever.lastEst.d)!;
  const sigers = hab.sign(serder.raw, true) as Siger[];
  return { serder, tsgs: [new TransIdxSigGroup(kever.prefixer, est.sner!, new Diger({ qb64: est.said! }), sigers)] };
}

Deno.test("retireHab removes record, name and prefix but keeps KEL and key state", async () => {
  await run(function*() {
    const hby = yield* temp();
    try {
      const alice = single(hby, "alice");
      alice.interact({ data: [] });
      const pre = alice.pre;
      const kel = [...hby.db.getKelItemIter(pre)];
      const state = hby.db.getState(pre);

      const retired = hby.retireHab(pre);

      assertEquals(retired.pre, pre);
      assertEquals(retired.name, "alice");
      assertEquals(retired.domain, undefined);
      assertEquals(hby.db.getHab(pre), null);
      assertEquals(hby.db.getName("", "alice"), null);
      assertEquals(hby.db.prefixes.has(pre), false);
      assertEquals(hby.prefixes.includes(pre), false);
      assertEquals(hby.habs.has(pre), false);
      assertEquals(hby.habByName("alice"), null);
      assertEquals([...hby.db.getKelItemIter(pre)], kel);
      assertEquals(hby.db.getState(pre), state);
      assertEquals(hby.db.getKever(pre)?.sn, 1);
      // No event was made: the KEL ends where it did.
      assertEquals(kel.length, 2);
      // A second retirement finds no local habitat.
      assertThrows(() => hby.retireHab(pre), ValidationError, "not a local habitat");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("retireHab deletes keeper key material", async () => {
  await run(function*() {
    const hby = yield* temp();
    try {
      const alice = single(hby, "alice");
      const bob = single(hby, "bob");
      alice.rotate({ ncount: 1, nsith: "1" });
      const pre = alice.pre;
      const aliases = presAliases(hby, pre);
      // The self-addressing prefix and the first inception key that `move()` rebound to it.
      assertEquals(aliases.length, 2);
      const pubs = keeperPubs(hby, aliases);
      const stored = pubs.filter((pub) => hby.ks.getPris(pub) !== null);
      assert(stored.length >= 3);
      const bobTrace = localTrace(hby, bob.pre);

      const retired = hby.retireHab(pre);

      assertEquals(retired.keys, stored.length);
      // `pres.` rows stay as the one-way marker; every other key row is gone.
      assertEquals(presAliases(hby, pre), aliases);
      assertEquals(hby.ks.getPrms(pre), null);
      assertEquals(hby.ks.getSits(pre), null);
      assertEquals(keeperPubs(hby, aliases), []);
      for (const pub of pubs) assertEquals(hby.ks.getPris(pub), null);
      assertEquals(localTrace(hby, bob.pre), bobTrace);
      assertExists(bob.sign(b("still signs"), true));
      // The keeper forgets the prefix: a second forget finds nothing.
      assertEquals(hby.mgr.forget(pre), 0);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("retireHab on a keyless habitat", async () => {
  await run(function*() {
    const hby = yield* temp();
    try {
      const { serder, sigers, signer } = preSigned();
      const hab = hby.makeSignedHab("held", undefined, { serder, sigers });
      hby.mgr.hold([signer]);
      const pres = [...hby.ks.pres.getTopItemIter()].length;

      const retired = hby.retireHab(hab.pre);

      assertEquals(retired.keys, 0);
      assertEquals(retired.name, "held");
      assertEquals(hby.db.getHab(hab.pre), null);
      assertEquals(hby.habs.has(hab.pre), false);
      assertEquals([...hby.ks.pres.getTopItemIter()].length, pres);
      assertExists(hby.db.getKever(hab.pre));
      // Retirement is one-way: the adopted inception cannot be adopted again.
      assertThrows(() => hby.makeSignedHab("held", undefined, { serder, sigers }), ValidationError, "already exists");

      // A retry after the Keeper committed and the Baser did not finds a habitat with only `pres.` rows left.
      const keyed = single(hby, "keyed");
      const aliases = presAliases(hby, keyed.pre);
      assert(hby.mgr.forget(keyed.pre) > 0);
      assertExists(hby.db.getHab(keyed.pre));
      assertEquals(hby.retireHab(keyed.pre).keys, 0);
      assertEquals(hby.db.getHab(keyed.pre), null);
      assertEquals(presAliases(hby, keyed.pre), aliases);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("retireHab refuses a recorded group member", async () => {
  await run(function*() {
    const hby = yield* temp();
    try {
      const member1 = single(hby, "member1");
      const member2 = single(hby, "member2");
      const { hab: group } = hby.makeGroupHab("team", member1, [member1.pre, member2.pre], undefined, undefined, {
        isith: "2",
        nsith: "2",
        toad: 0,
      });
      const before = localTrace(hby, member1.pre);

      assertThrows(() => hby.retireHab(member1.pre), ValidationError, `recorded local member of group ${group.pre}`);
      assertEquals(localTrace(hby, member1.pre), before);
      assertThrows(() => hby.retireHab(group.pre), ValidationError, "group habitats is not supported");
      assertExists(hby.db.getHab(group.pre));
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("retireHab refuses an accepted group member", async () => {
  await run(function*() {
    const hby = yield* temp();
    try {
      const member1 = single(hby, "member1");
      const member2 = single(hby, "member2");
      const { hab: group } = hby.makeGroupHab("team", member1, [member1.pre, member2.pre], undefined, undefined, {
        isith: "2",
        nsith: "2",
        toad: 0,
      });
      assertEquals(hby.db.getHab(group.pre)?.mid, member1.pre);
      const before = localTrace(hby, member2.pre);

      assertThrows(() => hby.retireHab(member2.pre), ValidationError, `accepted member of local group ${group.pre}`);
      assertEquals(localTrace(hby, member2.pre), before);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("retireHab refuses a delegator of a local delegate", async () => {
  await run(function*() {
    const hby = yield* temp();
    try {
      const delegator = single(hby, "delegator");
      const delegate = single(hby, "delegate", delegator.pre);
      assertEquals(delegate.kever?.delpre, delegator.pre);
      const before = localTrace(hby, delegator.pre);

      assertThrows(() => hby.retireHab(delegator.pre), ValidationError, `delegator of local habitat ${delegate.pre}`);
      assertEquals(localTrace(hby, delegator.pre), before);
      // The delegate itself is an ordinary single-sig habitat and may be retired.
      assertEquals(hby.retireHab(delegate.pre).name, "delegate");
      assertEquals(hby.retireHab(delegator.pre).name, "delegator");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("retired identifier stays remote after reopen", async () => {
  const dir = await Deno.makeTempDir(), name = crypto.randomUUID();
  const open = () => createHabery({ name, headDirPath: dir, temp: false, skipConfig: true, skipSignator: true });
  await run(function*() {
    let hby = yield* open();
    const alice = single(hby, "alice");
    const bob = single(hby, "bob");
    const pre = alice.pre;
    hby.retireHab(pre);
    yield* hby.close();

    hby = yield* open();
    try {
      assertEquals(hby.habs.has(pre), false);
      assertEquals(hby.db.prefixes.has(pre), false);
      assertEquals(hby.db.getHab(pre), null);
      assertEquals(hby.habByName("alice"), null);
      assertEquals(hby.db.getKever(pre)?.sn, 0);
      assertEquals(hby.ks.getSits(pre), null);
      assert(hby.habs.has(bob.pre));
      assertThrows(() => hby.retireHab(pre), ValidationError, "not a local habitat");
    } finally {
      yield* hby.close(true);
    }
  });
  await Deno.remove(dir, { recursive: true });
});

/** Row counts across the Keeper and the habitat tables, and the next prefix index. */
function storeTrace(hby: Habery): unknown[] {
  const ks = hby.ks;
  return [
    [...ks.pres.getTopItemIter()].length,
    [...ks.prms.getTopItemIter()].length,
    [...ks.sits.getTopItemIter()].length,
    [...ks.pubs.getTopItemIter()].length,
    [...ks.pris.getTopItemIter()].length,
    hby.mgr.pidx,
    [...hby.db.getHabItemIter()].length,
    [...hby.db.names.getTopItemIter()].length,
    [...hby.db.prefixes],
    [...hby.habs.keys()],
  ];
}

Deno.test("creating a habitat that derives a retired identifier's keys is refused and writes nothing", async () => {
  await run(function*() {
    const hby = yield* temp();
    try {
      const old = single(hby, "alice").pre;
      hby.retireHab(old);
      const before = storeTrace(hby);

      for (
        const args of [
          { transferable: true, icount: 1, isith: "1", ncount: 1, nsith: "1", toad: 0 },
          { transferable: true, icount: 2, isith: "2", ncount: 2, nsith: "2", toad: 0 },
          { transferable: true, icount: 1, isith: "1", ncount: 1, nsith: "1", toad: 0, data: [{ other: true }] },
          // The same seed as a non-transferable key encodes the retired public key as `B...` instead of `D...`.
          { transferable: false },
        ]
      ) {
        assertThrows(() => hby.makeHab("alice", undefined, args), Error, `retired identifier ${old}`);
        assertEquals(storeTrace(hby), before);
      }
      assertEquals(hby.db.getName("", "alice"), null);
      assertEquals(hby.db.getHab(old), null);

      // The reverse direction: a retired non-transferable identifier's seed cannot return as a transferable key.
      const basic = hby.makeHab("basic", undefined, { transferable: false }).pre;
      assert(basic.startsWith("B"));
      hby.retireHab(basic);
      const retiredBasic = storeTrace(hby);
      assertThrows(() => single(hby, "basic"), Error, `retired identifier ${basic}`);
      assertEquals(storeTrace(hby), retiredBasic);
      // Another namespace derives other keys.
      assertNotEquals(hby.makeHab("alice", "other").pre, old);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Hab.make leaves no habitat or Keeper rows when local acceptance fails", async () => {
  await run(function*() {
    const hby = yield* temp();
    try {
      const bob = single(hby, "bob");
      const before = storeTrace(hby);
      const processEvent = hby.kevery.processEvent;
      hby.kevery.processEvent = () => ({ kind: "reject", code: "invalidPre", message: "forced rejection" });
      try {
        assertThrows(() => single(hby, "carol"), ValidationError, "forced rejection");
      } finally {
        hby.kevery.processEvent = processEvent;
      }

      assertEquals(storeTrace(hby), before);
      assertEquals(hby.db.getName("", "carol"), null);
      assertEquals(hby.db.getName("", "bob"), bob.pre);
      // Nothing left behind blocks the same inception afterwards.
      assert(single(hby, "carol").accepted);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("a stale reply from a retired identifier is still refused after retirement", async () => {
  await run(function*() {
    const hby = yield* temp();
    try {
      const alice = single(hby, "alice");
      const mailbox = single(hby, "mailbox");
      const older = signedEndRole(alice, mailbox.pre, "2026-01-01T00:00:00.000000+00:00");
      const newer = signedEndRole(alice, mailbox.pre, "2026-01-02T00:00:00.000000+00:00");
      assertEquals(hby.rvy.processReply(newer).kind, "accept");
      const keys: [string, string, string] = [alice.pre, "mailbox", mailbox.pre];
      assertEquals(hby.db.eans.get(keys)?.qb64, newer.serder.said);

      hby.retireHab(alice.pre);

      // The newer accepted reply, its date-time and its signatures stay, so BADA still orders the replay.
      assertEquals(hby.db.eans.get(keys)?.qb64, newer.serder.said);
      assertExists(hby.db.sdts.get([newer.serder.said!]));
      assertEquals(hby.rvy.processReply(older).kind, "unverified");
      assertEquals(hby.db.eans.get(keys)?.qb64, newer.serder.said);
      assertEquals(hby.db.ends.get(keys)?.allowed, true);
      // The same accepted reply replayed is still idempotent.
      assertEquals(hby.rvy.processReply(newer).kind, "accept");
    } finally {
      yield* hby.close(true);
    }
  });
});
