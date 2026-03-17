import { assertEquals } from "jsr:@std/assert";
import { smell, versify } from "../../src/serder/smell.ts";
import { Vrsn_1_0, Vrsn_2_0 } from "../../src/tables/versions.ts";

Deno.test("versify: round-trips v1 version strings through smell", () => {
  const vs = versify({
    proto: "KERI",
    pvrsn: Vrsn_1_0,
    kind: "JSON",
    size: 0x229,
  });

  assertEquals(vs, "KERI10JSON000229_");
  assertEquals(smell(new TextEncoder().encode(vs)).smellage, {
    proto: "KERI",
    pvrsn: Vrsn_1_0,
    gvrsn: null,
    kind: "JSON",
    size: 0x229,
  });
});

Deno.test("versify: round-trips v2 version strings through smell", () => {
  const vs = versify({
    proto: "ACDC",
    pvrsn: Vrsn_2_0,
    gvrsn: { major: 1, minor: 0 },
    kind: "CBOR",
    size: 1024,
  });

  assertEquals(smell(new TextEncoder().encode(vs)).smellage, {
    proto: "ACDC",
    pvrsn: Vrsn_2_0,
    gvrsn: { major: 1, minor: 0 },
    kind: "CBOR",
    size: 1024,
  });
});
