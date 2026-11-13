import { assertEquals, assertThrows } from "jsr:@std/assert";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import {
  findLocalGroupMember,
  groupSigningMembers,
  isLocalGroupHab,
  localGroupMember,
  uniqueMembers,
} from "../../../../src/app/multisig/group-members.ts";
import { MissingDurableStateError, ValidationError } from "../../../../src/core/errors.ts";

function fakeHab(pre: string): Hab {
  return { pre } as unknown as Hab;
}

function fakeHabery(args: {
  records?: Map<string, { mid?: string; smids?: string[] }>;
  habs?: Map<string, Hab>;
  smids?: Array<[string]>;
}): Habery {
  return {
    db: {
      getHab: (pre: string) => args.records?.get(pre),
    },
    habs: args.habs ?? new Map(),
    ks: {
      getSmids: () => (args.smids ?? []).map(([qb64]) => [{ qb64 }]),
    },
  } as unknown as Habery;
}

Deno.test("group-members resolves local group metadata", () => {
  const member = fakeHab("Emember");
  const hby = fakeHabery({
    records: new Map([["Egroup", { mid: member.pre, smids: ["Emember", "Eremote"] }]]),
    habs: new Map([[member.pre, member]]),
  });

  assertEquals(isLocalGroupHab(hby, fakeHab("Egroup")), true);
  assertEquals(localGroupMember(hby, "Egroup"), member);
  assertEquals(findLocalGroupMember(hby, ["Eremote", "Emember"]), member);
});

Deno.test("group-members refuses a non-group and reports a missing member as missing durable state", () => {
  const hby = fakeHabery({
    records: new Map([["Egroup", { mid: "Emissing" }], ["Esolo", {}]]),
  });

  assertThrows(() => localGroupMember(hby, "Esolo"), ValidationError, "Esolo is not a local group.");
  const missing = assertThrows(
    () => localGroupMember(hby, "Egroup"),
    MissingDurableStateError,
    "Group Egroup names local member Emissing, which this store does not hold.",
  );
  assertEquals(missing instanceof ValidationError, false, "a missing member is not a refusal of input");
});

Deno.test("group-members prefers key-state signing members and falls back to record members", () => {
  const withKeyState = fakeHabery({
    records: new Map([["Egroup", { smids: ["Erecord"] }]]),
    smids: [["Ekey1"], ["Ekey2"]],
  });
  const withRecordOnly = fakeHabery({
    records: new Map([["Egroup", { smids: ["Erecord"] }]]),
  });

  assertEquals(groupSigningMembers(withKeyState, "Egroup"), ["Ekey1", "Ekey2"]);
  assertEquals(groupSigningMembers(withRecordOnly, "Egroup"), ["Erecord"]);
  assertEquals(uniqueMembers(["", "Ea", "Ea", "Eb"]), ["Ea", "Eb"]);
});
