import { assertEquals, assertThrows } from "jsr:@std/assert";
import { DeserializeError } from "../../src/core/errors.ts";
import type { MapperMap } from "../../src/primitives/mapper.ts";
import {
  canonicalizeCesrNativeRaw,
  dumpCesrNativeSad,
  parseCesrNativeKed,
} from "../../src/serder/native.ts";
import { SerderKERI } from "../../src/serder/serder.ts";
import { Serdery } from "../../src/serder/serdery.ts";
import { versify } from "../../src/serder/smell.ts";
import { Vrsn_2_0 } from "../../src/tables/versions.ts";
import {
  KERIPY_NATIVE_V2_EXN_FIX_BODY,
  KERIPY_NATIVE_V2_QRY_FIX_BODY,
  KERIPY_NATIVE_V2_RPY_FIX_BODY,
  KERIPY_NATIVE_V2_XIP_FIX_BODY,
} from "../fixtures/external-vectors.ts";
import { KERIPY_MATTER_VECTORS } from "../fixtures/keripy-primitive-vectors.ts";
import {
  breakdownNativeKeriIcpFixture,
  expectedNativeKeriIcpSad,
  invalidNativeKeriIcpMapBodyQb64,
  nativeKeriIcpFixtureQb2,
  nativeKeriIcpFixtureQb64,
  nativeKeriIcpSmellage,
  renderNativeSegmentSummary,
} from "../fixtures/native-serder-test-helpers.ts";

// This file is the maintainers' native-serder walkthrough. The tests are meant
// to read like worked examples of the native story:
// KERI fixed-body basics first, then the ACDC map/fixed section lane.

function keriV2FixtureSad(
  ilk: "qry" | "rpy" | "xip" | "exn",
): Record<string, unknown> {
  const base = {
    v: versify({
      proto: "KERI",
      pvrsn: Vrsn_2_0,
      gvrsn: Vrsn_2_0,
      kind: "CESR",
      size: 0,
    }),
  };

  switch (ilk) {
    case "qry":
      return {
        ...base,
        t: "qry",
        d: "",
        i: "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx",
        dt: "2026-03-17T12:34:56.000000+00:00",
        r: "ksn",
        rr: "reply",
        q: { pre: "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx", sn: "0" },
      };
    case "rpy":
      return {
        ...base,
        t: "rpy",
        d: "",
        i: "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx",
        dt: "2026-03-17T12:34:56.000000+00:00",
        r: "introduce",
        a: { cid: "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx" },
      };
    case "xip":
      return {
        ...base,
        t: "xip",
        d: "",
        // This nonce is pinned to the exact KERIpy fixture above, so the
        // computed top-level SAID also stays byte-for-byte aligned.
        u: "0AAb4Y8P4m9N2S8RULf7rqmR",
        i: "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx",
        ri: "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN",
        dt: "2026-03-17T12:34:56.000000+00:00",
        r: "ipex",
        q: { role: "issuer" },
        a: { d: "", action: "grant" },
      };
    case "exn":
      return {
        ...base,
        t: "exn",
        d: "",
        i: "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx",
        ri: "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN",
        x: "EFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2",
        p: "EN0MZ5zwEHpCi297Rg4fu1vfFXSPWHAP9PWVvCEV1_Kd",
        dt: "2026-03-17T12:34:56.000000+00:00",
        r: "credential/issue",
        q: { schema: "EFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2" },
        a: { d: "", m: "hello" },
      };
  }
}

Deno.test("native helper: KERI v2 icp fixture is broken down into readable top-level CESR segments", () => {
  // This is the "teach me the wire shape" test. The helper should expose the
  // native fixture in the same segment order a maintainer would parse it by
  // eye: body counter, verser, ilk, then fixed fields in protocol order.
  const segments = breakdownNativeKeriIcpFixture();

  assertEquals(segments.map((segment) => segment.name), [
    "bodyCounter",
    "verser",
    "ilk",
    "said",
    "pre",
    "sn",
    "kt",
    "keys",
    "nt",
    "ndigs",
    "bt",
    "backs",
    "traits",
    "seals",
  ]);

  assertEquals(segments[0].qb64, "-FA5");
  assertEquals(segments[1].qb64, "0OKERICAACAA");
  assertEquals(segments[2].qb64, "Xicp");
  assertEquals(segments[5].semantic, "0");
  assertEquals(segments[6].semantic, "1");
  assertEquals(segments[7].semantic, [
    "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx",
  ]);
  assertEquals(segments[9].semantic, [
    "EFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2",
  ]);
  assertEquals(segments[11].semantic, []);
  assertEquals(segments[12].semantic, []);
  assertEquals(segments[13].semantic, []);

  // Keep one exact summary assertion so CI failures show the whole native shape
  // in a single diff instead of scattering the lesson across many assertions.
  assertEquals(
    renderNativeSegmentSummary(segments),
    "bodyCounter=-FA5 | verser=0OKERICAACAA | ilk=Xicp | said=EFaYE2LT...JKWXRN | pre=DNG2arBD...iXp4Hx | sn=MAAA | kt=MAAB | keys=-JALDNG2...iXp4Hx | nt=MAAB | ndigs=-JALEFXI...DXV8D2 | bt=MAAA | backs=-JAA | traits=-JAA | seals=-JAA",
  );
});

Deno.test("canonicalizeCesrNativeRaw: qb64 text and qb2 binary become the same readable ASCII native body", () => {
  // Native qb2 is opaque to a human reader. This test locks the core learning
  // invariant: both domains normalize to the same readable qb64 text form.
  const expected = new TextEncoder().encode(nativeKeriIcpFixtureQb64());

  assertEquals(
    canonicalizeCesrNativeRaw(expected, { major: 2, minor: 0 }),
    expected,
  );
  assertEquals(
    canonicalizeCesrNativeRaw(nativeKeriIcpFixtureQb2(), {
      major: 2,
      minor: 0,
    }),
    expected,
  );
});

Deno.test("parseCesrNativeKed: native fixed-body fixture reconstructs the same semantic SAD a maintainer would write by hand", () => {
  // Inhale example: compact CESR-native fields should rebuild the same
  // semantic SAD shape used by ordinary non-native KERI serders.
  const parsed = parseCesrNativeKed(
    new TextEncoder().encode(nativeKeriIcpFixtureQb64()),
    nativeKeriIcpSmellage(),
  );

  assertEquals(parsed.ilk, "icp");
  assertEquals(parsed.said, "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN");
  assertEquals(parsed.ked, expectedNativeKeriIcpSad());
});

Deno.test("dumpCesrNativeSad: semantic SAD emits the same CESR native fixture that the readable helper breaks down", () => {
  // Exhale companion: starting from the semantic SAD should reproduce the
  // pinned native fixture byte-for-byte.
  const raw = dumpCesrNativeSad(expectedNativeKeriIcpSad() as MapperMap);

  assertEquals(raw, new TextEncoder().encode(nativeKeriIcpFixtureQb64()));
});

Deno.test("parseCesrNativeKed: message-shaped KERI native MapBodyGroup is rejected because top-level KERI native bodies must be fixed-field", () => {
  // This is the exact boundary that used to be too permissive: the payload
  // looks message-shaped because it carries `v`, `t`, `d`, `i`, and the rest
  // of the expected KERI labels, but KERIpy semantics still reject it because
  // native KERI top-level messages are fixed-body, not map-body.
  assertThrows(
    () =>
      parseCesrNativeKed(
        new TextEncoder().encode(invalidNativeKeriIcpMapBodyQb64()),
        nativeKeriIcpSmellage(),
      ),
    DeserializeError,
    "FixBodyGroup",
  );
});

Deno.test("Serdery: native fixture reaps to the same SerderKERI in txt and qb2 domains", () => {
  // End-to-end runtime bridge: regardless of input domain, `Serdery` should
  // produce one canonical `SerderKERI` with the same semantic body and qb64 raw.
  const serdery = new Serdery();
  const txt =
    serdery.reap(new TextEncoder().encode(nativeKeriIcpFixtureQb64())).serder;
  const bny = serdery.reap(nativeKeriIcpFixtureQb2()).serder;

  assertEquals(txt instanceof SerderKERI, true);
  assertEquals(bny instanceof SerderKERI, true);
  assertEquals(txt.ked, expectedNativeKeriIcpSad());
  assertEquals(bny.ked, expectedNativeKeriIcpSad());
  assertEquals(txt.raw, new TextEncoder().encode(nativeKeriIcpFixtureQb64()));
  assertEquals(bny.raw, new TextEncoder().encode(nativeKeriIcpFixtureQb64()));
});

Deno.test("parseCesrNativeKed + dumpCesrNativeSad: ACDC map-body `acm` round-trips compactable section fields", () => {
  // This is the ACDC map-body teaching test: top-level `acm` stays map-shaped,
  // while section fields like `s` and `a` may themselves be compactable nested
  // blocks carried as CESR-native map groups.
  const sad = {
    v: versify({
      proto: "ACDC",
      pvrsn: Vrsn_2_0,
      gvrsn: Vrsn_2_0,
      kind: "CESR",
      size: 0,
    }),
    t: "acm",
    d: "EFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2",
    u: "",
    i: "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx",
    rd: "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN",
    s: { d: "", title: "schema" },
    a: { d: "", role: "holder" },
    e: { d: "", link: "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN" },
    r: { d: "", usage: "test" },
  };

  const raw = dumpCesrNativeSad(sad as MapperMap);
  const parsed = parseCesrNativeKed(raw, {
    proto: "ACDC",
    pvrsn: Vrsn_2_0,
    gvrsn: Vrsn_2_0,
    kind: "CESR",
    size: raw.length,
  });

  assertEquals(parsed.ilk, "acm");
  assertEquals(parsed.ked, {
    ...sad,
    v: versify({
      proto: "ACDC",
      pvrsn: Vrsn_2_0,
      gvrsn: Vrsn_2_0,
      kind: "CESR",
      size: raw.length,
    }),
  });
});

Deno.test("parseCesrNativeKed + dumpCesrNativeSad: KERI v2 qry round-trips route and mapper fields through the native matrix", () => {
  // This is the broader KERI matrix test: not another ICP-shaped body, but a
  // route/query message with datetime, path, return-route, and native mapper
  // payload fields.
  const sad = {
    v: versify({
      proto: "KERI",
      pvrsn: Vrsn_2_0,
      gvrsn: Vrsn_2_0,
      kind: "CESR",
      size: 0,
    }),
    t: "qry",
    d: "EFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2",
    i: "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx",
    dt: "2026-03-17T12:34:56.000000+00:00",
    r: "ksn",
    rr: "reply",
    q: { pre: "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx", sn: "0" },
  };

  const raw = dumpCesrNativeSad(sad);
  const parsed = parseCesrNativeKed(raw, {
    proto: "KERI",
    pvrsn: Vrsn_2_0,
    gvrsn: Vrsn_2_0,
    kind: "CESR",
    size: raw.length,
  });

  assertEquals(parsed.ilk, "qry");
  assertEquals(parsed.ked, {
    ...sad,
    v: versify({
      proto: "KERI",
      pvrsn: Vrsn_2_0,
      gvrsn: Vrsn_2_0,
      kind: "CESR",
      size: raw.length,
    }),
  });
});

Deno.test("native parity: KERIpy qry/rpy/xip/exn fixtures round-trip byte-for-byte through SerderKERI and native dump", () => {
  // These are the tail-parity fixtures that matter for route-heavy native
  // messages. They prove our `Pather`-backed route encoding now matches the
  // reference bytes KERIpy emits instead of only preserving semantic shape.
  const fixtures = [
    ["qry", KERIPY_NATIVE_V2_QRY_FIX_BODY],
    ["rpy", KERIPY_NATIVE_V2_RPY_FIX_BODY],
    ["xip", KERIPY_NATIVE_V2_XIP_FIX_BODY],
    ["exn", KERIPY_NATIVE_V2_EXN_FIX_BODY],
  ] as const;

  for (const [ilk, fixture] of fixtures) {
    const serder = new SerderKERI({
      sad: keriV2FixtureSad(ilk),
      pvrsn: Vrsn_2_0,
      gvrsn: Vrsn_2_0,
      kind: "CESR",
      makify: true,
      verify: true,
      ilk,
    });

    assertEquals(new TextDecoder().decode(serder.raw), fixture);
    assertEquals(
      new TextDecoder().decode(
        dumpCesrNativeSad((serder.ked ?? {}) as MapperMap),
      ),
      fixture,
    );
    assertEquals(
      parseCesrNativeKed(new TextEncoder().encode(fixture), {
        proto: "KERI",
        pvrsn: Vrsn_2_0,
        gvrsn: Vrsn_2_0,
        kind: "CESR",
        size: fixture.length,
      }).ked,
      serder.ked,
    );
  }
});

Deno.test("parseCesrNativeKed + dumpCesrNativeSad: KERI v2 xip round-trips nonce, route, and mapper fields", () => {
  // This is the nonce-bearing KERI native case. It proves the matrix handles
  // KERI `u` as a qualified nonce token, not the ACDC empty-or-value rule.
  const sad = {
    v: versify({
      proto: "KERI",
      pvrsn: Vrsn_2_0,
      gvrsn: Vrsn_2_0,
      kind: "CESR",
      size: 0,
    }),
    t: "xip",
    d: "EFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2",
    u: KERIPY_MATTER_VECTORS.noncerSalt128,
    i: "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx",
    ri: "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN",
    dt: "2026-03-17T12:34:56.000000+00:00",
    r: "ipex",
    q: { role: "issuer" },
    a: { d: "", action: "grant" },
  };

  const raw = dumpCesrNativeSad(sad);
  const parsed = parseCesrNativeKed(raw, {
    proto: "KERI",
    pvrsn: Vrsn_2_0,
    gvrsn: Vrsn_2_0,
    kind: "CESR",
    size: raw.length,
  });

  assertEquals(parsed.ilk, "xip");
  assertEquals(parsed.ked, {
    ...sad,
    v: versify({
      proto: "KERI",
      pvrsn: Vrsn_2_0,
      gvrsn: Vrsn_2_0,
      kind: "CESR",
      size: raw.length,
    }),
  });
});

Deno.test("dumpCesrNativeSad: non-native-only KERI ilks are rejected by the native support matrix", () => {
  // Guardrail test: the native matrix should reject KERI ilks we have not
  // declared native-compatible instead of best-effort serializing them.
  assertThrows(
    () =>
      dumpCesrNativeSad({
        v: versify({
          proto: "KERI",
          pvrsn: Vrsn_2_0,
          gvrsn: Vrsn_2_0,
          kind: "CESR",
          size: 0,
        }),
        t: "vcp",
        d: "EFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2",
      }),
    DeserializeError,
  );
});

Deno.test("parseCesrNativeKed + dumpCesrNativeSad: ACDC fixed-body `act` round-trips compactable section fields", () => {
  // Fixed-body ACDC ilks put the ilk in a fixed slot after the verser, then
  // serialize the remaining fields in protocol order without explicit labels.
  const sad = {
    v: versify({
      proto: "ACDC",
      pvrsn: Vrsn_2_0,
      gvrsn: Vrsn_2_0,
      kind: "CESR",
      size: 0,
    }),
    t: "act",
    d: "EFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2",
    u: "",
    i: "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx",
    rd: "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN",
    s: { d: "", title: "schema" },
    a: { d: "", role: "holder" },
    e: { d: "", link: "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN" },
    r: { d: "", usage: "test" },
  };

  const raw = dumpCesrNativeSad(sad);
  const parsed = parseCesrNativeKed(raw, {
    proto: "ACDC",
    pvrsn: Vrsn_2_0,
    gvrsn: Vrsn_2_0,
    kind: "CESR",
    size: raw.length,
  });

  assertEquals(parsed.ilk, "act");
  assertEquals(parsed.ked, {
    ...sad,
    v: versify({
      proto: "ACDC",
      pvrsn: Vrsn_2_0,
      gvrsn: Vrsn_2_0,
      kind: "CESR",
      size: raw.length,
    }),
  });
});
