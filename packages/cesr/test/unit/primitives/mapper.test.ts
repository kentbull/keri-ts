import { assertEquals, assertThrows } from "jsr:@std/assert";
import { DeserializeError, SemanticInterpretationError, SyntaxParseError } from "../../../src/core/errors.ts";
import { parseLabeler } from "../../../src/primitives/labeler.ts";
import {
  interpretMapperBodySyntax,
  Mapper,
  type MapperMap,
  parseMapperBody,
  parseMapperBodySyntax,
} from "../../../src/primitives/mapper.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import type { Kind } from "../../../src/tables/versions.ts";
import vectors from "../../fixtures/aggregate-vectors.json" with { type: "json" };
import { counterV2, token } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../../fixtures/external-vectors.ts";
import { txt } from "../../fixtures/primitive-test-helpers.ts";

const V2 = { major: 2, minor: 0 } as const;

Deno.test("mapper: parses KERIpy native v2 map payload", () => {
  const payload = KERIPY_NATIVE_V2_ICP_FIX_BODY.slice(4);
  const mapPayload = `0J_i${payload.slice(0, 12)}0J_s${payload.slice(12, 16)}0J_d${payload.slice(16)}`;
  const mapBody = `${counterV2(CtrDexV2.MapBodyGroup, mapPayload.length / 4)}${mapPayload}`;

  const mapper = parseMapperBody(txt(mapBody), V2, "txt");
  assertEquals(mapper.code, CtrDexV2.MapBodyGroup);
  assertEquals(mapper.fields.length > 0, true);
  assertEquals(mapper.fields.some((f) => f.label !== null), true);
});

Deno.test("mapper: syntax parse + semantic interpretation", () => {
  const payload = `0J_i${token("B")}0J_d${token("E")}`;
  const mapBody = `${counterV2(CtrDexV2.MapBodyGroup, payload.length / 4)}${payload}`;

  const syntax = parseMapperBodySyntax(txt(mapBody), V2, "txt");
  assertEquals(syntax.entries.length, 4);
  assertEquals(syntax.entries[0].kind, "label");
  assertEquals(syntax.entries[1].kind, "value");

  const interpreted = interpretMapperBodySyntax(syntax);
  assertEquals(interpreted.length, 2);
  assertEquals(interpreted[0].label, "i");
});

Deno.test("mapper: rejects malformed syntax and dangling labels", () => {
  assertThrows(
    () => parseMapperBodySyntax(txt("-GACVAAA-KAB"), V2, "txt"),
    SyntaxParseError,
  );

  assertThrows(
    () =>
      interpretMapperBodySyntax({
        code: CtrDexV2.MapBodyGroup,
        count: 1,
        fullSize: 4,
        fullSizeB2: 3,
        totalSize: 8,
        totalSizeB2: 6,
        entries: [
          {
            kind: "label",
            primitive: parseLabeler(txt("0J_i"), "txt"),
            label: "i",
            consumed: 4,
          },
        ],
      }),
    SemanticInterpretationError,
  );
});

for (const row of vectors.rows) {
  const kind = row.kind as Kind;
  Deno.test(`mapper: ${kind} verifies frozen claims across semantic and wire inputs`, () => {
    const mad = structuredClone(row.ael[1]) as MapperMap;
    const init = { kind, saidive: true };
    const valid = Mapper.fromSad(mad, init);
    assertEquals(valid.mad, mad);
    assertEquals(new Mapper({ ...init, raw: valid.raw }).mad, mad);
    if (kind === "CESR") {
      assertEquals(new Mapper({ ...init, qb64: valid.qb64 }).mad, mad);
      assertEquals(new Mapper({ ...init, qb64b: valid.qb64b }).mad, mad);
      assertEquals(new Mapper({ ...init, qb2: valid.qb2 }).mad, mad);
    }

    for (const changed of [{ ...mad, role: "changed" }, { ...mad, d: row.compact[2] }, { ...mad, d: "malformed" }]) {
      const wire = Mapper.fromSad(changed, { ...init, verify: false });
      assertThrows(() => Mapper.fromSad(changed, init), DeserializeError, "SAID at d does not verify");
      assertThrows(() => new Mapper({ ...init, raw: wire.raw }), DeserializeError, "SAID at d does not verify");
      if (kind === "CESR") {
        for (const input of [{ qb64: wire.qb64 }, { qb64b: wire.qb64b }, { qb2: wire.qb2 }]) {
          assertThrows(() => new Mapper({ ...init, ...input }), DeserializeError, "SAID at d does not verify");
        }
      }
      assertEquals(new Mapper({ ...init, raw: wire.raw, verify: false }).mad, changed);
      assertEquals(Mapper.fromSad(changed, { ...init, saidive: false }).mad, changed);
      // makify replaces claims rather than validating stale input claims.
      const repaired = Mapper.fromSad(changed, { ...init, makify: true });
      assertEquals(Mapper.fromSad(repaired.mad, init).mad, repaired.mad);
    }
    const noClaim = { role: "holder" };
    assertEquals(Mapper.fromSad(noClaim, init).mad, noClaim);
    const alternate = Mapper.fromSad({ id: "", role: "holder" }, { ...init, saids: { id: "E" }, makify: true });
    assertEquals(Mapper.fromSad(alternate.mad, { ...init, saids: { id: "E" } }).mad, alternate.mad);
    assertThrows(
      () => Mapper.fromSad({ ...alternate.mad, role: "changed" }, { ...init, saids: { id: "E" } }),
      DeserializeError,
      "SAID at id does not verify",
    );
  });
}
