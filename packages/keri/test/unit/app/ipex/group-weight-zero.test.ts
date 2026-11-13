/**
 * A group member whose signing weight is 0 is still a member (run in Docker).
 *
 * The holder group has two signing members under the weighted threshold `["1", "0"]`: the edge member's signature
 * alone satisfies it, and the custodian member's never counts. The custodian also holds the group's sole next-key
 * commitment. A single-signature issuer grants a v2 DH credential to the group and the edge member admits it alone.
 * Weight decides threshold satisfaction only; delivery and membership treat the custodian like any other member: the
 * issuer delivers the Grant to it, the edge member sends it the group's exchange messages, and it ends holding the
 * credential, its TEL state and the registry root, so a wiped co-member could replay from it. Having contributed
 * nothing to the key exchange, it accepts the Grant by following the lead's final proof, signing nothing.
 *
 * The second test uses the deployed shape: the edge member is a non-transferable, inception-only identifier whose
 * signer the host holds (`makeSignedHab`), so its wrappers carry non-indexed signatures, and the group later rotates
 * to another such edge member with the custodian supplying the rotation key.
 */
import { createProtocolHandler } from "@keri-ts/hosting";
import {
  Diger,
  MtrDex,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  type SerderACDC,
  type SerderKERI,
  type Siger,
  Signer,
  Vrsn_2_0,
} from "cesr-ts";
import { call, ensure, type Operation, run, sleep, spawn, type Task } from "effection";
import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { RegistryAuthor } from "../../../../src/acdc/authoring.ts";
import type { RegBaser } from "../../../../src/acdc/regbasing.ts";
import { Regery } from "../../../../src/acdc/registraring.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import {
  approveGroupIpex,
  groupIpexProposals,
  proposeGroupAdmit,
  waitForGroupIpex,
} from "../../../../src/app/ipex/group-ipex.ts";
import { approveGroupIssuanceExchange, followGroupIssuanceProof } from "../../../../src/app/ipex/group-issuance.ts";
import { proposeIssuance, waitForIssuance } from "../../../../src/app/ipex/issuance.ts";
import { groupSigningMembers } from "../../../../src/app/multisig/group-members.ts";
import { proposeGroupRotation, settleProposedRotation } from "../../../../src/app/multisig/proposing.ts";
import { replaceGroupMember } from "../../../../src/app/multisig/replace-member.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { type AgentRuntime, createAgentRuntime, runAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import type { Receiptor } from "../../../../src/app/witness/receipting.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { incept, interact, reply } from "../../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { dgKey } from "../../../../src/db/core/keys.ts";
import { loadNests } from "../../../../src/db/exchange/exchange-nests.ts";
import { openLmdbRegistry } from "../../../../src/db/lmdb-stores.ts";

const KRAM = { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } } as const;
const BUDGET_MS = 60_000;

interface Side {
  name: string;
  hby: Habery;
  baser: RegBaser;
  member: Hab;
  hab: Hab;
  runtime: AgentRuntime;
  handler: ReturnType<typeof createProtocolHandler>;
  url: string;
}

/** One top-level message a side's HTTP endpoint received: its SAID, sender and route. */
interface Arrival {
  said: string | null;
  sender: unknown;
  route: unknown;
}

/** A non-transferable, single-key, inception-only identifier built outside any Habery, as an edge device holds it. */
interface HeldEdge {
  signer: Signer;
  serder: SerderKERI;
  sigers: Siger[];
}

/** The three parties, the holder group and its coordinator, with every runtime hosted and every endpoint served. */
interface WeightZeroGroup {
  sides: Side[];
  issuer: Side;
  edge: Side;
  custodian: Side;
  group: string;
  coordinator: SerderKERI;
  arrivals: Arrival[];
  hosts: Task<void>[];
}

/** What a completed Grant left behind. */
interface Granted {
  grant: string;
  admit: string;
  credential: SerderACDC;
  regk: string;
}

function* until(cond: () => boolean, what: string, ms = BUDGET_MS): Operation<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    yield* sleep(20);
  }
}

/** The routes of the multisig wrappers `side` holds from `sender`. */
function wrappersFrom(side: Side, sender: string): string[] {
  return [...side.hby.db.exns.getTopItemIter()].map(([, body]) => body)
    .filter((body) => body.pre === sender && body.route?.startsWith("/multisig/"))
    .map((body) => body.route!);
}

function heldEdge(): HeldEdge {
  const signer = Signer.random({ code: MtrDex.Ed25519_Seed, transferable: false });
  const serder = incept([signer.verfer.qb64], { version: Vrsn_2_0, code: signer.verfer.code, nsith: "0", toad: 0 });
  return { signer, serder, sigers: [signer.sign(serder.raw, { index: 0 }) as Siger] };
}

/** Accept every accepted event of `pre` from `from` at each of `to`, from `sn` on. */
function* shareKel(from: Habery, pre: string, to: Side[], sn = 0): Operation<void> {
  for (const wire of from.db.clonePreIter(pre, sn)) {
    for (const target of to) {
      if (target.hby === from) continue;
      yield* dispatchEnvelope(envelopeFromFrame(parseBytes(wire)[0]), target.hby.rvy, target.hby.kevery);
    }
  }
}

/**
 * Build the parties and a holder group with signing threshold `["1", "0"]` in which the custodian is the only
 * rotation member. With `nonTransferableEdge`, the edge member is a held non-transferable identifier. Every group
 * signature here is the edge member's alone.
 */
function* weightZeroGroup(nonTransferableEdge: boolean): Operation<WeightZeroGroup> {
  const sides: Side[] = [];
  for (const name of ["issuer", "edge", "custodian"]) {
    const hby = yield* createHabery({
      name: `${name}-${crypto.randomUUID()}`,
      bran: `${name}WeightZeroPasscodeABCDE`,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    const baser = yield* openLmdbRegistry({ name: `${name}-${crypto.randomUUID()}`, temp: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
      acdc: new Regery(hby, baser),
      kram: KRAM,
    });
    let member: Hab;
    if (name === "edge" && nonTransferableEdge) {
      const held = heldEdge();
      member = hby.makeSignedHab(name, undefined, { serder: held.serder, sigers: held.sigers });
      hby.mgr.hold([held.signer]);
    } else member = hby.makeHab(name);
    sides.push({ name, hby, baser, member, hab: member, runtime } as Side);
  }
  yield* ensure(function*() {
    for (const side of sides) {
      yield* side.runtime.close();
      yield* side.hby.close(true);
      yield* side.baser.close(true);
    }
  });
  const [issuer, edge, custodian] = sides;
  if (nonTransferableEdge) {
    assert(edge.member.pre!.startsWith("B"), "the edge member is a non-transferable basic prefix");
    assertEquals(edge.member.kever!.transferable, false);
    assertEquals(edge.member.kever!.ndigers.length, 0, "the edge member commits no next key");
  }
  for (const source of sides) yield* shareKel(source.hby, source.member.pre!, sides);

  // Both members sign; only the edge member's signature carries weight; only the custodian commits a next key.
  const signing = [edge.member.pre!, custodian.member.pre!];
  const creations = [edge, custodian].map((side) =>
    side.hby.makeGroupHab("group", side.member, signing, [custodian.member.pre!], undefined, {
      isith: ["1", "0"],
      nsith: "1",
    })
  );
  assertEquals(creations[0].serder.ked!.kt, ["1", "0"]);
  assertEquals(creations[0].serder.ked!.n, creations[1].serder.ked!.n, "one next-key commitment, the custodian's");
  assertEquals((creations[0].serder.ked!.n as string[]).length, 1);
  // The edge member's signature alone incepts the group, everywhere.
  const inception = parseBytes(messagize(creations[0].serder, { sigers: creations[0].sigers, gvrsn: Vrsn_2_0 }))[0];
  for (const side of sides) {
    yield* dispatchEnvelope(envelopeFromFrame(inception, true), side.hby.rvy, side.hby.kevery);
  }
  edge.hab = creations[0].hab;
  custodian.hab = creations[1].hab;
  const group = edge.hab.pre!;
  for (const side of sides) assertExists(side.hby.db.getKever(group), `${side.name} accepts the group`);
  assertEquals(
    custodian.hby.ks.getSmids(group).map((tuple) => tuple[0].qb64),
    signing,
    "the weight-0 member is a signing member",
  );

  const intakeAll = function*(wire: Uint8Array, local = false) {
    for (const side of sides) yield* side.runtime.reactor.processBytes(wire, { local });
  };
  const groupProof = (body: SerderKERI) =>
    new TransIdxSigGroup(
      new Prefixer({ qb64: group }),
      NumberPrimitive.fromNum(0n),
      new Diger({ qb64: edge.hab.kever!.lastEst.d }),
      edge.hab.sign(body.raw, true),
    );
  // The coordinator: an accepted group event that elects the lowest signing index, the edge member, as lead.
  const state = edge.hab.kever!;
  const coordinator = interact(group, state.said, state.sn + 1, [], { version: Vrsn_2_0 });
  yield* intakeAll(messagize(coordinator, { sigers: edge.hab.sign(coordinator.raw, true), gvrsn: Vrsn_2_0 }), true);
  for (const side of sides) assertEquals(side.hby.db.getKever(group)?.sn, 1, `${side.name} accepts the coordinator`);

  // Real endpoints. A group's endpoints are its members'; the custodian's endpoint records what reaches it.
  const arrivals: Arrival[] = [];
  for (const side of sides) {
    side.handler = createProtocolHandler(side.runtime, {
      hostedPrefixes: [side.member.pre!, side.hab.pre!],
      serviceHab: side.member,
    });
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (request) => {
      if (side === custodian) {
        try {
          for (const frame of parseBytes(new Uint8Array(await request.clone().arrayBuffer()))) {
            arrivals.push({ said: frame.body.said, sender: frame.body.ked?.i, route: frame.body.ked?.r });
          }
        } catch {
          // Not every request body is a parseable message stream; only messages are recorded.
        }
      }
      return side.handler(request);
    });
    yield* ensure(() =>
      call(async () => {
        await server.shutdown();
        await side.handler.close?.();
      })
    );
    side.url = `http://127.0.0.1:${server.addr.port}/`;
    yield* intakeAll(side.member.makeLocScheme(side.url, side.member.pre!, "http"));
    yield* intakeAll(side.member.makeEndRole(side.member.pre!, Roles.controller, true));
    if (side !== issuer) {
      const controller = reply("/end/role/add", {
        cid: group,
        role: Roles.controller,
        eid: side.member.pre,
      }, { pre: group, pvrsn: Vrsn_2_0 });
      yield* intakeAll(messagize(controller, { tsgs: [groupProof(controller)], gvrsn: Vrsn_2_0 }));
    }
  }
  const host = (side: Side) => spawn(() => runAgentRuntime(side.runtime, { hab: side.member, pollMailbox: false }));
  const hosts = [yield* host(issuer), yield* host(edge), yield* host(custodian)];
  return { sides, issuer, edge, custodian, group, coordinator, arrivals, hosts };
}

/**
 * The issuer grants a credential to the group; the edge member alone consents to DH and admits it, and the weight-0
 * custodian follows the final proof. Asserts (a) the edge member sends the custodian the group's exchange
 * messages, (b) the issuer delivers the Grant to the custodian's own endpoint, (c) the custodian holds the accepted
 * Grant, the credential, the issuer's TEL head and the registry root, and (d) DH and the Admit complete on the edge
 * member's signature alone.
 */
function* grantToGroup(g: WeightZeroGroup): Operation<Granted> {
  const { issuer, edge, custodian, group, coordinator, arrivals } = g;
  const stub = { hby: issuer.hby, *receipt(): Operation<void> {} } as unknown as Receiptor;
  const author = new RegistryAuthor(issuer.runtime.acdc!, stub);
  yield* author.incept("issued", issuer.hab.pre!);
  const registry = author.registry("issued", issuer.hab.pre!);
  const credential = author.create(registry, { issuee: group, attribute: { name: "Ada" } });
  const issuance = issuer.runtime.operations!.issuance;
  const { grant } = yield* proposeIssuance(issuance, { credential, options: { recipient: group, message: "Issue" } });

  // (b) The issuer delivers the Grant to the weight-0 member's own endpoint, not only to the edge member's.
  yield* until(
    () => arrivals.some((arrival) => arrival.said === grant && arrival.sender === issuer.hab.pre),
    "the issuer to deliver the Grant to the weight-0 member",
  );
  yield* until(
    () => !!custodian.runtime.exc.retainedInput(grant, { pending: true }),
    "the custodian to hold the Grant",
  );

  // Only the edge member consents to DH; the custodian never consents to anything.
  yield* until(() => !!edge.runtime.exc.retainedInput(grant, { pending: true }), "the edge member to hold the Grant");
  approveGroupIssuanceExchange(edge.runtime.operations!.issuance, grant, coordinator.said!);
  const edgeWaiting = yield* waitForIssuance(edge.runtime.operations!.issuance, grant, {
    timeoutMs: BUDGET_MS,
    until: (status) => status.state !== "active" || status.needs === "admit",
  });
  assertEquals(
    [edgeWaiting.status.state, (edgeWaiting.status as { needs?: string }).needs],
    ["active", "admit"],
    JSON.stringify(edgeWaiting.status),
  );
  assertEquals((yield* waitForIssuance(issuance, grant, { timeoutMs: BUDGET_MS })).status.state, "done");

  // --- (d) the Admit completes on the edge member's signature alone ---
  const proposed = yield* proposeGroupAdmit(edge.runtime.operations!.groupIpex, {
    hab: edge.hab,
    grant,
    message: "Group admit",
  });
  const admit = proposed.said;
  assertEquals(
    (yield* waitForGroupIpex(edge.runtime.operations!.groupIpex, admit, { timeoutMs: BUDGET_MS })).status,
    { state: "done", phase: "accepted" },
    "the Admit completes without the weight-0 member's signature",
  );
  yield* until(() => issuer.runtime.exc.complete(admit), "the issuer to accept the group's Admit");

  // (a) The edge member sent the weight-0 member each group exchange message it publishes, to its own endpoint.
  assertEquals(
    edge.runtime.operations!.groupIpex.outcomes.get(admit)!.members.map((sent) => [sent.recipient, sent.outcome]),
    [[custodian.member.pre, "delivered"]],
    "the Admit proposal went to the weight-0 member",
  );
  yield* until(
    () =>
      ["/multisig/rpy", "/multisig/ipex-proof", "/multisig/exn"].every((route) =>
        wrappersFrom(custodian, edge.member.pre!).includes(route)
      ),
    "the custodian to hold the edge member's DH reply, DH proof and Admit wrappers",
  );
  assert(
    arrivals.some((arrival) => arrival.sender === edge.member.pre && arrival.route === "/multisig/exn"),
    "the wrappers reached the custodian's own endpoint",
  );
  assertEquals(
    groupIpexProposals(custodian.runtime.operations!.groupIpex, custodian.hab).map((p) => [p.said, p.proposer]),
    [[admit, edge.member.pre]],
    "the custodian processed the Admit proposal",
  );

  // (c) The weight-0 member holds the issuer's TEL head and the registry root without consenting to anything.
  const regk = registry.regk!;
  const tel = (side: Side) => side.runtime.acdc!.store.headEvent(regk)?.said;
  const root = edge.hab.mgr.getRegistryRoot(group, regk);
  assertExists(root, "the lead holds the registry root");
  yield* until(() => tel(custodian) === tel(issuer), "the custodian to hold the issuer's TEL head");
  assertEquals(issuer.runtime.acdc!.store.headEvent(regk)?.ilk, "bup", "the TEL head is the issuance update");
  yield* until(() => !!custodian.hab.mgr.getRegistryRoot(group, regk), "the custodian to retain its root copy");
  assertEquals(custodian.hab.mgr.getRegistryRoot(group, regk)?.qb64, root.qb64);
  // The group completed the key exchange without the weight-0 member, so it is too late for it to consent; it
  // follows the lead's final proof instead, signing nothing, and accepts the Grant.
  yield* followGroupIssuanceProof(custodian.runtime.operations!.issuance, grant, { coordinator: coordinator.said! });
  const followed = yield* waitForIssuance(custodian.runtime.operations!.issuance, grant, {
    timeoutMs: BUDGET_MS,
    until: (status) => status.state !== "active" || status.needs === "admit",
  });
  assertEquals([followed.status.state, (followed.status as { needs?: string }).needs], ["active", "admit"]);
  yield* until(() => custodian.runtime.exc.complete(grant), "the custodian to accept the Grant");
  assertCustodianHolds(g, { grant, admit, credential, regk });
  // The weight-0 member contributed nothing to any of it.
  assertEquals(wrappersFrom(edge, custodian.member.pre!), [], "the custodian sent no group contribution");
  return { grant, admit, credential, regk };
}

/** The custodian holds the accepted Grant, its credential, the issuer's TEL head and the group's registry root. */
function assertCustodianHolds(g: WeightZeroGroup, granted: Granted): void {
  const { issuer, edge, custodian, group } = g, { grant, credential, regk } = granted;
  assert(custodian.runtime.exc.complete(grant), "the custodian holds the accepted Grant");
  assert(
    loadNests(custodian.hby.db, grant).some((frame) => frame.body.said === credential.said),
    "the custodian holds the credential the Grant carries",
  );
  assertEquals(
    custodian.runtime.acdc!.store.headEvent(regk)?.said,
    issuer.runtime.acdc!.store.headEvent(regk)?.said,
    "the custodian holds the issuer's TEL head",
  );
  assertEquals(
    custodian.hab.mgr.getRegistryRoot(group, regk)?.qb64,
    edge.hab.mgr.getRegistryRoot(group, regk)?.qb64,
    "the custodian holds the registry root",
  );
}

Deno.test("a weight-0 group member receives the group's Grant and holds the credential", async () => {
  await run(function*() {
    const g = yield* weightZeroGroup(false);
    const { custodian } = g;
    const { admit } = yield* grantToGroup(g);

    // As for any member (KERIpy Multiplexor.add replays a child only after local approval), the weight-0 member
    // accepts the group's completed Admit through its own approval; its signature adds no weight.
    assert(!custodian.runtime.exc.complete(admit), "holding a proposal is not accepting it");
    yield* approveGroupIpex(custodian.runtime.operations!.groupIpex, admit);
    assertEquals(
      (yield* waitForGroupIpex(custodian.runtime.operations!.groupIpex, admit, { timeoutMs: BUDGET_MS })).status,
      { state: "done", phase: "accepted" },
    );
    for (const task of g.hosts) yield* task.halt();
  });
});

Deno.test("a weight-0 custodian holds the group's credential when the edge member is non-transferable", async () => {
  await run(function*() {
    const g = yield* weightZeroGroup(true);
    const { sides, edge, custodian, group } = g;
    const granted = yield* grantToGroup(g);

    // --- the group rotates to another non-transferable edge member; the custodian supplies the rotation key ---
    // The edge device's store adopts the new member and holds its signer; every party learns its inception.
    const next = heldEdge();
    const nextEdge = edge.hby.makeSignedHab("edge-2", undefined, { serder: next.serder, sigers: next.sigers });
    edge.hby.mgr.hold([next.signer]);
    yield* shareKel(edge.hby, nextEdge.pre!, sides);
    // The new edge member is served at the edge device's endpoint.
    const previousHandler = edge.handler;
    edge.handler = createProtocolHandler(edge.runtime, {
      hostedPrefixes: [edge.member.pre!, nextEdge.pre!, group],
      serviceHab: edge.member,
    });
    yield* call(async () => await previousHandler.close?.());
    for (
      const wire of [
        nextEdge.makeLocScheme(edge.url, nextEdge.pre!, "http"),
        nextEdge.makeEndRole(nextEdge.pre!, Roles.controller, true),
      ]
    ) {
      for (const side of sides) yield* side.runtime.reactor.processBytes(wire);
    }
    // The custodian's committed next key becomes current, and every party learns the custodian's rotation.
    custodian.member.rotate();
    yield* shareKel(custodian.hby, custodian.member.pre!, sides, 1);
    // The custodian proposes the rotation: its own contribution signs its new key at index 1 against the group's
    // only prior next digest, which alone satisfies the prior next threshold but not the current one.
    const smids = [nextEdge.pre!, custodian.member.pre!], rmids = [custodian.member.pre!];
    const proposed = yield* proposeGroupRotation(custodian.runtime, custodian.hab, {
      smids,
      rmids,
      isith: ["1", "0"],
      nsith: "1",
    });
    assertEquals(
      custodian.hby.db.getKever(group)!.sn,
      1,
      "the custodian's weight-0 signature does not rotate the group",
    );
    assertEquals(
      proposed.members.map((sent) => [sent.recipient, sent.outcome]),
      [[nextEdge.pre, "delivered"]],
      "the weight-0 proposer reaches the new non-transferable edge member",
    );
    yield* until(
      () => wrappersFrom(edge, custodian.member.pre!).includes("/multisig/rot"),
      "the edge device to hold the custodian's rotation proposal",
    );
    // The new edge member signs its current-only contribution; with it the rotation meets both thresholds.
    const body = custodian.hby.db.getEvtSerder(group, proposed.event.said)!;
    const own = custodian.hby.db.sigs.get(dgKey(group, proposed.event.said));
    assertEquals(own.map((siger) => [siger.index, siger.ondex]), [[1, 0]]);
    const edgeSiger = next.signer.sign(body.raw, { index: 0, only: true }) as Siger;
    const rot = parseBytes(messagize(body, { sigers: [edgeSiger, ...own], gvrsn: Vrsn_2_0 }))[0];
    for (const side of sides) {
      yield* dispatchEnvelope(envelopeFromFrame(rot, true), side.hby.rvy, side.hby.kevery);
      assertEquals(side.hby.db.getKever(group)?.said, proposed.event.said, `${side.name} accepts the rotation`);
    }
    // The proposer commits the members its proposal named once the rotation is accepted.
    assert(settleProposedRotation(custodian.runtime, proposed));
    assertEquals(
      custodian.hby.db.getKever(group)!.verfers.map((verfer) => verfer.qb64),
      [next.signer.verfer.qb64, custodian.member.kever!.verfers[0].qb64],
    );

    // The edge device's store records the new edge member as the group's local member; it signs as the group.
    const replaced = replaceGroupMember(edge.runtime, { group, member: nextEdge, smids, rmids });
    assertEquals(replaced.previous, edge.member.pre);
    assertEquals(edge.hby.db.getHab(group)?.mid, nextEdge.pre);
    assertEquals(groupSigningMembers(edge.hby, group), smids);
    const probe = new TextEncoder().encode("signed as the group by the new edge member");
    const [signed] = edge.hby.habs.get(group)!.sign(probe, true) as Siger[];
    assertEquals(signed.index, 0);
    assert(edge.hby.db.getKever(group)!.verfers[0].verify(signed.raw, probe));

    // The custodian still holds the credential, and its record follows the rotated membership.
    assertCustodianHolds(g, granted);
    assertEquals(groupSigningMembers(custodian.hby, group), smids, "the custodian's record names the new edge member");
    for (const task of g.hosts) yield* task.halt();
  });
});
