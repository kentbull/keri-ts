/** Commander registrations for benchmark, DB, and experimental tooling commands. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";

/** Register benchmarking, DB, and experimental commands. */
export function registerToolingCmds(
  program: Command,
  dispatch: CommandDispatch,
): void {
  registerBenchmarkCmds(program, dispatch);
  registerDbCmds(program, dispatch);
  registerExperimentalCmds(program, dispatch);
}

function registerBenchmarkCmds(program: Command, dispatch: CommandDispatch): void {
  const benchmarkCommand = program.command("benchmark").description(
    "Benchmark operations",
  );
  benchmarkCommand
    .command("cesr")
    .description("Benchmark CESR parser from file or stdin")
    .option("--in <path>", "Input file path (defaults to stdin)")
    .option(
      "--iterations <count>",
      "Measured benchmark iterations",
      (value: string) => Number(value),
      50,
    )
    .option(
      "--warmup <count>",
      "Warmup iterations before measurement",
      (value: string) => Number(value),
      5,
    )
    .option(
      "--chunk-size <bytes>",
      "Chunk size for simulated streaming input",
      (value: string) => Number(value),
      0,
    )
    .option("--framed", "Use framed parser mode")
    .option("--compat", "Use compat attachment dispatch mode")
    .option(
      "--allow-errors",
      "Do not fail benchmark if parse errors are emitted",
    )
    .option("--json", "Emit benchmark result as one JSON line")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "benchmark.cesr",
        args: {
          inPath: options.in,
          iterations: options.iterations,
          warmupIterations: options.warmup,
          chunkSize: options.chunkSize,
          framed: options.framed || false,
          compat: options.compat || false,
          allowErrors: options.allowErrors || false,
          json: options.json || false,
        },
      });
    });
}

function registerDbCmds(program: Command, dispatch: CommandDispatch): void {
  const dbCommand = program.command("db").description("Database operations");
  dbCommand
    .command("dump")
    .description("Dump database contents")
    .argument(
      "[target]",
      "Dump target like baser, baser.locs, mailboxer.tpcs, or outboxer.tgts",
      "baser.evts",
    )
    .requiredOption("-n, --name <name>", "Database name")
    .option("-b, --base <base>", "Additional optional prefix to database path")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root",
    )
    .option("-t, --temp", "Use temporary database")
    .option("--compat", "Open KERIpy-compatible .keri stores instead of .tufa")
    .option(
      "--prefix <prefix>",
      "Logical key prefix filter for one sub-database target",
    )
    .option(
      "--limit <count>",
      "Maximum number of entries to print for one targeted sub-database",
      (value: string) => Number.parseInt(value, 10),
    )
    .action((
      target: string,
      options: {
        name: string;
        base?: string;
        headDir?: string;
        temp?: boolean;
        compat?: boolean;
        prefix?: string;
        limit?: number;
      },
    ) => {
      dispatch({
        name: "db.dump",
        args: {
          name: options.name,
          base: options.base,
          headDirPath: options.headDir,
          temp: options.temp || false,
          compat: options.compat || false,
          target,
          prefix: options.prefix,
          limit: options.limit,
        },
      });
    });
}

function registerExperimentalCmds(
  program: Command,
  dispatch: CommandDispatch,
): void {
  const experimentalCommand = program
    .command("experimental")
    .description("Experimental or placeholder commands");

  experimentalCommand
    .command("interact")
    .description("Create an interaction event (placeholder)")
    .action(() => {
      dispatch({ name: "interact", args: {} });
    });
}
