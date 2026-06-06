import { annotateCommand } from "./commands/annotate.ts";
import { benchCommand } from "./commands/bench.ts";
import { validateCommand } from "./commands/validate.ts";
import type { CliCommand, CliIo } from "./types.ts";

const COMMANDS: Record<string, CliCommand> = {
  annotate: annotateCommand,
  validate: validateCommand,
  bench: benchCommand,
};

const TEPHRA_USAGE = [
  "Usage: tephra <command> [options]",
  "",
  "Commands:",
  "  annotate   Annotate a CESR stream",
  "  validate   Validate a CESR stream",
  "  bench      Benchmark CESR parser throughput",
  "",
  "Run `tephra <command> --help` for command-specific options.",
].join("\n");

/**
 * Execute the package-level `tephra` CLI dispatcher.
 *
 * This function owns only command selection and top-level usage behavior. Each
 * subcommand receives the already-selected argument tail plus a runtime-neutral
 * IO adapter, so command behavior remains identical under Deno and Node.
 */
export async function tephraCli(args: string[], io: CliIo): Promise<number> {
  const [command, ...commandArgs] = args;
  if (command === "--help" || command === "-h") {
    await io.writeStdout(`${TEPHRA_USAGE}\n`);
    return 0;
  }
  if (!command) {
    await io.writeStderr(`${TEPHRA_USAGE}\n`);
    return 1;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    await io.writeStderr(`Unknown tephra command: ${command}\n${TEPHRA_USAGE}\n`);
    return 1;
  }

  return await handler(commandArgs, io);
}
