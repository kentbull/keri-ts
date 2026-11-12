/** The browser entry opens wallet inventory through a backend-neutral opener and keeps it across reopen. */
import {
  b,
  type CesrFrame,
  collectPayload,
  Diger,
  framePayload,
  Kinds,
  makeBlindState,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  type SerderACDC,
  type SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { openRegistry, RegistryStore } from "keri-ts/db";
import { indexedDbOpener } from "keri-ts/db/indexeddb";
import {
  acdcmap,
  blindate,
  Exchanger,
  type Hab,
  type Habery,
  openHabery,
  regcept,
  RegistryObserver,
} from "keri-ts/runtime";
import { IDBFactory, IDBKeyRange } from "npm:fake-indexeddb@6.2.5";
import { ipexExnBody } from "../../keri/src/app/ipex/ipex-building.ts";
import { loadIpexHandlers } from "../../keri/src/app/ipex/ipexing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../keri/src/app/protocol/parsering.ts";
import { TransIdxSigGroup } from "../../keri/src/core/dispatch.ts";
import { messageAttachmentGroups } from "../../keri/src/core/protocol-serialization.ts";
import { MemStoreOpener } from "../../keri/src/db/core/memstore.ts";
import { openWalletBaser, Wallet, type WalletBaser } from "../web.ts";

/** Sign a node or exchange with its owning habitat. */
function signed(body: SerderACDC | SerderKERI, hab: Hab, nests?: CesrFrame[]): CesrFrame {
  const tsgs = [
    new TransIdxSigGroup(
      new Prefixer({ qb64: hab.pre }),
      NumberPrimitive.fromNum(BigInt(hab.kever!.lastEst.s)),
      new Diger({ qb64: hab.kever!.lastEst.d }),
      hab.sign(body.raw, true),
    ),
  ];
  return { body, attachments: messageAttachmentGroups({ tsgs }, Vrsn_2_0), gvrsn: Vrsn_2_0, nests };
}

/** Feed a frame through the ordinary KEL/EXN processor. */
function* ingest(frame: CesrFrame | Uint8Array, hby: Habery, exc: Exchanger): Operation<void> {
  const wire = frame instanceof Uint8Array ? frame : yield* call(() => collectPayload(framePayload(frame)));
  for (const parsed of parseBytes(wire)) yield* dispatchEnvelope(envelopeFromFrame(parsed), hby.rvy, hby.kevery, exc);
}

Deno.test("wallet/web records issuance and admission through indexedDbOpener and reads them after a fresh reopen", async () => {
  const factory = new IDBFactory() as unknown as IDBFactory;
  const keyRange = IDBKeyRange as unknown as typeof globalThis.IDBKeyRange;
  const name = crypto.randomUUID();
  await run(function*() {
    // Protocol owners stay in memory; only the wallet inventory is on IndexedDB.
    const mem = new MemStoreOpener();
    const source = yield* openHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, opener: mem });
    const receiver = yield* openHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, opener: mem });
    const baser = yield* openRegistry({ name: crypto.randomUUID(), temp: true, opener: mem });
    const registry = new RegistryStore(baser);
    const issuer = source.makeHab("issuer"), holder = receiver.makeHab("holder");
    const sending = new Exchanger(source), receiving = new Exchanger(receiver);
    loadIpexHandlers(source, sending, { registry });
    loadIpexHandlers(receiver, receiving, { registry });
    const first = indexedDbOpener({ factory, keyRange });
    const db = yield* openWalletBaser(first, { name });
    const issuerWallet = new Wallet({ hby: source, registry, exc: sending, db });
    const holderWallet = new Wallet({ hby: receiver, registry, exc: receiving, db });
    let reopened: WalletBaser | undefined;
    try {
      for (const wire of source.db.clonePreIter(issuer.pre, 0)) yield* ingest(wire, receiver, receiving);
      for (const wire of receiver.db.clonePreIter(holder.pre, 0)) yield* ingest(wire, source, sending);

      // Accepted blinded issuance, recorded by the issuer.
      const rip = regcept(issuer.pre);
      const credential = acdcmap(issuer.pre, {
        regid: rip.said!,
        kind: Kinds.cbor,
        attribute: { d: "", value: "binary" },
      });
      const opening = makeBlindState({ acdc: credential.said!, state: "issued", sn: 1n, raw: b("0123456789abcdef") });
      const issued = blindate(rip.said!, rip.said!, opening.d.nonce);
      issuer.interact({
        data: [{ i: rip.said!, s: rip.sad!.n, d: rip.said! }, { i: rip.said!, s: issued.sad!.n, d: issued.said! }],
      });
      const observer = new RegistryObserver(source.db, registry);
      assertEquals(observer.processEvent(rip).kind, "accept");
      assertEquals(observer.processEvent(issued).kind, "accept");
      const record = issuerWallet.recordIssued(credential, issued.said!, { blinder: opening });

      // Consent to one accepted Grant/Admit pair, recorded by the holder.
      const node = acdcmap(issuer.pre, { issuee: holder.pre, attribute: { d: "", role: "member" } });
      const grant = ipexExnBody(issuer.pre, "/ipex/grant", [node], {
        message: "grant",
        recipient: holder.pre,
        plan: [[(node.schema as { $id: string }).$id, "/", []]],
      });
      const frame = signed(grant, issuer, [signed(node, issuer)]);
      yield* ingest(frame, source, sending);
      yield* ingest(frame, receiver, receiving);
      const prepared = yield* holderWallet.prepareAdmit(grant.said!, holder.pre, { consent: true });
      yield* ingest(prepared.wire, receiver, receiving);
      yield* ingest(prepared.wire, source, sending);
      const admission = yield* call(() =>
        holderWallet.recordAdmission(grant.said!, prepared.admit.said!, { consent: true })
      );

      // Durable close, then a fresh opener over the same IndexedDB factory.
      yield* db.store.flushed();
      yield* db.close();
      reopened = yield* openWalletBaser(indexedDbOpener({ factory, keyRange }), { name });
      const wallet = new Wallet({ hby: source, registry, exc: sending, db: reopened });
      assertEquals(wallet.inventory().issued, [record]);
      assertEquals(wallet.inventory().held, [admission]);
      assertEquals(wallet.admissions(node.said!), [admission]);
      assert(wallet.issuedCredential(credential.said!).raw.every((byte, i) => byte === credential.raw[i]));
    } finally {
      if (reopened) yield* reopened.close(true);
      yield* db.close(true);
      yield* baser.close(true);
      yield* receiver.close(true);
      yield* source.close(true);
    }
  });
});
