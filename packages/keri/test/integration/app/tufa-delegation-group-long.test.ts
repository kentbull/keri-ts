// @file-test-lane runtime-slow

import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  Diger,
  Ilks,
  NumberPrimitive,
  Prefixer,
  SerderKERI,
  Siger,
  type ThresholdSith,
  Verfer,
} from "../../../../cesr/mod.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { encodeHugeNumber } from "../../../src/app/keeping.ts";
import { rotate as rotateEvent } from "../../../src/core/protocol-eventing.ts";
import { interact as interactEvent } from "../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../src/core/protocol-serialization.ts";
import { HabitatRecord } from "../../../src/core/records.ts";
import { dgKey } from "../../../src/db/core/keys.ts";

const ENABLE_LONG_MULTISIG_DELEGATION = Deno.env.get("KERI_LONG_MULTISIG_DELEGATION") === "1";
const GROUP_THRESHOLD: ThresholdSith = ["2/3", "2/3", "2/3"];
const DELEGATE_EVENT_COUNT = 64;

interface GroupAid {
  hby: Habery;
  hab: Hab;
  current: Hab[];
  next: Hab[];
}

interface GroupEvent {
  serder: SerderKERI;
  message: Uint8Array;
}

function makeMember(hby: Habery, alias: string): Hab {
  return hby.makeHab(alias, undefined, {
    transferable: true,
    icount: 1,
    isith: "1",
    ncount: 1,
    nsith: "1",
    toad: 0,
  });
}

function makeWeightedGroup(
  hby: Habery,
  alias: string,
  current: Hab[],
  next: Hab[],
  delpre?: string,
): GroupAid {
  const group = hby.makeGroupHab(
    alias,
    current[0]!,
    current.map((member) => member.pre),
    next.map((member) => member.pre),
    undefined,
    {
      isith: GROUP_THRESHOLD,
      nsith: GROUP_THRESHOLD,
      toad: 0,
      delpre,
    },
  );

  return {
    hby,
    hab: group.hab,
    current: [...current],
    next: [...next],
  };
}

function eventSerderFor(hby: Habery, pre: string, sn: number): SerderKERI {
  const said = hby.db.kels.getLast(pre, sn)
    ?? hby.db.pdes.getOn(pre, sn)[0]
    ?? hby.db.delegables.get([pre])[0];
  assertExists(said);
  const serder = hby.db.getEvtSerder(pre, said);
  assertExists(serder);
  return serder;
}

function eventAnchor(serder: SerderKERI): { i: string; s: string; d: string } {
  assertExists(serder.pre);
  assertExists(serder.snh);
  assertExists(serder.said);
  return { i: serder.pre, s: serder.snh, d: serder.said };
}

function memberTuples(members: readonly Hab[]) {
  return members.map((member, index) =>
    [
      new Prefixer({ qb64: member.pre }),
      new NumberPrimitive({ qb64: encodeHugeNumber(index) }),
    ] as [Prefixer, NumberPrimitive]
  );
}

function persistGroupMembers(group: GroupAid): void {
  const pre = group.hab.pre;
  const stored = group.hby.db.getHab(pre);
  assertExists(stored);
  group.hby.db.pinHab(
    pre,
    new HabitatRecord({
      ...stored,
      smids: group.current.map((member) => member.pre),
      rmids: group.next.map((member) => member.pre),
    }),
  );
  group.hby.ks.pinSmids(pre, memberTuples(group.current));
  group.hby.ks.pinRmids(pre, memberTuples(group.next));
}

function currentGroupKey(member: Hab): string {
  const key = member.kever?.verfers[0]?.qb64;
  assertExists(key);
  return key;
}

function nextMemberDigest(member: Hab): string {
  const digest = member.kever?.ndigers[0]?.qb64;
  assertExists(digest);
  return digest;
}

function groupIndexForKey(group: GroupAid, key: string): number {
  const kever = group.hab.kever;
  assertExists(kever);
  const index = kever.verfers.findIndex((verfer) => verfer.qb64 === key);
  if (index < 0) {
    throw new Error(`Group ${group.hab.pre} does not expose key ${key}.`);
  }
  return index;
}

function priorNextIndexForKey(group: GroupAid, key: string): number {
  const kever = group.hab.kever;
  assertExists(kever);
  const verfer = new Verfer({ qb64: key });
  const index = kever.ndigers.findIndex((diger) => Diger.compare(verfer.qb64b, diger.code, diger.raw));
  if (index < 0) {
    throw new Error(
      `Group ${group.hab.pre} prior next commitments do not expose ${key}.`,
    );
  }
  return index;
}

function signGroupEvent(
  group: GroupAid,
  serder: SerderKERI,
  signers: readonly Hab[],
  options: { rotated: boolean },
): Siger[] {
  const sigers: Siger[] = [];
  for (const member of signers) {
    const key = currentGroupKey(member);
    const index = options.rotated
      ? group.current.findIndex((current) => current.pre === member.pre)
      : groupIndexForKey(group, key);
    if (index < 0) {
      throw new Error(`${member.pre} is not a current group signer.`);
    }
    const ondex = options.rotated ? priorNextIndexForKey(group, key) : null;
    sigers.push(
      ...(member.mgr.sign(serder.raw, {
        pubs: [key],
        indexed: true,
        indices: [index],
        ondices: [ondex],
      }) as Siger[]),
    );
  }
  return sigers;
}

function processLocalGroupEvent(
  group: GroupAid,
  serder: SerderKERI,
  sigers: Siger[],
): GroupEvent {
  const decision = group.hby.kevery.processEvent({
    serder,
    sigers,
    wigers: [],
    frcs: [],
    sscs: [],
    ssts: [],
    local: true,
  });
  if (decision.kind === "reject") {
    throw new Error(decision.message);
  }
  return {
    serder,
    message: messagize(serder, { sigers, pipelined: true }),
  };
}

function groupInteract(
  group: GroupAid,
  data: unknown[],
  signers: readonly Hab[] = group.current.slice(0, 2),
): GroupEvent {
  const kever = group.hab.kever;
  assertExists(kever);
  const serder = interactEvent(
    group.hab.pre,
    kever.serder.said ?? kever.said,
    kever.sn + 1,
    data,
  );
  return processLocalGroupEvent(
    group,
    serder,
    signGroupEvent(group, serder, signers, { rotated: false }),
  );
}

function rotateMembers(members: readonly Hab[]): void {
  for (const member of members) {
    member.rotate({ ncount: 1, nsith: "1" });
  }
}

function groupRotate(
  group: GroupAid,
  current: Hab[],
  next: Hab[],
  data: unknown[],
): GroupEvent {
  rotateMembers(current);
  const kever = group.hab.kever;
  assertExists(kever);
  group.current = [...current];
  group.next = [...next];
  const serder = rotateEvent(
    group.hab.pre,
    current.map(currentGroupKey),
    kever.serder.said ?? kever.said,
    {
      ilk: kever.delpre !== null ? Ilks.drt : Ilks.rot,
      sn: kever.sn + 1,
      isith: GROUP_THRESHOLD,
      nsith: GROUP_THRESHOLD,
      ndigs: next.map(nextMemberDigest),
      toad: Number(kever.toader.num),
      wits: [...kever.wits],
      data,
    },
  );
  return processLocalGroupEvent(
    group,
    serder,
    signGroupEvent(group, serder, current.slice(0, 2), { rotated: true }),
  );
}

function anchorDelegatedEvent(delegator: GroupAid, delegated: SerderKERI) {
  const approval = groupInteract(delegator, [eventAnchor(delegated)]);
  assertExists(delegated.pre);
  assertExists(delegated.said);
  assertExists(approval.serder.sner);
  assertExists(approval.serder.said);
  delegator.hby.db.aess.pin(dgKey(delegated.pre, delegated.said), [
    approval.serder.sner,
    new Diger({ qb64: approval.serder.said }),
  ]);
  delegator.hby.kevery.processEscrowDelegables();
  assertExists(delegator.hby.db.aess.get(dgKey(delegated.pre, delegated.said)));
  return approval;
}

Deno.test({
  name: "long-running Tufa multisig delegation rotates group membership across 64 delegate events",
  ignore: !ENABLE_LONG_MULTISIG_DELEGATION,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await run(function*() {
      const hby = yield* createHabery({
        name: `tufa-long-multisig-delegation-${crypto.randomUUID()}`,
        temp: true,
      });

      try {
        const delegatorMembers = [
          makeMember(hby, "delegator-member-u"),
          makeMember(hby, "delegator-member-v"),
          makeMember(hby, "delegator-member-w"),
        ];
        const delegator = makeWeightedGroup(
          hby,
          "delegator-group",
          delegatorMembers,
          delegatorMembers,
        );

        const [memberA, memberB, memberC, memberD, memberE, memberF] = [
          "a",
          "b",
          "c",
          "d",
          "e",
          "f",
        ].map((name) => makeMember(hby, `delegate-member-${name}`));

        const delegate = makeWeightedGroup(
          hby,
          "delegate-group",
          [memberA, memberB, memberC],
          [memberB, memberC, memberD],
          delegator.hab.pre,
        );
        const inception = eventSerderFor(hby, delegate.hab.pre, 0);
        anchorDelegatedEvent(delegator, inception);
        assertEquals(hby.db.getKever(delegate.hab.pre)?.sn, 0);

        const membershipPlan = [
          [memberB, memberC, memberD],
          [memberC, memberD, memberE],
          [memberD, memberE, memberF],
        ];

        for (let sn = 1; sn < DELEGATE_EVENT_COUNT; sn += 1) {
          if (sn % 2 === 1) {
            const current = membershipPlan.shift()
              ?? [memberD, memberE, memberF];
            const next = membershipPlan[0] ?? [memberD, memberE, memberF];
            const rotation = groupRotate(delegate, current, next, [
              { kind: "delegate-rotation", sn },
            ]);
            anchorDelegatedEvent(delegator, rotation.serder);
            persistGroupMembers(delegate);
          } else {
            const interaction = groupInteract(delegate, [
              { kind: "delegate-interaction", sn },
            ]);
            assertEquals(interaction.serder.snh, sn.toString(16));
            groupInteract(delegator, [
              { kind: "delegator-interaction", delegateSn: sn },
            ]);
          }

          assertEquals(hby.db.getKever(delegate.hab.pre)?.sn, sn);
        }

        const delegateKever = hby.db.getKever(delegate.hab.pre);
        assertExists(delegateKever);
        assertEquals(delegateKever.sn, DELEGATE_EVENT_COUNT - 1);
        assertEquals(delegateKever.serder.snh, "3f");
        assertEquals(delegateKever.tholder?.sith, GROUP_THRESHOLD);
        assertEquals(delegateKever.ntholder?.sith, GROUP_THRESHOLD);
        assertEquals(
          delegateKever.verfers.map((verfer) => verfer.qb64),
          [memberD, memberE, memberF].map(currentGroupKey),
        );

        const storedDelegate = hby.db.getHab(delegate.hab.pre);
        assertExists(storedDelegate);
        assertEquals(storedDelegate.smids, [
          memberD.pre,
          memberE.pre,
          memberF.pre,
        ]);
        assertEquals(storedDelegate.rmids, [
          memberD.pre,
          memberE.pre,
          memberF.pre,
        ]);
        assertEquals(hby.db.delegables.get([delegate.hab.pre]), []);
        assertEquals(hby.db.pdes.cntOn(delegate.hab.pre, 0), 0);
        assertEquals(hby.db.dune.cnt(), 0);
        const delegatorKever = hby.db.getKever(delegator.hab.pre);
        assertExists(delegatorKever);
        assertEquals(delegatorKever.sn > 16, true);
      } finally {
        yield* hby.close(true);
      }
    });
  },
});
