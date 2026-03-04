import { assertEquals, assertThrows } from "jsr:@std/assert";
import { DeserializeError } from "../../src/core/errors.ts";
import { createParser } from "../../src/core/parser-engine.ts";
import { smell } from "../../src/serder/smell.ts";
import {
  parseSerder,
  Serder,
  SerderACDC,
  SerderKERI,
} from "../../src/serder/serder.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import {
  counterV2,
  sigerToken,
  token,
} from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_STRUCTOR_VECTORS } from "../fixtures/keripy-primitive-vectors.ts";
import { v2ify } from "../fixtures/versioned-body-fixtures.ts";

function v1ifyAcdc(raw: string): string {
  const size = new TextEncoder().encode(raw).length;
  const sizeHex = size.toString(16).padStart(6, "0");
  return raw.replace("ACDC10JSON000000_", `ACDC10JSON${sizeHex}_`);
}

Deno.test("serder: parseSerder hydrates SerderKERI for KERI payloads", () => {
  const body = v2ify('{"v":"KERI20JSON000000_","t":"icp","d":"Eabc"}');
  const raw = new TextEncoder().encode(body);
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
  const raw = new TextEncoder().encode(body);
  const { smellage } = smell(raw);

  const serder = parseSerder(raw, smellage);
  assertEquals(serder instanceof SerderACDC, true);
  assertEquals(serder instanceof Serder, true);
  assertEquals(serder.proto, "ACDC");
  assertEquals(serder.said, "Eacdcsaid");
});

Deno.test("serder: subtype constructors reject wrong protocol domains", () => {
  const raw = new TextEncoder().encode('{"v":"KERI20JSON000000_","d":"Eabc"}');
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
    ...parser.feed(new TextEncoder().encode(stream)),
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
    ...parser.feed(new TextEncoder().encode(stream)),
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
  const raw = new TextEncoder().encode(bad);
  const { smellage } = smell(raw);
  assertThrows(() => parseSerder(raw, smellage), DeserializeError);
});
