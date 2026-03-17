import { assertEquals, assertThrows } from "jsr:@std/assert";
import { DeserializeError } from "../../src/core/errors.ts";
import { createParser } from "../../src/core/parser-engine.ts";
import { b } from "../../src/index.ts";
import { Matter } from "../../src/primitives/matter.ts";
import {
  parseSerder,
  Serder,
  SerderACDC,
  SerderKERI,
  sizeify,
} from "../../src/serder/serder.ts";
import { smell, versify } from "../../src/serder/smell.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { Vrsn_2_0 } from "../../src/tables/versions.ts";
import {
  counterV2,
  sigerToken,
  token,
} from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_STRUCTOR_VECTORS } from "../fixtures/keripy-primitive-vectors.ts";
import { v2ify } from "../fixtures/versioned-body-fixtures.ts";

function v1ifyAcdc(raw: string): string {
  const size = b(raw).length;
  const sizeHex = size.toString(16).padStart(6, "0");
  return raw.replace("ACDC10JSON000000_", `ACDC10JSON${sizeHex}_`);
}

Deno.test("serder: parseSerder hydrates SerderKERI for KERI payloads", () => {
  const body = v2ify('{"v":"KERI20JSON000000_","t":"icp","d":"Eabc"}');
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
  const body = v1ifyAcdc('{"v":"ACDC10JSON000000_","d":"Eacdcsaid","a":{}}');
  const raw = b(body);
  const { smellage } = smell(raw);

  const serder = parseSerder(raw, smellage);
  assertEquals(serder instanceof SerderACDC, true);
  assertEquals(serder instanceof Serder, true);
  assertEquals(serder.proto, "ACDC");
  assertEquals(serder.said, "Eacdcsaid");
});

Deno.test("serder: subtype constructors reject wrong protocol domains", () => {
  const raw = b('{"v":"KERI20JSON000000_","d":"Eabc"}');
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

Deno.test("serder: structor projection classifies attachment families", () => {
  const body = v2ify('{"v":"KERI20JSON000000_","t":"ixn","d":"Eabc"}');
  const aggorPayload = `${token("B")}${token("E")}`;
  const aggor = `${
    counterV2(CtrDexV2.GenericListGroup, aggorPayload.length / 4)
  }${aggorPayload}`;
  const sealer = `${counterV2(CtrDexV2.SealSourceCouples, 1)}${token("B")}${
    token("E")
  }`;
  const blinder = `${counterV2(CtrDexV2.BlindedStateQuadruples, 1)}${
    token("B")
  }${token("E")}${token("D")}${token("M")}`;
  const mediar = `${counterV2(CtrDexV2.TypedMediaQuadruples, 1)}${token("B")}${
    token("E")
  }${token("D")}${token("M")}`;
  const stream = `${body}${aggor}${sealer}${blinder}${mediar}`;

  const parser = createParser();
  const events = [
    ...parser.feed(b(stream)),
    ...parser.flush(),
  ];
  const frame = events.find((event) => event.type === "frame");
  if (!frame || frame.type !== "frame") {
    throw new Error("expected one parsed frame");
  }

  assertEquals(frame.frame.body instanceof SerderKERI, true);
  const serder = frame.frame.body as SerderKERI;
  const projection = serder.projectStructors(frame.frame);

  assertEquals(projection.aggor.length, 1);
  assertEquals(projection.sealer.length, 1);
  assertEquals(projection.blinder.length, 1);
  assertEquals(projection.mediar.length, 1);
});

Deno.test("serder: projection traverses nested wrapper groups and preserves other families", () => {
  const body = v2ify('{"v":"KERI20JSON000000_","t":"ixn","d":"Eabc"}');
  const sealerPayload = KERIPY_STRUCTOR_VECTORS.sealerTypedDigestPayload;
  const nestedSealer = `${
    counterV2(CtrDexV2.TypedDigestSealCouples, 1)
  }${sealerPayload}`;
  const nestedControllerSigs = `${
    counterV2(CtrDexV2.ControllerIdxSigs, 1)
  }${sigerToken()}`;
  const wrapperPayload = `${nestedSealer}${nestedControllerSigs}`;
  const wrapper = `${
    counterV2(CtrDexV2.AttachmentGroup, wrapperPayload.length / 4)
  }${wrapperPayload}`;
  const stream = `${body}${wrapper}`;

  const parser = createParser();
  const events = [
    ...parser.feed(b(stream)),
    ...parser.flush(),
  ];
  const frame = events.find((event) => event.type === "frame");
  if (!frame || frame.type !== "frame") {
    throw new Error("expected one parsed frame");
  }

  assertEquals(frame.frame.body instanceof SerderKERI, true);
  const serder = frame.frame.body as SerderKERI;
  const projection = serder.projectStructors(frame.frame);
  const otherCodes = new Set(projection.other.map((group) => group.code));

  assertEquals(projection.sealer.length, 1);
  assertEquals(otherCodes.has(CtrDexV2.AttachmentGroup), true);
  assertEquals(otherCodes.has(CtrDexV2.ControllerIdxSigs), true);
});

Deno.test("serder: parseSerder wraps malformed JSON decode failures", () => {
  const bad = v2ify('{"v":"KERI20JSON000000_","t":"icp","d":"Eabc"');
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
  assertEquals(serder.tholder?.sith, "1");
  assertEquals(serder.ntholder?.sith, "1");
  assertEquals(serder.bner?.numh, "1");
  assertEquals(serder.bn, 1);
  assertEquals(serder.berfers.map((verfer) => verfer.qb64), [backer]);
  assertEquals(serder.genus, "-_AAA");
  assertEquals(serder.mucodes.FixBodyGroup, CtrDexV2.FixBodyGroup);
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

Deno.test("serder: SerderACDC can preserve expanded sections while computing the compact-form top-level SAID", () => {
  // This is the key ACDC compactification rule from KERIpy: the visible sad can
  // remain expanded, while the top-level `d` is still the digest of the most
  // compact variant.
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
