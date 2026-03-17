import { run } from "effection";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { Kinds, t } from "../../../../cesr/mod.ts";
import { createLMDBer, type LMDBer } from "../../../src/db/core/lmdber.ts";
import {
  Komer,
  KomerBase,
  type KomerKind,
  type KomerSchema,
} from "../../../src/db/koming.ts";

class RecordModel {
  constructor(
    readonly first: string,
    readonly last: string,
    readonly street: string,
    readonly city: string,
    readonly state: string,
    readonly zip: number,
  ) {}
}

type RecordModelShape = {
  first: string;
  last: string;
  street: string;
  city: string;
  state: string;
  zip: number;
};

class AnotherClass {
  constructor(readonly age: number) {}
}

type AnotherClassShape = {
  age: number;
};

class CustomRecord {
  constructor(
    readonly first: string,
    readonly last: string,
    readonly street: string,
    readonly city: string,
    readonly state: string,
    readonly zip: number,
  ) {}
}

type CustomRecordShape = {
  name: string;
  address1: string;
  address2: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "object" && "constructor" in value) {
    const name = (value as { constructor?: { name?: string } }).constructor
      ?.name;
    if (name) {
      return name;
    }
  }
  return typeof value;
}

function assertRecordShape(value: unknown): asserts value is RecordModelShape {
  if (
    !isPlainObject(value) ||
    typeof value.first !== "string" ||
    typeof value.last !== "string" ||
    typeof value.street !== "string" ||
    typeof value.city !== "string" ||
    typeof value.state !== "string" ||
    typeof value.zip !== "number"
  ) {
    throw new TypeError("Expected a plain RecordShape object.");
  }
}

function assertRecord(value: unknown): asserts value is RecordModel {
  if (!(value instanceof RecordModel)) {
    throw new TypeError(
      `Invalid schema type=${describeType(value)}. Expected RecordModel.`,
    );
  }
}

const recordSchema: KomerSchema<RecordModel, RecordModelShape> = {
  assert: assertRecord,
  toStored: (value) => ({
    first: value.first,
    last: value.last,
    street: value.street,
    city: value.city,
    state: value.state,
    zip: value.zip,
  }),
  fromStored: (value) => {
    assertRecordShape(value);
    return new RecordModel(
      value.first,
      value.last,
      value.street,
      value.city,
      value.state,
      value.zip,
    );
  },
};

function assertAnotherClassShape(
  value: unknown,
): asserts value is AnotherClassShape {
  if (!isPlainObject(value) || typeof value.age !== "number") {
    throw new TypeError("Expected a plain AnotherClassShape object.");
  }
}

function assertAnotherClass(value: unknown): asserts value is AnotherClass {
  if (!(value instanceof AnotherClass)) {
    throw new TypeError(
      `Invalid schema type=${describeType(value)}. Expected AnotherClass.`,
    );
  }
}

const anotherClassSchema: KomerSchema<AnotherClass, AnotherClassShape> = {
  assert: assertAnotherClass,
  toStored: (value) => ({ age: value.age }),
  fromStored: (value) => {
    assertAnotherClassShape(value);
    return new AnotherClass(value.age);
  },
};

function assertCustomRecord(value: unknown): asserts value is CustomRecord {
  if (!(value instanceof CustomRecord)) {
    throw new TypeError(
      `Invalid schema type=${describeType(value)}. Expected CustomRecord.`,
    );
  }
}

function assertCustomRecordShape(
  value: unknown,
): asserts value is CustomRecordShape {
  if (
    !isPlainObject(value) ||
    typeof value.name !== "string" ||
    typeof value.address1 !== "string" ||
    typeof value.address2 !== "string"
  ) {
    throw new TypeError("Expected a plain CustomRecordShape object.");
  }
}

const customRecordSchema: KomerSchema<CustomRecord, CustomRecordShape> = {
  assert: assertCustomRecord,
  toStored: (value) => ({
    name: `${value.first} ${value.last}`,
    address1: value.street,
    address2: `${value.city} ${value.state} ${value.zip}`,
  }),
  fromStored: (value) => {
    assertCustomRecordShape(value);
    const [first, last] = value.name.split(" ");
    const [city, state, zip] = value.address2.split(" ");
    return new CustomRecord(
      first,
      last,
      value.address1,
      city,
      state,
      Number.parseInt(zip, 10),
    );
  },
};

async function withTempDb(
  fn: (ctx: { lmdber: LMDBer }) => void,
): Promise<void> {
  await run(function* () {
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

Deno.test("db/koming - Komer mirrors KERIpy happy-path CRUD behavior", async () => {
  await withTempDb(({ lmdber }) => {
    const mydb = new Komer<RecordModel, RecordModelShape>(lmdber, {
      subkey: "records.",
      schema: recordSchema,
    });
    const sue = new RecordModel(
      "Susan",
      "Black",
      "100 Main Street",
      "Riverton",
      "UT",
      84058,
    );

    const keys = ["test_key", "0001"] as const;
    assert(mydb instanceof Komer);
    assert(mydb instanceof KomerBase);
    assertEquals(mydb.sep, KomerBase.Sep);
    assertEquals(t(mydb._tokey(keys)), "test_key.0001");
    assertEquals(mydb._tokeys(mydb._tokey(keys)), ["test_key", "0001"]);

    assertEquals(mydb.put(keys, sue), true);
    let actual = mydb.get(keys);
    assert(actual instanceof RecordModel);
    assertEquals(actual, sue);

    assertEquals(mydb.rem(keys), true);
    assertEquals(mydb.get(keys), null);

    assertEquals(mydb.put(keys, sue), true);
    actual = mydb.get(keys);
    assertEquals(actual, sue);

    const kip = new RecordModel(
      "Kip",
      "Thorne",
      "200 Center Street",
      "Bluffdale",
      "UT",
      84043,
    );
    assertEquals(mydb.put(keys, kip), false);
    assertEquals(mydb.get(keys), sue);

    assertEquals(mydb.getDict(keys), {
      first: "Susan",
      last: "Black",
      street: "100 Main Street",
      city: "Riverton",
      state: "UT",
      zip: 84058,
    });

    assertEquals(mydb.pin(keys, kip), true);
    assertEquals(mydb.get(keys), kip);

    const bob = new RecordModel(
      "Bob",
      "Brown",
      "100 Center Street",
      "Bluffdale",
      "UT",
      84043,
    );
    assertEquals(mydb.put("keystr", bob), true);
    actual = mydb.get("keystr");
    assertEquals(actual, bob);
    assertEquals(mydb.getDict("keystr"), {
      first: "Bob",
      last: "Brown",
      street: "100 Center Street",
      city: "Bluffdale",
      state: "UT",
      zip: 84043,
    });
    assertEquals(mydb.getDict("missing"), null);
    assertEquals(mydb.rem("keystr"), true);
    assertEquals(mydb.get("keystr"), null);
  });
});

Deno.test("db/koming - Komer mirrors KERIpy branch iteration and trim behavior", async () => {
  await withTempDb(({ lmdber }) => {
    type Stuff = { a: string; b: string };
    const mydb = new Komer<Stuff>(lmdber, { subkey: "recs." });

    const w = { a: "Big", b: "Blue" };
    const x = { a: "Tall", b: "Red" };
    const y = { a: "Fat", b: "Green" };
    const z = { a: "Eat", b: "White" };

    assertEquals(mydb.put(["a", "1"], w), true);
    assertEquals(mydb.put(["a", "2"], x), true);
    assertEquals(mydb.put(["a", "3"], y), true);
    assertEquals(mydb.put(["a", "4"], z), true);

    assertEquals([...mydb.getTopItemIter()], [
      [["a", "1"], w],
      [["a", "2"], x],
      [["a", "3"], y],
      [["a", "4"], z],
    ]);
    assertEquals([...mydb.getFullItemIter()], [
      [["a", "1"], w],
      [["a", "2"], x],
      [["a", "3"], y],
      [["a", "4"], z],
    ]);

    assertEquals(mydb.put(["b", "1"], w), true);
    assertEquals(mydb.put(["b", "2"], x), true);
    assertEquals(mydb.put(["bc", "3"], y), true);
    assertEquals(mydb.put(["bc", "4"], z), true);

    assertEquals([...mydb.getTopItemIter(["b", ""])], [
      [["b", "1"], w],
      [["b", "2"], x],
    ]);
    assertEquals([...mydb.getTopItemIter(["b"], { topive: true })], [
      [["b", "1"], w],
      [["b", "2"], x],
    ]);

    assertEquals(mydb.cnt(), 8);
    assertEquals(mydb.trim(["b", ""]), true);
    assertEquals([...mydb.getTopItemIter()], [
      [["a", "1"], w],
      [["a", "2"], x],
      [["a", "3"], y],
      [["a", "4"], z],
      [["bc", "3"], y],
      [["bc", "4"], z],
    ]);

    assertEquals(mydb.remTop(), true);
    assertEquals([...mydb.getTopItemIter()], []);
  });
});

Deno.test("db/koming - Komer rejects invalid schema values on put", async () => {
  await withTempDb(({ lmdber }) => {
    const mydb = new Komer<AnotherClass, AnotherClassShape>(lmdber, {
      subkey: "records.",
      schema: anotherClassSchema,
    });
    const sue = new RecordModel("Susan", "Black", "", "", "", 0);

    assertThrows(
      () => mydb.put(["test_key", "0001"], sue as unknown as AnotherClass),
      TypeError,
      "Expected AnotherClass",
    );
  });
});

Deno.test("db/koming - Komer rejects invalid schema values on get", async () => {
  await withTempDb(({ lmdber }) => {
    const writer = new Komer<RecordModel, RecordModelShape>(lmdber, {
      subkey: "records.",
      schema: recordSchema,
    });
    const keys = ["test_key", "0001"] as const;
    assertEquals(
      writer.put(keys, new RecordModel("Susan", "Black", "", "", "", 0)),
      true,
    );

    const reader = new Komer<AnotherClass, AnotherClassShape>(lmdber, {
      subkey: "records.",
      schema: anotherClassSchema,
    });
    assertThrows(
      () => reader.get(keys),
      TypeError,
      "Expected a plain AnotherClassShape object.",
    );
  });
});

Deno.test("db/koming - Komer returns null for missing entries", async () => {
  await withTempDb(({ lmdber }) => {
    const mydb = new Komer<RecordModel, RecordModelShape>(lmdber, {
      subkey: "records.",
      schema: recordSchema,
    });
    assertEquals(
      mydb.put(
        ["test_key", "0001"],
        new RecordModel("Susan", "Black", "", "", "", 0),
      ),
      true,
    );
    assertEquals(mydb.get(["not_found", "0001"]), null);
  });
});

Deno.test("db/koming - Komer serializers mirror KERIpy format selection", async () => {
  await withTempDb(({ lmdber }) => {
    const k = new Komer<RecordModel, RecordModelShape>(lmdber, {
      subkey: "records.",
      schema: recordSchema,
    });
    const jim = new RecordModel(
      "Jim",
      "Black",
      "100 Main Street",
      "Riverton",
      "UT",
      84058,
    );

    assertEquals(
      k._serializer(Kinds.mgpk)(jim),
      new Uint8Array([
        0x86,
        0xa5,
        0x66,
        0x69,
        0x72,
        0x73,
        0x74,
        0xa3,
        0x4a,
        0x69,
        0x6d,
        0xa4,
        0x6c,
        0x61,
        0x73,
        0x74,
        0xa5,
        0x42,
        0x6c,
        0x61,
        0x63,
        0x6b,
        0xa6,
        0x73,
        0x74,
        0x72,
        0x65,
        0x65,
        0x74,
        0xaf,
        0x31,
        0x30,
        0x30,
        0x20,
        0x4d,
        0x61,
        0x69,
        0x6e,
        0x20,
        0x53,
        0x74,
        0x72,
        0x65,
        0x65,
        0x74,
        0xa4,
        0x63,
        0x69,
        0x74,
        0x79,
        0xa8,
        0x52,
        0x69,
        0x76,
        0x65,
        0x72,
        0x74,
        0x6f,
        0x6e,
        0xa5,
        0x73,
        0x74,
        0x61,
        0x74,
        0x65,
        0xa2,
        0x55,
        0x54,
        0xa3,
        0x7a,
        0x69,
        0x70,
        0xce,
        0x00,
        0x01,
        0x48,
        0x5a,
      ]),
    );

    assertEquals(
      k._serializer(Kinds.cbor)(jim),
      new Uint8Array([
        // `cbor-x` emits a compact length prefix that differs from KERIpy's
        // `cbor2` bytes while representing the same decoded object.
        0xb9,
        0x00,
        0x06,
        0x65,
        0x66,
        0x69,
        0x72,
        0x73,
        0x74,
        0x63,
        0x4a,
        0x69,
        0x6d,
        0x64,
        0x6c,
        0x61,
        0x73,
        0x74,
        0x65,
        0x42,
        0x6c,
        0x61,
        0x63,
        0x6b,
        0x66,
        0x73,
        0x74,
        0x72,
        0x65,
        0x65,
        0x74,
        0x6f,
        0x31,
        0x30,
        0x30,
        0x20,
        0x4d,
        0x61,
        0x69,
        0x6e,
        0x20,
        0x53,
        0x74,
        0x72,
        0x65,
        0x65,
        0x74,
        0x64,
        0x63,
        0x69,
        0x74,
        0x79,
        0x68,
        0x52,
        0x69,
        0x76,
        0x65,
        0x72,
        0x74,
        0x6f,
        0x6e,
        0x65,
        0x73,
        0x74,
        0x61,
        0x74,
        0x65,
        0x62,
        0x55,
        0x54,
        0x63,
        0x7a,
        0x69,
        0x70,
        0x1a,
        0x00,
        0x01,
        0x48,
        0x5a,
      ]),
    );

    assertEquals(
      t(k._serializer(Kinds.json)(jim)),
      '{"first":"Jim","last":"Black","street":"100 Main Street","city":"Riverton","state":"UT","zip":84058}',
    );
  });
});

Deno.test("db/koming - Komer supports KERIpy-style custom serialization hooks", async () => {
  await withTempDb(({ lmdber }) => {
    const mydb = new Komer<CustomRecord, CustomRecordShape>(lmdber, {
      subkey: "records.",
      schema: customRecordSchema,
    });
    const jim = new CustomRecord(
      "Jim",
      "Black",
      "100 Main Street",
      "Riverton",
      "UT",
      84058,
    );
    const keys = ["test_key", "0001"] as const;

    assertEquals(mydb.put(keys, jim), true);
    const actual = mydb.get(keys);
    assertEquals(actual, jim);

    const ser = lmdber.getVal(mydb.sdb, mydb._tokey(keys));
    assertEquals(
      ser === null ? null : t(ser),
      '{"name":"Jim Black","address1":"100 Main Street","address2":"Riverton UT 84058"}',
    );
  });
});

Deno.test("db/koming - Komer deserializers mirror KERIpy format selection", async () => {
  await withTempDb(({ lmdber }) => {
    const k = new Komer<RecordModel, RecordModelShape>(lmdber, {
      subkey: "records.",
      schema: recordSchema,
    });
    const msgp = new Uint8Array([
      0x86,
      0xa5,
      0x66,
      0x69,
      0x72,
      0x73,
      0x74,
      0xa3,
      0x4a,
      0x69,
      0x6d,
      0xa4,
      0x6c,
      0x61,
      0x73,
      0x74,
      0xa5,
      0x42,
      0x6c,
      0x61,
      0x63,
      0x6b,
      0xa6,
      0x73,
      0x74,
      0x72,
      0x65,
      0x65,
      0x74,
      0xaf,
      0x31,
      0x30,
      0x30,
      0x20,
      0x4d,
      0x61,
      0x69,
      0x6e,
      0x20,
      0x53,
      0x74,
      0x72,
      0x65,
      0x65,
      0x74,
      0xa4,
      0x63,
      0x69,
      0x74,
      0x79,
      0xa8,
      0x52,
      0x69,
      0x76,
      0x65,
      0x72,
      0x74,
      0x6f,
      0x6e,
      0xa5,
      0x73,
      0x74,
      0x61,
      0x74,
      0x65,
      0xa2,
      0x55,
      0x54,
      0xa3,
      0x7a,
      0x69,
      0x70,
      0xce,
      0x00,
      0x01,
      0x48,
      0x5a,
    ]);
    const cbor = new Uint8Array([
      0xa6,
      0x65,
      0x66,
      0x69,
      0x72,
      0x73,
      0x74,
      0x63,
      0x4a,
      0x69,
      0x6d,
      0x64,
      0x6c,
      0x61,
      0x73,
      0x74,
      0x65,
      0x42,
      0x6c,
      0x61,
      0x63,
      0x6b,
      0x66,
      0x73,
      0x74,
      0x72,
      0x65,
      0x65,
      0x74,
      0x6f,
      0x31,
      0x30,
      0x30,
      0x20,
      0x4d,
      0x61,
      0x69,
      0x6e,
      0x20,
      0x53,
      0x74,
      0x72,
      0x65,
      0x65,
      0x74,
      0x64,
      0x63,
      0x69,
      0x74,
      0x79,
      0x68,
      0x52,
      0x69,
      0x76,
      0x65,
      0x72,
      0x74,
      0x6f,
      0x6e,
      0x65,
      0x73,
      0x74,
      0x61,
      0x74,
      0x65,
      0x62,
      0x55,
      0x54,
      0x63,
      0x7a,
      0x69,
      0x70,
      0x1a,
      0x00,
      0x01,
      0x48,
      0x5a,
    ]);
    const json = new TextEncoder().encode(
      '{"first": "Jim", "last": "Black", "street": "100 Main Street", "city": "Riverton", "state": "UT", "zip": 84058}',
    );

    assertEquals(
      k._deserializer(Kinds.mgpk)(msgp),
      new RecordModel(
        "Jim",
        "Black",
        "100 Main Street",
        "Riverton",
        "UT",
        84058,
      ),
    );
    assertEquals(
      k._deserializer(Kinds.json)(json),
      new RecordModel(
        "Jim",
        "Black",
        "100 Main Street",
        "Riverton",
        "UT",
        84058,
      ),
    );
    assertEquals(
      k._deserializer(Kinds.cbor)(cbor),
      new RecordModel(
        "Jim",
        "Black",
        "100 Main Street",
        "Riverton",
        "UT",
        84058,
      ),
    );
  });
});

for (const kind of [Kinds.json, Kinds.cbor, Kinds.mgpk] as const) {
  Deno.test(`db/koming - Komer round-trips plain objects with ${kind}`, async () => {
    await withTempDb(({ lmdber }) => {
      const komer = new Komer<{ name: string; hid: string; attrs: string[] }>(
        lmdber,
        {
          subkey: "habs.",
          kind,
        },
      );
      const record = {
        name: "alice",
        hid: "EPrefix",
        attrs: ["watcher", "issuer"],
      };

      assertEquals(komer.kind, kind);
      assertEquals(komer.put("EPrefix", record), true);
      assertEquals(komer.get("EPrefix"), record);
      assertEquals([...komer.getTopItemIter("")], [[["EPrefix"], record]]);
    });
  });
}

Deno.test("db/koming - Komer defaults to JSON serialization", async () => {
  await withTempDb(({ lmdber }) => {
    const komer = new Komer<{ name: string; hid: string }>(lmdber, {
      subkey: "habs.",
    });
    const record = { name: "alice", hid: "EPrefix" };

    assertEquals(komer.kind, Kinds.json);
    assertEquals(komer.put("EPrefix", record), true);
    assertEquals(komer.get("EPrefix"), record);
  });
});

Deno.test("db/koming - Komer rejects unsupported runtime kind values", async () => {
  await withTempDb(({ lmdber }) => {
    assertThrows(
      () =>
        new Komer<{ name: string }>(lmdber, {
          subkey: "habs.",
          kind: "BOGUS" as KomerKind,
        }),
      Error,
      "Unsupported Komer serialization kind",
    );
  });
});
