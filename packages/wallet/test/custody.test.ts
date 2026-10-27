/** Optional secrets stay separate from ordinary inventory and exact public registry history. */
import { BlindState, BoundState, makeBlindState, MtrDex, Signer } from "cesr-ts";
import { parseBytes } from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { openRegistry, RegistryStore } from "keri-ts/db";
import {
  acdcmap,
  blindate,
  createHabery,
  Exchanger,
  type Hab,
  type Habery,
  regcept,
  RegistryObserver,
  ValidationError,
  vetBlind,
} from "keri-ts/runtime";
import { chmod, link, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dispatchEnvelope, envelopeFromFrame } from "../../keri/src/app/protocol/parsering.ts";
import { createWalletBaser, Wallet } from "../mod.ts";
import { RegistryCustody } from "../src/custody.ts";

/** Feed real KEL replay to the ordinary receiver; never copy accepted native markers. */
function* introduce(source: Habery, recipient: Habery, hab: Hab): Operation<void> {
  for (const wire of source.db.clonePreIter(hab.pre, 0)) {
    for (const parsed of parseBytes(wire)) {
      yield* dispatchEnvelope(envelopeFromFrame(parsed), recipient.rvy, recipient.kevery);
    }
  }
}

Deno.test({
  name: "custody protected handoff preserves exact derivation through reopen, AEID replacement and public successor",
  ignore: Deno.build.os === "windows",
  async fn() {
    const root = await Deno.makeTempDir({ prefix: "wallet-custody-" });
    try {
      await run(function*() {
        const source = yield* createHabery({
          name: "custody-issuer",
          headDirPath: root,
          skipConfig: true,
          bran: "MyPasscodeARealSecret",
        });
        const holder = yield* createHabery({
          name: "custody-holder",
          headDirPath: root,
          skipConfig: true,
          bran: "AnotherPasscodeSecretX",
        });
        const baser = yield* openRegistry({ name: "custody-registry", headDirPath: root });
        const sourceDb = yield* createWalletBaser({ name: "custody-issuer", headDirPath: root });
        const holderDb = yield* createWalletBaser({ name: "custody-holder", headDirPath: root });
        const registry = new RegistryStore(baser),
          issuer = source.makeHab("issuer"),
          disclosee = holder.makeHab("holder");
        const custody = new RegistryCustody({ hby: source, registry, db: sourceDb });
        const receiving = new RegistryCustody({ hby: holder, registry, db: holderDb });
        try {
          yield* introduce(source, holder, issuer);
          yield* introduce(holder, source, disclosee);
          const rip = regcept(issuer.pre);
          issuer.interact({ data: [{ s: "0", d: rip.said! }] });
          const observer = new RegistryObserver(source.db, registry);
          assertEquals(observer.processEvent(rip).kind, "accept");
          const info = custody.createCustody(rip.said!, disclosee.pre);
          assertEquals(custody.createCustody(rip.said!, disclosee.pre), info);
          const credential = acdcmap(issuer.pre, { regid: rip.said!, attribute: { d: "", i: disclosee.pre } });
          disclosee.interact();
          const selected = disclosee.kever!.serder;
          const proof = custody.derive(rip.said!, 1, credential.said!, "issued", {
            bound: true,
            bsn: selected.sn!,
            bd: selected.said!,
          });
          const update = blindate(rip.said!, rip.said!, proof.d.nonce);
          custody.retainDerivedUpdate(update, proof); // F02: before processing and anchoring.
          issuer.interact({ data: [{ s: "1", d: update.said! }] });
          assertEquals(observer.processEvent(update).kind, "accept");
          assertEquals(
            BoundState.qb64(custody.derivedOpening(update) as BoundState),
            BoundState.qb64(proof as BoundState),
          );
          const path = join(root, "private-custody.json");
          yield* call(() => custody.exportCustody(rip.said!, path));
          assertEquals((yield* call(() => stat(path))).mode & 0o7777, 0o600);
          const secret = JSON.parse(yield* call(() => readFile(path, "utf8")));
          assert(!(yield* call(() => readFile(join(sourceDb.path!, "data.mdb")))).includes(secret.salt));
          assertEquals(yield* call(() => receiving.importCustody(path, info)), info);
          assertEquals(
            BoundState.qb64(
              receiving.derive(rip.said!, 1, credential.said!, "issued", {
                bound: true,
                bsn: selected.sn!,
                bd: selected.said!,
              }) as BoundState,
            ),
            BoundState.qb64(proof as BoundState),
          );
          const future = custody.derive(rip.said!, 17, credential.said!, "revoked");
          assertEquals(
            BlindState.qb64(receiving.derive(rip.said!, 17, credential.said!, "revoked") as BlindState),
            BlindState.qb64(future as BlindState),
          );
          disclosee.interact(); // Later KEL state must not replace the original exact bound coordinates.
          const other = custody.derive(rip.said!, 2, credential.said!, "revoked", {
            bound: true,
            bsn: disclosee.kever!.sn,
            bd: disclosee.kever!.serder.said!,
          });
          const later = blindate(rip.said!, update.said!, other.d.nonce, { sn: 2 });
          custody.retainDerivedUpdate(later, other);
          issuer.interact({ data: [{ s: "2", d: later.said! }] });
          assertEquals(observer.processEvent(later).kind, "accept");
          yield* sourceDb.close();
          yield* holderDb.close();
          yield* baser.close();
          for (const hby of [source, holder]) {
            yield* hby.ks.close();
            yield* hby.db.close();
            yield* hby.ks.reopen();
            yield* hby.db.reopen();
          }
          yield* sourceDb.reopen();
          yield* holderDb.reopen();
          yield* baser.reopen({ reuse: true });
          assert(vetBlind(custody.derivedOpening(update), proof.d.nonce));
          assert(vetBlind(custody.derivedOpening(later), other.d.nonce));
          const publicProof = makeBlindState({ acdc: credential.said!, state: "revoked" });
          const successor = blindate(rip.said!, later.said!, publicProof.d.nonce, { sn: 3 });
          issuer.interact({ data: [{ s: "3", d: successor.said! }] });
          assertEquals(observer.processEvent(successor).kind, "accept");
          registry.retainOpening(successor, publicProof);
          assert(vetBlind(custody.derivedOpening(update), proof.d.nonce));
          assertEquals(registry.head(rip.said!)!.qb64, successor.said);
          const lost = yield* createWalletBaser({ name: crypto.randomUUID(), temp: true });
          try {
            assertThrows(
              () => new RegistryCustody({ hby: source, registry, db: lost }).createCustody(rip.said!, disclosee.pre),
              ValidationError,
              "cannot be recreated",
            );
          } finally {
            yield* lost.close(true);
          }
          assertThrows(() => receiving.createCustody(rip.said!, disclosee.pre), ValidationError, "local identifier");
          yield* call(() =>
            assertRejects(
              () => receiving.importCustody(path, { ...info, controller: disclosee.pre }),
              ValidationError,
              "controller",
            )
          );
          yield* call(() =>
            assertRejects(() => receiving.importCustody(path, { ...info, discloser: issuer.pre }), ValidationError)
          );
          yield* call(() => chmod(path, 0o644));
          yield* call(() => assertRejects(() => receiving.importCustody(path, info), ValidationError, "mode0600"));
          yield* call(() => chmod(path, 0o600));
          const symbolic = path + ".symlink", hard = path + ".hardlink";
          yield* call(() => symlink(path, symbolic));
          yield* call(() => assertRejects(() => receiving.importCustody(symbolic, info)));
          yield* call(() => link(path, hard));
          yield* call(() => assertRejects(() => receiving.importCustody(path, info), ValidationError, "mode0600"));
          yield* call(() => Deno.remove(hard));
          yield* call(() => assertRejects(() => custody.exportCustody(rip.said!, path)));
          const replacement = new Signer({
            code: MtrDex.Ed25519_Seed,
            raw: crypto.getRandomValues(new Uint8Array(32)),
            transferable: false,
          });
          holder.mgr.updateAeid(replacement.verfer.qb64, replacement.qb64);
          assertThrows(
            () => receiving.derive(rip.said!, 17, credential.said!, "revoked"),
            ValidationError,
            "AEID changed",
          );
          yield* call(() => assertRejects(() => receiving.importCustody(path, info), ValidationError, "AEID changed"));
          yield* call(() => receiving.importCustody(path, { ...info, rewrap: true }));
          yield* holderDb.close();
          yield* holderDb.reopen();
          assertEquals(
            BlindState.qb64(receiving.derive(rip.said!, 17, credential.said!, "revoked") as BlindState),
            BlindState.qb64(future as BlindState),
          );
          const oversized = path + ".large";
          yield* call(() => writeFile(oversized, new Uint8Array(16385), { mode: 0o600 }));
          yield* call(() => assertRejects(() => receiving.importCustody(oversized, info), ValidationError, "size"));
        } finally {
          yield* holderDb.close();
          yield* sourceDb.close();
          yield* baser.close();
          yield* holder.close();
          yield* source.close();
        }
      });
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test("ordinary inventory needs no private capability; lost opaque custody is never regenerated", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const baser = yield* openRegistry({ name: crypto.randomUUID(), temp: true });
    const db = yield* createWalletBaser({ name: crypto.randomUUID(), temp: true });
    try {
      const registry = new RegistryStore(baser), hab = hby.makeHab("issuer");
      const wallet = new Wallet({ hby, registry, db, exc: new Exchanger(hby) });
      assertEquals(wallet.inventory(), { issued: [], held: [] });
      const custody = new RegistryCustody({ hby, registry, db });
      assertThrows(() => custody.createCustody("unprovisioned", hab.pre), ValidationError, "encrypted Keeper");
      const key = new Signer({
        code: MtrDex.Ed25519_Seed,
        raw: crypto.getRandomValues(new Uint8Array(32)),
        transferable: false,
      });
      hby.mgr.updateAeid(key.verfer.qb64, key.qb64);
      const observer = new RegistryObserver(hby.db, registry), rip = regcept(hab.pre);
      hab.interact({ data: [{ s: "0", d: rip.said! }] });
      assertEquals(observer.processEvent(rip).kind, "accept");
      const proof = makeBlindState(), update = blindate(rip.said!, rip.said!, proof.d.nonce);
      hab.interact({ data: [{ s: "1", d: update.said! }] });
      assertEquals(observer.processEvent(update).kind, "accept");
      assertThrows(() => custody.createCustody(rip.said!, hab.pre), ValidationError, "cannot be recreated");
      registry.retainOpening(update, proof);
      assertEquals(custody.createCustody(rip.said!, hab.pre).registry, rip.said);
      assertThrows(() => custody.derive(rip.said!, 0, "", ""), ValidationError, "positive integer");
      assertEquals(wallet.inventory(), { issued: [], held: [] });
    } finally {
      yield* db.close(true);
      yield* baser.close(true);
      yield* hby.close(true);
    }
  });
});
