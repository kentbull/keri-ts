import { readFile, writeFile } from "node:fs/promises";
import { argv, exit, stderr, stdin, stdout } from "node:process";
import { annotateCli, type CliIo } from "./cli.ts";

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

const NODE_IO: CliIo = {
  readFile: async (path: string) => {
    const data = await readFile(path);
    return new Uint8Array(data);
  },
  writeTextFile: async (path: string, text: string) => {
    await writeFile(path, text, "utf8");
  },
  readStdin: readNodeStdin,
  writeStdout: async (text: string) => {
    await new Promise<void>((resolve, reject) => {
      stdout.write(text, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  },
  writeStderr: async (text: string) => {
    await new Promise<void>((resolve, reject) => {
      stderr.write(text, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  },
};

const code = await annotateCli(argv.slice(2), NODE_IO);
exit(code);
