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
 *
 * The fixture lives in `weight-zero-group.ts`. The import tests feed the exported disclosure stream to a fresh store with KRAM on whose clock runs an hour ahead,
 * so every exchange in it is far past its KRAM window: the finite import accepts it as retained history, ordinary
 * intake refuses it.
 */
import { createProtocolHandler } from "@keri-ts/hosting";
import { parseBytes, type Siger, Vrsn_2_0 } from "cesr-ts";
import { call, ensure, type Operation, run } from "effection";
import { assert, assertEquals, assertExists, assertFalse, assertThrows } from "jsr:@std/assert";
import { Regery } from "../../../../src/acdc/registraring.ts";
import {
  type CredentialImportResult,
  importCredentialStream,
} from "../../../../src/app/credentials/credential-importing.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { type DisclosureRole, listGroupDisclosures } from "../../../../src/app/ipex/disclosure-replaying.ts";
import { issuanceStatus } from "../../../../src/app/ipex/issuance.ts";
import { groupSigningMembers } from "../../../../src/app/multisig/group-members.ts";
import { proposeGroupRotation } from "../../../../src/app/multisig/proposing.ts";
import { replaceGroupMember } from "../../../../src/app/multisig/replace-member.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { type RuntimeClock, systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import type { AgentCue } from "../../../../src/core/cues.ts";
import { KramRefusedError, ValidationError } from "../../../../src/core/errors.ts";
import { isKramLateReason } from "../../../../src/core/mailbox/kram-time.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { dgKey } from "../../../../src/db/core/keys.ts";
import { openLmdbRegistry } from "../../../../src/db/lmdb-stores.ts";
import {
  assertCustodianHolds,
  custodianAccepts,
  exported,
  type Granted,
  grantToGroup,
  heldEdge,
  KRAM,
  receives,
  shareKel,
  type Side,
  until,
  type WeightZeroGroup,
  weightZeroGroup,
  wrappersFrom,
} from "./weight-zero-group.ts";

Deno.test("a weight-0 group member receives the group's Grant and holds the credential", async () => {
  await run(function*() {
    const g = yield* weightZeroGroup(false);
    const { admit } = yield* grantToGroup(g);
    yield* custodianAccepts(g, admit);
    for (const task of g.hosts) yield* task.halt();
  });
});

Deno.test("lists a group's held and issued disclosures", async () => {
  await run(function*() {
    const g = yield* weightZeroGroup(false);
    const { issuer, edge, custodian, group } = g;
    const granted = yield* grantToGroup(g);
    const row = (role: DisclosureRole) => ({
      grant: granted.grant,
      admit: granted.admit,
      credential: granted.credential.said!,
      registry: granted.regk,
      role,
    });
    // Until the weight-0 member accepts the group's Admit, the disclosure is not complete in its store.
    assertEquals(listGroupDisclosures(custodian.hby, custodian.runtime.exc, group), []);
    yield* custodianAccepts(g, granted.admit);
    for (const side of [custodian, edge]) {
      assertEquals(listGroupDisclosures(side.hby, side.runtime.exc, group), [row("holder")], side.name);
    }
    // The issuer's store lists the same disclosure as issued by it, and nothing for the group.
    assertEquals(listGroupDisclosures(issuer.hby, issuer.runtime.exc, issuer.hab.pre!), [row("issuer")]);
    assertEquals(listGroupDisclosures(issuer.hby, issuer.runtime.exc, group), [row("holder")]);
    assertEquals(listGroupDisclosures(custodian.hby, custodian.runtime.exc, custodian.member.pre!), []);
    // The registry the group's credential names, read from the store's accepted heads, by issuer.
    const store = custodian.runtime.acdc!.store;
    assertEquals(store.registries(issuer.hab.pre!), [granted.regk]);
    assertEquals(store.registries(group), []);
    assert(store.registries().includes(granted.regk));
    for (const task of g.hosts) yield* task.halt();
  });
});

Deno.test("exported stream carries KELs, registry TEL, Grant and Admit in order", async () => {
  await run(function*() {
    const g = yield* weightZeroGroup(false);
    const { issuer, edge, group } = g;
    const { grant, admit, credential, regk } = yield* grantToGroup(g);
    const stream = yield* exported(edge, edge.hab, grant);
    const frames = parseBytes(stream);
    const kel = (pre: string) => [...edge.hby.db.fels.getAllItemIter(pre)].map(([, , said]) => said);
    const tel = [...edge.runtime.acdc!.store.baser.tels.getAllItemIter(regk)].map(([, , said]) => said.qb64);
    assertEquals(
      frames.map((frame) => frame.body.said),
      [...kel(group), ...kel(issuer.hab.pre!), ...tel, grant, admit],
      "the group's and the issuer's KELs, the registry TEL, then the Grant, then its Admit",
    );
    assertEquals(tel.length, 2, "the registry inception and its issuance update");
    assert(
      frames.at(-2)!.nests!.some((nest) => nest.body.said === credential.said),
      "the credential travels inside its Grant",
    );
    yield* receives(g, { grant, admit, credential, regk }, stream);
    for (const task of g.hosts) yield* task.halt();
  });
});

Deno.test("a weight-0 member exports the same stream", async () => {
  await run(function*() {
    const g = yield* weightZeroGroup(false);
    const { edge, custodian } = g;
    const granted = yield* grantToGroup(g), { grant, admit } = granted;
    yield* custodianAccepts(g, admit);
    // Exporting reads stored evidence only: the weight-0 member's group habitat is never asked to sign.
    const refuse = () => {
      throw new Error("export must not sign");
    };
    const unsigned = Object.assign(Object.create(custodian.hab), { sign: refuse, endorse: refuse }) as Hab;
    const stream = yield* exported(custodian, unsigned, grant);
    // The same events and exchanges in the same order. Attachments are each store's own retained proofs, so the
    // bytes can differ: the custodian also keeps its own signature on the group's inception, for example.
    const saids = (wire: Uint8Array) => parseBytes(wire).map((frame) => frame.body.said);
    assertEquals(saids(stream), saids(yield* exported(edge, edge.hab, grant)));
    yield* receives(g, granted, stream);
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
    assertEquals(
      custodian.hby.db.getKever(group)!.verfers.map((verfer) => verfer.qb64),
      [next.signer.verfer.qb64, custodian.member.kever!.verfers[0].qb64],
    );
    // Accepted from the network, with nothing settled: each runtime's stored members follow accepted state, so the
    // custodian's group messages now go to the new edge member, not the old one. Weight plays no part.
    const follows = (side: Side) => groupSigningMembers(side.hby, group).join() === smids.join();
    yield* until(() => follows(custodian), "the custodian's stored members to name the new edge member");
    assertEquals(custodian.hby.db.getHab(group)?.rmids, rmids);
    // The edge device's lists follow too, while its recorded local member stays the old edge member until replaced.
    yield* until(() => follows(edge), "the edge device's stored members to follow the rotation");
    assertEquals(edge.hby.db.getHab(group)?.mid, edge.member.pre);

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

/** How far the late receiver's clock runs ahead: past every window of {@link KRAM}. */
const LATE_MS = 3_600_000;

/** A fresh store with KRAM on, a signator (so its runtime keeps notices) and a clock {@link LATE_MS} ahead. */
interface LateReceiver {
  hby: Habery;
  runtime: AgentRuntime;
}

/** One disclosure exported from the edge member's store and imported into a late receiver. */
interface ImportedDisclosure {
  g: WeightZeroGroup;
  granted: Granted;
  stream: Uint8Array;
  receiver: LateReceiver;
  result: CredentialImportResult;
}

function* lateReceiver(): Operation<LateReceiver> {
  const hby = yield* createHabery({
    name: `late-${crypto.randomUUID()}`,
    bran: "lateReceiverWeightZeroPasscode",
    temp: true,
    skipConfig: true,
  });
  const baser = yield* openLmdbRegistry({ name: `late-${crypto.randomUUID()}`, temp: true });
  const clock: RuntimeClock = {
    now: () => Date.now() + LATE_MS,
    setTimeout: systemClock.setTimeout,
    clearTimeout: systemClock.clearTimeout,
  };
  const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), clock, {
    acdc: new Regery(hby, baser),
    kram: KRAM,
  });
  yield* ensure(function*() {
    yield* runtime.close();
    yield* hby.close(true);
    yield* baser.close(true);
  });
  assertExists(runtime.notifier, "the receiver keeps notices");
  return { hby, runtime };
}

/** Import `bytes` into `receiver` through the finite credential importer. */
function* imports(receiver: LateReceiver, bytes: Uint8Array, timeoutMs?: number): Operation<CredentialImportResult> {
  const { runtime } = receiver;
  return yield* importCredentialStream(runtime.protocol, runtime.vdr!.reger, bytes, runtime.clock, timeoutMs);
}

/** Grant to the group, export the disclosure from the edge member's store and import it into a late receiver. */
function* importedDisclosure(): Operation<ImportedDisclosure> {
  const g = yield* weightZeroGroup(false);
  const granted = yield* grantToGroup(g);
  const stream = yield* exported(g.edge, g.edge.hab, granted.grant);
  const receiver = yield* lateReceiver();
  const result = yield* imports(receiver, stream);
  return { g, granted, stream, receiver, result };
}

/** What an import could change in `receiver`: exchanges, replies, escrows, KELs, the registry TEL and notices. */
function receiverState(receiver: LateReceiver, g: WeightZeroGroup, regk: string): string {
  const { hby, runtime } = receiver, db = hby.db;
  return JSON.stringify({
    exns: [...db.exns.getTopItemIter()].map(([keys, body]) => [keys, body.said]),
    erpy: [...db.erpy.getTopItemIter()].map(([keys, said]) => [keys, said.qb64]),
    meta: [...db.exchangeMeta.getTopItemIter()].map(([keys, meta]) => [keys, meta]),
    epse: [...db.epse.getTopItemIter()].map(([keys]) => keys),
    emse: [...db.emse!.getTopItemIter()].map(([keys]) => keys),
    kels: [g.group, g.issuer.hab.pre!].map((pre) => [...db.fels.getAllItemIter(pre)].map(([, , said]) => said)),
    tel: [...runtime.acdc!.store.baser.tels.getAllItemIter(regk)].map(([, , said]) => said.qb64),
    notices: runtime.notifier!.count(),
  });
}

Deno.test("import accepts a retained Grant and Admit past their KRAM window", async () => {
  await run(function*() {
    const { g, granted, receiver, result } = yield* importedDisclosure();
    const { grant, admit, regk } = granted, { hby, runtime } = receiver;
    assertEquals(result, { saved: [], complete: true, unaccepted: [] });
    assertEquals(hby.db.getKever(g.group)?.said, g.edge.hby.db.getKever(g.group)?.said, "the group KEL");
    assertEquals(runtime.acdc!.store.headEvent(regk)?.said, g.edge.runtime.acdc!.store.headEvent(regk)?.said);
    assert(runtime.exc.complete(grant), "the Grant is accepted");
    assert(runtime.exc.complete(admit), "the Admit is accepted");
    assertEquals(hby.db.erpy.get([grant])?.qb64, admit, "the Grant's reply row names the Admit");
    // KRAM never saw them: no transaction cache row, and the Exchanger records them as retained history.
    assertEquals(runtime.exc.exchangeDeadline(hby.db.exns.get([grant])!), null);
    assertEquals([grant, admit].map((said) => hby.db.exchangeMeta.get([said])?.retained), [true, true]);
    for (const task of g.hosts) yield* task.halt();
  });
});

Deno.test("network intake still refuses the same stale Grant", async () => {
  await run(function*() {
    const g = yield* weightZeroGroup(false);
    const { grant, admit, regk } = yield* grantToGroup(g);
    const stream = yield* exported(g.edge, g.edge.hab, grant);
    const { runtime } = yield* lateReceiver();
    yield* runtime.reactor.processBytes(stream);
    // The KELs and the TEL are not KRAM's concern and are accepted; the exchanges are refused as late.
    assertEquals(runtime.acdc!.store.headEvent(regk)?.said, g.edge.runtime.acdc!.store.headEvent(regk)?.said);
    assertFalse(runtime.exc.complete(grant), "ordinary intake refuses the stale Grant");
    assertFalse(runtime.exc.complete(admit), "and its Admit");
    assertEquals(runtime.hby.db.epse.get([grant]), null, "nothing is escrowed for it");
    const cues: AgentCue[] = [];
    while (!runtime.cues.empty) cues.push(runtime.cues.pull()!);
    const refused = cues.find((cue) => cue.kin === "kramRefused" && cue.said === grant);
    assert(refused?.kin === "kramRefused" && isKramLateReason(refused.reason), "KRAM refuses the Grant as late");
    for (const task of g.hosts) yield* task.halt();
  });
});

Deno.test("import reports an unaccepted registry event", async () => {
  await run(function*() {
    const g = yield* weightZeroGroup(false);
    const { regk } = yield* grantToGroup(g);
    const store = g.edge.runtime.acdc!.store;
    const tel = [...store.baser.tels.getAllItemIter(regk)].map(([, , said]) => said.qb64);
    const receiver = yield* lateReceiver();
    // The TEL alone, without the issuer's KEL that anchors it: neither event can be accepted.
    const result = yield* imports(receiver, store.cloneTel(regk), 50);
    assertEquals(result, { saved: [], complete: false, unaccepted: tel });
    assertEquals(receiver.runtime.acdc!.store.head(regk), null);
    for (const task of g.hosts) yield* task.halt();
  });
});

Deno.test("a retained Grant leaves no pending operation, notice or escrowed exchange", async () => {
  await run(function*() {
    const { g, granted, receiver, result } = yield* importedDisclosure();
    const { grant, admit } = granted, { hby, runtime } = receiver;
    assert(result.complete);
    // A later escrow pass on the late clock changes nothing either.
    yield* runtime.protocol.processEscrowsOnce();
    assert(runtime.exc.complete(grant) && runtime.exc.complete(admit));
    assertEquals(runtime.notifier!.count(), 0, "no notice asks anyone to act on history");
    assertEquals([...hby.db.epse.getTopItemIter()].length, 0, "no partially signed exchange escrow");
    assertEquals([...hby.db.emse!.getTopItemIter()].length, 0, "no missing-schema exchange escrow");
    // Their age is not a lifetime here: neither is reported expired.
    assertEquals([grant, admit].map((said) => runtime.exc.exchangeExpiry(said)), [null, null]);
    // No issuance operation, live or resumable, and none reported expired.
    const issuance = runtime.operations!.issuance;
    assertEquals(issuance.grantsOf(g.group), []);
    const refused = assertThrows(() => issuanceStatus(issuance, grant), ValidationError, "No issuance was begun");
    assertFalse(refused instanceof KramRefusedError, "the Grant is not refused as lapsed");
    for (const task of g.hosts) yield* task.halt();
  });
});

Deno.test("a second import of the same stream changes nothing", async () => {
  await run(function*() {
    const { g, granted, stream, receiver, result } = yield* importedDisclosure();
    assert(result.complete);
    const before = receiverState(receiver, g, granted.regk);
    const again = yield* imports(receiver, stream);
    assertEquals(again, { saved: [], complete: true, unaccepted: [] });
    assertEquals(receiverState(receiver, g, granted.regk), before);
    for (const task of g.hosts) yield* task.halt();
  });
});
