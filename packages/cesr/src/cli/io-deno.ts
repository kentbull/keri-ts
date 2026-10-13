import type { CliIo } from "./types.ts";

/** Consume a web stream on demand and join cancellation before releasing its reader. */
async function* readStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value.length) yield value;
    }
  } finally {
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

/** Write all encoded bytes; Deno writers may accept less than one whole buffer. */
async function writeText(stream: Pick<Deno.FsFile, "write">, text: string): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  for (let offset = 0; offset < bytes.length;) offset += await stream.write(bytes.subarray(offset));
}

/** Create the Deno CLI adapter; every source closes when its consumer stops. */
export function createDenoCliIo(): CliIo {
  return {
    /** Deno's file/stdin streams are consumed incrementally, including finite annotation admission. */
    async *read(path?: string) {
      if (!path) {
        yield* readStream(Deno.stdin.readable);
        return;
      }
      const file = await Deno.open(path, { read: true });
      yield* readStream(file.readable);
    },
    writeTextFile: (path, text) => Deno.writeTextFile(path, text),
    writeStdout: (text) => writeText(Deno.stdout, text),
    writeStderr: (text) => writeText(Deno.stderr, text),
  };
}
