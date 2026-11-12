/**
 * Which local habs exist without accepted key state across a reopen, and what
 * the Habery does with each. LMDB-backed so every store really closes (run in Docker).
 */
import { run } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { b, Diger, MtrDex, type Siger, Signer, Vrsn_2_0 } from "../../../../../cesr/mod.ts";
import { createConfiger } from "../../../../src/app/identity/configing.ts";
import { type Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { incept } from "../../../../src/core/protocol-eventing.ts";
import { dgKey } from "../../../../src/db/core/keys.ts";

const open = (name: string, headDirPath: string) =>
  createHabery({ name, headDirPath, temp: false, skipConfig: true, skipSignator: true });

Deno.test("a delegated single-sig inception is accepted by its own delegate before any anchor, so it reloads, whether the delegator is remote or local", async () => {
  const dir = await Deno.makeTempDir(), name = crypto.randomUUID();
  await run(function*() {
    const remote = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, skipSignator: true });
    const delegator = remote.makeHab("delegator");
    let hby = yield* open(name, dir);
    for (const [, said] of [...remote.db.getKelItemIter(delegator.pre!)]) {
      hby.kevery.processEvent({
        serder: remote.db.getEvtSerder(delegator.pre!, said)!,
        sigers: remote.db.sigs.get(dgKey(delegator.pre!, said)),
        wigers: [],
        frcs: [],
        sscs: [],
        ssts: [],
        local: false,
      });
    }
    // Remote delegator: the delegate accepts its own event before any anchor (KERIpy validateDelegation).
    const child = hby.makeHab("child", undefined, { delpre: delegator.pre! });
    // A local delegator changes nothing for a single-sig delegate: it still accepts its own event.
    const local = hby.makeHab("local-delegator");
    const second = hby.makeHab("second", undefined, { delpre: local.pre! });
    assertEquals([child.accepted, second.accepted], [true, true]);
    yield* hby.close();

    hby = yield* open(name, dir);
    const reopened = hby.habs.get(child.pre!);
    assert(reopened?.accepted && reopened.kever?.delpre === delegator.pre);
    assert(hby.habs.get(second.pre!)?.accepted);
    yield* hby.close(true);
    yield* remote.close(true);
  });
  await Deno.remove(dir, { recursive: true });
});

Deno.test("a keyless hab with alias config reopens without throwing and applies its config once its signer is held", async () => {
  const dir = await Deno.makeTempDir(), name = crypto.randomUUID();
  const date = "2026-04-06T12:00:00.000Z", url = "http://127.0.0.1:7001/";
  await run(function*() {
    const signer = Signer.random({ code: MtrDex.Ed25519_Seed, transferable: true });
    const next = Signer.random({ code: MtrDex.Ed25519_Seed });
    const serder = incept([signer.verfer.qb64], {
      version: Vrsn_2_0,
      code: "E",
      ndigs: [new Diger({ code: MtrDex.Blake3_256, raw: Diger.digest(b(next.verfer.qb64), MtrDex.Blake3_256) }).qb64],
      toad: 0,
    });
    const sigers = [signer.sign(serder.raw, { index: 0 }) as Siger];
    const cf = yield* createConfiger({ name, headDirPath: dir, temp: false });
    cf.put({ keyless: { dt: date, curls: [url] } });
    let hby: Habery = yield* createHabery({ name, headDirPath: dir, cf, skipSignator: true });
    const hab = hby.makeSignedHab("keyless", undefined, { serder, sigers });
    const pre = hab.pre!;
    yield* hby.close();

    hby = yield* createHabery({
      name,
      headDirPath: dir,
      cf: yield* createConfiger({ name, headDirPath: dir, temp: false }),
      skipSignator: true,
    }); // used to throw: no signer to sign config
    assertEquals(hby.deferredReconfigure, [pre]);
    assertEquals(hby.db.locs.get([pre, "http"]), null);
    hby.mgr.hold([signer]);
    assert(hby.habs.get(pre)!.reconfigure());
    assertEquals(hby.db.locs.get([pre, "http"])?.url, url);
    yield* hby.close(true);
  });
  await Deno.remove(dir, { recursive: true });
});
