/**
 * A group's mail through a single-signature mailbox host: the group holds the `mailbox` end role and each of its
 * members polls the host with its own keys. Every runtime here is real (Poster, MailboxPoller, Counselor) and
 * shares one in-process HTTP fabric; nothing is stubbed on the delivery path.
 */
import { createProtocolHandler } from "@keri-ts/hosting";
import { Diger, Prefixer } from "cesr-ts";
import type { SerderKERI } from "cesr-ts";
import { call, type Operation, run, spawn, type Task } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { findVerifiedChallengeResponse } from "../../../../src/app/identity/challenging.ts";
import { loadAcceptedEndpointRole } from "../../../../src/app/identity/endpoint-roleing.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { collectKelSubmission } from "../../../../src/app/mailbox/kel-submission.ts";
import {
  addMailbox,
  completeGroupMailbox,
  mailboxStatus,
  proposeGroupMailbox,
} from "../../../../src/app/mailbox/mailbox-admin.ts";
import type { GroupEventRef } from "../../../../src/app/multisig/counseling.ts";
import { listGroupProposals } from "../../../../src/app/multisig/proposals.ts";
import { type AgentRuntime, createAgentRuntime, runAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { exchange } from "../../../../src/core/exchange/protocol-exchanging.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { FakeRuntimeHttpClient } from "../../../support/runtime-fakes.ts";
import { approvalDepsOf, approvePending } from "../multisig/approve-pending.ts";
import { learn } from "../multisig/proposal-fixture.ts";
import { waitForCondition } from "./mailbox-runtime-support.ts";

const HOST_URL = "http://group-mailbox-host.test/";
/** Poll windows short enough that an empty SSE poll turns over within a test's patience. */
const POLLING = { maxPollDurationMs: 150 } as const;
const PATIENCE = { timeoutMs: 10_000 } as const;
const GROUP_ARGS = { isith: "2", nsith: "2", toad: 0 } as const;

/** One participant: its own Habery and runtime, reachable at its own origin and running its workers. */
interface Party {
  readonly hby: Habery;
  readonly hab: Hab;
  readonly runtime: AgentRuntime;
  readonly url: string;
}

/** A 2-of-2 group made of two parties; each party holds its own view of the group habitat. */
interface Group {
  readonly pre: string;
  readonly members: readonly [Party, Party];
}

/** The mailbox host, every party and the one HTTP fabric they share. */
interface Fixture {
  readonly http: FakeRuntimeHttpClient;
  readonly host: {
    readonly hby: Habery;
    readonly runtime: AgentRuntime;
    readonly service: Hab;
    readonly handler: (request: Request) => Promise<Response>;
  };
  party(name: string): Operation<Party>;
}

/** Open the host and a party factory; everything opened is closed, runtimes before their stores. */
function* withFixture(body: (fixture: Fixture) => Operation<void>): Operation<void> {
  const http = new FakeRuntimeHttpClient();
  const hostHby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  const service = hostHby.makeHab("mailbox");
  const hostRuntime = yield* createAgentRuntime(hostHby, http, systemClock, { enableMailboxStore: true });
  const handler = createProtocolHandler(hostRuntime, { serviceHab: service });
  http.registerOrigin(HOST_URL, handler);
  const parties: Party[] = [];
  const workers: Task<void>[] = [];
  const fixture: Fixture = {
    http,
    host: { hby: hostHby, runtime: hostRuntime, service, handler },
    *party(name) {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const hab = hby.makeHab(name, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const runtime = yield* createAgentRuntime(hby, http, systemClock, { mailboxPolling: POLLING });
      const party = { hby, hab, runtime, url: `http://${name}.party.test/` };
      parties.push(party);
      hby.db.locs.pin([service.pre, "http"], { url: HOST_URL });
      http.registerOrigin(party.url, createProtocolHandler(runtime));
      workers.push(yield* spawn(() => runAgentRuntime(runtime)));
      return party;
    },
  };
  try {
    yield* body(fixture);
  } finally {
    for (const worker of workers.reverse()) yield* worker.halt();
    for (const party of parties) yield* party.runtime.close();
    yield* hostRuntime.close();
    for (const party of parties) yield* party.hby.close(true);
    yield* hostHby.close(true);
  }
}

/** Teach each party the others' public KELs. */
function* introduce(...parties: Party[]): Operation<void> {
  for (const target of parties) {
    for (const source of parties) {
      if (source !== target) yield* call(() => learn(target.hby, source.hab));
    }
  }
}

/** The group habitat as one party holds it. */
function groupHab(party: Party, group: Group): Hab {
  return required(party.hby.habs.get(group.pre) ?? null);
}

/**
 * Two parties incept a 2-of-2 group, as the CLI does: each makes its group habitat and the inception carries both
 * contributions. The members reach each other at their own endpoints, not through any mailbox.
 */
function* makeGroup(fixture: Fixture, names: readonly [string, string]): Operation<Group> {
  const members = [yield* fixture.party(names[0]), yield* fixture.party(names[1])] as const;
  yield* introduce(...members);
  for (const target of members) {
    for (const source of members) {
      if (source === target) continue;
      yield* target.runtime.reactor.processBytes(source.hab.makeEndRole(source.hab.pre, Roles.controller, true));
      yield* target.runtime.reactor.processBytes(source.hab.makeLocScheme(source.url, source.hab.pre, "http"));
    }
  }
  const mids = members.map((member) => member.hab.pre);
  const [first, second] = members.map((member) =>
    member.hby.makeGroupHab("group", member.hab, mids, mids, undefined, GROUP_ARGS)
  );
  const icp = messagize(first.serder, { sigers: [...first.sigers, ...second.sigers] });
  for (const member of members) {
    yield* member.runtime.reactor.processBytes(icp, { local: true });
    yield* member.runtime.protocol.processEscrowsOnce();
  }
  return { pre: first.hab.pre, members };
}

/** The host serves the group's mail after one member proposes the role, the other approves and the first completes. */
function* authorizeGroupMailbox(fixture: Fixture, group: Group): Operation<void> {
  const [proposer, approver] = group.members;
  const mailbox = fixture.host.service.pre;
  const proposal = yield* proposeGroupMailbox(
    proposer.hby,
    proposer.runtime.protocol,
    proposer.runtime.postman,
    groupHab(proposer, group),
    mailbox,
  );
  assertEquals(proposal.accepted, false, "one of two signatures does not authorize the mailbox");
  const deps = approvalDepsOf(approver.hby, approver.runtime);
  yield* waitForCondition(
    () => listGroupProposals(deps, { group: group.pre }).some((each) => each.local === "unapproved"),
    { ...PATIENCE, message: "The approver never received the mailbox proposal." },
  );
  const approved = required(yield* approvePending(approver.hby, approver.runtime, { group: group.pre }));
  assertEquals(approved.accepted, true, "the second signature meets the threshold");
  yield* waitForCondition(
    () =>
      mailboxStatus(proposer.hby, group.pre, mailbox).state === "authorized"
      || proposer.hby.db.ends.get([group.pre, Roles.mailbox, mailbox])?.allowed === true,
    { ...PATIENCE, message: "The approval never reached the proposer." },
  );
  yield* completeGroupMailbox(
    {
      hby: proposer.hby,
      http: fixture.http,
      reactor: proposer.runtime.reactor,
      protocol: proposer.runtime.protocol,
    },
    groupHab(proposer, group),
    mailbox,
  );
}

/** The value, failing the test when it is absent. */
function required<T>(value: T | null): T {
  assert(value !== null, "expected a value");
  return value;
}

/** A sender that has learned a group's KEL and its accepted mailbox role. */
function* teachSender(fixture: Fixture, sender: Party, group: Group): Operation<void> {
  const [first] = group.members;
  yield* call(() => learn(sender.hby, groupHab(first, group)));
  const rpy = loadAcceptedEndpointRole(groupHab(first, group), fixture.host.service.pre, Roles.mailbox);
  yield* sender.runtime.reactor.processBytes(rpy);
}

/** A challenge-response exn from `signer` to `recipient`, unsigned. */
function challengeExn(signer: string, recipient: string, words: string[]): SerderKERI {
  return exchange("/challenge/response", { i: signer, words }, { sender: signer, recipient })[0];
}

/** The exn signed by both members for the group: their indexed signatures in one signature group. */
function groupSigned(group: Group, serder: SerderKERI): Uint8Array {
  const sigers = group.members.flatMap((member) => groupHab(member, group).sign(serder.raw, true));
  const kever = required(groupHab(group.members[0], group).kever ?? null);
  const proof = new TransIdxSigGroup(
    new Prefixer({ qb64: group.pre }),
    kever.sner,
    new Diger({ qb64: kever.said }),
    sigers,
  );
  return messagize(serder, { tsgs: [proof] });
}

/** Send `msg` from `src` to `dest` on the challenge topic and require that the Poster delivered it. */
function* deliver(party: Party, src: string, dest: string, msg: Uint8Array): Operation<string[]> {
  const evt = party.runtime.postman.send({ src, dest, topic: "/challenge", msg }, { notify: true });
  const outcome = yield* party.runtime.postman.wait(evt);
  if (outcome.kin !== "sent") throw new Error(`Delivery failed: ${String(outcome.error)}`);
  return outcome.deliveries;
}

/** Wait until `party` holds a verified challenge response from `signer` carrying `words`. */
function* received(party: Party, signer: string, words: string[]): Operation<void> {
  yield* waitForCondition(
    () => findVerifiedChallengeResponse(party.hby.db, signer, words) !== null,
    { ...PATIENCE, message: `${party.hab.pre} never received the response from ${signer}.` },
  );
}

/** A single-signature party that authorizes the host as its own mailbox. */
function* recipientWithMailbox(fixture: Fixture, name: string): Operation<Party> {
  const recipient = yield* fixture.party(name);
  const status = yield* addMailbox(
    {
      hby: recipient.hby,
      http: fixture.http,
      reactor: recipient.runtime.reactor,
      protocol: recipient.runtime.protocol,
    },
    recipient.hab,
    fixture.host.service.pre,
  );
  assertEquals(status.state, "authorized");
  return recipient;
}

/** Teach `sender`'s group members the recipient's KEL and mailbox role so they can address it. */
function* teachMembers(fixture: Fixture, group: Group, recipient: Party): Operation<void> {
  yield* introduce(recipient, ...group.members);
  yield* call(() => learn(recipient.hby, groupHab(group.members[0], group)));
  const rpy = loadAcceptedEndpointRole(recipient.hab, fixture.host.service.pre, Roles.mailbox);
  for (const member of group.members) yield* member.runtime.reactor.processBytes(rpy);
}

Deno.test("A group's mailbox role is proposed by one member, approved by the other, completed, and the mailbox then serves the group's mail to each member and refuses an outsider", async () => {
  await run(function*() {
    yield* withFixture(function*(fixture) {
      const group = yield* makeGroup(fixture, ["alice", "bob"]);
      const sender = yield* fixture.party("sender");
      const outsider = yield* fixture.party("outsider");
      yield* introduce(sender, ...group.members);
      yield* authorizeGroupMailbox(fixture, group);
      for (const member of group.members) {
        assertEquals(mailboxStatus(member.hby, group.pre, fixture.host.service.pre).state, "authorized");
      }

      yield* teachSender(fixture, sender, group);
      const words = ["able", "baker", "charlie"];
      const msg = sender.hab.endorse(challengeExn(sender.hab.pre, group.pre, words));
      const evt = sender.runtime.postman.send(
        { src: sender.hab.pre, dest: group.pre, topic: "/challenge", msg },
        { notify: true },
      );
      const outcome = yield* sender.runtime.postman.wait(evt);
      assertEquals(outcome.kin, "sent");
      for (const member of group.members) yield* received(member, sender.hab.pre, words);

      // The host knows the outsider's KEL, so the refusal is about authority over the group, not an unknown key.
      yield* fixture.host.runtime.reactor.processBytes(collectKelSubmission(outsider.hby, outsider.hab.pre).replay);
      const query = outsider.hab.query(group.pre, fixture.host.service.pre, {
        route: "mbx",
        q: { topics: { "/challenge": 0 } },
      });
      const refused = yield* call(() =>
        fixture.host.handler(
          new Request(HOST_URL, {
            method: "POST",
            headers: { "content-type": "application/cesr" },
            body: new Uint8Array(query),
          }),
        )
      );
      assertEquals(refused.status, 403);
    });
  });
});

Deno.test("A message signed for the group and sent by one member reaches a single-sig recipient's mailbox", async () => {
  await run(function*() {
    yield* withFixture(function*(fixture) {
      const group = yield* makeGroup(fixture, ["alice", "bob"]);
      const recipient = yield* recipientWithMailbox(fixture, "recipient");
      yield* teachMembers(fixture, group, recipient);

      const words = ["delta", "echo", "foxtrot"];
      const msg = groupSigned(group, challengeExn(group.pre, recipient.hab.pre, words));
      const [member] = group.members;
      const deliveries = yield* deliver(member, member.hab.pre, recipient.hab.pre, msg);
      assertEquals(deliveries.length, 1);
      yield* received(recipient, group.pre, words);
    });
  });
});

Deno.test("A group-signed message reaches another group's mailbox and each recipient member receives it", async () => {
  await run(function*() {
    yield* withFixture(function*(fixture) {
      const sending = yield* makeGroup(fixture, ["alice", "bob"]);
      const receiving = yield* makeGroup(fixture, ["carol", "dave"]);
      yield* authorizeGroupMailbox(fixture, receiving);
      yield* introduce(...sending.members, ...receiving.members);
      for (const member of receiving.members) {
        yield* call(() => learn(member.hby, groupHab(sending.members[0], sending)));
      }
      for (const member of sending.members) {
        yield* teachSender(fixture, member, receiving);
      }

      const words = ["golf", "hotel", "india"];
      const msg = groupSigned(sending, challengeExn(sending.pre, receiving.pre, words));
      const [member] = sending.members;
      yield* deliver(member, member.hab.pre, receiving.pre, msg);
      for (const recipient of receiving.members) yield* received(recipient, sending.pre, words);
    });
  });
});

Deno.test("After the group rotates, its members still poll its mailbox and receive new mail", async () => {
  await run(function*() {
    yield* withFixture(function*(fixture) {
      const group = yield* makeGroup(fixture, ["alice", "bob"]);
      const sender = yield* fixture.party("sender");
      yield* introduce(sender, ...group.members);
      yield* authorizeGroupMailbox(fixture, group);
      yield* teachSender(fixture, sender, group);

      const before = ["juliet", "kilo"];
      yield* deliver(
        sender,
        sender.hab.pre,
        group.pre,
        sender.hab.endorse(challengeExn(sender.hab.pre, group.pre, before)),
      );
      for (const member of group.members) yield* received(member, sender.hab.pre, before);

      // Both members rotate, then the group rotates through each member's Counselor; the host is told by the
      // library's own publication, never by the test.
      for (const member of group.members) member.hab.rotate();
      yield* introduce(...group.members);
      const mids = group.members.map((member) => member.hab.pre);
      const rotations = group.members.map((member) => member.hby.rotateGroupHab("group", mids, mids, GROUP_ARGS));
      for (const [index, member] of group.members.entries()) {
        const own = rotations[index], peer = rotations[1 - index];
        const event: GroupEventRef = { pre: group.pre, sn: own.serder.sn!, said: own.serder.said! };
        assert(member.runtime.counselor.start(event));
        yield* member.runtime.reactor.processBytes(peer.message, { local: true });
        yield* member.runtime.protocol.processEscrowsOnce();
      }
      yield* waitForCondition(
        () => fixture.host.hby.db.getKever(group.pre)?.sn === 1,
        { ...PATIENCE, message: "The host never learned the group's rotation." },
      );

      const after = ["lima", "mike"];
      yield* deliver(
        sender,
        sender.hab.pre,
        group.pre,
        sender.hab.endorse(challengeExn(sender.hab.pre, group.pre, after)),
      );
      for (const member of group.members) yield* received(member, sender.hab.pre, after);
    });
  });
});

Deno.test("A member that rotated its own identifier before the group rotates still polls the group's mailbox", async () => {
  await run(function*() {
    yield* withFixture(function*(fixture) {
      const group = yield* makeGroup(fixture, ["alice", "bob"]);
      const sender = yield* fixture.party("sender");
      yield* introduce(sender, ...group.members);
      yield* authorizeGroupMailbox(fixture, group);
      yield* teachSender(fixture, sender, group);

      const [rotated, steady] = group.members;
      rotated.hab.rotate();
      // The host learns the member's new key state through the runtime's own KEL publication.
      yield* waitForCondition(
        () => fixture.host.hby.db.getKever(rotated.hab.pre)?.sn === 1,
        { ...PATIENCE, message: "The host never learned the member's rotation." },
      );

      const words = ["november", "oscar"];
      yield* deliver(
        sender,
        sender.hab.pre,
        group.pre,
        sender.hab.endorse(challengeExn(sender.hab.pre, group.pre, words)),
      );
      yield* received(rotated, sender.hab.pre, words);
      yield* received(steady, sender.hab.pre, words);
    });
  });
});

Deno.test("A message sent as the group itself is wrapped for forwarding by the local member and still reaches the recipient", async () => {
  await run(function*() {
    yield* withFixture(function*(fixture) {
      const group = yield* makeGroup(fixture, ["alice", "bob"]);
      const recipient = yield* recipientWithMailbox(fixture, "recipient");
      yield* teachMembers(fixture, group, recipient);

      // One member's signature cannot meet the group's 2-of-2 threshold, so the host would drop a `/fwd`
      // wrapper signed in the group's name; the Poster signs the wrapper as the member instead.
      const words = ["papa", "quebec"];
      const msg = groupSigned(group, challengeExn(group.pre, recipient.hab.pre, words));
      yield* deliver(group.members[0], group.pre, recipient.hab.pre, msg);
      yield* received(recipient, group.pre, words);
    });
  });
});
