// @file-test-lane app-fast-parallel

import { assertEquals } from "jsr:@std/assert";
import {
  parseExnDataItems,
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
  assertEquals(parseThresholdOption(null), undefined);
});
