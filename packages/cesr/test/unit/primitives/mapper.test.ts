import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  SemanticInterpretationError,
  SyntaxParseError,
} from "../../../src/core/errors.ts";
import {
  interpretMapperBodySyntax,
  parseMapperBody,
  parseMapperBodySyntax,
} from "../../../src/primitives/mapper.ts";
import { parseLabeler } from "../../../src/primitives/labeler.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import {
  KERIPY_NATIVE_V2_ICP_FIX_BODY,
} from "../../fixtures/external-vectors.ts";
import { counterV2, token } from "../../fixtures/counter-token-fixtures.ts";
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
