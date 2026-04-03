import { assertEquals } from "jsr:@std/assert";
import { Streamer } from "../../../src/primitives/streamer.ts";

Deno.test("streamer: normalizes string and buffer-view inputs into stream bytes", () => {
  const fromText = new Streamer({ stream: "abc" });
  assertEquals(fromText.stream, new TextEncoder().encode("abc"));

  const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
  const fromView = new Streamer({
    stream: new DataView(bytes.buffer, 1, 2),
  });
  assertEquals(fromView.stream, new Uint8Array([0x01, 0x02]));
});
