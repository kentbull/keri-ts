/**
 * A group IPEX contribution that this member's own KRAM refuses is reported, not dropped (run in Docker).
 *
 * A 2-of-2 group's member signs its share of an Offer and feeds it to its own receiver. When KRAM refuses it for
 * its time or exchange lifetime, the consent throws `KramRefusedError`; when it is refused later, during the
 * operation's collection, the operation ends `expired` and `waitForGroupIpex` settles instead of timing out.
 */
import { Dater, parseBytes, type SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assert, assertEquals, assertInstanceOf, assertMatch } from "jsr:@std/assert";
import { Regery } from "../../../../src/acdc/registraring.ts";
import type { Poster, PosterEvent, PosterOutcome } from "../../../../src/app/delivery/forwarding.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import {
  GroupIpexOperations,
  groupIpexStatus,
  proposeGroupIpex,
  waitForGroupIpex,
} from "../../../../src/app/ipex/group-ipex.ts";
import { ipexExnBody } from "../../../../src/app/ipex/ipex-building.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { KramRefusedError } from "../../../../src/core/errors.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";
import { openLmdbRegistry } from "../../../../src/db/lmdb-stores.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../../../../src/time/mod.ts";
import { KRAM, TestClock } from "./issuance-fixtures.ts";

/** The exchange lifetime and drift of `KRAM`, in ms: a message stamped now is fresh, one a quarter hour on is not. */
const AGE_MS = 15 * 60_000;

interface Member {
  hby: Habery;
  runtime: AgentRuntime;
  hab: Hab;
}

/** What a test needs of a 2-of-2 group: the first member's operations and an Offer the group authored. */
interface Group {
  clock: TestClock;
  ops: GroupIpexOperations;
  member: Member;
  offer: SerderKERI;
  /** Pin when the offer's exchange opened, as accepting its Apply would have. */
  openedAt(timestampMs: number): void;
}

/** Poster whose sends all succeed at once; a collected contribution, not delivery, is what these tests exercise. */
function deliveringPoster(): Poster {
  const sent = (evt: PosterEvent): PosterOutcome => ({ kin: "sent", evt, deliveries: [] });
  return {
    send: (evt: PosterEvent) => ({ ...evt, kin: "msg" }),
    sendStream: (evt: PosterEvent) => ({ ...evt, kin: "stream" }),
    wait: (evt: PosterEvent): Operation<PosterOutcome> => call(() => Promise.resolve(sent(evt))),
  } as unknown as Poster;
}

/** Two members of a 2-of-2 group on KRAM, driven by a manual clock; the first member runs the operations. */
function* openGroup(): Operation<Group> {
  const clock = new TestClock();
  const members: Member[] = [];
  for (const name of ["one", "two"]) {
    const hby = yield* createHabery({
      name: `${name}-${crypto.randomUUID()}`,
      bran: `${name}GroupIpexKramPasscodeABCDE`,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    const baser = yield* openLmdbRegistry({ name: `${name}-${crypto.randomUUID()}`, temp: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), clock, {
      acdc: new Regery(hby, baser),
      kram: KRAM,
    });
    members.push({ hby, runtime, hab: hby.makeHab(name) });
  }
  const [first] = members;
  for (const source of members) {
    for (const target of members) {
      if (source === target) continue;
      for (const wire of source.hby.db.clonePreIter(source.hab.pre!, 0)) {
        yield* dispatchEnvelope(envelopeFromFrame(parseBytes(wire)[0]), target.hby.rvy, target.hby.kevery);
      }
    }
  }
  const signing = members.map((member) => member.hab.pre!);
  const creations = members.map((member) =>
    member.hby.makeGroupHab("group", member.hab, signing, signing, undefined, { isith: "2", nsith: "2" })
  );
  const inception = parseBytes(messagize(creations[0].serder, {
    sigers: creations.flatMap((creation) => creation.sigers),
    gvrsn: Vrsn_2_0,
  }))[0];
  for (const member of members) {
    yield* dispatchEnvelope(envelopeFromFrame(inception, true), member.hby.rvy, member.hby.kevery);
  }
  const group = creations[0].hab;
  const peer = first.hby.makeHab("peer");
  const apply = ipexExnBody(peer.pre!, "/ipex/apply", [], { message: "Apply", recipient: group.pre!, plan: [] });
  const offer = ipexExnBody(group.pre!, "/ipex/offer", [], { message: "Offer", prior: apply, plan: [] });
  const ops = new GroupIpexOperations({
    hby: first.hby,
    rgy: first.runtime.acdc!,
    exc: first.runtime.exc,
    protocol: first.runtime.protocol,
    postman: deliveringPoster(),
    clock,
  });
  return {
    clock,
    ops,
    member: { ...first, hab: group },
    offer,
    openedAt: (timestampMs) =>
      first.hby.db.xdt.pin(
        apply.said!,
        new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601(new Date(timestampMs))) }),
      ),
  };
}

Deno.test("group IPEX consent throws KramRefusedError for a message past its exchange lifetime", async () => {
  await run(function*() {
    const { clock, ops, member, offer, openedAt } = yield* openGroup();
    openedAt(clock.now() - AGE_MS);
    let refused: unknown;
    try {
      yield* proposeGroupIpex(ops, { hab: member.hab, exn: offer });
    } catch (error) {
      refused = error;
    }
    assertInstanceOf(refused, KramRefusedError);
    assertEquals([refused.said, refused.refusal.reason], [offer.said, "lifetime"]);
    assert(refused.refusal.deadline, "the refusal names the last acceptable instant");
    assertEquals(ops.live.size, 0, "a refused consent records no operation");
  });
});

/**
 * A group Offer this member consented to, collected once, then aged until its KRAM cache is pruned: the next
 * collection feeds this member's stored contribution to its own receiver again and KRAM refuses it as late.
 */
function* beginThenAge(): Operation<{ group: Group; said: string }> {
  const group = yield* openGroup();
  const { clock, ops, member, offer, openedAt } = group;
  // The exchange opened a minute before the Offer was stamped, well inside its lifetime.
  openedAt(clock.now() - 60_000);
  const begun = yield* proposeGroupIpex(ops, { hab: member.hab, exn: offer });
  yield* ops.processOnce();
  assertEquals(groupIpexStatus(ops, begun.said), { state: "active", phase: "awaitingMembers" });
  clock.skew += AGE_MS;
  group.member.runtime.protocol.kvy.kramer!.prune();
  return { group, said: begun.said };
}

Deno.test("group IPEX operation ends expired with the KRAM reason", async () => {
  await run(function*() {
    const { group: { ops }, said } = yield* beginThenAge();
    yield* ops.processOnce();
    const status = groupIpexStatus(ops, said);
    assertEquals(status.state, "expired");
    assertMatch((status as { reason: string }).reason, /^KRAM refused message \S+: timeliness \(acceptable until /);
    assertEquals(ops.live.size, 0, "an expired operation stops retrying");
  });
});

Deno.test("waitForGroupIpex settles expired instead of timing out", async () => {
  await run(function*() {
    const { group: { ops }, said } = yield* beginThenAge();
    yield* ops.processOnce();
    const waited = yield* waitForGroupIpex(ops, said, { timeoutMs: 5_000 });
    assertEquals(waited.outcome, "settled");
    assertEquals(waited.status.state, "expired");
  });
});
