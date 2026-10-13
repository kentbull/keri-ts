import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import { createHash } from "node:crypto";
import { corpus } from "../../../../scripts/bench/cesr-corpus.ts";
import { parseBytes } from "../../src/parser/stream.ts";
import { Texter } from "../../src/primitives/texter.ts";

Deno.test("streaming benchmark corpus has legal counts and stable item bytes in both genera and domains", () => {
  for (const genus of [1, 2] as const) {
    for (const binary of [false, true]) {
      for (const depth of [0, 1, 3]) {
        const { manifest, chunks } = corpus({
          payloadBytes: 1024,
          itemBytes: 256,
          chunkBytes: 73,
          genus,
          binary,
          depth,
        });
        const input = new Uint8Array(manifest.wireBytes);
        let offset = 0;
        for (const chunk of chunks()) {
          input.set(chunk, offset);
          offset += chunk.length;
        }
        assertEquals(offset, input.length);
        const events = parseBytes(input);
        assertEquals(events.length, manifest.items);
        for (const [index, event] of events.entries()) {
          if (event.type === "error") throw event.error;
          const item = event.frame.attachments[0].items[0];
          assertInstanceOf(item, Texter);
          const raw = item.raw;
          assertEquals(new DataView(raw.buffer, raw.byteOffset, 8).getBigUint64(0), BigInt(index));
          for (let i = 0; i < 8; i++) raw[i] = i;
          assertEquals(createHash("sha256").update(raw).digest("hex"), manifest.itemSha256);
        }
      }
    }
  }
});
