import type { CliIo } from "./types.ts";

/**
 * Read a full `ReadableStream` into one contiguous byte buffer.
 *
 * Deno exposes stdin as a web stream, while CLI commands want a single byte
 * buffer. Keeping this helper here prevents command modules from depending on
 * the Deno runtime directly.
 */
export async function readAllReadable(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Create the Deno runtime IO adapter for the package-level `tephra` CLI. */
export function createDenoCliIo(): CliIo {
  const textEncoder = new TextEncoder();
  return {
    readFile: (path: string) => Deno.readFile(path),
    writeTextFile: (path: string, text: string) => Deno.writeTextFile(path, text),
    readStdin: () => readAllReadable(Deno.stdin.readable),
    writeStdout: async (text: string) => {
      await Deno.stdout.write(textEncoder.encode(text));
    },
    writeStderr: async (text: string) => {
      await Deno.stderr.write(textEncoder.encode(text));
    },
  };
}
