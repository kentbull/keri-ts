import { assertEquals } from "jsr:@std/assert";
import { parseExnDataItems } from "../../../src/app/cli/common/parsing.ts";

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
