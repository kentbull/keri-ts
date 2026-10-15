import { assertEquals, assertExists } from "jsr:@std/assert";
import { corpus } from "../../../../scripts/bench/cesr-corpus.ts";
import { collectPayload } from "../../src/core/payload.ts";
import { parseBytes } from "../../src/parser/complete.ts";

Deno.test("streaming benchmark corpus has legal counts and stable item bytes in both genera and domains", async () => {
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
        // This tiny correctness fixture may collect; measured workers never do.
        const input = new Uint8Array(manifest.wireBytes);
        let offset = 0;
        for (const chunk of chunks()) {
          input.set(chunk, offset);
          offset += chunk.length;
        }
        assertEquals(offset, input.length);
        const frames = await parseBytes(input);
        try {
          assertEquals(frames.length, manifest.items);
          for (const [index, frame] of frames.entries()) {
            assertExists(frame.essr);
            assertEquals(frame.essr.count, 1);
            const raw = await collectPayload(frame.essr.raw);
            assertEquals(new DataView(raw.buffer, raw.byteOffset, 8).getBigUint64(0), BigInt(index));
            // Verify ordering first, then normalize the ID for the common digest oracle.
            for (let i = 0; i < 8; i++) raw[i] = i;
            const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(raw).buffer));
            assertEquals(
              Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
              manifest.itemSha256,
            );
          }
        } finally {
          for (const frame of frames) await frame.essr?.discard();
        }
      }
    }
  }
});
