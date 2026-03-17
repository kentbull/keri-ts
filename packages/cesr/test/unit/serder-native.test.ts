import { assertEquals } from "jsr:@std/assert";
import {
  canonicalizeCesrNativeRaw,
  dumpCesrNativeSad,
  parseCesrNativeKed,
} from "../../src/serder/native.ts";
import { SerderKERI } from "../../src/serder/serder.ts";
import { Serdery } from "../../src/serder/serdery.ts";
import {
  breakdownNativeKeriIcpFixture,
  expectedNativeKeriIcpSad,
  nativeKeriIcpFixtureQb2,
  nativeKeriIcpFixtureQb64,
  nativeKeriIcpSmellage,
  renderNativeSegmentSummary,
} from "../fixtures/native-serder-test-helpers.ts";

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
    canonicalizeCesrNativeRaw(nativeKeriIcpFixtureQb2(), { major: 2, minor: 0 }),
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
  const raw = dumpCesrNativeSad(expectedNativeKeriIcpSad());

  assertEquals(raw, new TextEncoder().encode(nativeKeriIcpFixtureQb64()));
});

Deno.test("Serdery: native fixture reaps to the same SerderKERI in txt and qb2 domains", () => {
  // End-to-end runtime bridge: regardless of input domain, `Serdery` should
  // produce one canonical `SerderKERI` with the same semantic body and qb64 raw.
  const serdery = new Serdery();
  const txt = serdery.reap(new TextEncoder().encode(nativeKeriIcpFixtureQb64())).serder;
  const bny = serdery.reap(nativeKeriIcpFixtureQb2()).serder;

  assertEquals(txt instanceof SerderKERI, true);
  assertEquals(bny instanceof SerderKERI, true);
  assertEquals(txt.ked, expectedNativeKeriIcpSad());
  assertEquals(bny.ked, expectedNativeKeriIcpSad());
  assertEquals(txt.raw, new TextEncoder().encode(nativeKeriIcpFixtureQb64()));
  assertEquals(bny.raw, new TextEncoder().encode(nativeKeriIcpFixtureQb64()));
});
