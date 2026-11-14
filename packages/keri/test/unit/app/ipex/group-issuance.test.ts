/**
 * Group DH issuance through `runtime.operations.issuance` alone (run in Docker): no CLI code is in the path.
 *
 * A 2-of-2 issuer group (a custodian and a non-custodian member) issues a v2 DH credential to a single-signature
 * holder, each side a composed runtime with its own stores, reached through real local HTTP endpoints. The
 * member reloads between consent and completion, consents again and the issuance completes; every member
 * ends holding the registry root with exactly one copy sent, by the runtime's replicator.
 */
import { createProtocolHandler } from "@keri-ts/hosting";
import {
  collectPayload,
  Diger,
  framePayload,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  type SerderACDC,
  type SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, ensure, type Operation, run, sleep, spawn } from "effection";
import { assert, assertEquals, assertExists, assertNotEquals, assertThrows } from "jsr:@std/assert";
import { loadNests } from "../../../../db.ts";
import { acdcmap } from "../../../../src/acdc/messaging.ts";
import type { RegBaser } from "../../../../src/acdc/regbasing.ts";
import { Regery } from "../../../../src/acdc/registraring.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { groupIpexProposals } from "../../../../src/app/ipex/group-ipex.ts";
import {
  approveGroupIssuance,
  approveGroupIssuanceExchange,
  deriveGroupCustody,
  followGroupIssuanceProof,
  groupIssuanceElection,
  groupIssuanceProof,
  groupIssuanceProposals,
  GroupParty,
  proposeGroupIssuance,
} from "../../../../src/app/ipex/group-issuance.ts";
import { exchangeWire } from "../../../../src/app/ipex/ipex-discloser.ts";
import {
  admitIssuance,
  approveIssuanceExchange,
  deliverIssuanceAdmit,
  type IssuanceDeps,
  type IssuanceOperations,
  type IssuanceStatus,
  issuanceStatus,
  waitForIssuance,
} from "../../../../src/app/ipex/issuance.ts";
import { MULTISIG_EXN_ROUTE, multisigExnBody } from "../../../../src/app/multisig/grouping.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { type AgentRuntime, createAgentRuntime, runAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { type RuntimeClock, systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { interact, reply } from "../../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { openLmdbRegistry } from "../../../../src/db/lmdb-stores.ts";
import { approvePending } from "../multisig/approve-pending.ts";
import { learn } from "../multisig/proposal-fixture.ts";
import { TestClock } from "./issuance-fixtures.ts";

const KRAM = { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } } as const;
const BUDGET_MS = 60_000;

/** One party: stores, composed runtime, and the HTTP endpoint other parties reach it on. */
interface Side {
  name: string;
  /** Store name, so a durable party can open the same stores again. */
  storeName: string;
  hby: Habery;
  baser: RegBaser;
  /** The member habitat that signs and hosts the endpoint. */
  member: Hab;
  /** The group (or, for the holder, the same single-signature) habitat. */
  hab: Hab;
  runtime: AgentRuntime;
  handler: ReturnType<typeof createProtocolHandler>;
  port: number;
}

function ops(side: Side): IssuanceOperations {
  return side.runtime.operations!.issuance;
}

function* until(cond: () => boolean, what: string, ms = BUDGET_MS): Operation<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    yield* sleep(20);
  }
}

/** Open a party's stores and runtime; `dir` makes them durable so they can be closed and opened again. */
function* open(
  name: string,
  bran: string,
  dir?: string,
  clock: RuntimeClock = systemClock,
): Operation<{ hby: Habery; baser: RegBaser; runtime: AgentRuntime }> {
  const hby = yield* createHabery({
    name,
    bran,
    temp: !dir,
    headDirPath: dir,
    skipConfig: true,
    skipSignator: true,
  });
  const baser = yield* openLmdbRegistry({ name: `${name}-registry`, temp: !dir, headDirPath: dir });
  const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), clock, {
    acdc: new Regery(hby, baser),
    kram: KRAM,
  });
  return { hby, baser, runtime };
}

/** The parties of a group issuance, wired to each other: a 2-of-2 issuer group (`lead` is its custodian) and a holder. */
interface GroupIssuers {
  sides: Side[];
  lead: Side;
  peer: Side;
  holder: Side;
  rip: SerderACDC;
  coordinator: SerderKERI;
  credential: SerderACDC;
}

/**
 * Open the custodian, member and holder with `clock`, every party knowing the others' KELs and serving a real
 * endpoint; the issuer members form a 2-of-2 group whose managed registry and coordinator every party holds.
 * `dir` makes the issuer stores durable so they can be closed and opened again.
 */
function* openGroupIssuers(clock: RuntimeClock, dir?: string): Operation<GroupIssuers> {
  const names = ["custodian", "member", "holder"];
  const sides: Side[] = [];
  for (const name of names) {
    const bran = `${name}GroupIssuancePasscodeABC`;
    const storeName = `${name}-${crypto.randomUUID()}`;
    const stores = yield* open(storeName, bran, name === "holder" ? undefined : dir, clock);
    const member = stores.hby.makeHab(name);
    sides.push({ name, storeName, ...stores, member, hab: member } as Side);
  }
  const [lead, peer, holder] = sides;
  yield* ensure(function*() {
    for (const side of sides) {
      yield* side.runtime.close();
      yield* side.hby.close(side.name === "holder");
      yield* side.baser.close(side.name === "holder");
    }
  });
  // Each party knows the others' member KELs.
  for (const source of sides) {
    for (const target of sides) {
      if (source === target) continue;
      for (const wire of source.hby.db.clonePreIter(source.member.pre!, 0)) {
        yield* dispatchEnvelope(envelopeFromFrame(parseBytes(wire)[0]), target.hby.rvy, target.hby.kevery);
      }
    }
  }
  // The two issuer members form a 2-of-2 group; each accepts both inception contributions.
  const signing = [lead.member.pre!, peer.member.pre!];
  const creations = [lead, peer].map((side) =>
    side.hby.makeGroupHab("group", side.member, signing, signing, undefined, { isith: "2", nsith: "2" })
  );
  const inception = parseBytes(messagize(creations[0].serder, {
    sigers: [...creations[0].sigers, ...creations[1].sigers],
    gvrsn: Vrsn_2_0,
  }))[0];
  for (const side of sides) {
    yield* dispatchEnvelope(envelopeFromFrame(inception, true), side.hby.rvy, side.hby.kevery);
  }
  lead.hab = creations[0].hab;
  peer.hab = creations[1].hab;
  const issuers = [lead, peer];
  const intakeAll = function*(wire: Uint8Array, local = false) {
    for (const side of sides) yield* side.runtime.reactor.processBytes(wire, { local });
  };
  const groupProof = (body: SerderKERI) =>
    new TransIdxSigGroup(
      new Prefixer({ qb64: lead.hab.pre! }),
      NumberPrimitive.fromNum(0n),
      new Diger({ qb64: lead.hab.kever!.lastEst.d }),
      issuers.flatMap((side) => side.hab.sign(body.raw, true)),
    );
  const groupInteraction = function*(data: unknown[] = []) {
    const state = lead.hab.kever!;
    const body = interact(lead.hab.pre!, state.said, state.sn + 1, data, { version: Vrsn_2_0 });
    yield* intakeAll(
      messagize(body, { sigers: issuers.flatMap((side) => side.hab.sign(body.raw, true)), gvrsn: Vrsn_2_0 }),
      true,
    );
    return body;
  };
  // The custodian's managed registry, its inception sealed by the group and known to every party.
  const registry = lead.runtime.acdc!.makeRegistry("group-derived", lead.hab.pre!);
  const rip = registry.store.event(registry.regk!)!;
  const coordinator = yield* groupInteraction([{ i: rip.said!, s: rip.sad!.n, d: rip.said! }]);
  yield* intakeAll(rip.raw);
  const credential: SerderACDC = acdcmap(lead.hab.pre!, {
    regid: rip.said!,
    attribute: { d: "", i: holder.hab.pre, name: "Ada" },
  });

  // Real endpoints; a group's endpoints are its members'. The handler is swappable so a member can reload.
  for (const side of sides) {
    const make = () =>
      createProtocolHandler(side.runtime, {
        hostedPrefixes: [side.member.pre!, side.hab.pre!],
        serviceHab: side.member,
      });
    side.handler = make();
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen() {} },
      (request) => side.handler(request),
    );
    side.port = server.addr.port;
    yield* ensure(() =>
      call(async () => {
        await server.shutdown();
        await side.handler.close?.();
      })
    );
    yield* intakeAll(side.member.makeLocScheme(`http://127.0.0.1:${side.port}/`, side.member.pre!, "http"));
    yield* intakeAll(side.member.makeEndRole(side.member.pre!, Roles.controller, true));
    if (side !== holder) {
      const controller = reply("/end/role/add", {
        cid: side.hab.pre,
        role: Roles.controller,
        eid: side.member.pre,
      }, { pre: side.hab.pre!, pvrsn: Vrsn_2_0 });
      yield* intakeAll(messagize(controller, { tsgs: [groupProof(controller)], gvrsn: Vrsn_2_0 }));
    }
  }
  // A wallet registers its identifiers' DH owners when it opens.
  for (const side of sides) side.runtime.ipex!.dhke(side.hab);
  return { sides, lead, peer, holder, rip, coordinator, credential };
}

/** Record, for each request that reaches the holder's endpoint, the key and registry events it carries as `ilk:sn`. */
function recordEvents(holder: Side): string[][] {
  const sent: string[][] = [];
  const serve = holder.handler;
  holder.handler = Object.assign(async (request: Request) => {
    const events = parseBytes(new Uint8Array(await request.clone().arrayBuffer())).flatMap(({ body }) =>
      body.ilk && ["icp", "rot", "ixn", "vcp", "vrt", "iss", "rev", "bup", "rip"].includes(body.ilk)
        ? ["sn" in body ? `${body.ilk}:${body.sn}` : body.ilk]
        : []
    );
    if (events.length) sent.push(events);
    return serve(request);
  }, serve) as typeof serve;
  return sent;
}

Deno.test("a 2-of-2 group issues a v2 DH credential to a single-signature holder; a member reloads and consents again", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await run(function*() {
      const { sides, lead, peer, holder, rip, coordinator, credential } = yield* openGroupIssuers(systemClock, dir);
      const received = recordEvents(holder);

      // Every sent root copy writes one marker through the runtime's single replicator.
      const sentCopies: string[] = [];
      const countCopies = (side: Side) => {
        const pin = side.hby.db.rrsn.pin.bind(side.hby.db.rrsn);
        side.hby.db.rrsn.pin = ((keys: Parameters<typeof pin>[0], record: Parameters<typeof pin>[1]) => {
          sentCopies.push(`${side.member.pre}>${(keys as string[])[2]}`);
          return pin(keys, record);
        }) as typeof pin;
      };
      for (const side of sides) countCopies(side);

      // Every store and the runtime close and open again; only what the stores prove survives.
      const reload = function*(side: Side) {
        yield* side.runtime.close();
        yield* side.hby.close();
        yield* side.baser.close();
        const reopened = yield* open(side.storeName, `${side.name}GroupIssuancePasscodeABC`, dir);
        side.hby = reopened.hby;
        side.baser = reopened.baser;
        side.runtime = reopened.runtime;
        side.member = side.hby.habs.get(side.member.pre!)!;
        side.hab = side.hby.habs.get(side.hab.pre!)!;
        assertExists(side.hab);
        side.runtime.ipex!.dhke(side.hab);
        side.handler = createProtocolHandler(side.runtime, {
          hostedPrefixes: [side.member.pre!, side.hab.pre!],
          serviceHab: side.member,
        });
        countCopies(side);
      };

      // The election reads the same under the pinned coordinator and the default (the latest establishment), and an
      // event that is not an accepted group event is refused.
      const pinned = groupIssuanceElection(ops(lead), lead.hab.pre!, coordinator.said!);
      const byDefault = groupIssuanceElection(ops(lead), lead.hab.pre!);
      assertEquals([byDefault.custodian, byDefault.lead], [pinned.custodian, pinned.lead]);
      assertEquals([pinned.custodian, pinned.lead], [lead.member.pre, true]);
      assertEquals(groupIssuanceElection(ops(peer), peer.hab.pre!).lead, false);
      assertThrows(
        () => groupIssuanceElection(ops(lead), lead.hab.pre!, rip.said!),
        ValidationError,
        "accepted group event",
      );
      const host = (side: Side) => spawn(() => runAgentRuntime(side.runtime, { hab: side.member, pollMailbox: false }));

      // --- the custodian prepares and consents; its host sends the proposal ---
      const draft = { credential, options: { recipient: holder.hab.pre!, message: "Group issuance" } };
      const { grant } = yield* proposeGroupIssuance(ops(lead), draft, { coordinator: coordinator.said! });
      assertEquals(issuanceStatus(ops(lead), grant).state, "active");
      assertEquals(ops(lead).liveOf(grant)!.group!.xid, grant, "the derived transaction id is the Grant's own");
      let leadHost = yield* host(lead);
      const holderHost = yield* host(holder);

      // --- the member sees the proposal and consents; nothing is sent until its host runs ---
      yield* until(
        () => groupIssuanceProposals(ops(peer), peer.hab).some((proposal) => proposal.grant === grant),
        "the member to hold the custodian's proposal",
      );
      const listed = groupIssuanceProposals(ops(peer), peer.hab);
      assertEquals(listed.map((p) => [p.grant, p.proposer, p.recipient, p.complete]), [
        [grant, lead.member.pre, holder.hab.pre, false],
      ]);
      // A fresh issuance Grant is one proposal in one family: the group IPEX list does not offer it too.
      assertEquals(groupIpexProposals(peer.runtime.operations!.groupIpex, peer.hab), []);
      // A proposal the elected custodian did not sign is refused at consent, not left to stall DH.
      const stored = groupIssuanceProposals(ops(peer))[0];
      const original = loadNests(peer.hby.db, stored.wrapper)[0];
      const draftGrant = original.body as SerderKERI;
      const unsigned = parseBytes(exchangeWire(peer.hab, draftGrant))[0];
      unsigned.nests = original.nests;
      const wrapperBody = multisigExnBody(
        peer.member.pre!,
        { route: MULTISIG_EXN_ROUTE, attrs: { gid: peer.hab.pre! } },
        draftGrant,
        { version: Vrsn_2_0 },
      );
      const forgedParent = parseBytes(peer.member.endorse(wrapperBody, { gvrsn: Vrsn_2_0 }))[0];
      forgedParent.nests = [unsigned];
      const forged = yield* call(() => collectPayload(framePayload(forgedParent)));
      let refusedForged = "";
      try {
        yield* approveGroupIssuance(ops(peer), grant, { proposal: forged, coordinator: coordinator.said! });
      } catch (error) {
        refusedForged = (error as Error).message;
      }
      assert(refusedForged.includes("elected custodian's signature"), refusedForged);
      assertEquals(ops(peer).liveOf(grant) !== undefined, false, "a refused proposal records nothing");

      yield* approveGroupIssuance(ops(peer), grant, { coordinator: coordinator.said! });
      assertEquals((issuanceStatus(ops(peer), grant) as { phase: string }).phase, "awaitingGrantSignatures");
      assertEquals(sentCopies, []);

      // --- the member reloads between consent and completion: every store and the runtime close and reopen ---
      yield* reload(peer);
      // What the stores prove: the Grant is pending, no operation holds it, and consent is the member's to give.
      const afterReload = issuanceStatus(ops(peer), grant);
      assertEquals(
        [afterReload.state, (afterReload as { phase?: string }).phase, (afterReload as { needs?: string }).needs],
        ["active", "awaitingExchangeConsent", "exchange"],
      );

      // --- it consents again with the same call and the issuance completes ---
      yield* approveGroupIssuance(ops(peer), grant, { coordinator: coordinator.said! });
      const peerHost = yield* host(peer);

      // The holder consents to the DH exchange once the full Grant has arrived.
      yield* until(() => !!holder.runtime.exc.retainedInput(grant, { pending: true }), "the holder to hold the Grant");
      assertEquals(
        (issuanceStatus(ops(holder), grant) as { needs?: string }).needs,
        "exchange",
        "receiving the Grant does not approve DH",
      );
      approveIssuanceExchange(ops(holder), grant);

      // The registry update is a separate consent: the member approves the custodian's proposal.
      let bup: SerderKERI | undefined;
      yield* until(() => {
        bup = [...peer.hby.db.exns.getTopItemIter()].map(([, body]) => body).find((body) =>
          body.route === "/multisig/bup"
        );
        return !!bup;
      }, "the registry update proposal to reach the member");
      assertEquals(lead.runtime.acdc!.store.headEvent(rip.said!)!.said, rip.said!, "DH does not approve the update");
      assert(!lead.runtime.exc.complete(grant), "the issuance waits for the member's approval of the update");
      // --- the custodian reloads while the registry update still awaits the member: it cannot resume yet ---
      yield* leadHost.halt();
      yield* reload(lead);
      assertEquals(
        issuanceStatus(ops(lead), grant).state,
        "interrupted",
        "the update is not accepted, so nothing resumes",
      );
      leadHost = yield* host(lead);
      // The member approves; the update is accepted in the reloaded custodian's stores, and the owner's repeated scan
      // then derives the coordinator and custodian and adopts the exchange.
      assertExists(yield* approvePending(peer.hby, peer.runtime, { said: bup!.said!, registryName: "group-derived" }));

      // --- completion, read from the stores ---
      const done: IssuanceStatus = { state: "done", role: "issuer", phase: "issued" };
      assertEquals((yield* waitForIssuance(ops(lead), grant, { timeoutMs: BUDGET_MS })).status, done);
      assertEquals((yield* waitForIssuance(ops(peer), grant, { timeoutMs: BUDGET_MS })).status, done);
      const waiting = yield* waitForIssuance(ops(holder), grant, {
        timeoutMs: BUDGET_MS,
        until: (status) => status.state !== "active" || status.needs === "admit",
      });
      assertEquals(
        [waiting.status.state, (waiting.status as { needs?: string }).needs],
        ["active", "admit"],
      );
      for (const side of sides) assert(side.runtime.exc.complete(grant), `${side.name} holds the accepted Grant`);

      // Every member ends holding the registry root, and exactly one copy was sent, to the member only.
      const root = lead.hab.mgr.getRegistryRoot(lead.hab.pre!, rip.said!);
      assertExists(root);
      assertEquals(holder.hab.mgr.getRegistryRoot(holder.hab.pre!, rip.said!)?.qb64, root.qb64);
      yield* until(
        () => !!peer.hab.mgr.getRegistryRoot(peer.hab.pre!, rip.said!),
        "the member to retain its root copy",
      );
      assertEquals(peer.hab.mgr.getRegistryRoot(peer.hab.pre!, rip.said!)?.qb64, root.qb64);
      yield* sleep(300);
      assertEquals(sentCopies, [`${lead.member.pre}>${peer.member.pre}`], "exactly one copy per member, none twice");

      // A member that was sent a root copy is not mistaken for the custodian, whatever the group events elect.
      const registries = { hby: peer.hby, exc: peer.runtime.exc };
      assertEquals(deriveGroupCustody(registries, peer.hab, grant), null, "the copy shows the root was not its own");
      assertEquals(
        deriveGroupCustody({ hby: lead.hby, exc: lead.runtime.exc }, lead.hab, grant)?.custodian,
        lead.member.pre,
      );

      // The custodian's public proof is derivable from the stores, and the status of a completed Grant reads from them.
      const proof = yield* groupIssuanceProof(ops(lead), grant);
      const delivered = [...peer.hby.db.exns.getTopItemIter()].map(([, body]) => body)
        .filter((body) => body.route === "/multisig/ipex-proof");
      assertEquals(delivered.map((body) => body.pre), [lead.member.pre]);
      assertEquals(
        parseBytes(proof).at(-1)!.body.said,
        delivered[0].said,
        "the exported proof is the wrapper the member received",
      );
      assertEquals(issuanceStatus(ops(lead), grant), done);

      // The custodian reloaded, so the operation that proved the Grant never sent its support: it sends in full.
      assert(received.length >= 1 && received.at(-1)!.includes("icp:0"), "a rebuilt operation sends the whole support");

      // --- the holder admits, a separate consent ---
      const admitted = yield* admitIssuance(ops(holder).deps, grant);
      const reached = yield* deliverIssuanceAdmit(ops(holder).deps.delivery, admitted);
      assertNotEquals(reached.length, 0);
      assertEquals(issuanceStatus(ops(holder), grant), { state: "done", role: "holder", phase: "admitted" });
      yield* until(() => lead.runtime.exc.complete(admitted.admit.said!), "the issuer group to accept the Admit");

      yield* peerHost.halt();
      yield* leadHost.halt();
      yield* holderHost.halt();
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("the group's support sent after proving carries only the anchoring event and the registry update", async () => {
  await run(function*() {
    const { lead, peer, holder, coordinator, credential } = yield* openGroupIssuers(systemClock);
    const received = recordEvents(holder);
    const host = (side: Side) => spawn(() => runAgentRuntime(side.runtime, { hab: side.member, pollMailbox: false }));
    const draft = { credential, options: { recipient: holder.hab.pre!, message: "Group issuance" } };
    const { grant } = yield* proposeGroupIssuance(ops(lead), draft, { coordinator: coordinator.said! });
    const hosts = [yield* host(lead), yield* host(holder), yield* host(peer)];
    yield* until(
      () => groupIssuanceProposals(ops(peer), peer.hab).some((proposal) => proposal.grant === grant),
      "the member to hold the custodian's proposal",
    );
    yield* approveGroupIssuance(ops(peer), grant, { coordinator: coordinator.said! });
    yield* until(() => !!holder.runtime.exc.retainedInput(grant, { pending: true }), "the holder to hold the Grant");
    approveIssuanceExchange(ops(holder), grant);
    let bup: SerderKERI | undefined;
    yield* until(() => {
      bup = [...peer.hby.db.exns.getTopItemIter()].map(([, body]) => body).find((body) =>
        body.route === "/multisig/bup"
      );
      return !!bup;
    }, "the registry update proposal to reach the member");
    const sn = lead.hab.kever!.sn;
    assertExists(yield* approvePending(peer.hby, peer.runtime, { said: bup!.said!, registryName: "group-derived" }));
    const done: IssuanceStatus = { state: "done", role: "issuer", phase: "issued" };
    assertEquals((yield* waitForIssuance(ops(lead), grant, { timeoutMs: BUDGET_MS })).status, done);
    yield* sleep(300);
    assert(received[0].includes("icp:0"), "the Grant carries the group's whole KEL");
    assertEquals(
      received.at(-1),
      [`ixn:${sn + 1}`, "bup"],
      "later: exactly the anchoring interaction event and the registry update",
    );
    for (const halt of hosts) yield* halt.halt();
  });
});

// A group cannot re-date its threshold query, so the custodian resends the same bytes. The holder's KRAM drops
// identical copies cheaply only while its replay row lives, and refuses them as untimely once the query is older than
// the multi-key window (60 s here), so resending then is useless work. The schedule doubles from 1 s to 8 s and stops
// at the window; the operation itself keeps waiting for the holder until its Grant deadline.
Deno.test("a group issuer backs off its unchanged threshold query and stops resending once the holder cannot accept it", async () => {
  await run(function*() {
    const clock = new TestClock();
    const { lead, peer, holder, coordinator, credential } = yield* openGroupIssuers(clock);
    // Count the DH queries that reach the holder's endpoint.
    let queries = 0;
    const serve = holder.handler;
    holder.handler = Object.assign(async (request: Request) => {
      const body = new TextDecoder().decode(await request.clone().arrayBuffer());
      if (body.includes("\"t\":\"qry\"") && body.includes("/ipex/dhke")) queries++;
      return serve(request);
    }, serve) as typeof serve;
    const host = (side: Side) => spawn(() => runAgentRuntime(side.runtime, { hab: side.member, pollMailbox: false }));

    const draft = { credential, options: { recipient: holder.hab.pre!, message: "Group issuance" } };
    const { grant } = yield* proposeGroupIssuance(ops(lead), draft, { coordinator: coordinator.said! });
    const leadHost = yield* host(lead);
    const peerHost = yield* host(peer);
    yield* until(
      () => groupIssuanceProposals(ops(peer), peer.hab).some((proposal) => proposal.grant === grant),
      "the member to hold the custodian's proposal",
    );
    yield* approveGroupIssuance(ops(peer), grant, { coordinator: coordinator.said! });

    // The holder never consents to DH, so it never answers. The first query reaches it once.
    yield* until(() => queries >= 1, "the first threshold query to reach the holder");
    yield* sleep(100);
    assertEquals(queries, 1, "one query before the clock moves");

    // Advance the fake clock a second at a time, giving the custodian's host a few passes of its own (it passes
    // every 50 ms) at each step, four minutes in all (inside the Grant's five-minute exchange deadline). Resends
    // fall 1, 3, 7, 15, 23, 31, 39, 47 and 55 s after the first; the next would fall at 63 s, after the 60 s window
    // closed, so ten queries in all.
    let atSeventySeconds = 0;
    for (let second = 1; second <= 240; second++) {
      clock.skew += 1000;
      yield* sleep(150);
      if (second === 70) atSeventySeconds = queries;
    }
    yield* sleep(100);
    assertEquals(atSeventySeconds, 10, "nine backed-off resends inside the window");
    assertEquals(queries, 10, "no resend after the window closed");
    assertEquals(issuanceStatus(ops(lead), grant).state, "active", "the issuance keeps waiting for the holder");
    yield* peerHost.halt();
    yield* leadHost.halt();
  });
});

Deno.test("a member that left after contributing follows the custodian's proof without signing", async () => {
  // Covered end to end by the test above; this pins the contract of the follow call on its own inputs.
  await run(function*() {
    const { hby, runtime } = yield* open(`follow-${crypto.randomUUID()}`, "followGroupIssuancePasscodeABCDE");
    yield* ensure(function*() {
      yield* runtime.close();
      yield* hby.close(true);
    });
    const hab = hby.makeHab("solo");
    const unknown = "EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const issuance = runtime.operations!.issuance;
    let refused = "";
    try {
      yield* followGroupIssuanceProof(issuance, unknown, { coordinator: unknown });
    } catch (error) {
      refused = String((error as Error).message);
    }
    assert(refused.includes("pending group issuance"), refused);
    let holderRefused = "";
    try {
      approveGroupIssuanceExchange(issuance, unknown);
    } catch (error) {
      holderRefused = String((error as Error).message);
    }
    assert(holderRefused.includes("pending group issuance"), holderRefused);
    assertThrows(() => groupIssuanceElection(issuance, hab.pre!), ValidationError, "local group");
  });
});

Deno.test("a Habery that holds two members of one group does not send group issuance traffic to itself", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const other = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const first = hby.makeHab("first"), second = hby.makeHab("second"), remote = other.makeHab("remote");
      yield* call(() => learn(hby, remote));
      const smids = [first.pre!, second.pre!, remote.pre!];
      const created = hby.makeGroupHab("group", first, smids, smids, undefined, { isith: "1", nsith: "1", toad: 0 });
      const party = GroupParty.resolve({ hby, group: {} } as unknown as IssuanceDeps, created.hab);
      assertEquals(party.others(), [remote.pre], "the other local member shares this Habery's stores and is skipped");
    } finally {
      yield* other.close(true);
      yield* hby.close(true);
    }
  });
});
