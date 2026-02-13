import { annotateCli, type CliIo, readAllReadable } from "./cli.ts";

const TEXT_ENCODER = new TextEncoder();

const DENO_IO: CliIo = {
  readFile: (path: string) => Deno.readFile(path),
  writeTextFile: (path: string, text: string) => Deno.writeTextFile(path, text),
  readStdin: () => readAllReadable(Deno.stdin.readable),
  writeStdout: async (text: string) => {
    await Deno.stdout.write(TEXT_ENCODER.encode(text));
  },
  writeStderr: async (text: string) => {
    await Deno.stderr.write(TEXT_ENCODER.encode(text));
  },
};

if (import.meta.main) {
  const code = await annotateCli(Deno.args, DENO_IO);
  Deno.exit(code);
}
