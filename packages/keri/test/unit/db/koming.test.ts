// @file-test-lane db-fast

import { run } from "effection";
import { assert, assertEquals, assertInstanceOf } from "jsr:@std/assert";
import { Kinds, t } from "../../../../cesr/mod.ts";
import { KeyStateRecord, type KeyStateRecordShape, RawRecord, StateEERecord } from "../../../src/core/records.ts";
import { createLMDBer, type LMDBer } from "../../../src/db/core/lmdber.ts";
import { DupKomer, Komer, KomerBase, type KomerKind } from "../../../src/db/koming.ts";

interface PersonRecordShape {
  first: string;
  last: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: number;
  };
}

class PersonRecord extends RawRecord<PersonRecordShape> implements PersonRecordShape {
  declare first: string;
  declare last: string;
  declare address: {
    street: string;
    city: string;
    state: string;
    zip: number;
  };

  constructor(data: PersonRecordShape = {
    first: "",
    last: "",
    address: {
      street: "",
      city: "",
      state: "",
      zip: 0,
    },
  }) {
    super({
      ...data,
      address: { ...data.address },
    });
  }
}

async function withTempDb(
  fn: (ctx: { lmdber: LMDBer }) => void,
): Promise<void> {
  await run(function*() {
    const lmdber = yield* createLMDBer({
      name: `komer-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      fn({ lmdber });
    } finally {
      yield* lmdber.close(true);
    }
  });
}

Deno.test("db/koming - Komer stores one persisted record shape", async () => {
  await withTempDb(({ lmdber }) => {
    const people = new Komer<PersonRecord>(lmdber, {
      subkey: "people.",
      recordClass: PersonRecord,
    });
    const sue: PersonRecordShape = {
      first: "Susan",
      last: "Black",
      address: {
        street: "100 Main Street",
        city: "Riverton",
        state: "UT",
        zip: 84058,
      },
    };
    const keys = ["test_key", "0001"] as const;

    assert(people instanceof Komer);
    assert(people instanceof KomerBase);
    assertEquals(people.sep, KomerBase.Sep);
    assertEquals(t(people._tokey(keys)), "test_key.0001");
    assertEquals(people._tokeys(people._tokey(keys)), ["test_key", "0001"]);

    assertEquals(people.put(keys, sue), true);
    assertInstanceOf(people.get(keys), PersonRecord);
    assertEquals(people.getDict(keys), sue);
    assertEquals(people.cnt(), 1);
    assertEquals(people.cntAll(), 1);

    const kip: PersonRecordShape = {
      first: "Kip",
      last: "Thorne",
      address: {
        street: "200 Center Street",
        city: "Bluffdale",
        state: "UT",
        zip: 84043,
      },
    };

    assertEquals(people.put(keys, kip), false);
    assertInstanceOf(people.get(keys), PersonRecord);
    assertEquals(people.getDict(keys), sue);
    assertEquals(people.pin(keys, kip), true);
    assertInstanceOf(people.get(keys), PersonRecord);
    assertEquals(people.getDict(keys), kip);
    assertEquals(people.rem(keys), true);
    assertEquals(people.get(keys), null);
  });
});

Deno.test("db/koming - Komer round-trips JSON, CBOR, and MGPK persisted records", async () => {
  await withTempDb(({ lmdber }) => {
    const record = {
      first: "Ada",
      last: "Lovelace",
      address: {
        street: "1 Analytical Engine Way",
        city: "London",
        state: "LDN",
        zip: 10001,
      },
    } satisfies PersonRecordShape;

    for (
      const kind of [Kinds.json, Kinds.cbor, Kinds.mgpk] satisfies KomerKind[]
    ) {
      const store = new Komer<PersonRecord>(lmdber, {
        subkey: `${kind.toLowerCase()}.`,
        kind,
        recordClass: PersonRecord,
      });
      assertEquals(store.put("ada", record), true);
      assertInstanceOf(store.get("ada"), PersonRecord);
      assertEquals(store.getDict("ada"), record);
    }
  });
});

Deno.test("db/koming - getTopItemIter and trim operate on key branches", async () => {
  await withTempDb(({ lmdber }) => {
    const people = new Komer<PersonRecord>(lmdber, {
      subkey: "people.",
      recordClass: PersonRecord,
    });
    const makeRecord = (first: string): PersonRecordShape => ({
      first,
      last: "Tester",
      address: {
        street: "1 Test Way",
        city: "Lehi",
        state: "UT",
        zip: 84043,
      },
    });

    people.pin(["team", "alpha"], makeRecord("Alice"));
    people.pin(["team", "beta"], makeRecord("Bob"));
    people.pin(["other", "gamma"], makeRecord("Carol"));

    assertEquals(
      [...people.getTopItemIter("team", { topive: true })],
      [
        [["team", "alpha"], new PersonRecord(makeRecord("Alice"))],
        [["team", "beta"], new PersonRecord(makeRecord("Bob"))],
      ],
    );

    assertEquals(people.trim("team", { topive: true }), true);
    assertEquals(people.get(["team", "alpha"]), null);
    assertEquals(people.get(["team", "beta"]), null);
    assertEquals(people.getDict(["other", "gamma"]), makeRecord("Carol"));
  });
});

Deno.test("db/koming - string keys pass through unchanged", async () => {
  await withTempDb(({ lmdber }) => {
    const store = new Komer<PersonRecord>(lmdber, {
      subkey: "people.",
      recordClass: PersonRecord,
    });
    const person: PersonRecordShape = {
      first: "String",
      last: "Key",
      address: {
        street: "9 Direct Path",
        city: "Provo",
        state: "UT",
        zip: 84601,
      },
    };

    assertEquals(t(store._tokey("plain.key")), "plain.key");
    assertEquals(store.put("plain.key", person), true);
    assertInstanceOf(store.get("plain.key"), PersonRecord);
    assertEquals(store.getDict("plain.key"), person);
    assertEquals(store.getDict("missing"), null);
  });
});

Deno.test("db/koming - record hydrators return record instances while plain-object writes still work", async () => {
  await withTempDb(({ lmdber }) => {
    const states = new Komer<KeyStateRecord>(lmdber, {
      subkey: "states.",
      recordClass: KeyStateRecord,
    });

    assertEquals(
      states.put("aid", {
        i: "Eaid",
        d: "Esaid",
        s: "0",
        f: "0",
        dt: "2026-04-03T00:00:00.000000+00:00",
        et: "icp",
        k: ["Dkey"],
        n: [],
        ee: {
          s: "0",
          d: "Esaid",
          br: [],
          ba: [],
        },
      }),
      true,
    );

    const state = states.get("aid");
    assertInstanceOf(state, KeyStateRecord);
    assertInstanceOf(state?.ee, StateEERecord);
    assertEquals(state?.i, "Eaid");
    assertEquals(state?.ee?.d, "Esaid");
    assertEquals(states.getDict("aid"), {
      i: "Eaid",
      d: "Esaid",
      s: "0",
      f: "0",
      dt: "2026-04-03T00:00:00.000000+00:00",
      et: "icp",
      k: ["Dkey"],
      n: [],
      ee: {
        s: "0",
        d: "Esaid",
        br: [],
        ba: [],
      },
    });
  });
});

Deno.test("db/koming - DupKomer matches native duplicate-key behavior", async () => {
  await withTempDb(({ lmdber }) => {
    const people = new DupKomer<PersonRecord>(lmdber, {
      subkey: "dups.",
      recordClass: PersonRecord,
    });
    const alice = {
      first: "Alice",
      last: "Able",
      address: {
        street: "1 Alpha Ave",
        city: "Afton",
        state: "UT",
        zip: 84001,
      },
    } satisfies PersonRecordShape;
    const bob = {
      first: "Bob",
      last: "Baker",
      address: {
        street: "2 Beta Blvd",
        city: "Bountiful",
        state: "UT",
        zip: 84010,
      },
    } satisfies PersonRecordShape;
    const cara = {
      first: "Cara",
      last: "Clark",
      address: {
        street: "3 Gamma Grove",
        city: "Cedar",
        state: "UT",
        zip: 84720,
      },
    } satisfies PersonRecordShape;

    assertEquals(people.put("team", [bob, alice]), true);
    assertEquals(people.add("team", bob), false);
    assertEquals(people.add("team", cara), true);
    assertEquals([...people.getIter("team")], [
      new PersonRecord(alice),
      new PersonRecord(bob),
      new PersonRecord(cara),
    ]);
    assertEquals(people.get("team"), [
      new PersonRecord(alice),
      new PersonRecord(bob),
      new PersonRecord(cara),
    ]);
    assertEquals(people.getLast("team"), new PersonRecord(cara));
    assertEquals(people.cnt("team"), 3);

    people.put(["branch", "alpha"], [alice]);
    people.put(["branch", "beta"], [bob]);
    assertEquals(
      [...people.getTopItemIter("branch", { topive: true })],
      [
        [["branch", "alpha"], new PersonRecord(alice)],
        [["branch", "beta"], new PersonRecord(bob)],
      ],
    );

    assertEquals(people.rem("team", bob), true);
    assertEquals(people.get("team"), [
      new PersonRecord(alice),
      new PersonRecord(cara),
    ]);
    assertEquals(people.pin("team", [cara]), true);
    assertEquals(people.get("team"), [new PersonRecord(cara)]);
    assertEquals(people.rem("team"), true);
    assertEquals(people.get("team"), []);
  });
});
