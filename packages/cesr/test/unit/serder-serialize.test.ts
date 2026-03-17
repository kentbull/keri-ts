import { assertEquals } from "jsr:@std/assert";
import { codeB64ToB2 } from "../../src/core/bytes.ts";
import { dumps, parseSerder, Serder, sizeify } from "../../src/serder/serder.ts";
import { SerderKERI } from "../../src/serder/serder.ts";
import { reapSerder } from "../../src/serder/serdery.ts";
import { smell, versify } from "../../src/serder/smell.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";

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

Deno.test("dumps: CESR native KERI sad round-trips through reapSerder", () => {
  const { serder } = reapSerder(new TextEncoder().encode(KERIPY_NATIVE_V2_ICP_FIX_BODY));
  const raw = dumps((serder as Serder).sad ?? {}, "CESR");
  assertEquals(raw, new TextEncoder().encode(KERIPY_NATIVE_V2_ICP_FIX_BODY));
});

Deno.test("reapSerder: native KERI txt and qb2 hydrate SerderKERI", () => {
  const txt = reapSerder(new TextEncoder().encode(KERIPY_NATIVE_V2_ICP_FIX_BODY)).serder;
  const bny = reapSerder(codeB64ToB2(KERIPY_NATIVE_V2_ICP_FIX_BODY)).serder;

  assertEquals(txt instanceof SerderKERI, true);
  assertEquals(bny instanceof SerderKERI, true);
  assertEquals(txt.ked?.t, "icp");
  assertEquals(bny.ked?.d, txt.ked?.d);
});
