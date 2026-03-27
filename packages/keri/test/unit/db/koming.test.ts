import { run } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { Kinds, t } from "../../../../cesr/mod.ts";
import { createLMDBer, type LMDBer } from "../../../src/db/core/lmdber.ts";
import { Komer, KomerBase, type KomerKind } from "../../../src/db/koming.ts";

interface PersonRecord {
  first: string;
  last: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: number;
  };
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
    const people = new Komer<PersonRecord>(lmdber, { subkey: "people." });
    const sue: PersonRecord = {
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
    assertEquals(people.get(keys), sue);
    assertEquals(people.getDict(keys), sue);
    assertEquals(people.cnt(), 1);
    assertEquals(people.cntAll(), 1);

    const kip: PersonRecord = {
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
    assertEquals(people.get(keys), sue);
    assertEquals(people.pin(keys, kip), true);
    assertEquals(people.get(keys), kip);
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
    } satisfies PersonRecord;

    for (
      const kind of [Kinds.json, Kinds.cbor, Kinds.mgpk] satisfies KomerKind[]
    ) {
      const store = new Komer<PersonRecord>(lmdber, {
        subkey: `${kind.toLowerCase()}.`,
        kind,
      });
      assertEquals(store.put("ada", record), true);
      assertEquals(store.get("ada"), record);
      assertEquals(store.getDict("ada"), record);
    }
  });
});

Deno.test("db/koming - getTopItemIter and trim operate on key branches", async () => {
  await withTempDb(({ lmdber }) => {
    const people = new Komer<PersonRecord>(lmdber, { subkey: "people." });
    const makeRecord = (first: string): PersonRecord => ({
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
        [["team", "alpha"], makeRecord("Alice")],
        [["team", "beta"], makeRecord("Bob")],
      ],
    );

    assertEquals(people.trim("team", { topive: true }), true);
    assertEquals(people.get(["team", "alpha"]), null);
    assertEquals(people.get(["team", "beta"]), null);
    assertEquals(people.get(["other", "gamma"]), makeRecord("Carol"));
  });
});

Deno.test("db/koming - string keys pass through unchanged", async () => {
  await withTempDb(({ lmdber }) => {
    const store = new Komer<PersonRecord>(lmdber, { subkey: "people." });
    const person: PersonRecord = {
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
    assertEquals(store.get("plain.key"), person);
    assertEquals(store.getDict("missing"), null);
  });
});
