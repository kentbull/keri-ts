import { Command } from "npm:commander@^10.0.1";
import { type Operation } from "npm:effection@^3.6.0";
import { agentCommand } from "./agent.ts";
import { annotateCommand } from "./annotate.ts";
import { benchmarkCommand } from "./benchmark.ts";
import { type CommandArgs, type CommandDispatch, type CommandHandler } from "./command-types.ts";
import { dumpEvts } from "./db-dump.ts";
import { exportCommand } from "./export.ts";
import { inceptCommand } from "./incept.ts";
import { initCommand } from "./init.ts";
import { DISPLAY_VERSION } from "../version.ts";

export function createCmdHandlers(): Map<string, CommandHandler> {
  return new Map([
    ["init", (args: CommandArgs) => initCommand(args)],
    ["incept", (args: CommandArgs) => inceptCommand(args)],
    ["export", (args: CommandArgs) => exportCommand(args)],
    ["agent", (args: CommandArgs) => agentCommand(args)],
    ["annotate", (args: CommandArgs) => annotateCommand(args)],
    ["benchmark.cesr", (args: CommandArgs) => benchmarkCommand(args)],
    ["db.dump", (args: CommandArgs) => dumpEvts(args)],
    ["interact", interactCommand],
    ["witness", witnessCommand],
  ]);
}

/**
 * registers core commands with the program
 */
export function registerCmds(program: Command, dispatch: CommandDispatch): void {
  // top level commands
  regVersionCmd(program);
  regInitCmd(program, dispatch);
  regInceptCmd(program, dispatch);
  regExportCmd(program, dispatch);
  regAnnotateCmd(program, dispatch);
  regAgentCmd(program, dispatch);
  regBenchmarkSubCmd(program, dispatch);

  // sub commands
  regDbDumpSubCmd(program, dispatch);
  regExperimentalSubCmd(program, dispatch);
}

/**
 * Registers the version command with the program.
 * Equivalent to `kli version` from KERIpy.
 *
 * @param program The tufa Commander program instance
 * @param dispatch The command dispatch function
 */
function regVersionCmd(program: Command): void {
  program
    .command("version")
    .description("Show tufa version")
    .action(() => {
      console.log(DISPLAY_VERSION);
      return Promise.resolve();
    });
}

/**
 * Registers the init command with the program.
 * Equivalent to `kli init` from KERIpy.
 *
 * @param program The tufa Commander program instance
 * @param dispatch The command dispatch function
 */
function regInitCmd(program: Command, dispatch: CommandDispatch): void {
  program
    .command("init")
    .description("Create a database and keystore")
    .option("-n, --name <name>", "Keystore name and file location of KERI keystore (required)")
    .option("-b, --base <base>", "Additional optional prefix to file location of KERI keystore")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-t, --temp", "Create a temporary keystore, used for testing")
    .option("-s, --salt <salt>", "Qualified base64 salt for creating key pairs")
    .option("-c, --config-dir <dir>", "Directory override for configuration data")
    .option("--config-file <file>", "Configuration filename override")
    .option(
      "-p, --passcode <passcode>",
      "22 character encryption passcode for keystore (is not saved)",
    )
    .option("--nopasscode", "Create an unencrypted keystore")
    .option(
      "-a, --aeid <aeid>",
      "Qualified base64 of non-transferable identifier prefix for authentication and encryption of secrets in keystore",
    )
    .option(
      "-e, --seed <seed>",
      "Qualified base64 private-signing key (seed) for the aeid from which the private decryption key may be derived",
    )
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "init",
        args: {
          name: options.name,
          base: options.base,
          headDirPath: options.headDir,
          temp: options.temp || false,
          salt: options.salt,
          configDir: options.configDir,
          configFile: options.configFile,
          passcode: options.passcode,
          nopasscode: options.nopasscode || false,
          aeid: options.aeid,
          seed: options.seed,
        },
      });
      return Promise.resolve();
    });
}

/**
 * Registers the incept command with the program.
 * Equivalent to `kli incept` from KERIpy.
 *
 * @param program The tufa Commander program instance
 * @param dispatch The command dispatch function
 */
function regInceptCmd(program: Command, dispatch: CommandDispatch): void {
  program
    .command("incept")
    .description("Initialize a prefix")
    .requiredOption("-n, --name <name>", "Keystore name and file location of KERI keystore")
    .option("-b, --base <base>", "Additional optional prefix to file location of KERI keystore")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .requiredOption("-a, --alias <alias>", "Human readable alias for the new identifier prefix")
    .option("-f, --file <file>", "Filename to use to create the identifier", "")
    .option("-tf, --transferable", "Whether the prefix is transferable or non-transferable")
    .option(
      "-w, --wits <prefix>",
      "New set of witnesses, replaces all existing witnesses",
      (value: string, prev: string[] = []) => {
        prev.push(value);
        return prev;
      },
      [],
    )
    .option(
      "-t, --toad <toad>",
      "Witness threshold (threshold of accountable duplicity)",
      (value: string) => Number(value),
    )
    .option(
      "-ic, --icount <count>",
      "Incepting key count for number of keys used for inception",
      (value: string) => Number(value),
    )
    .option("-s, --isith <isith>", "Signing threshold for the inception event")
    .option(
      "-nc, --ncount <count>",
      "Next key count for number of next keys used on first rotation",
      (value: string) => Number(value),
    )
    .option("-x, --nsith <nsith>", "Signing threshold for the next rotation")
    .option("-e, --est-only", "Only allow establishment events in KEL")
    .option(
      "-d, --data <data>",
      "Anchor data, '@' allowed",
      (value: string, prev: string[] = []) => {
        prev.push(value);
        return prev;
      },
      [],
    )
    .option("-di, --delpre <prefix>", "Delegator AID for delegated identifiers")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "incept",
        args: {
          name: options.name,
          base: options.base,
          headDirPath: options.headDir,
          passcode: options.passcode,
          alias: options.alias,
          file: options.file,
          transferable: options.transferable || false,
          wits: options.wits || [],
          toad: options.toad,
          icount: options.icount,
          isith: options.isith,
          ncount: options.ncount,
          nsith: options.nsith,
          estOnly: options.estOnly || false,
          data: options.data || [],
          delpre: options.delpre,
        },
      });
      return Promise.resolve();
    });
}

/**
 * Registers the export command with the program.
 * Equivalent to `kli export` from KERIpy.
 *
 * @param program The tufa Commander program instance
 * @param dispatch The command dispatch function
 */
function regExportCmd(program: Command, dispatch: CommandDispatch): void {
  program
    .command("export")
    .description("Export key events in CESR stream format")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-a, --alias <alias>", "Human readable alias for identifier to export")
    .option("-b, --base <base>", "Optional base path prefix")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .option("--files", "Export artifacts to individual files")
    .option("--ends", "Export service end points")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "export",
        args: {
          name: options.name,
          alias: options.alias,
          base: options.base,
          headDirPath: options.headDir,
          passcode: options.passcode,
          files: options.files || false,
          ends: options.ends || false,
        },
      });
      return Promise.resolve();
    });
}

/**
 * Registers the annotate command with the program.
 *
 * @param program The tufa Commander program instance
 * @param dispatch The command dispatch function
 */
function regAnnotateCmd(program: Command, dispatch: CommandDispatch): void {
  program
    .command("annotate")
    .description("Annotate CESR stream from file or stdin")
    .option("--in <path>", "Input file path (defaults to stdin)")
    .option("--out <path>", "Output file path (defaults to stdout)")
    .option("--qb2", "Treat input as qb2 binary instead of text CESR")
    .option("--pretty", "Pretty-print annotation output")
    .action((options: { in?: string; out?: string; qb2?: boolean; pretty?: boolean }) => {
      dispatch({
        name: "annotate",
        args: {
          inPath: options.in,
          outPath: options.out,
          qb2: options.qb2 || false,
          pretty: options.pretty || false,
        },
      });
      return Promise.resolve();
    });
}

/**
 * Registers the agent command with the program.
 *
 * @param program The tufa Commander program instance
 * @param dispatch The command dispatch function
 */
function regAgentCmd(program: Command, dispatch: CommandDispatch): void {
  program
    .command("agent")
    .description("Start the KERI agent server")
    .option("-p, --port <port>", "Port number for the server (default: 8000)", "8000")
    .action(function (this: Command) {
      const options = this.opts();
      dispatch({
        name: "agent",
        args: {
          port: options.port ? Number(options.port) : 8000,
        },
      });
      return Promise.resolve();
    });
}

/**
 * Registers benchmark subcommands with the program.
 *
 * @param program The tufa Commander program instance
 * @param dispatch The command dispatch function
 */
function regBenchmarkSubCmd(program: Command, dispatch: CommandDispatch): void {
  const benchmarkCommand = program.command("benchmark").description("Benchmark operations");
  regBenchmarkCesrCmd(benchmarkCommand, dispatch);
}

/**
 * Registers the CESR benchmark command.
 *
 * @param benchmarkCommand The benchmark sub-command instance
 * @param dispatch The command dispatch function
 */
function regBenchmarkCesrCmd(benchmarkCommand: Command, dispatch: CommandDispatch): void {
  benchmarkCommand
    .command("cesr")
    .description("Benchmark CESR parser from file or stdin")
    .option("--in <path>", "Input file path (defaults to stdin)")
    .option("--iterations <count>", "Measured benchmark iterations", (value: string) => Number(value), 50)
    .option("--warmup <count>", "Warmup iterations before measurement", (value: string) => Number(value), 5)
    .option("--chunk-size <bytes>", "Chunk size for simulated streaming input", (value: string) => Number(value), 0)
    .option("--framed", "Use framed parser mode")
    .option("--compat", "Use compat attachment dispatch mode")
    .option("--allow-errors", "Do not fail benchmark if parse errors are emitted")
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
      return Promise.resolve();
    });
}

/**
 * Registers the db dump sub command with the program.
 *
 * @param program The tufa Commander program instance
 * @param dispatch The command dispatch function
 */
function regDbDumpSubCmd(program: Command, dispatch: CommandDispatch): void {
  const dbCommand = program.command("db").description("Database operations");
  regDbDumpCmd(dbCommand, dispatch);
}

/**
 * Registers the db dump command with the program.
 *
 * @param dbCommand The db sub-command instance
 * @param dispatch The command dispatch function
 */
function regDbDumpCmd(dbCommand: Command, dispatch: CommandDispatch): void {
  dbCommand
    .command("dump")
    .description("Dump database contents")
    .requiredOption("-n, --name <name>", "Database name")
    .option("-b, --base <base>", "Additional optional prefix to database path")
    .option("-t, --temp", "Use temporary database")
    .action((options: { name: string; base?: string; temp?: boolean }) => {
      dispatch({
        name: "db.dump",
        args: {
          name: options.name,
          base: options.base,
          temp: options.temp || false,
        },
      });
      return Promise.resolve();
    });
}

/**
 * Registers the experimental sub command with the program.
 * This is for commands not yet implemented, finished, or supported by tufa.
 *
 * @param program The tufa Commander program instance
 * @param dispatch The command dispatch function
 */
function regExperimentalSubCmd(program: Command, dispatch: CommandDispatch): void {
  const experimentalCommand = program
    .command("experimental")
    .description("Experimental or placeholder commands");
  regInteractCmd(experimentalCommand, dispatch);
  regWitnessCmd(experimentalCommand, dispatch);
}

function regInteractCmd(experimentalCommand: Command, dispatch: CommandDispatch): void {
  experimentalCommand
    .command("interact")
    .description("Create an interaction event (placeholder)")
    .action(() => {
      dispatch({ name: "interact", args: {} });
      return Promise.resolve();
    });
}

function regWitnessCmd(experimentalCommand: Command, dispatch: CommandDispatch): void {
  experimentalCommand
    .command("witness")
    .description("Start a witness server (placeholder)")
    .action(() => {
      dispatch({ name: "witness", args: {} });
      return Promise.resolve();
    });
}

// deno-lint-ignore require-yield
function* interactCommand(_args: CommandArgs): Operation<void> {
  console.log("tufa experimental interact command - coming soon!");
}

// deno-lint-ignore require-yield
function* witnessCommand(_args: CommandArgs): Operation<void> {
  console.log("tufa experimental witness command - coming soon!");
}
