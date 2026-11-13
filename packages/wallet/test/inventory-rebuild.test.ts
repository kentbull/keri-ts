/**
 * A fresh edge wallet rebuilds its inventory from a co-member's replayed disclosures (run in Docker).
 *
 * The co-member is the weight-0 custodian of `weight-zero-group.ts`: it holds the group, its credentials and their
 * registry state. The edge wallet starts from an empty store, re-adopts its held non-transferable member, rejoins the
 * group and imports what the custodian exports (`exportDisclosureStream`), on a clock two days ahead, so every
 * exchange is far past the wallet's KRAM window and only a retained import accepts it. `credentials.rebuild` then
 * writes the inventory rows.
 */
import { bytesEqual, type SerderACDC, Vrsn_2_0 } from "cesr-ts";
import { call, ensure, type Operation, run } from "effection";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import {
  acdcmap,
  blindate,
  exchangeWire,
  type HttpClient,
  type HttpResponse,
  type HttpStreamResponse,
  ipexExnBody,
  listGroupDisclosures,
  MemoryDerivedUpdateStore,
  prepareIpexExn,
  RegistryCustody,
  type RuntimeClock,
  systemClock,
  ValidationError,
} from "keri-ts/runtime";
import type { StoreLockManager } from "keri-ts/runtime/web";
import { IDBFactory, IDBKeyRange } from "npm:fake-indexeddb@6.2.5";
import { RegistryAuthor } from "../../keri/src/acdc/authoring.ts";
import type { Hab } from "../../keri/src/app/identity/habbing.ts";
import type { Receiptor } from "../../keri/src/app/witness/receipting.ts";
import { interact } from "../../keri/src/core/protocol-eventing.ts";
import { messagize } from "../../keri/src/core/protocol-serialization.ts";
import {
  custodianAccepts,
  exported,
  type Granted,
  grantToGroup,
  shareKel,
  until,
  type WeightZeroGroup,
  weightZeroGroup,
} from "../../keri/test/unit/app/ipex/weight-zero-group.ts";
import { createWalletBaser } from "../lmdb.ts";
import { type HeldCredential, Wallet } from "../mod.ts";
import { openWebWallet, type WebWallet } from "../web.ts";

/** How far the edge wallet's clock runs ahead: past its 24 hour KRAM lags, so its network intake refuses the exchanges. */
const LATE_MS = 2 * 86_400_000;

/** The custodian's OOBI host, as the edge reaches it. */
const OOBI_HOST = "http://custodian.test/oobi";

/** A fresh edge wallet that rejoined the group, and its re-adopted member. */
interface Edge {
  wallet: WebWallet;
  member: string;
}

/** What the group issued: a Grant to the issuer party, its Admit, the credential, its registry and issuing update. */
interface GroupIssued {
  grant: string;
  admit: string;
  credential: SerderACDC;
  regk: string;
  update: string;
}

/** An HTTP client that serves the custodian's OOBIs of `habs`; every other request is a 404. */
function oobiClient(habs: readonly Hab[]): HttpClient {
  const served = new Map(habs.map((hab) => [`${OOBI_HOST}/${hab.pre}/controller`, hab]));
  const missing = { status: 404, ok: false, headers: new Headers() };
  return {
    *request(): Operation<HttpResponse> {
      return { ...missing, body: new Uint8Array() };
    },
    *open(url): Operation<HttpStreamResponse> {
      const hab = served.get(url);
      if (!hab) return { ...missing, body: async function*() {} };
      const bytes = hab.replyToOobi(hab.pre, "controller");
      return {
        status: 200,
        ok: true,
        headers: new Headers({ "content-type": "application/json+cesr" }),
        body: async function*() {
          yield bytes;
        },
      };
    },
  };
}

/**
 * An empty edge store: open a wallet on a fake IndexedDB with the late clock and the member's held signer, re-adopt
 * the member from its signed inception, resolve the custodian member's OOBI and rejoin the group from the custodian's
 * group OOBI. The rejoin writes the group record, which is the signal to refill.
 */
function* freshEdge(g: WeightZeroGroup): Operation<Edge> {
  const { custodian, group } = g, keys = g.edgeKeys!;
  const locks: StoreLockManager = { request: async (_name, _options, callback) => await callback({}) };
  const clock: RuntimeClock = {
    now: () => Date.now() + LATE_MS,
    setTimeout: systemClock.setTimeout,
    clearTimeout: systemClock.clearTimeout,
  };
  const wallet = yield* call(() =>
    openWebWallet({
      name: `edge-${crypto.randomUUID()}`,
      bran: "edgeRefillPasscode0123456",
      heldSigners: [keys.signer],
      host: {
        indexedDb: { factory: new IDBFactory(), keyRange: IDBKeyRange as unknown as typeof globalThis.IDBKeyRange },
        locks,
        storage: { persist: () => Promise.resolve(true) },
        http: oobiClient([custodian.hab, custodian.member]),
        clock,
        lifecycle: null,
      },
    })
  );
  yield* ensure(() => call(() => wallet.close()));
  const member = wallet.hby.makeSignedHab("edge", undefined, { serder: keys.serder, sigers: keys.sigers }).pre!;
  const resolved = yield* call(() => wallet.oobis.resolve(`${OOBI_HOST}/${custodian.member.pre}/controller`));
  assertEquals(resolved.outcome, "resolved");
  const joined = yield* call(() =>
    wallet.groups.rejoin({ oobi: `${OOBI_HOST}/${group}/controller`, group, member, alias: "group" })
  );
  assert(joined.outcome === "joined" && joined.written, "the rejoin writes the record this store lacked");
  return { wallet, member };
}

/** What the original holder reads: a wallet over the custodian's own stores records its consent and reads the view. */
function* holderView(g: WeightZeroGroup, granted: Granted): Operation<HeldCredential> {
  const { custodian } = g;
  const db = yield* createWalletBaser({ name: `custodian-${crypto.randomUUID()}`, temp: true });
  yield* ensure(() => db.close(true));
  const wallet = new Wallet({
    hby: custodian.hby,
    registry: custodian.runtime.acdc!.store,
    exc: custodian.runtime.exc,
    db,
  });
  yield* call(() => wallet.recordAdmission(granted.grant, granted.admit, { consent: true }));
  return yield* call(() => wallet.heldCredential(granted.grant));
}

/** The group holds an admitted credential at the custodian, and a fresh edge wallet imports the custodian's export. */
function* refilled(): Operation<{ g: WeightZeroGroup; granted: Granted; edge: Edge }> {
  const g = yield* weightZeroGroup(true);
  const granted = yield* grantToGroup(g);
  yield* custodianAccepts(g, granted.admit);
  const edge = yield* freshEdge(g);
  const disclosures = listGroupDisclosures(g.custodian.hby, g.custodian.runtime.exc, g.group);
  assertEquals(disclosures.map((row) => [row.grant, row.role]), [[granted.grant, "holder"]]);
  const stream = yield* exported(g.custodian, g.custodian.hab, granted.grant);
  const imported = yield* call(() => edge.wallet.credentials.importStream(stream));
  assertEquals(imported, { saved: [], complete: true, unaccepted: [] });
  return { g, granted, edge };
}

/**
 * The group issues a credential from its own registry, without DH: the custodian incepts the registry and makes its
 * root, the edge member's signature alone anchors the inception and the issuing update as the group, the Grant carries
 * the issuance opening, and the issuer party (as recipient) admits it. The custodian holds the accepted pair.
 */
function* groupIssues(g: WeightZeroGroup): Operation<GroupIssued> {
  const { sides, issuer, edge, custodian, group } = g;
  const anchor = function*(seal: { i: string; s: string; d: string }) {
    const state = edge.hab.kever!;
    const body = interact(group, state.said, state.sn + 1, [seal], { version: Vrsn_2_0 });
    const wire = messagize(body, { sigers: edge.hab.sign(body.raw, true), gvrsn: Vrsn_2_0 });
    for (const side of sides) yield* side.runtime.reactor.processBytes(wire, { local: true });
  };
  const rgy = custodian.runtime.acdc!, store = rgy.store;
  const registry = rgy.makeRegistry("group-issued", group), regk = registry.regk!;
  yield* anchor({ i: regk, s: store.event(regk)!.sad!.n as string, d: regk });
  rgy.processEscrows();
  assertEquals(store.headEvent(regk)?.said, regk, "the custodian accepts the group's registry inception");
  const custody = new RegistryCustody({
    hby: custodian.hby,
    hab: custodian.hab,
    registry: store,
    store: new MemoryDerivedUpdateStore(),
  });
  custody.createCustody(regk);
  const credential = acdcmap(group, { regid: regk, issuee: issuer.hab.pre!, attribute: { name: "Grace" } });
  const opening = custody.derive(regk, 1, credential.said!, "issued");
  const update = blindate(regk, regk, opening.d.nonce, { sn: 1 });
  custody.retainDerivedUpdate(update, opening);
  yield* anchor({ i: regk, s: update.sad!.n as string, d: update.said! });
  store.baser.transaction(() => {
    store.putEvent(update);
    registry.processEvent(update);
  });
  rgy.processEscrows();
  assertEquals(store.headEvent(regk)?.said, update.said, "the custodian accepts the issuing update");

  const plan: [string, string, string[]][] = [[(credential.schema as { $id: string }).$id, "/", []]];
  const discloser = custodian.runtime.operations!.issuance.discloser;
  const [grant, nests] = yield* prepareIpexExn(
    group,
    "/ipex/grant",
    discloser.registryProof(credential, regk, [opening]),
    {
      message: "Group issued",
      recipient: issuer.hab.pre!,
      plan,
    },
  );
  // Signed as the group by the edge member, whose weight alone satisfies the group's threshold.
  yield* custodian.runtime.reactor.processBytes(exchangeWire(edge.hab, grant, nests));
  assert(custodian.runtime.exc.complete(grant.said!), "the custodian accepts the group's Grant");
  const admit = ipexExnBody(issuer.hab.pre!, "/ipex/admit", [], { message: "Admitted", prior: grant });
  yield* custodian.runtime.reactor.processBytes(exchangeWire(issuer.hab, admit));
  assert(custodian.runtime.exc.complete(admit.said!), "the custodian accepts the recipient's Admit");
  return { grant: grant.said!, admit: admit.said!, credential, regk, update: update.said! };
}

/** Stop the fixture's hosts, as each of its tests does. */
function* halt(g: WeightZeroGroup): Operation<void> {
  for (const task of g.hosts) yield* task.halt();
}

Deno.test("the wallet inventory lists a credential imported from a replayed stream", async () => {
  await run(function*() {
    const { g, granted, edge } = yield* refilled();
    const { wallet } = edge;
    assertEquals(wallet.credentials.list().held, [], "importing writes no inventory row");
    const list = yield* call(() => wallet.credentials.rebuild());
    assertEquals(
      list.held.map((row) => [row.grant, row.admit, row.credential, row.holder]),
      [[granted.grant, granted.admit, granted.credential.said, g.group]],
    );
    assertEquals(list.issued, []);
    assertEquals(wallet.credentials.list(), list);
    // The edge returns the same credential and proof bytes as the original holder.
    const original = yield* holderView(g, granted);
    const held = yield* call(() => wallet.wallet.heldCredential(granted.grant));
    assert(bytesEqual(held.credential.raw, original.credential.raw), "the same credential bytes");
    assertEquals(held.proof, original.proof);
    assertEquals(held.artifacts, original.artifacts);
    assertEquals([held.grant.said, held.admit], [granted.grant, original.admit]);
    yield* halt(g);
  });
});

Deno.test("rebuild records a group-issued credential once the root is held", async () => {
  await run(function*() {
    const g = yield* weightZeroGroup(true);
    const { custodian, group } = g;
    const issued = yield* groupIssues(g);
    assertEquals(
      listGroupDisclosures(custodian.hby, custodian.runtime.exc, group).map((row) => [row.grant, row.role]),
      [[issued.grant, "issuer"]],
    );
    const { wallet, member } = yield* freshEdge(g);
    const stream = yield* exported(custodian, custodian.hab, issued.grant);
    assert((yield* call(() => wallet.credentials.importStream(stream))).complete, "the edge accepts the stream");
    // Without the group's registry root the issuance opening cannot be derived, so nothing is recorded yet.
    assertEquals(wallet.hby.mgr.getRegistryRoot(group, issued.regk), null);
    assertEquals(yield* call(() => wallet.credentials.rebuild()), { issued: [], held: [] });
    // The custodian sends the edge member the root copy; the edge takes it in as retained history too.
    const copy = custodian.runtime.registryRoot!.prepare(custodian.member, member, group, issued.regk, {
      hinted: true,
    });
    yield* call(() => wallet.credentials.importStream(copy));
    yield* until(() => !!wallet.hby.mgr.getRegistryRoot(group, issued.regk), "the edge to retain the root copy");
    const list = yield* call(() => wallet.credentials.rebuild());
    assertEquals(
      list.issued.map((row) => [row.credential, row.registry, row.controller, row.update, row.bound]),
      [[issued.credential.said, issued.regk, group, issued.update, null]],
    );
    assertEquals(list.held, []);
    assert(bytesEqual(wallet.wallet.issuedCredential(issued.credential.said!).raw, issued.credential.raw));
    yield* halt(g);
  });
});

Deno.test("rebuild keeps a credential revoked since", async () => {
  await run(function*() {
    const { g, granted, edge } = yield* refilled();
    const { issuer, custodian } = g, { wallet } = edge;
    // The issuer revokes the credential after the group admitted it, and the custodian learns the revocation.
    const stub = { hby: issuer.hby, *receipt(): Operation<void> {} } as unknown as Receiptor;
    const author = new RegistryAuthor(issuer.runtime.acdc!, stub);
    const sn = issuer.hab.kever!.sn + 1;
    const revoked = yield* author.update(
      author.registry("issued", issuer.hab.pre!),
      granted.credential,
      "revoked",
      { public: true },
    );
    yield* shareKel(issuer.hby, issuer.hab.pre!, [custodian], sn);
    yield* custodian.runtime.reactor.processBytes(issuer.runtime.acdc!.store.cloneTel(granted.regk));
    assertEquals(custodian.runtime.acdc!.store.headEvent(granted.regk)?.said, revoked.said);
    // A later refill from the custodian brings the revocation to the edge.
    const stream = yield* exported(custodian, custodian.hab, granted.grant);
    assert((yield* call(() => wallet.credentials.importStream(stream))).complete, "the edge accepts the later stream");
    assertEquals(wallet.runtime.acdc!.store.headEvent(granted.regk)?.said, revoked.said);
    // Fresh consent needs current standing, which a revoked credential no longer has.
    yield* call(() =>
      assertRejects(
        () => wallet.wallet.recordAdmission(granted.grant, granted.admit, { consent: true }),
        ValidationError,
        "Current authenticated graph acceptance",
      )
    );
    // Rebuild checks the history the pair was accepted under: the credential was admitted, so it is held.
    const list = yield* call(() => wallet.credentials.rebuild());
    assertEquals(list.held.map((row) => [row.grant, row.credential]), [[granted.grant, granted.credential.said]]);
    yield* halt(g);
  });
});

Deno.test("rebuild twice changes nothing", async () => {
  await run(function*() {
    const { g, granted, edge } = yield* refilled();
    const { wallet } = edge;
    const first = yield* call(() => wallet.credentials.rebuild());
    assertEquals(first.held.map((row) => row.grant), [granted.grant]);
    // A second rebuild, and a repeated import before it, write nothing and keep the rows as they were.
    assertEquals(yield* call(() => wallet.wallet.reconcileAdmissions()), []);
    const stream = yield* exported(g.custodian, g.custodian.hab, granted.grant);
    assertEquals(yield* call(() => wallet.credentials.importStream(stream)), {
      saved: [],
      complete: true,
      unaccepted: [],
    });
    assertEquals(yield* call(() => wallet.credentials.rebuild()), first);
    assertEquals(wallet.wallet.admissions(granted.credential.said!), first.held);
    yield* halt(g);
  });
});
