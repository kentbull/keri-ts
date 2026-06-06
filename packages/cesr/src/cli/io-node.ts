import { readFile, writeFile } from "node:fs/promises";
import { stderr, stdin, stdout } from "node:process";
import type { CliIo } from "./types.ts";

/** Read Node stdin into one contiguous byte buffer for command execution. */
async function readNodeStdin(): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stdin) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    chunks.push(bytes);
    total += bytes.length;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Write text to a Node stream and wait for completion or backpressure error. */
async function writeNodeStream(
  stream: typeof stdout | typeof stderr,
  text: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(text, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/** Create the Node runtime IO adapter for the package-level `tephra` CLI. */
export function createNodeCliIo(): CliIo {
  return {
    readFile: async (path: string) => {
      const data = await readFile(path);
      return new Uint8Array(data);
    },
    writeTextFile: async (path: string, text: string) => {
      await writeFile(path, text, "utf8");
    },
    readStdin: readNodeStdin,
    writeStdout: (text: string) => writeNodeStream(stdout, text),
    writeStderr: (text: string) => writeNodeStream(stderr, text),
  };
}
