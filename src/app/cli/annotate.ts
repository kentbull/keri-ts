import { type Operation } from "npm:effection@^3.6.0";
import { spawnSync } from "node:child_process";
import { AppError } from "../../core/errors.ts";

interface AnnotateArgs {
  inPath?: string;
  outPath?: string;
  qb2?: boolean;
  pretty?: boolean;
}

function readAllStdinSync(): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const chunk = new Uint8Array(64 * 1024);
    const read = Deno.stdin.readSync(chunk);
    if (read === null) {
      break;
    }

    const used = chunk.subarray(0, read);
    chunks.push(used);
    total += read;
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

function buildDenoAnnotateArgs(options: AnnotateArgs): string[] {
  const args = [
    "run",
    "--allow-read",
    "--allow-write",
    "packages/cesr/src/annotate/cli-deno.ts",
    "--in",
    options.inPath!,
  ];

  if (options.outPath) {
    args.push("--out", options.outPath);
  }
  if (options.qb2) {
    args.push("--qb2");
  }
  if (options.pretty) {
    args.push("--pretty");
  }

  return args;
}

function buildNodeAnnotateArgs(options: AnnotateArgs): string[] {
  const nodeScript = [
    "import { annotate } from 'cesr-ts';",
    "import fs from 'node:fs';",
    "const [inPath, outPath, qb2, pretty] = process.argv.slice(1);",
    "const input = fs.readFileSync(inPath);",
    "const output = qb2 === '1'",
    "  ? annotate(new Uint8Array(input), { domainHint: 'bny', pretty: pretty === '1' })",
    "  : annotate(input.toString('utf8'), { domainHint: 'txt', pretty: pretty === '1' });",
    "if (outPath) {",
    "  fs.writeFileSync(outPath, output, 'utf8');",
    "} else {",
    "  process.stdout.write(output + '\\n');",
    "}",
  ].join("\n");

  return [
    "--input-type=module",
    "--eval",
    nodeScript,
    options.inPath!,
    options.outPath ?? "",
    options.qb2 ? "1" : "0",
    options.pretty ? "1" : "0",
  ];
}

interface ChildOutput {
  success: boolean;
  code: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

function forwardChildOutput(output: ChildOutput): void {
  if (output.stdout.length > 0) {
    Deno.stdout.writeSync(output.stdout);
  }
  if (output.stderr.length > 0) {
    Deno.stderr.writeSync(output.stderr);
  }
}

function runDenoAnnotator(options: AnnotateArgs): ChildOutput {
  const child = new Deno.Command(Deno.execPath(), {
    args: buildDenoAnnotateArgs(options),
    stdout: "piped",
    stderr: "piped",
  });
  return child.outputSync();
}

function runNodeAnnotator(options: AnnotateArgs): ChildOutput {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: { execPath?: string };
  };
  const executable = maybeProcess.process?.execPath || "node";
  const output = spawnSync(executable, buildNodeAnnotateArgs(options), {
    stdio: "pipe",
  });

  return {
    success: output.status === 0,
    code: output.status ?? 1,
    stdout: output.stdout ? new Uint8Array(output.stdout) : new Uint8Array(),
    stderr: output.stderr ? new Uint8Array(output.stderr) : new Uint8Array(),
  };
}

// deno-lint-ignore require-yield
export function* annotateCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const options: AnnotateArgs = {
    inPath: args.inPath as string | undefined,
    outPath: args.outPath as string | undefined,
    qb2: args.qb2 as boolean | undefined,
    pretty: args.pretty as boolean | undefined,
  };

  let tempInPath: string | undefined;
  if (!options.inPath) {
    tempInPath = Deno.makeTempFileSync({ suffix: ".cesr" });
    Deno.writeFileSync(tempInPath, readAllStdinSync());
    options.inPath = tempInPath;
  }

  try {
    let output: ChildOutput;

    try {
      output = runDenoAnnotator(options);
    } catch (error) {
      const isDenoMissing = error instanceof Error &&
        (error.message.includes("not found: deno") ||
          (typeof (error as { code?: unknown }).code === "string" &&
            (error as { code?: string }).code === "ENOENT"));
      if (!isDenoMissing) {
        throw error;
      }
      output = runNodeAnnotator(options);
    }

    forwardChildOutput(output);

    if (!output.success) {
      throw new AppError(
        `annotate command failed with exit code ${output.code}`,
      );
    }
  } finally {
    if (tempInPath) {
      try {
        Deno.removeSync(tempInPath);
      } catch {
        // best-effort cleanup
      }
    }
  }
}
