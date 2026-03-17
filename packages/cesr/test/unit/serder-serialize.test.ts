import { assertEquals } from "jsr:@std/assert";
import { dumps, parseSerder, sizeify } from "../../src/serder/serder.ts";
import { smell, versify } from "../../src/serder/smell.ts";

Deno.test("dumps: JSON/CBOR/MGPK payloads round-trip through parseSerder", () => {
  const cases = [
    {
      kind: "JSON" as const,
      ked: { v: versify({ size: 0, kind: "JSON" }), t: "icp", d: "Eabc", i: "Eabc", s: "0" },
    },
    {
      kind: "CBOR" as const,
      ked: { v: versify({ size: 0, kind: "CBOR" }), t: "icp", d: "Eabc", i: "Eabc", s: "0" },
    },
    {
      kind: "MGPK" as const,
      ked: { v: versify({ size: 0, kind: "MGPK" }), t: "icp", d: "Eabc", i: "Eabc", s: "0" },
    },
  ];

  for (const { kind, ked } of cases) {
    const { raw, ked: sized } = sizeify({ ...ked }, kind);
    const { smellage } = smell(raw);
    const serder = parseSerder(raw, smellage);
    assertEquals(serder.ked, sized);
  }
});

Deno.test("sizeify: rewrites version size to final serialized length", () => {
  const ked = {
    v: versify({ size: 0 }),
    t: "icp",
    d: "Eabc",
    i: "Eabc",
    s: "0",
  };

  const { raw, ked: sized } = sizeify(ked, "JSON");
  const { smellage } = smell(raw);

  assertEquals(smellage.size, raw.length);
  assertEquals(sized.v, versify({ size: raw.length }));
});
