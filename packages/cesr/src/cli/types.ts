/**
 * Runtime-neutral IO boundary for CESR CLI commands.
 *
 * Command modules should depend on this interface instead of importing Deno or
 * Node APIs directly. That keeps `tephra annotate`, `tephra validate`, and
 * `tephra bench` executable from both the Deno launcher and the npm/Node launcher.
 */
export interface CliIo {
  /** Read one complete input file as raw CESR bytes. */
  readFile(path: string): Promise<Uint8Array>;
  /** Write command output to a text file, used by `tephra annotate --out`. */
  writeTextFile(path: string, text: string): Promise<void>;
  /** Read stdin as raw CESR bytes when `--in` is omitted. */
  readStdin(): Promise<Uint8Array>;
  /** Write terminal output intended for successful command output. */
  writeStdout(text: string): Promise<void>;
  /** Write terminal output intended for usage errors or validation failures. */
  writeStderr(text: string): Promise<void>;
}

/** Shared command contract for package-level CESR CLI subcommands. */
export type CliCommand = (args: string[], io: CliIo) => Promise<number>;
