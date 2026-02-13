import { assertEquals, assertThrows } from "jsr:@std/assert";
import { createParser } from "../../src/core/parser-engine.ts";
import { sniff } from "../../src/parser/cold-start.ts";
import { smell } from "../../src/serder/smell.ts";

function encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function v1ify(raw: string): string {
  const size = new TextEncoder().encode(raw).length;
  const sizeHex = size.toString(16).padStart(6, "0");
  return raw.replace("KERI10JSON000000_", `KERI10JSON${sizeHex}_`);
}

Deno.test("sniff detects message and text counters", () => {
  assertEquals(sniff(encode("{")), "msg");
  assertEquals(sniff(encode("-AAB")), "txt");
});

Deno.test("smell parses v1 version string", () => {
  const raw = v1ify('{"v":"KERI10JSON000000_","t":"icp","d":"Eabc"}');
  const result = smell(encode(raw));
  assertEquals(result.smellage.proto, "KERI");
  assertEquals(result.smellage.kind, "JSON");
  assertEquals(result.smellage.pvrsn.major, 1);
});

Deno.test("parser emits frame with attached material quadlets", () => {
  const body = v1ify('{"v":"KERI10JSON000000_","t":"icp","d":"Eabc"}');
  const ims = `${body}-VABABCD`;

  const parser = createParser();
  const emissions = parser.feed(encode(ims));

  assertEquals(emissions.length, 1);
  assertEquals(emissions[0].type, "frame");
  if (emissions[0].type === "frame") {
    assertEquals(emissions[0].frame.serder.ilk, "icp");
    assertEquals(emissions[0].frame.attachments.length, 1);
    assertEquals(emissions[0].frame.attachments[0].code, "-V");
    assertEquals(emissions[0].frame.attachments[0].count, 1);
  }
});

Deno.test("parser fail-fast on unknown top-level counter", () => {
  const body = v1ify('{"v":"KERI10JSON000000_","t":"icp","d":"Eabc"}');
  const ims = `${body}-AAB`; // invalid as top-level attachment bundle

  const parser = createParser();
  const emissions = parser.feed(encode(ims));
  assertEquals(emissions.length, 1);
  assertEquals(emissions[0].type, "error");
});

Deno.test("parser handles chunked input", () => {
  const body = v1ify('{"v":"KERI10JSON000000_","t":"icp","d":"Eabc"}');
  const ims = `${body}-VABABCD`;
  const parser = createParser();

  const first = parser.feed(encode(ims.slice(0, 10)));
  assertEquals(first.length, 0);
  const second = parser.feed(encode(ims.slice(10)));
  assertEquals(second.length, 1);
  assertEquals(second[0].type, "frame");
});

Deno.test("sniff throws on empty buffer", () => {
  assertThrows(() => sniff(new Uint8Array(0)));
});
