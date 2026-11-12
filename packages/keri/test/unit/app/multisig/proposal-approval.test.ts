/** approveGroupProposal: explicit-SAID approval of KEL and reply proposals, and resume after a crash. */
import { Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { groupEndorseReply } from "../../../../src/app/identity/endpoint-roleing.ts";
import type { GroupEventRef } from "../../../../src/app/multisig/counseling.ts";
import { multisigInceptExn, multisigRpyExn } from "../../../../src/app/multisig/grouping.ts";
import { signGroupMessage, storedGroupMessage } from "../../../../src/app/multisig/multisig-messaging.ts";
import { approvePendingMultisigProposal } from "../../../../src/app/multisig/multisig-workflows.ts";
import { approveGroupProposal, findGroupProposal } from "../../../../src/app/multisig/proposals.ts";
import { Reactor } from "../../../../src/app/protocol/reactor.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { reply as replyEvent } from "../../../../src/core/protocol-eventing.ts";
import { learn, peerInteraction, readDeps, receive, type Scenario, scenario } from "./proposal-fixture.ts";

/** Approval deps over a scenario; the Counselor is a recorder. */
function approvalDeps(s: Scenario) {
  const started: Array<{ event: GroupEventRef | undefined; inputs: unknown }> = [];
  const deps = {
    hby: s.left,
    exc: s.runtime.exc,
    reactor: s.runtime.reactor,
    protocol: s.runtime.protocol,
    postman: s.runtime.postman,
    notifier: s.notifier,
    registryStore: null,
    counselor: { start: (event: GroupEventRef, inputs: unknown) => (started.push({ event, inputs }), true) },
  };
  return { deps, started };
}

/** Count signatures this member makes and messages it sends. */
function instrument(s: Scenario) {
  const counts = { signs: 0, sent: [] as string[] };
  const sign = s.alice.mgr.sign.bind(s.alice.mgr);
  // Group event contributions are the indexed signs; wrapper endorsement is not counted.
  s.alice.mgr.sign = ((...args: Parameters<typeof sign>) => {
    if ((args[1] as { indices?: number[] } | undefined)?.indices) counts.signs++;
    return sign(...args);
  }) as typeof sign;
  s.runtime.postman.send = evt => {
    counts.sent.push(new TextDecoder().decode(evt.msg).match(/"d":"([^"]+)"/)?.[1] ?? "");
    return { ...evt, kin: "msg" };
  };
  return counts;
}

const noPrompt = {
  approveProposal: () => {
    throw new Error("Resume must not prompt again.");
  },
  chooseGroupAlias: () => {
    throw new Error("Resume must not rename the group.");
  },
  chooseRegistryName: () => "unused",
};

Deno.test("approveGroupProposal signs, sends, starts the Counselor and returns the event", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const counts = instrument(s);
      const { deps, started } = approvalDeps(s);
      const { signed, ixn } = yield* peerInteraction(s, []);
      const result = yield* approveGroupProposal(deps, signed.exnSaid, { fallbackAfterMs: 0 });
      assertEquals(result.event, { pre: s.group, sn: ixn.serder.sn, said: ixn.serder.said });
      assertEquals(started, [{
        event: result.event,
        inputs: { auths: undefined, fallbackAfterMs: 0, proxy: undefined },
      }]);
      assertEquals(counts.signs, 1);
      assertEquals(counts.sent.length, 1);
      assertEquals(result.accepted, true);
      assertEquals(findGroupProposal(readDeps(s), signed.exnSaid)?.local, "approved");
    }, "2");
  });
});

Deno.test("approveGroupProposal cannot approve a proposal the caller did not name", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const counts = instrument(s);
      const { deps } = approvalDeps(s);
      const first = yield* peerInteraction(s, [{ n: 1 }]);
      const second = yield* peerInteraction(s, [{ n: 2 }]);
      assertEquals(s.notifier.count(), 2);
      yield* approveGroupProposal(deps, first.signed.exnSaid);
      assertEquals(counts.signs, 1, "one signature for the one named proposal");
      assertEquals(findGroupProposal(readDeps(s), second.signed.exnSaid)?.local, "unapproved");
      yield* call(() =>
        assertRejects(
          () => run(() => approveGroupProposal(deps, "Enotastoredproposal")),
          ValidationError,
          "No group proposal",
        )
      );
      assertEquals(counts.signs, 1);
    }, "2");
  });
});

Deno.test("approveGroupProposal approves a reply proposal without starting the Counselor", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const counts = instrument(s);
      const { deps, started } = approvalDeps(s);
      yield* call(() => learn(s.right, s.left.habs.get(s.group)!));
      const rpy = replyEvent("/end/role/add", { cid: s.group, role: "mailbox", eid: s.bob.pre }, {
        pre: s.group,
        pvrsn: Vrsn_2_0,
      });
      const peerRpy = groupEndorseReply(s.right, s.group, rpy, Vrsn_2_0);
      const wrapper = signGroupMessage(s.bob, s.alice.pre, yield* multisigRpyExn(s.group, s.bob, peerRpy));
      yield* receive(s, wrapper.message);
      const result = yield* approveGroupProposal(deps, wrapper.exnSaid);
      assertEquals(result.event, undefined);
      assertEquals(started, []);
      assertEquals(result.accepted, true);
      assertEquals(counts.sent.length, 1);
    }, "2");
  });
});

/** Run `body` with `Reactor.processBytes` failing once on a local wrapper that contains `needle`. */
function* crashingOnce(needle: string, body: () => Operation<void>): Operation<void> {
  const original = Reactor.prototype.processBytes;
  let armed = true;
  Reactor.prototype.processBytes = function*(this: Reactor, bytes: Uint8Array, options?: { local?: boolean }) {
    if (armed && new TextDecoder().decode(bytes).includes(needle)) {
      armed = false;
      throw new Error("crash before the wrapper is stored");
    }
    return yield* original.call(this, bytes, options);
  } as typeof original;
  try {
    yield* body();
  } finally {
    Reactor.prototype.processBytes = original;
  }
}

Deno.test("crash window 1: signed but wrapper not stored resumes without prompting or signing again", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const counts = instrument(s);
      const { deps, started } = approvalDeps(s);
      const { signed } = yield* peerInteraction(s, []);
      yield* crashingOnce("\"/multisig/ixn\"", function*() {
        yield* call(() =>
          assertRejects(() => run(() => approveGroupProposal(deps, signed.exnSaid)), Error, "crash before")
        );
      });
      assertEquals(counts.signs, 1);
      assertEquals(counts.sent.length, 0);
      assertEquals(storedGroupMessage(s.left.db, s.alice.pre, s.left.db.exns.get([signed.exnSaid])!), null);
      const result = yield* approveGroupProposal(deps, signed.exnSaid);
      assertEquals(counts.signs, 1, "the recorded signature is reused");
      assertEquals(counts.sent.length, 1);
      assertExists(storedGroupMessage(s.left.db, s.alice.pre, s.left.db.exns.get([signed.exnSaid])!));
      assertEquals(result.accepted, true);
      assertEquals(started.length, 1);
    }, "2");
  });
});

Deno.test("crash window 1 through the callback wrapper does not prompt a second time", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const counts = instrument(s);
      const { signed } = yield* peerInteraction(s, []);
      let prompts = 0;
      const callbacks = {
        approveProposal: () => (prompts++, true),
        chooseGroupAlias: () => "unused",
        chooseRegistryName: () => "unused",
      };
      yield* crashingOnce("\"/multisig/ixn\"", function*() {
        yield* call(() =>
          assertRejects(
            () => run(() => approvePendingMultisigProposal(s.left, s.runtime, { said: signed.exnSaid, callbacks })),
            Error,
            "crash before",
          )
        );
      });
      const result = yield* approvePendingMultisigProposal(s.left, s.runtime, { said: signed.exnSaid, callbacks });
      assertEquals(prompts, 1);
      assertEquals(counts.signs, 1);
      assertEquals(result?.accepted, true);
    }, "2");
  });
});

Deno.test("crash window 2: wrapper stored but not sent is replayed, not re-signed", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const counts = instrument(s);
      const { deps } = approvalDeps(s);
      const { signed } = yield* peerInteraction(s, []);
      const send = s.runtime.postman.send;
      s.runtime.postman.send = () => {
        throw new Error("crash before send");
      };
      yield* call(() =>
        assertRejects(() => run(() => approveGroupProposal(deps, signed.exnSaid)), Error, "crash before")
      );
      const stored = storedGroupMessage(s.left.db, s.alice.pre, s.left.db.exns.get([signed.exnSaid])!);
      assertExists(stored);
      s.runtime.postman.send = send;
      yield* approveGroupProposal(deps, signed.exnSaid);
      assertEquals(counts.signs, 1);
      assertEquals(counts.sent, [stored.said]);
      assertEquals(
        storedGroupMessage(s.left.db, s.alice.pre, s.left.db.exns.get([signed.exnSaid])!)?.said,
        stored.said,
      );
    }, "2");
  });
});

Deno.test("crash window 3: approving again after the send resends the same wrapper", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const counts = instrument(s);
      const { deps } = approvalDeps(s);
      const { signed } = yield* peerInteraction(s, []);
      yield* approveGroupProposal(deps, signed.exnSaid);
      yield* approveGroupProposal(deps, signed.exnSaid);
      assertEquals(counts.signs, 1);
      assertEquals(counts.sent.length, 2);
      assertEquals(counts.sent[0], counts.sent[1]);
    }, "2");
  });
});

Deno.test("an unjoined group needs its alias, is joined once, and resumes without it", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const counts = instrument(s);
      const { deps, started } = approvalDeps(s);
      const other = s.right.makeGroupHab("other", s.bob, s.mids, s.mids, undefined, {
        isith: "1",
        nsith: "1",
        toad: 0,
      });
      const incept = signGroupMessage(
        s.bob,
        s.alice.pre,
        yield* multisigInceptExn(s.bob, s.mids, s.mids, other.message),
      );
      yield* receive(s, incept.message);
      yield* call(() =>
        assertRejects(() => run(() => approveGroupProposal(deps, incept.exnSaid)), ValidationError, "group alias")
      );
      assertEquals(counts.signs, 0);
      assertEquals(s.left.habs.has(other.hab.pre), false);
      yield* crashingOnce("\"/multisig/icp\"", function*() {
        yield* call(() =>
          assertRejects(
            () => run(() => approveGroupProposal(deps, incept.exnSaid, { groupAlias: "joined" })),
            Error,
            "crash before",
          )
        );
      });
      assertEquals(s.left.habs.get(other.hab.pre)?.name, "joined");
      const result = yield* approveGroupProposal(deps, incept.exnSaid);
      assertEquals(counts.signs, 1);
      assertEquals(result.event?.pre, other.hab.pre);
      assertEquals(started.length, 1);
      assertEquals(s.left.habs.get(other.hab.pre)?.name, "joined");
    }, "2");
  });
});

Deno.test("joinGroupHab is idempotent for the same arguments and renames for a new alias", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const { hab } = { hab: s.left.habs.get(s.group)! };
      const first = s.left.db.getHab(s.group);
      s.left.joinGroupHab(s.group, "group", s.alice, s.mids, s.mids);
      assertEquals(s.left.db.getHab(s.group), first);
      s.left.joinGroupHab(s.group, "renamed", s.alice, s.mids, s.mids);
      assertEquals([s.left.db.getHab(s.group)?.name, hab.pre], ["renamed", s.group]);
    });
  });
});
