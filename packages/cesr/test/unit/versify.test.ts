import { assertEquals } from "jsr:@std/assert";
import { smell, versify } from "../../src/serder/smell.ts";
import { Vrsn_1_0, Vrsn_2_0 } from "../../src/tables/versions.ts";

Deno.test("versify: known V1 vector", () => {
  const vs = versify({ size: 0x229 });
  assertEquals(vs, "KERI10JSON000229_");
});

Deno.test("versify: V1 default options", () => {
  const vs = versify({ size: 100 });
  assertEquals(vs, "KERI10JSON000064_");
});

Deno.test("versify: V1 round-trip through smell", () => {
  const size = 512;
  const vs = versify({ proto: "KERI", pvrsn: Vrsn_1_0, kind: "JSON", size });
  const { smellage } = smell(new TextEncoder().encode(vs));
  assertEquals(smellage.proto, "KERI");
  assertEquals(smellage.pvrsn, Vrsn_1_0);
  assertEquals(smellage.kind, "JSON");
  assertEquals(smellage.size, size);
});

Deno.test("versify: V1 CBOR round-trip", () => {
  const vs = versify({ kind: "CBOR", size: 0x1ff });
  const { smellage } = smell(new TextEncoder().encode(vs));
  assertEquals(smellage.kind, "CBOR");
  assertEquals(smellage.size, 0x1ff);
});

Deno.test("versify: V1 ACDC protocol", () => {
  const vs = versify({ proto: "ACDC", size: 300 });
  const { smellage } = smell(new TextEncoder().encode(vs));
  assertEquals(smellage.proto, "ACDC");
  assertEquals(smellage.size, 300);
});

Deno.test("versify: V2 round-trip", () => {
  const size = 1024;
  const vs = versify({
    proto: "KERI",
    pvrsn: Vrsn_2_0,
    gvrsn: { major: 1, minor: 0 },
    kind: "JSON",
    size,
  });
  const { smellage } = smell(new TextEncoder().encode(vs));
  assertEquals(smellage.proto, "KERI");
  assertEquals(smellage.pvrsn, Vrsn_2_0);
  assertEquals(smellage.gvrsn, { major: 1, minor: 0 });
  assertEquals(smellage.kind, "JSON");
  assertEquals(smellage.size, size);
});

Deno.test("versify: V2 null gvrsn defaults to 0.0", () => {
  const vs = versify({ pvrsn: Vrsn_2_0, size: 256 });
  const { smellage } = smell(new TextEncoder().encode(vs));
  assertEquals(smellage.gvrsn, { major: 0, minor: 0 });
  assertEquals(smellage.size, 256);
});
