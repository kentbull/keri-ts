import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  loadInceptFileOptions,
  loadRotateFileOptions,
  parseBooleanOption,
  parseCountOption,
  parseExnDataItems,
  parseStringListOption,
  parseThresholdOption,
} from "../../../src/app/cli/common/parsing.ts";

Deno.test("parseExnDataItems matches KERIpy-style coercion and merge order", () => {
  const parsed = parseExnDataItems([
    "count=1",
    "enabled=true",
    "tags=[\"a\",\"b\"]",
    "meta={\"x\":1}",
    "note=hello",
    "{\"count\":2,\"extra\":\"json\"}",
    "empty=null",
  ]);

  assertEquals(parsed, {
    count: 2,
    enabled: true,
    tags: ["a", "b"],
    meta: { x: 1 },
    note: "hello",
    extra: "json",
    empty: null,
  });
});

Deno.test("parseExnDataItems loads object payloads from @file references", () => {
  const dir = Deno.makeTempDirSync();
  const path = `${dir}/payload.json`;
  Deno.writeTextFileSync(
    path,
    JSON.stringify({
      route: "challenge",
      nested: { ok: true },
    }),
  );

  try {
    const parsed = parseExnDataItems([`@${path}`, "route=overridden"]);
    assertEquals(parsed, {
      route: "overridden",
      nested: { ok: true },
    });
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("parseThresholdOption accepts CLI and JSON-file threshold forms", () => {
  const structured = [{ "1": ["1/2", "1/2"] }, "1"];

  assertEquals(parseThresholdOption(2), "2");
  assertEquals(parseThresholdOption("2"), "2");
  assertEquals(parseThresholdOption(JSON.stringify(structured)), structured);
  assertEquals(parseThresholdOption(structured), structured);
  assertEquals(parseThresholdOption(undefined), undefined);
  assertThrows(() => parseThresholdOption(null));
});

Deno.test("CLI primitives preserve omission and explicit zero, false and empty lists", () => {
  assertEquals(parseBooleanOption(undefined, "flag"), undefined);
  assertEquals(parseBooleanOption(false, "flag"), false);
  assertEquals(parseCountOption(undefined, "count"), undefined);
  assertEquals(parseCountOption("0", "count"), 0);
  assertEquals(parseStringListOption(undefined, "wits"), undefined);
  assertEquals(parseStringListOption([], "wits"), []);
  for (const value of ["", " ", "1e2", "0x10", "1.5", -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, null]) {
    assertThrows(() => parseCountOption(value, "count"));
  }
  assertThrows(() => parseBooleanOption("false", "flag"));
  assertThrows(() => parseStringListOption(["valid", 3], "wits"));
  for (const value of ["", [], ["not-a-weight"], [["1/2"]], Number.MAX_SAFE_INTEGER + 1]) {
    assertThrows(() => parseThresholdOption(value));
  }
});

Deno.test("lifecycle option files validate supplied fields without filtering malformed entries", () => {
  const file = Deno.makeTempFileSync();
  try {
    Deno.writeTextFileSync(file, JSON.stringify({ transferable: true, ncount: 0, wits: [], data: [{ custom: true }] }));
    const inception = loadInceptFileOptions(file);
    assertEquals(inception.transferable, true);
    assertEquals(inception.ncount, 0);
    assertEquals(inception.wits, []);
    assertEquals(inception.data, [{ custom: true }]);
    for (const value of [null, [], { wits: ["valid", 3] }, { ncount: -1 }, { data: false }, { nsith: "" }]) {
      Deno.writeTextFileSync(file, JSON.stringify(value));
      assertThrows(() => loadInceptFileOptions(file));
      assertThrows(() => loadRotateFileOptions(file));
    }
  } finally {
    Deno.removeSync(file);
  }
});
