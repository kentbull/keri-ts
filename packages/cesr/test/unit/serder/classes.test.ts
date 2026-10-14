import { assertEquals, assertThrows } from "jsr:@std/assert";
import { decodeHex } from "jsr:@std/encoding/hex";
import { DeserializeError, ResourceAdmissionError } from "../../../src/core/errors.ts";
import { b } from "../../../src/index.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { Matter } from "../../../src/primitives/matter.ts";
import { admitJson } from "../../../src/serder/json-admission.ts";
import { parseSerder, Serder, SerderACDC, SerderKERI, sizeify } from "../../../src/serder/serder.ts";
import { reapSerder } from "../../../src/serder/serdery.ts";
import { smell, versify } from "../../../src/serder/smell.ts";
import { CtrDexV2 } from "../../../src/tables/counter-codex.ts";
import { Vrsn_2_0 } from "../../../src/tables/versions.ts";
import { counterV2, groupV2, sigerToken, token } from "../../fixtures/counter-token-fixtures.ts";
import issueeVectors from "../../fixtures/issuee-vectors.json" with { type: "json" };
import { KERIPY_STRUCTOR_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { KERIPY_STRUCTING_DATA_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { v2ify } from "../../fixtures/versioned-body-fixtures.ts";

/** Stamp the fixture with an ACDC v1 version string and its final byte length. */
function v1ifyAcdc(raw: string): string {
  const size = b(raw).length;
  const sizeHex = size.toString(16).padStart(6, "0");
  return raw.replace("ACDC10JSON000000_", `ACDC10JSON${sizeHex}_`);
}

Deno.test("serder: parseSerder hydrates SerderKERI for KERI payloads", () => {
  const body = v2ify("{\"v\":\"KERI20JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"}");
  const raw = b(body);
  const { smellage } = smell(raw);

  const serder = parseSerder(raw, smellage);
  assertEquals(serder instanceof SerderKERI, true);
  assertEquals(serder instanceof Serder, true);
  assertEquals(serder.proto, "KERI");
  assertEquals(serder.ilk, "icp");
  assertEquals(serder.said, "Eabc");
});

Deno.test("serder: parseSerder hydrates SerderACDC for ACDC payloads", () => {
  const body = v1ifyAcdc("{\"v\":\"ACDC10JSON000000_\",\"d\":\"Eacdcsaid\",\"a\":{}}");
  const raw = b(body);
  const { smellage } = smell(raw);

  const serder = parseSerder(raw, smellage);
  assertEquals(serder instanceof SerderACDC, true);
  assertEquals(serder instanceof Serder, true);
  assertEquals(serder.proto, "ACDC");
  assertEquals(serder.said, "Eacdcsaid");
});

Deno.test("serder: subtype constructors reject wrong protocol domains", () => {
  const raw = b("{\"v\":\"KERI20JSON000000_\",\"d\":\"Eabc\"}");
  const smellage = {
    proto: "ACDC" as const,
    kind: "JSON" as const,
    pvrsn: { major: 2, minor: 0 } as const,
    gvrsn: { major: 2, minor: 0 } as const,
    size: raw.length,
  };
  assertThrows(
    () =>
      new SerderKERI({
        raw,
        smellage,
        ked: { v: "ACDC20JSON000000_", d: "Eabc" },
        ilk: null,
        said: "Eabc",
      }),
    DeserializeError,
  );
  assertThrows(
    () =>
      new SerderACDC({
        raw,
        smellage: { ...smellage, proto: "KERI" },
        ked: { v: "KERI20JSON000000_", d: "Eabc", t: "icp" },
        ilk: "icp",
        said: "Eabc",
      }),
    DeserializeError,
  );
});

Deno.test("serder: structor projection classifies attachment families", async () => {
  const body = v2ify("{\"v\":\"KERI20JSON000000_\",\"t\":\"ixn\",\"d\":\"Eabc\"}");
  const genericPayload = `${token("B")}${token("E")}`;
  const generic = `${counterV2(CtrDexV2.GenericListGroup, genericPayload.length / 4)}${genericPayload}`;
  const sealer = groupV2(CtrDexV2.SealSourceCouples, `${token("0A")}${token("E")}`);
  const blinder = groupV2(CtrDexV2.BlindedStateQuadruples, KERIPY_STRUCTOR_VECTORS.blinderBlindStatePayload);
  const mediar = groupV2(CtrDexV2.TypedMediaQuadruples, KERIPY_STRUCTOR_VECTORS.mediarTypedMediaPayload);
  const stream = `${body}${generic}${sealer}${blinder}${mediar}`;

  const frames = await parseBytes(b(stream));
  assertEquals(frames.length, 1);
  const frame = frames[0];

  assertEquals(frame.body instanceof SerderKERI, true);
  const serder = frame.body as SerderKERI;
  const projection = serder.projectStructors(frame);

  assertEquals(projection.generic.length, 1);
  assertEquals(projection.generic[0].qb64g, generic);
  assertEquals(projection.sealer.length, 1);
  assertEquals(projection.blinder.length, 1);
  assertEquals(projection.mediar.length, 1);
});

Deno.test("serder: projection traverses nested wrapper groups and preserves other families", async () => {
  const body = v2ify("{\"v\":\"KERI20JSON000000_\",\"t\":\"ixn\",\"d\":\"Eabc\"}");
  const sealerPayload = KERIPY_STRUCTOR_VECTORS.sealerTypedDigestPayload;
  const nestedSealer = groupV2(CtrDexV2.TypedDigestSealCouples, sealerPayload);
  const nestedControllerSigs = groupV2(CtrDexV2.ControllerIdxSigs, sigerToken());
  const wrapperPayload = `${nestedSealer}${nestedControllerSigs}`;
  const wrapper = `${counterV2(CtrDexV2.AttachmentGroup, wrapperPayload.length / 4)}${wrapperPayload}`;
  const stream = `${body}${wrapper}`;

  const frames = await parseBytes(b(stream));
  assertEquals(frames.length, 1);
  const frame = frames[0];

  assertEquals(frame.body instanceof SerderKERI, true);
  const serder = frame.body as SerderKERI;
  const projection = serder.projectStructors(frame);
  const otherCodes = new Set(projection.other.map((group) => group.code));

  assertEquals(projection.sealer.length, 1);
  // The progressive parser consumes the structural enclosure and retains its leaves.
  assertEquals(otherCodes.has(CtrDexV2.AttachmentGroup), false);
  assertEquals(otherCodes.has(CtrDexV2.ControllerIdxSigs), true);
});

Deno.test("serder: parseSerder wraps malformed JSON decode failures", () => {
  const bad = v2ify("{\"v\":\"KERI20JSON000000_\",\"t\":\"icp\",\"d\":\"Eabc\"");
  const raw = b(bad);
  const { smellage } = smell(raw);
  assertThrows(() => parseSerder(raw, smellage), DeserializeError);
});

Deno.test("serder: SerderKERI makify returns saidified inception serder", () => {
  const key = "BCdY2Fdr0d4hX4T8sE-MN1lt4oBpl0mD1M2bK8M5j9mA";
  const nxt = "EJxJ1GB8oGD4JAH7YpiMCSWKDV3ulpt37zg9vq1QnOh_";

  const serder = new SerderKERI({
    sad: {
      t: "icp",
      i: "",
      kt: "1",
      k: [key],
      nt: "1",
      n: [nxt],
      bt: "0",
      b: [],
      c: [],
      a: [],
    },
    makify: true,
    saids: {
      d: "E",
      i: "E",
    },
  });

  assertEquals(serder.verify(), true);
  assertEquals(serder.pre, serder.said);
  assertEquals(serder.keys, [key]);
  assertEquals(serder.ndigs, [nxt]);
  assertEquals(serder.estive, true);
});

Deno.test("serder: SerderKERI preserves non-digestive i code from existing prefix", () => {
  const key = "BCdY2Fdr0d4hX4T8sE-MN1lt4oBpl0mD1M2bK8M5j9mA";

  const serder = new SerderKERI({
    sad: {
      t: "icp",
      i: key,
      kt: "1",
      k: [key],
      nt: "0",
      n: [],
      bt: "0",
      b: [],
      c: [],
      a: [],
    },
    makify: true,
  });

  assertEquals(serder.pre, key);
  assertEquals(new Matter({ qb64: serder.pre ?? "" }).code, "B");
  assertEquals(serder.verify(), true);
});

Deno.test("serder: SerderKERI exposes KERIpy-style numeric, threshold, and backer wrapper accessors", () => {
  // This is the accessor parity test for the KERI subtype: the semantic hex
  // strings stay available, but the wrapper projections should also exist for
  // maintainers who want the same object-level surface KERIpy exposes.
  const key = "BCdY2Fdr0d4hX4T8sE-MN1lt4oBpl0mD1M2bK8M5j9mA";
  const nxt = "EJxJ1GB8oGD4JAH7YpiMCSWKDV3ulpt37zg9vq1QnOh_";
  const backer = "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx";

  const serder = new SerderKERI({
    sad: {
      v: versify({
        proto: "KERI",
        pvrsn: Vrsn_2_0,
        gvrsn: Vrsn_2_0,
        kind: "JSON",
        size: 0,
      }),
      t: "icp",
      d: "",
      i: "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN",
      s: "a",
      kt: "1",
      k: [key],
      nt: "1",
      n: [nxt],
      bt: "1",
      b: [backer],
      c: [],
      a: [],
    },
    pvrsn: Vrsn_2_0,
    gvrsn: Vrsn_2_0,
    kind: "JSON",
    makify: true,
  });

  assertEquals(serder.sner?.numh, "a");
  assertEquals(serder.sn, 10);
  assertEquals(serder.snh, "a");
  const leading = new SerderKERI({ sad: { ...serder.sad, s: "000A" }, makify: true });
  assertEquals([leading.sner?.numh, leading.snh, leading.sn], ["a", "a", 10]);
  assertEquals(serder.tholder?.sith, "1");
  assertEquals(serder.ntholder?.sith, "1");
  assertEquals(serder.bner?.numh, "1");
  assertEquals(serder.bn, 1);
  assertEquals(serder.berfers.map((verfer) => verfer.qb64), [backer]);
  assertEquals(serder.genus, "-_AAA");
  assertEquals(serder.mucodes.FixBodyGroup, CtrDexV2.FixBodyGroup);
  assertEquals([serder.uuid, serder.nonce], [null, null], "inception next-key digests are not a nonce");
  const nonce = "0AAxyHwW6htOZ_rANOaZb2N2";
  const legacy = new SerderKERI({ sad: { t: "vcp", ii: key, n: nonce }, makify: true });
  const reopened = new SerderKERI({ raw: legacy.raw });
  assertEquals([legacy.uuid, legacy.nonce, reopened.uuid, reopened.nonce], [nonce, nonce, nonce, nonce]);
  // Unchecked hydration can supply both fields; the reference prefers even an empty u.
  const hydrated = new SerderKERI({
    raw: legacy.raw,
    smellage: smell(legacy.raw).smellage,
    ked: { ...legacy.sad, u: "", s: 9 },
    ilk: legacy.ilk,
    said: legacy.said,
  });
  assertEquals([hydrated.uuid, hydrated.nonce], ["", ""]);
  assertEquals([hydrated.sner, hydrated.snh, hydrated.sn], [null, null, null], "non-string sequence stays absent");
  const current = new SerderKERI({
    sad: { t: "xip", i: key, u: nonce },
    pvrsn: Vrsn_2_0,
    gvrsn: Vrsn_2_0,
    makify: true,
  });
  assertEquals([current.uuid, current.nonce], [nonce, nonce], "current u and its alias retain the same value");
  assertEquals([current.sner, current.snh, current.sn], [null, null, null], "missing sequence remains absent");
});

Deno.test("serder: SerderKERI hydrates weighted threshold accessors from semantic arrays", () => {
  const keyA = "DHGF1NUOc-vwViJHL5vQ4pwJK2a41rRonZ4kJlMUZ-xF";
  const keyB = "DFtTn4J6D8SIe8TXtEX12ce06obMjWaV-jncEV1Goypd";
  const nxtA = "EGKa8UzUyVkfZmNi3bRwFm0lB8KJwYahjKwcMEbLNcq0";
  const nxtB = "EJzwX8-rUGej2owHHc9P3-ELUjl-oHkFPQo4bHLLllId";
  const nested = [{ "1": ["1/2", "1/2"] }];

  const serder = new SerderKERI({
    sad: {
      t: "icp",
      i: "",
      kt: ["1/2", "1/2"],
      k: [keyA, keyB],
      nt: nested,
      n: [nxtA, nxtB],
      bt: "0",
      b: [],
      c: [],
      a: [],
    },
    makify: true,
    saids: {
      d: "E",
      i: "E",
    },
  });

  assertEquals(serder.verify(), true);
  assertEquals(serder.tholder?.weighted, true);
  assertEquals(serder.tholder?.sith, ["1/2", "1/2"]);
  assertEquals(serder.ntholder?.weighted, true);
  assertEquals(serder.ntholder?.sith, nested);
});

Deno.test("serder: SerderKERI exposes raw `a` separately from list-only `seals`", () => {
  const cid = "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx";

  const serder = new SerderKERI({
    sad: {
      v: versify({
        proto: "KERI",
        pvrsn: Vrsn_2_0,
        gvrsn: Vrsn_2_0,
        kind: "JSON",
        size: 0,
      }),
      t: "rpy",
      d: "",
      i: cid,
      dt: "2026-03-17T12:34:56.000000+00:00",
      r: "introduce",
      a: { cid },
    },
    pvrsn: Vrsn_2_0,
    gvrsn: Vrsn_2_0,
    kind: "JSON",
    makify: true,
  });

  assertEquals(serder.a, { cid });
  assertEquals(serder.seals, []);
});

Deno.test("serder: SerderKERI keeps raw seals but offers typed seal projections", () => {
  const pre = KERIPY_STRUCTING_DATA_VECTORS.sealEvent.i;
  const said = "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN";

  const serder = new SerderKERI({
    sad: {
      t: "ixn",
      d: "",
      i: pre,
      s: "1",
      p: said,
      a: [
        { i: pre, s: "0", d: said },
        { s: "0", d: said },
      ],
    },
    makify: true,
  });

  assertEquals(serder.seals, [
    { i: pre, s: "0", d: said },
    { s: "0", d: said },
  ]);
  assertEquals(serder.sealRecords.length, 2);
  assertEquals(serder.eventSeals.length, 1);
  assertEquals(serder.eventSeals[0].i.qb64, pre);
  assertEquals(serder.eventSeals[0].s.numh, "0");
  assertEquals(serder.eventSeals[0].d.qb64, said);
});

Deno.test("serder: SerderKERI typed seal projections reject malformed seal entries", () => {
  const pre = KERIPY_STRUCTING_DATA_VECTORS.sealEvent.i;
  const said = "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN";
  const serder = new SerderKERI({
    sad: {
      t: "ixn",
      d: "",
      i: pre,
      s: "1",
      p: said,
      a: [{ nope: true }],
    },
    makify: true,
  });

  assertThrows(() => serder.sealRecords, DeserializeError);
  assertThrows(() => serder.eventSeals, DeserializeError);
});

Deno.test("serder: SerderKERI rejects raw seal payloads on non-transferable inception before typed projection", () => {
  const key = "BCdY2Fdr0d4hX4T8sE-MN1lt4oBpl0mD1M2bK8M5j9mA";

  assertThrows(
    () =>
      new SerderKERI({
        sad: {
          t: "icp",
          i: key,
          kt: "1",
          k: [key],
          nt: "0",
          n: [],
          bt: "0",
          b: [],
          c: [],
          // Boundary rule: this is rejected structurally because the raw `a`
          // list is non-empty, even though the entry is not a valid seal dict.
          a: [{ malformed: "seal" }],
        },
        makify: true,
      }),
    DeserializeError,
  );
});

Deno.test("serder: SerderKERI normalizes deprecated intive bt inputs for both sad and raw paths", () => {
  const key = "BCdY2Fdr0d4hX4T8sE-MN1lt4oBpl0mD1M2bK8M5j9mA";
  const nxt = "EJxJ1GB8oGD4JAH7YpiMCSWKDV3ulpt37zg9vq1QnOh_";
  const backer = "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx";

  const fromSad = new SerderKERI({
    sad: {
      v: versify({
        proto: "KERI",
        pvrsn: Vrsn_2_0,
        gvrsn: Vrsn_2_0,
        kind: "JSON",
        size: 0,
      }),
      t: "icp",
      d: "",
      i: "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN",
      s: "a",
      kt: "1",
      k: [key],
      nt: "1",
      n: [nxt],
      bt: 1,
      b: [backer],
      c: [],
      a: [],
    },
    pvrsn: Vrsn_2_0,
    gvrsn: Vrsn_2_0,
    kind: "JSON",
    makify: true,
  });
  const fromRaw = new SerderKERI({ raw: fromSad.raw });

  assertEquals(fromSad.ked?.bt, 1);
  assertEquals(fromSad.bner?.numh, "1");
  assertEquals(fromSad.bn, 1);
  assertEquals(fromRaw.ked?.bt, 1);
  assertEquals(fromRaw.bner?.numh, "1");
  assertEquals(fromRaw.bn, 1);
});

Deno.test("serder: SerderKERI rejects invalid non-transferable inception state", () => {
  const key = "BCdY2Fdr0d4hX4T8sE-MN1lt4oBpl0mD1M2bK8M5j9mA";

  assertThrows(
    () =>
      new SerderKERI({
        sad: {
          t: "icp",
          i: key,
          kt: "1",
          k: [key],
          nt: "1",
          n: ["EJxJ1GB8oGD4JAH7YpiMCSWKDV3ulpt37zg9vq1QnOh_"],
          bt: "0",
          b: [],
          c: [],
          a: [],
        },
        makify: true,
      }),
    DeserializeError,
  );
});

Deno.test("serder: SerderACDC can preserve expanded v2 sections while computing the compact-form top-level SAID", () => {
  // This is the key ACDC v2 compactification rule from KERIpy: the visible sad
  // can remain expanded, while the top-level `d` is still the digest of the
  // most compact variant.
  const issuer = "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx";
  const regid = "EFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2";
  const template = {
    v: versify({
      proto: "ACDC",
      pvrsn: Vrsn_2_0,
      gvrsn: Vrsn_2_0,
      kind: "JSON",
      size: 0,
    }),
    t: "acm",
    d: "",
    u: "",
    i: issuer,
    rd: regid,
    s: { d: "", title: "schema" },
    a: { d: "", i: issuer, role: "holder" },
    e: { d: "", link: regid },
    r: { d: "", usage: "test" },
  };

  const expanded = new SerderACDC({
    sad: template,
    pvrsn: Vrsn_2_0,
    gvrsn: Vrsn_2_0,
    kind: "JSON",
    makify: true,
    compactify: false,
  });
  const compacted = new SerderACDC({
    sad: template,
    pvrsn: Vrsn_2_0,
    gvrsn: Vrsn_2_0,
    kind: "JSON",
    makify: true,
    compactify: true,
  });

  assertEquals(expanded.verify(), true);
  assertEquals(compacted.verify(), true);
  // Same top-level SAID, different caller-visible section representation.
  assertEquals(expanded.said, compacted.said);
  assertEquals(typeof expanded.schema, "object");
  assertEquals(typeof expanded.attrib, "object");
  assertEquals(typeof compacted.schema, "string");
  assertEquals(typeof compacted.attrib, "string");
});

Deno.test("serder: SerderACDC rejects expanded-section tampering when top-level d is left stale", () => {
  // This is the inverse of the previous test: if a maintainer changes expanded
  // section content but leaves top-level `d` alone, verification must fail
  // because `d` commits to the compact form of those sections.
  const issuer = "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx";
  const regid = "EFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2";
  const serder = new SerderACDC({
    sad: {
      v: versify({
        proto: "ACDC",
        pvrsn: Vrsn_2_0,
        gvrsn: Vrsn_2_0,
        kind: "JSON",
        size: 0,
      }),
      t: "acm",
      d: "",
      u: "",
      i: issuer,
      rd: regid,
      s: { d: "", title: "schema" },
      a: { d: "", i: issuer, role: "holder" },
      e: { d: "", link: regid },
      r: { d: "", usage: "test" },
    },
    pvrsn: Vrsn_2_0,
    gvrsn: Vrsn_2_0,
    kind: "JSON",
    makify: true,
    compactify: false,
  });

  const tampered = serder.sad ?? {};
  ((tampered.a as Record<string, unknown>).role) = "tampered";
  const { raw } = sizeify(tampered, "JSON");

  assertThrows(
    () => new SerderACDC({ raw, verify: true }),
    DeserializeError,
  );
});

Deno.test("serder: SerderACDC partial schema sections compute and verify $id while leaving the visible section expanded", () => {
  // Partial section ilks are not top-level compactable, but they still have
  // embedded section identifier rules. For `sch`, that identifier is `$id`.
  const serder = new SerderACDC({
    sad: {
      v: versify({
        proto: "ACDC",
        pvrsn: Vrsn_2_0,
        gvrsn: Vrsn_2_0,
        kind: "JSON",
        size: 0,
      }),
      t: "sch",
      d: "",
      s: { title: "schema" },
    },
    pvrsn: Vrsn_2_0,
    gvrsn: Vrsn_2_0,
    kind: "JSON",
    makify: true,
  });

  assertEquals(serder.verify(), true);
  assertEquals(typeof serder.schema, "object");
  assertEquals(typeof (serder.schema as Record<string, unknown>).$id, "string");
});

Deno.test("serder: ACDC issuee follows disclosed attributes or aggregate members", () => {
  for (const row of issueeVectors.rows) {
    // Checked wire hydration keeps compacted commitments from becoming fake recipients.
    const credential = new SerderACDC({ raw: decodeHex(row.raw) });
    assertEquals(credential.issuee, row.issuee, row.name);
    assertEquals(credential.issueeb, row.issuee === null ? null : b(row.issuee), row.name);
  }
});

Deno.test("serder: stale explicit schema claims cannot enter verification fallback", () => {
  for (const kind of ["JSON", "CBOR", "MGPK", "CESR"] as const) {
    const options = { kind, pvrsn: Vrsn_2_0, gvrsn: Vrsn_2_0 };
    const valid = new SerderACDC({
      ...options,
      sad: { t: "acm", u: "", i: KERIPY_STRUCTING_DATA_VECTORS.sealEvent.i, s: { $id: "", title: "schema" } },
      makify: true,
    });
    const changed = structuredClone(valid.sad!);
    (changed.s as Record<string, unknown>).$id = token("E");
    assertThrows(() => new SerderACDC({ ...options, sad: changed }), DeserializeError, "schema section commitment");
    const { raw } = sizeify(changed, kind);
    assertThrows(() => new SerderACDC({ raw }), DeserializeError, "schema section commitment");
    assertEquals(new SerderACDC({ ...options, sad: changed, verify: false }).verify(), false);
    assertEquals(new SerderACDC({ ...options, sad: changed, makify: true }).schema, valid.schema);
  }
});

Deno.test("JSON admission counts lexical containers, references, fields, scalars and UTF-16 upper bounds", () => {
  const raw = b("{\"a\":[0,\"é\",{},true,null],\"a\":\"\\u0041\"}");
  const charges: number[] = [];
  const budget = { decodedBytes: 428, admitStage: (bytes: number) => charges.push(bytes) };
  admitJson(raw, budget);
  assertEquals(charges, [64 + 2 * raw.length, 428]);
  assertEquals(budget.decodedBytes, 0);
  assertEquals(JSON.parse(new TextDecoder().decode(raw)), { a: "A" }); // Duplicate keys and escapes keep native semantics.
});

Deno.test("admitted JSON reuses only stable independent exact backing and admits before suffix copies", () => {
  const raw = b(v2ify("{\"v\":\"KERI20JSON000000_\",\"a\":\"\\\"[]{}:é\"}"));
  const budget = () => ({ decodedBytes: 10000 });
  assertEquals(reapSerder(raw, budget()).serder.raw === raw, true);
  assertEquals(reapSerder(raw).serder.raw === raw, false, "standalone reap retains its copy contract");
  const oversized = new Uint8Array(raw.length + 1);
  oversized.set(raw);
  const view = oversized.subarray(0, raw.length);
  const copied = reapSerder(view, budget()).serder;
  assertEquals(copied.raw === view, false);
  assertEquals(copied.raw.buffer.byteLength, raw.length);
  assertEquals(copied.ked, JSON.parse(new TextDecoder().decode(raw)));
  const resizable = new Uint8Array(new ArrayBuffer(raw.length, { maxByteLength: raw.length + 1 }));
  resizable.set(raw);
  assertEquals(reapSerder(resizable, budget()).serder.raw === resizable, false);
  const shared = new Uint8Array(new SharedArrayBuffer(raw.length));
  shared.set(raw);
  assertEquals(reapSerder(shared, budget()).serder.raw === shared, false);
  const refusal = new ResourceAdmissionError("copy refused", "busy");
  let slices = 0;
  const slice = view.slice.bind(view);
  view.slice = (start, end) => {
    if (end === 256) return slice(start, end); // Existing bounded version-header probe.
    slices++;
    throw new Error("body copy must not precede admission");
  };
  assertEquals(
    assertThrows(() =>
      reapSerder(view, {
        decodedBytes: 10000,
        admitStage: () => {
          throw refusal;
        },
      })
    ),
    refusal,
  );
  assertEquals(slices, 0);
});
