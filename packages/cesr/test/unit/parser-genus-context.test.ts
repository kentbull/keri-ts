import { assertEquals, assertInstanceOf, assertStringIncludes } from "jsr:@std/assert";
import { concatBytes, decodeB64 } from "../../src/core/bytes.ts";
import { VersionError } from "../../src/core/errors.ts";
import { createParser, parseBytes } from "../../src/parser/stream.ts";
import { Counter, CounterGroup } from "../../src/primitives/counter.ts";
import { Texter } from "../../src/primitives/texter.ts";
import { versify } from "../../src/serder/smell.ts";
import { counterV1, groupV2, sigerToken } from "../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY as native } from "../fixtures/external-vectors.ts";
import { encode } from "../fixtures/stream-byte-fixtures.ts";

const v1 = { major: 1, minor: 0 } as const;
const v2 = { major: 2, minor: 0 } as const;
const gvc = (major: 1 | 2) => new TextDecoder().decode(Counter.makeGVC({ major, minor: 0 }));

/** Minimal aligned JSON body, keeping protocol and genus metadata separate. */
function body(major: 1 | 2): string {
  const version = (size: number) => versify({ pvrsn: major === 1 ? v1 : v2, gvrsn: major === 1 ? null : v2, size });
  let raw = JSON.stringify({ v: version(0), t: "rpy", d: "Eabc" });
  raw += " ".repeat((4 - raw.length % 4) % 4);
  return raw.replace(version(0), version(raw.length));
}

const json1 = body(1);
const json2 = body(2);
const sig1 = counterV1("-A", 1) + sigerToken();
const sig2 = groupV2("-K", sigerToken());
const nonNative = (raw: string) => groupV2("-H", new Texter({ raw: encode(raw), code: "4B" }).qb64);

Deno.test("explicit genus persists across v1 bodies, chunks and following messages", () => {
  for (const binary of [false, true]) {
    const cesr = binary ? decodeB64 : encode;
    const wire = concatBytes(cesr(gvc(2)), encode(json1), cesr(sig2), encode(json1), cesr(sig2));
    for (const framed of [false, true]) {
      const expected = parseBytes(wire, { framed });
      assertEquals(expected.map((e) => e.type), ["frame", "frame"]);
      for (const event of expected) {
        if (event.type !== "frame") continue;
        assertEquals(event.frame.body.pvrsn, v1);
        assertEquals(event.frame.body.gvrsn, null);
        assertEquals(event.frame.attachments.map((g) => [g.name, g.code, g.count, g.items.length]), [[
          "ControllerIdxSigs",
          "-K",
          22,
          1,
        ]]);
      }
      for (let split = 0; split <= wire.length; split++) {
        const parser = createParser({ framed });
        assertEquals(
          [...parser.feed(wire.slice(0, split)), ...parser.feed(wire.slice(split)), ...parser.flush()],
          expected,
        );
      }
      const parser = createParser({ framed });
      const events = [...wire].flatMap((byte) => parser.feed(Uint8Array.of(byte)));
      assertEquals([...events, ...parser.flush()], expected);
    }
  }
});

Deno.test("enclosed genus is inherited, inner selectors stay local, and ordered siblings retain their context", () => {
  const inner = gvc(1) + json1 + sig1 + json1 + sig1;
  const wire = gvc(2) + groupV2("-A", json1 + sig2 + groupV2("-A", inner) + json1 + sig2) + json1 + sig2;
  const events = parseBytes(encode(wire));
  assertEquals(events.map((e) => e.type), Array(5).fill("frame"));
  assertEquals(events.map((e) => e.type === "frame" ? e.frame.attachments[0].code : "error"), [
    "-K",
    "-A",
    "-A",
    "-K",
    "-K",
  ]);

  // Both body wrappers preserve the outer genus despite a v1 protocol body.
  for (const wrapped of [groupV2("-B", json1 + sig2), nonNative(json1) + sig2]) {
    const events = parseBytes(encode(gvc(2) + wrapped + json1 + sig2));
    assertEquals(events.map((e) => e.type), ["frame", "frame"]);
    for (const event of events) {
      if (event.type === "frame") {
        assertEquals(event.frame.body.pvrsn, v1);
        assertEquals(event.frame.attachments[0].code, "-K");
      }
    }
  }
  for (const cesr of [encode, decodeB64]) {
    const events = parseBytes(cesr(gvc(2) + native + groupV2("-C", gvc(1) + sig1) + native + sig2));
    assertEquals(events.map((e) => e.type), ["frame", "frame"]);
    if (events[0].type === "frame" && events[1].type === "frame") {
      assertInstanceOf(events[0].frame.attachments[0].items[0], CounterGroup);
      assertEquals(events[0].frame.attachments[0].items[0].code, "-A");
      assertEquals(events[1].frame.attachments[0].code, "-K");
    }
  }
});

Deno.test("explicit genus cannot be replaced by body metadata or alternate-major counter probing", () => {
  const incompatible = [
    gvc(1) + json2,
    gvc(1) + native,
    gvc(1) + groupV2("-B", json1 + sig2),
    gvc(2) + json1 + sig1,
    // A v2 body inside a v1 non-native wrapper must not become an opaque success.
    gvc(1) + counterV1("-W", nonNative(json2).slice(4).length / 4) + nonNative(json2).slice(4),
  ];
  for (const raw of [json2, json2.replace("{", "[")]) {
    const payload = new Texter({ raw: encode(raw), code: "4B" }).qb64;
    const events = parseBytes(encode(gvc(1) + counterV1("-W", payload.length / 4) + payload));
    assertEquals(events.map((e) => e.type), ["error"]);
    if (events[0].type === "error") assertInstanceOf(events[0].error, VersionError);
  }
  for (const wire of incompatible) {
    const events = parseBytes(encode(wire));
    assertEquals(events.some((e) => e.type === "error"), true, wire);
  }
  for (const suffix of ["DAA", "CAB", "CBA"]) {
    for (const cesr of [encode, decodeB64]) {
      for (const wrapped of [false, true]) {
        const selector = "-_AAA" + suffix;
        const wire = wrapped ? native + groupV2("-C", selector + sig2) : selector + native;
        const events = parseBytes(cesr(wire));
        assertEquals(events.map((e) => e.type), ["error"]);
        if (events[0].type === "error") {
          assertInstanceOf(events[0].error, VersionError);
          assertStringIncludes(
            events[0].error.message,
            suffix === "DAA" ? "major version 3" : suffix === "CAB" ? "2.1" : "2.64",
          );
        }
      }
    }
  }
});

Deno.test("legacy inference and reset do not retain a prior explicit genus", () => {
  const parser = createParser();
  parser.feed(encode(gvc(2) + json1));
  parser.reset();
  const events = [...parser.feed(encode(json1 + sig1 + json2 + sig2)), ...parser.flush()];
  assertEquals(events.map((e) => e.type), ["frame", "frame"]);
  assertEquals(events.map((e) => e.type === "frame" ? e.frame.attachments[0].code : "error"), ["-A", "-K"]);
  assertEquals(parser.feed(encode(gvc(1) + json2)).map((e) => e.type), ["error"]);
  const recovered = [...parser.feed(encode(json2 + sig2)), ...parser.flush()];
  assertEquals(recovered.map((e) => e.type), ["frame"]);
});
