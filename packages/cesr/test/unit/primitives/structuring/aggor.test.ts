import { assertEquals, assertThrows } from "jsr:@std/assert";
import { decodeHex } from "jsr:@std/encoding/hex";
import { b, concatBytes } from "../../../../src/core/bytes.ts";
import { DeserializeError, SerializeError, ShortageError, UnknownCodeError } from "../../../../src/core/errors.ts";
import { Aggor, type AggorList } from "../../../../src/primitives/structuring/aggor.ts";
import { Mapper, type MapperMap } from "../../../../src/primitives/structuring/mapper.ts";
import type { Kind } from "../../../../src/tables/versions.ts";
import vectors from "../../../fixtures/aggregate-vectors.json" with { type: "json" };

for (const row of vectors.rows) {
  const kind = row.kind as Kind;

  Deno.test(`aggor: ${kind} construction and disclosure match frozen KERIpy`, () => {
    const seed = structuredClone(vectors.seed) as AggorList;
    const aggor = new Aggor({ ael: seed, kind, makify: true });
    assertEquals(seed, vectors.seed as AggorList);
    assertEquals(aggor.ael, row.ael as AggorList);
    assertEquals(aggor.raw, decodeHex(row.raw));
    assertEquals(aggor.count, row.count);
    assertEquals(aggor.size, decodeHex(row.raw).length);
    assertEquals(aggor.code, "E");
    assertEquals(aggor.kind, kind);
    assertEquals(new Aggor({ raw: aggor.raw, kind }).ael, row.ael as AggorList);
    assertEquals(new Aggor({ ael: aggor.ael, kind }).raw, aggor.raw);

    const [compact] = aggor.disclose();
    const [partial, disclosedKind] = aggor.disclose([1]);
    assertEquals(compact, row.compact);
    assertEquals(partial, row.partial);
    assertEquals(disclosedKind, kind);
    assertEquals(new Aggor({ ael: compact, kind }).raw, decodeHex(row.compactRaw));
    assertEquals(Aggor.verifyDisclosure(partial, kind), true);
    assertEquals(Aggor.verifyDisclosure(compact, kind), true);

    const empty = new Aggor({ kind });
    assertEquals(empty.raw, decodeHex(row.emptyRaw));
    assertEquals(empty.agid, null);
    assertEquals(new Aggor({ raw: empty.raw, kind }).ael, []);
    assertEquals(aggor.qb64b, aggor.raw);
    if (kind === "JSON" || kind === "CESR") {
      assertEquals(aggor.qb64, new TextDecoder().decode(aggor.raw));
    } else {
      // Python's text accessor rejects binary CBOR/MGPK bytes rather than replacing them.
      assertThrows(() => aggor.qb64, TypeError);
    }
    if (kind === "CESR") {
      assertEquals(new Aggor({ qb2: aggor.qb2 }).raw, aggor.raw);
      assertEquals(aggor.byteCount("txt"), aggor.raw.length);
      assertEquals(aggor.byteCount("bny"), aggor.qb2.length);
      // CESR inhale consumes exactly one aggregate from a larger field stream.
      assertEquals(new Aggor({ raw: concatBytes(aggor.raw, empty.raw) }).raw, aggor.raw);
    } else {
      assertEquals(empty.count, null);
      assertThrows(() => aggor.qb2, SerializeError);
      assertThrows(() => aggor.byteCount(), SerializeError);
      assertThrows(() => new Aggor({ qb2: aggor.raw, kind }), DeserializeError);
    }
  });

  Deno.test(`aggor: ${kind} rejects changed AGID, disclosed map SAID, and content`, () => {
    const ael = structuredClone(row.ael) as AggorList;
    ael[0] = row.compact[1];
    assertEquals(Aggor.verifyDisclosure(ael, kind), false);
    assertThrows(() => new Aggor({ ael, kind }), DeserializeError, "identifier does not verify");
    assertThrows(() => new Aggor({ raw: new Aggor({ ael, kind, verify: false }).raw, kind }), DeserializeError);

    const altered = structuredClone(row.ael) as AggorList;
    (altered[1] as MapperMap).d = row.compact[2];
    assertEquals(Aggor.verifyDisclosure(altered, kind), false);
    assertThrows(() => new Aggor({ ael: altered, kind }), DeserializeError, "SAID at d does not verify");
    const missing = structuredClone(row.ael) as AggorList;
    delete (missing[1] as MapperMap).d;
    assertEquals(Aggor.verifyDisclosure(missing, kind), false);
    assertThrows(() => new Aggor({ ael: missing, kind }), kind === "CESR" ? SerializeError : DeserializeError);
    const changed = structuredClone(row.ael) as AggorList;
    (changed[1] as MapperMap).role = "changed";
    assertEquals(Aggor.verifyDisclosure(changed, kind), false);
    assertThrows(() => new Aggor({ ael: changed, kind }), DeserializeError, "SAID at d does not verify");
    assertThrows(() => new Aggor({ raw: new Mapper({ mad: {}, kind }).raw, kind }), DeserializeError);
  });
}

Deno.test("aggor: CESR rejects generic non-digest elements and truncated framing", () => {
  assertThrows(() => new Aggor({ qb64: "-JALDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }), UnknownCodeError);
  assertThrows(() => new Aggor({ qb64: "-JAB" }), ShortageError);
  assertThrows(() => new Aggor({ raw: b("-JAB-JAA"), verify: false }), DeserializeError, "map element");
});
