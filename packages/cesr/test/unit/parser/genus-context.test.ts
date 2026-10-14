import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";
import { concatBytes, decodeB64 } from "../../../src/core/bytes.ts";
import { VersionError } from "../../../src/core/errors.ts";
import { parseBytes } from "../../../src/parser/complete.ts";
import { parse } from "../../../src/parser/progressive.ts";
import { Counter } from "../../../src/primitives/counter.ts";
import { Texter } from "../../../src/primitives/texter.ts";
import { versify } from "../../../src/serder/smell.ts";
import { counterV1, groupV2, sigerToken } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY as native } from "../../fixtures/external-vectors.ts";
import { encode } from "../../fixtures/stream-byte-fixtures.ts";

/** Supported genera, selected independently from the body's protocol version. */
const v1 = { major: 1, minor: 0 } as const;
/** Selected genus v2 for context-boundary fixtures. */
const v2 = { major: 2, minor: 0 } as const;
/** Encode an explicit stream selector, including both minor-version sextets. */
const gvc = (major: 1 | 2) => new TextDecoder().decode(Counter.makeGVC({ major, minor: 0 }));

/** Minimal aligned JSON body, keeping protocol and genus metadata separate. */
function body(major: 1 | 2): string {
  /** Recompute the body size without changing the selected version. */
  const version = (size: number) => versify({ pvrsn: major === 1 ? v1 : v2, gvrsn: major === 1 ? null : v2, size });
  let raw = JSON.stringify({ v: version(0), t: "rpy", d: "Eabc" });
  // Modular wraparound adds zero to three spaces, preserving aligned input unchanged.
  raw += " ".repeat((4 - raw.length % 4) % 4);
  return raw.replace(version(0), version(raw.length));
}

/** Parallel bodies and signature leaves expose protocol/genus confusion. */
const json1 = body(1);
/** A v2 JSON body whose implicit genus is exercised below. */
const json2 = body(2);
/** One v1 item-counted indexed signature. */
const sig1 = counterV1("-A", 1) + sigerToken();
/** One v2 byte-counted indexed signature. */
const sig2 = groupV2("-K", sigerToken());
/** Qualify a non-native body inside a v2 payload-counted wrapper. */
const nonNative = (raw: string) => groupV2("-H", new Texter({ raw: encode(raw), code: "4B" }).qb64);

/** Supply exactly the requested chunks to the progressive engine. */
async function* chunks(...parts: Uint8Array[]) {
  yield* parts;
}

Deno.test("explicit genus persists across v1 bodies, chunks and following messages", async () => {
  for (const binary of [false, true]) {
    const cesr = binary ? decodeB64 : encode;
    const wire = concatBytes(cesr(gvc(2)), encode(json1), cesr(sig2), encode(json1), cesr(sig2));
    const expected = await parseBytes(wire);
    assertEquals(expected.length, 2);
    for (const frame of expected) {
      assertEquals(frame.body.pvrsn, v1);
      assertEquals(frame.body.gvrsn, null);
      assertEquals(frame.attachments.map((g) => [g.name, g.code, g.count, g.items.length]), [[
        "ControllerIdxSigs",
        "-K",
        22,
        1,
      ]]);
    }
    const edge = cesr(gvc(2)).length;
    assertEquals(
      await Array.fromAsync(parse(chunks(wire.slice(0, edge), new Uint8Array(), wire.slice(edge)))),
      expected,
    );
    // One-byte production splits every selector and primitive header in both domains.
    assertEquals(await Array.fromAsync(parse(chunks(...Array.from(wire, (byte) => Uint8Array.of(byte))))), expected);
  }
});

Deno.test("enclosed genus is inherited, inner selectors stay local, and ordered siblings retain their context", async () => {
  const inner = gvc(1) + json1 + sig1 + json1 + sig1;
  const wire = gvc(2) + groupV2("-A", json1 + sig2 + groupV2("-A", inner) + json1 + sig2) + json1 + sig2;
  const frames = await parseBytes(encode(wire));
  assertEquals(frames.map((frame) => frame.attachments[0].code), ["-K", "-A", "-A", "-K", "-K"]);

  // Both body wrappers preserve the outer genus despite a v1 protocol body.
  for (const wrapped of [groupV2("-B", json1 + sig2), nonNative(json1) + sig2]) {
    const frames = await parseBytes(encode(gvc(2) + wrapped + json1 + sig2));
    assertEquals(frames.length, 2);
    for (const frame of frames) {
      assertEquals(frame.body.pvrsn, v1);
      assertEquals(frame.attachments[0].code, "-K");
    }
  }
  for (const cesr of [encode, decodeB64]) {
    const frames = await parseBytes(cesr(gvc(2) + native + groupV2("-C", gvc(1) + sig1) + native + sig2));
    // The attachment enclosure owns its local selector but leaves only semantic leaves.
    assertEquals(frames.map((frame) => frame.attachments[0].code), ["-A", "-K"]);
  }
});

Deno.test("explicit genus cannot be replaced by body metadata or alternate-major counter probing", async () => {
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
    await assertRejects(() => parseBytes(encode(gvc(1) + counterV1("-W", payload.length / 4) + payload)), VersionError);
  }
  for (const wire of incompatible) await assertRejects(() => parseBytes(encode(wire)));
  for (const suffix of ["DAA", "CAB", "CBA"]) {
    for (const cesr of [encode, decodeB64]) {
      for (const wrapped of [false, true]) {
        const selector = "-_AAA" + suffix;
        const wire = wrapped ? native + groupV2("-C", selector + sig2) : selector + native;
        const error = await assertRejects(() => parseBytes(cesr(wire)), VersionError);
        assertStringIncludes(error.message, suffix === "DAA" ? "major version 3" : suffix === "CAB" ? "2.1" : "2.64");
      }
    }
  }
});

Deno.test("independent parse invocations start with fresh genus inference after success or failure", async () => {
  await parseBytes(encode(gvc(2) + json1));
  const frames = await parseBytes(encode(json1 + sig1 + json2 + sig2));
  assertEquals(frames.map((frame) => frame.attachments[0].code), ["-A", "-K"]);
  await assertRejects(() => parseBytes(encode(gvc(1) + json2)), VersionError);
  assertEquals((await parseBytes(encode(json2 + sig2)))[0].attachments[0].code, "-K");
});
