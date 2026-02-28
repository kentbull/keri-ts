import { assertEquals } from "jsr:@std/assert";
import { createParser } from "../../src/core/parser-engine.ts";
import { intToB64 } from "../../src/core/bytes.ts";
import { CtrDexV1 } from "../../src/tables/counter-codex.ts";
import { COUNTER_SIZES_V1 } from "../../src/tables/counter.tables.generated.ts";

function encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function counterV1(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V1.get(code);
  if (!sizage) throw new Error(`Unknown v1 counter code ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
}

function v1OpaqueNonNativeFrame(): string {
  // Legacy v1 stream shape with no leading genus-version selector.
  return `${counterV1(CtrDexV1.NonNativeBodyGroup, 1)}MAAA`;
}

function v1ify(raw: string): string {
  const size = new TextEncoder().encode(raw).length;
  const sizeHex = size.toString(16).padStart(6, "0");
  return raw.replace("KERI10JSON000000_", `KERI10JSON${sizeHex}_`);
}

Deno.test("legacy implicit-v1: top-level v1 NonNativeBodyGroup parses as v1 without genus-version selector", () => {
  const parser = createParser();
  const events = [...parser.feed(encode(v1OpaqueNonNativeFrame())), ...parser.flush()];
  const errors = events.filter((event) => event.type === "error");
  const frames = events.filter((event) => event.type === "frame");

  assertEquals(errors.length, 0);
  assertEquals(frames.length, 1);
  if (frames[0].type === "frame") {
    assertEquals(frames[0].frame.body.kind, "CESR");
    assertEquals(frames[0].frame.body.pvrsn.major, 1);
  }
});

Deno.test("legacy implicit-v1: v1 GenericGroup payload parses enclosed frames without genus-version selector", () => {
  const enclosed = `${v1OpaqueNonNativeFrame()}${v1OpaqueNonNativeFrame()}`;
  const generic = `${counterV1(CtrDexV1.GenericGroup, enclosed.length / 4)}${enclosed}`;
  const parser = createParser();
  const events = [...parser.feed(encode(generic)), ...parser.flush()];
  const errors = events.filter((event) => event.type === "error");
  const frames = events.filter((event) => event.type === "frame");

  assertEquals(errors.length, 0);
  assertEquals(frames.length, 2);
  if (frames[0].type === "frame" && frames[1].type === "frame") {
    assertEquals(frames[0].frame.body.pvrsn.major, 1);
    assertEquals(frames[1].frame.body.pvrsn.major, 1);
  }
});

Deno.test("legacy implicit-v1: full text SerderKERI inception body parses without genus-version selector", () => {
  const said = "EA4fS9yX5wzNf7qvI5hW5eTX8xv7gnVYxM9Dg8SxkS6w";
  const body = v1ify(
    `{"v":"KERI10JSON000000_","t":"icp","d":"${said}","i":"EA4fS9yX5wzNf7qvI5hW5eTX8xv7gnVYxM9Dg8SxkS6w","s":"0","kt":"1","k":["D1I8k4rC5C3mA0Yk8QkFQ-f2rCY6ZB8m7jN8uR7V2m3H"],"nt":"0","n":[],"bt":"0","b":[],"c":[],"a":[]}`,
  );
  const parser = createParser();
  const events = [...parser.feed(encode(body)), ...parser.flush()];
  const errors = events.filter((event) => event.type === "error");
  const frames = events.filter((event) => event.type === "frame");

  assertEquals(errors.length, 0);
  assertEquals(frames.length, 1);
  if (frames[0].type === "frame") {
    assertEquals(frames[0].frame.body.kind, "JSON");
    assertEquals(frames[0].frame.body.ilk, "icp");
    assertEquals(frames[0].frame.body.said, said);
    assertEquals(frames[0].frame.body.pvrsn.major, 1);
    assertEquals(frames[0].frame.body.ked?.t, "icp");
  }
});
