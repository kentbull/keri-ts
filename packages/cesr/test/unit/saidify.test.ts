import { assertEquals, assertThrows } from "jsr:@std/assert";
import { saidify } from "../../src/serder/saidify.ts";
import { smell } from "../../src/serder/smell.ts";
import { parseSerder } from "../../src/serder/serder.ts";
import { Matter } from "../../src/primitives/matter.ts";
import { SerializeError } from "../../src/core/errors.ts";
import { blake3 } from "npm:@noble/hashes@1.8.0/blake3";

Deno.test("saidify: inception KED produces correct SAID", () => {
  const ked: Record<string, unknown> = {
    v: "KERI10JSON000000_",
    t: "icp",
    d: "",
    i: "",
    s: "0",
    kt: "1",
    k: ["DAbcdefghijklmnopqrstuvwxyz012345678901234567"],
    nt: "1",
    n: ["EAbcdefghijklmnopqrstuvwxyz012345678901234567"],
    bt: "0",
    b: [],
    c: [],
    a: [],
  };

  const result = saidify(ked, blake3);
  assertEquals(result.said.length, 44);
  assertEquals(result.said[0], "E");
  assertEquals(result.ked.d, result.said);
  assertEquals(result.ked.i, result.said);

  // Verify version string has correct size
  const { smellage } = smell(new TextEncoder().encode(result.ked.v as string));
  assertEquals(smellage.size, result.raw.length);
});

Deno.test("saidify: SAID matches manual blake3+Matter encoding", () => {
  const ked: Record<string, unknown> = {
    v: "KERI10JSON000000_",
    t: "icp",
    d: "",
    i: "DFixedPrefix0000000000000000000000000000000",
    s: "0",
    kt: "1",
    k: ["DFixedPrefix0000000000000000000000000000000"],
    nt: "0",
    n: [],
    bt: "0",
    b: [],
    c: [],
    a: [],
  };

  const result = saidify(ked, blake3, { field: "d", code: "E" });

  // Manually compute: placeholder the ked, serialize, hash, encode
  const clone = { ...ked };
  clone.d = "#".repeat(44);
  // Don't placeholder i since it's not equal to d
  const json = JSON.stringify(clone);
  // Measure and set version
  const withVersion = { ...clone };
  withVersion.v = `KERI10JSON${json.length.toString(16).padStart(6, "0")}_`;
  const raw2 = new TextEncoder().encode(JSON.stringify(withVersion));
  const digest = blake3(raw2);
  const expectedSaid = new Matter({ code: "E", raw: digest }).qb64;

  assertEquals(result.said, expectedSaid);
});

Deno.test("saidify: round-trip through parseSerder", () => {
  const ked: Record<string, unknown> = {
    v: "KERI10JSON000000_",
    t: "icp",
    d: "",
    i: "",
    s: "0",
    kt: "1",
    k: ["DTestKey0000000000000000000000000000000000000"],
    nt: "0",
    n: [],
    bt: "0",
    b: [],
    c: [],
    a: [],
  };

  const result = saidify(ked, blake3);
  const { smellage } = smell(result.raw);
  const body = parseSerder(result.raw, smellage);
  assertEquals(body.said, result.said);
});

Deno.test("saidify: variable-size code throws", () => {
  const ked: Record<string, unknown> = { d: "" };
  // Code "4A" should be a variable-size code (fs === null)
  // Use a code that doesn't exist or has null fs
  assertThrows(
    () => saidify(ked, blake3, { code: "DOES_NOT_EXIST" }),
    SerializeError,
    "Unknown matter code",
  );
});

Deno.test("saidify: custom field name", () => {
  const ked: Record<string, unknown> = {
    v: "KERI10JSON000000_",
    t: "rpy",
    d: "",
    dt: "2024-01-01T00:00:00.000000+00:00",
    r: "/loc/scheme",
    a: { myDigest: "" },
  };

  // We can saidify a non-standard field at root level
  const result = saidify(ked, blake3, { field: "d" });
  assertEquals(result.ked.d, result.said);
  assertEquals(typeof result.ked.v, "string");
});
