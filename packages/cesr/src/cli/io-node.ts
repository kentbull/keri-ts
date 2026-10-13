import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { stderr, stdin, stdout } from "node:process";
import type { CliIo } from "./types.ts";

/** Write text at the actual npm CLI boundary and await the native stream callback. */
async function writeNodeStream(stream: typeof stdout | typeof stderr, text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(text, (error) => error ? reject(error) : resolve());
  });
}

/** Create the Node CLI adapter; breaking a source iterator destroys its file/stdin stream. */
export function createNodeCliIo(): CliIo {
  return {
    /** Fixed file chunks and owned copies satisfy the CESR cursor's backing-allocation limit. */
    async *read(path?: string) {
      const source = path ? createReadStream(path, { highWaterMark: 64 * 1024 }) : stdin;
      for await (const chunk of source) {
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        // Node buffers may share a larger slab; expose independent bounded parser chunks.
        for (let offset = 0; offset < bytes.length; offset += 65536) {
          yield Uint8Array.from(bytes.subarray(offset, offset + 65536));
        }
      }
    },
    writeTextFile: (path, text) => writeFile(path, text, "utf8"),
    writeStdout: (text) => writeNodeStream(stdout, text),
    writeStderr: (text) => writeNodeStream(stderr, text),
  };
}
