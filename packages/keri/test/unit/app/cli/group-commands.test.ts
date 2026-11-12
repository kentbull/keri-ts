/** Group commands sign only the proposal they were asked to sign: join consent and proposer waits. */
import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { findGroupProposal } from "../../../../src/app/multisig/proposals.ts";
import { proposeGroupInteraction } from "../../../../src/app/multisig/proposing.ts";
import { type JoinDeps, joinProposal } from "../../../../src/cli/messaging/group-join.ts";
import { waitForAcceptance } from "../../../../src/cli/messaging/group-wait.ts";
import { approvePrompt } from "../../../../src/cli/messaging/multisig.ts";
import { peerInteraction, readDeps, type Scenario, scenario } from "../multisig/proposal-fixture.ts";

function joinDeps(s: Scenario): JoinDeps {
  return {
    hby: s.left,
    exc: s.runtime.exc,
    reactor: s.runtime.reactor,
    protocol: s.runtime.protocol,
    postman: s.runtime.postman,
    notifier: s.notifier,
    registryStore: null,
    vdr: null,
    counselor: s.runtime.counselor,
  };
}

/** Count the group event contributions the local member signs. */
function countSigns(s: Scenario) {
  const counts = { signs: 0 };
  const sign = s.alice.mgr.sign.bind(s.alice.mgr);
  s.alice.mgr.sign = ((...args: Parameters<typeof sign>) => {
    if ((args[1] as { indices?: number[] } | undefined)?.indices) counts.signs++;
    return sign(...args);
  }) as typeof sign;
  s.runtime.postman.send = evt => ({ ...evt, kin: "msg" });
  return counts;
}

/** Answer `prompt` from a script, recording every question; console output is silenced until `restore`. */
function stubPrompts(answers: Array<string | null>) {
  const asked: string[] = [];
  const realPrompt = globalThis.prompt, realLog = console.log;
  globalThis.prompt = (message?: string) => {
    asked.push(message ?? "");
    return answers.shift() ?? null;
  };
  console.log = () => {};
  return {
    asked,
    restore() {
      globalThis.prompt = realPrompt;
      console.log = realLog;
    },
  };
}

/** The prompts `tufa multisig join` uses, for the given flags. */
function joinPrompts(options: { auto?: boolean }) {
  return {
    confirm: (proposal: Parameters<typeof approvePrompt>[1]) => approvePrompt(options, proposal),
    groupAlias: () => "joined",
    registryName: () => "registry",
    inputs: () => ({ fallbackAfterMs: 0 }),
  };
}

Deno.test("join without --auto prompts for each proposal and approves only the one answered yes", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const counts = countSigns(s);
      const first = yield* peerInteraction(s, [{ n: 1 }]);
      const second = yield* peerInteraction(s, [{ n: 2 }]);
      const stub = stubPrompts(["n", "y"]);
      try {
        const joined = yield* joinProposal(joinDeps(s), { deadline: Date.now() + 500, ...joinPrompts({}) });
        assertEquals(joined?.proposal.said, second.signed.exnSaid);
        assertEquals(stub.asked, ["\nJoin [Y|n]? ", "\nJoin [Y|n]? "]);
      } finally {
        stub.restore();
      }
      assertEquals(counts.signs, 1);
      assertEquals(findGroupProposal(readDeps(s), first.signed.exnSaid)?.local, "unapproved");
      assertEquals(findGroupProposal(readDeps(s), second.signed.exnSaid)?.local, "approved");
    }, "2");
  });
});

Deno.test("join without --auto signs nothing when every proposal is declined, asking once each", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const counts = countSigns(s);
      const first = yield* peerInteraction(s, [{ n: 1 }]);
      const second = yield* peerInteraction(s, [{ n: 2 }]);
      const stub = stubPrompts(["n", "n", "y"]);
      try {
        const joined = yield* joinProposal(joinDeps(s), { deadline: Date.now() + 600, ...joinPrompts({}) });
        assertEquals(joined, null);
        assertEquals(stub.asked.length, 2, "a declined proposal is not offered again while the command waits");
      } finally {
        stub.restore();
      }
      assertEquals(counts.signs, 0);
      for (const { signed } of [first, second]) {
        assertEquals(findGroupProposal(readDeps(s), signed.exnSaid)?.local, "unapproved");
      }
    }, "2");
  });
});

Deno.test("join --auto approves one pending proposal without prompting and leaves the others", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const counts = countSigns(s);
      const first = yield* peerInteraction(s, [{ n: 1 }]);
      const second = yield* peerInteraction(s, [{ n: 2 }]);
      const stub = stubPrompts([]);
      try {
        const joined = yield* joinProposal(joinDeps(s), {
          deadline: Date.now() + 500,
          ...joinPrompts({ auto: true }),
        });
        assertEquals(joined?.proposal.said, first.signed.exnSaid);
        assertEquals(stub.asked, []);
      } finally {
        stub.restore();
      }
      assertEquals(counts.signs, 1);
      assertEquals(findGroupProposal(readDeps(s), second.signed.exnSaid)?.local, "unapproved");
    }, "2");
  });
});

Deno.test("a proposer waiting for its event never signs another stored proposal", async () => {
  await run(function*() {
    yield* scenario(function*(s) {
      const counts = countSigns(s);
      const unrelated = yield* peerInteraction(s, [{ n: "peer" }]);
      const group = s.left.habByName("group")!;
      const sent = yield* proposeGroupInteraction(
        { hby: s.left, protocol: s.runtime.protocol, postman: s.runtime.postman, counselor: s.runtime.counselor },
        group,
        [{ n: "mine" }],
        { fallbackAfterMs: 0 },
      );
      assertEquals(counts.signs, 1, "only the proposer's own event is signed");
      const accepted = yield* waitForAcceptance(s.left, s.runtime, sent.event, Date.now() + 300);
      assertEquals(accepted, false, "the second member never signed");
      assertEquals(counts.signs, 1);
      assertEquals(findGroupProposal(readDeps(s), unrelated.signed.exnSaid)?.local, "unapproved");
    }, "2");
  });
});
