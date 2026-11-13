/**
 * A tracked issuance is plain data the wallet's change sink acts on: it is recorded in the inventory once its
 * exchange is over and the registry root can open the update, and it stops being tracked once recorded.
 *
 * The identifier, registry, exchange store, wallet and inventory are real and in memory. Only the issuance
 * owner's live table is a stand-in, so a test decides whether the exchange is still running or complete.
 */
import { b, Kinds, makeBlindState, MtrDex, Salter, type SerderACDC } from "cesr-ts";
import { type Operation, run } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { openRegistry, RegistryStore } from "keri-ts/db";
import {
  acdcmap,
  blindate,
  Exchanger,
  type Hab,
  type Habery,
  openHabery,
  regcept,
  RegistryObserver,
  type RuntimeChange,
} from "keri-ts/runtime";
import { ipexExnBody } from "../../keri/src/app/ipex/ipex-building.ts";
import { MemStoreOpener } from "../../keri/src/db/core/memstore.ts";
import { type TrackedIssuance, type TrackedIssuances, type WalletApiParts } from "../src/web/surface.ts";
import { walletChangeSink } from "../src/web/wallet-api.ts";
import { openWalletBaser, Wallet } from "../web.ts";

/** One issuer with an accepted registry whose single update issues `credential`, opened by a root not yet held. */
interface Fixture {
  readonly hby: Habery;
  readonly issuer: Hab;
  readonly wallet: Wallet;
  readonly grant: string;
  readonly credential: SerderACDC;
  readonly registry: string;
  readonly root: Salter;
  readonly tracked: TrackedIssuances;
  readonly forwarded: string[];
  readonly sink: ReturnType<typeof walletChangeSink>;
  /** Whether the issuance owner reports the exchange running (`true`) or complete (`false`). */
  running: boolean;
  /** Track the issuance as `issue` does. */
  track(): void;
}

/** Build the fixture, run `body`, and close every store. */
function* withIssuance(body: (fixture: Fixture) => Operation<void>): Operation<void> {
  const mem = new MemStoreOpener();
  const hby = yield* openHabery({
    name: crypto.randomUUID(),
    temp: true,
    skipConfig: true,
    opener: mem,
    bran: "0123456789abcdefghijk",
  });
  const baser = yield* openRegistry({ name: crypto.randomUUID(), temp: true, opener: mem });
  const inventory = yield* openWalletBaser(mem, { name: crypto.randomUUID() });
  try {
    const registry = new RegistryStore(baser);
    const issuer = hby.makeHab("issuer"), holder = hby.makeHab("holder");
    const exc = new Exchanger(hby);
    const wallet = new Wallet({ hby, registry, exc, db: inventory });

    // The grant is the exchange the issuance status reads; the registry update is what recording opens.
    const node = acdcmap(issuer.pre, { issuee: holder.pre, attribute: { d: "", role: "member" } });
    const exn = ipexExnBody(issuer.pre, "/ipex/grant", [node], {
      message: "grant",
      recipient: holder.pre,
      plan: [[(node.schema as { $id: string }).$id, "/", []]],
    });
    hby.db.exns.pin([exn.said!], exn);
    const rip = regcept(issuer.pre);
    const credential = acdcmap(issuer.pre, {
      regid: rip.said!,
      kind: Kinds.cbor,
      attribute: { d: "", value: "binary" },
    });
    const root = new Salter({ code: MtrDex.Salt_128, raw: b("0123456789abcdef") });
    // The opening the registry root derives for update 1; the update commits to it.
    const opening = makeBlindState({ salt: root.qb64, sn: 1, tier: "low", acdc: credential.said!, state: "issued" });
    const update = blindate(rip.said!, rip.said!, opening.d.nonce);
    issuer.interact({
      data: [{ i: rip.said!, s: rip.sad!.n, d: rip.said! }, { i: rip.said!, s: update.sad!.n, d: update.said! }],
    });
    const observer = new RegistryObserver(hby.db, registry);
    assertEquals(observer.processEvent(rip).kind, "accept");
    assertEquals(observer.processEvent(update).kind, "accept");

    const tracked: TrackedIssuances = new Map(), forwarded: string[] = [];
    const fixture: Fixture = {
      hby,
      issuer,
      wallet,
      grant: exn.said!,
      credential,
      registry: rip.said!,
      root,
      tracked,
      forwarded,
      sink: walletChangeSink(tracked, () => ({ push: (change: RuntimeChange) => void forwarded.push(change.kind) })),
      running: true,
      track() {
        tracked.set(exn.said!, { parts, hab: issuer, credential, registry: rip.said! } satisfies TrackedIssuance);
      },
    };
    const owner = {
      deps: { hby, exc: { complete: () => !fixture.running }, clock: { now: () => 0 } },
      endedOf: () => undefined,
      liveOf: () => fixture.running ? { role: "issuer", phase: "awaitingDh", expires: null, outbox: {} } : undefined,
    };
    const parts = {
      hby,
      wallet,
      inventory,
      tracked,
      runtime: { operations: { issuance: owner }, acdc: { store: registry } },
    } as unknown as WalletApiParts;
    yield* body(fixture);
  } finally {
    yield* inventory.close(true);
    yield* baser.close(true);
    yield* hby.close(true);
  }
}

/** Whether the inventory holds the issued credential. */
function recorded(fixture: Fixture): boolean {
  return !!fixture.wallet.db.issued.get([fixture.credential.said!]);
}

Deno.test("a tracked issuance is recorded when its issuance change arrives", async () => {
  await run(function*() {
    yield* withIssuance(function*(f) {
      f.hby.mgr.putRegistryRoot(f.issuer.pre, f.registry, f.root);
      f.track();
      f.sink.push({ kind: "event", id: f.grant });
      f.sink.push({ kind: "issuance", id: f.grant });
      assertEquals([recorded(f), f.tracked.has(f.grant)], [false, true], "a running exchange waits");
      f.running = false;
      f.sink.push({ kind: "issuance", id: f.grant });
      assert(recorded(f), "the finished exchange is recorded");
      assertEquals(f.wallet.db.issued.get([f.credential.said!])?.registry, f.registry);
      assertEquals(f.forwarded, ["event", "issuance", "issuance"], "every change is forwarded");
    });
  });
});

Deno.test("a tracked issuance waits for the root and is recorded on the root change", async () => {
  await run(function*() {
    yield* withIssuance(function*(f) {
      f.running = false;
      f.track();
      f.sink.push({ kind: "issuance", id: f.grant });
      assertEquals([recorded(f), f.tracked.has(f.grant)], [false, true], "no root, no opening: still tracked");
      f.hby.mgr.putRegistryRoot(f.issuer.pre, f.registry, f.root);
      f.sink.push({ kind: "root", id: f.registry });
      assert(recorded(f), "the retained root lets it record");
      assertEquals(f.tracked.size, 0);
    });
  });
});

Deno.test("a recorded issuance is no longer tracked", async () => {
  await run(function*() {
    yield* withIssuance(function*(f) {
      f.hby.mgr.putRegistryRoot(f.issuer.pre, f.registry, f.root);
      f.running = false;
      f.track();
      f.sink.push({ kind: "issuance", id: f.grant });
      assertEquals([recorded(f), f.tracked.size], [true, 0]);
      // The same grant tracked again (a reloaded page) is released on the next change without a second row.
      f.track();
      f.sink.push({ kind: "root", id: f.registry });
      assertEquals([f.wallet.inventory().issued.length, f.tracked.size], [1, 0]);
    });
  });
});
