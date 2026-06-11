// @file-test-lane app-fast-parallel

import { assertEquals, assertThrows } from "jsr:@std/assert";
import { resolveWitnessAuths } from "../../../src/app/cli/common/witness-auth.ts";
import { ValidationError } from "../../../src/core/errors.ts";

Deno.test("witness-auth parses explicit witness codes with command timestamp", () => {
  const auths = resolveWitnessAuths(
    ["Ewit"],
    ["Ewit:123456"],
    { codeTime: "2026-06-11T12:00:00.000000+00:00" },
  );

  assertEquals(auths, {
    Ewit: "123456#2026-06-11T12:00:00.000000+00:00",
  });
});

Deno.test("witness-auth prompts for missing codes with injectable prompt and clock", () => {
  const auths = resolveWitnessAuths(
    ["Eone", "Etwo"],
    ["Eone:111111"],
    {
      codeTime: "2026-06-11T12:00:00.000000+00:00",
      promptMissing: true,
      promptCode: (message) => message.includes("Etwo") ? "222222" : null,
      now: () => "2026-06-11T12:00:01.000000+00:00",
    },
  );

  assertEquals(auths, {
    Eone: "111111#2026-06-11T12:00:00.000000+00:00",
    Etwo: "222222#2026-06-11T12:00:01.000000+00:00",
  });
});

Deno.test("witness-auth rejects malformed code entries", () => {
  assertThrows(
    () => resolveWitnessAuths(["Ewit"], ["broken"], { now: () => "now" }),
    ValidationError,
    "Invalid witness code 'broken'. Expected <Witness AID>:<code>.",
  );
});
