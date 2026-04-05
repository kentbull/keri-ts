import { Command } from "npm:commander@^10.0.1";
import { action, type Operation } from "npm:effection@^3.6.0";
import { DISPLAY_VERSION } from "../version.ts";
import {
  type CommandArgs,
  type CommandDispatch,
  type CommandHandler,
} from "./command-types.ts";

/** Shape used for lazily imported command modules before handler extraction. */
type CommandModule = Record<string, unknown>;

/**
 * Bridge a promise-backed dynamic import into an Effection operation.
 *
 * This keeps CLI startup free of eager command-module imports while preserving
 * the existing generator-based handler contract.
 */
function* loadModule<TModule extends CommandModule>(
  load: () => Promise<TModule>,
): Operation<TModule> {
  return yield* action((resolve, reject) => {
    load()
      .then(resolve)
      .catch((error) =>
        reject(error instanceof Error ? error : new Error(String(error)))
      );
    return () => {};
  });
}

/**
 * Lazily resolve a command handler from its module only when selected.
 *
 * This prevents `tufa --help` / `tufa --version` from importing heavy command
 * dependencies like CESR or LMDB on startup.
 */
function lazyCommand<TModule extends CommandModule>(
  load: () => Promise<TModule>,
  exportName: string,
): CommandHandler {
  return function* (args: CommandArgs): Operation<void> {
    const module = yield* loadModule(load);
    const handler = module[exportName];
    if (typeof handler !== "function") {
      throw new Error(`Expected ${exportName} to be a command handler export`);
    }
    yield* (handler as CommandHandler)(args);
  };
}

/**
 * Build the canonical command-dispatch map used by CLI execution and tests.
 *
 * Keys must stay aligned with the names registered in `registerCmds()` so the
 * command parser and dispatch layer continue to agree on routing.
 */
export function createCmdHandlers(): Map<string, CommandHandler> {
  return new Map([
    ["init", lazyCommand(() => import("./init.ts"), "initCommand")],
    ["incept", lazyCommand(() => import("./incept.ts"), "inceptCommand")],
    [
      "challenge.generate",
      lazyCommand(() => import("./challenge.ts"), "challengeGenerateCommand"),
    ],
    [
      "challenge.respond",
      lazyCommand(() => import("./challenge.ts"), "challengeRespondCommand"),
    ],
    [
      "challenge.verify",
      lazyCommand(() => import("./challenge.ts"), "challengeVerifyCommand"),
    ],
    [
      "exchange.send",
      lazyCommand(() => import("./exchange.ts"), "exchangeSendCommand"),
    ],
    ["export", lazyCommand(() => import("./export.ts"), "exportCommand")],
    ["list", lazyCommand(() => import("./list.ts"), "listCommand")],
    ["aid", lazyCommand(() => import("./aid.ts"), "aidCommand")],
    ["agent", lazyCommand(() => import("./agent.ts"), "agentCommand")],
    ["ends.add", lazyCommand(() => import("./ends.ts"), "endsAddCommand")],
    ["loc.add", lazyCommand(() => import("./loc.ts"), "locAddCommand")],
    [
      "oobi.generate",
      lazyCommand(() => import("./oobi.ts"), "oobiGenerateCommand"),
    ],
    [
      "oobi.resolve",
      lazyCommand(() => import("./oobi.ts"), "oobiResolveCommand"),
    ],
    ["annotate", lazyCommand(() => import("./annotate.ts"), "annotateCommand")],
    [
      "benchmark.cesr",
      lazyCommand(() => import("./benchmark.ts"), "benchmarkCommand"),
    ],
    ["db.dump", lazyCommand(() => import("./db-dump.ts"), "dumpEvts")],
    ["interact", interactCommand],
    ["witness", witnessCommand],
  ]);
}

/**
 * Register the CLI command tree on the provided Commander program.
 *
 * The registered names must stay aligned with `createCmdHandlers()` so parse
 * results continue to dispatch to the intended lazy-loaded operations.
 */
export function registerCmds(
  program: Command,
  dispatch: CommandDispatch,
): void {
  // top level commands
  regVersionCmd(program);
  regInitCmd(program, dispatch);
  regInceptCmd(program, dispatch);
  regExportCmd(program, dispatch);
  regListCmd(program, dispatch);
  regAidCmd(program, dispatch);
  regAnnotateCmd(program, dispatch);
  regAgentCmd(program, dispatch);
  regChallengeSubCmd(program, dispatch);
  regEndsSubCmd(program, dispatch);
  regExchangeSubCmd(program, dispatch);
  regLocSubCmd(program, dispatch);
  regOobiSubCmd(program, dispatch);
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
    .option(
      "-n, --name <name>",
      "Keystore name and file location of KERI keystore (required)",
    )
    .option(
      "-b, --base <base>",
      "Additional optional prefix to file location of KERI keystore",
    )
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-t, --temp", "Create a temporary keystore, used for testing")
    .option("-s, --salt <salt>", "Qualified base64 salt for creating key pairs")
    .option(
      "-c, --config-dir <dir>",
      "Directory override for configuration data",
    )
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
    .requiredOption(
      "-n, --name <name>",
      "Keystore name and file location of KERI keystore",
    )
    .option(
      "-b, --base <base>",
      "Additional optional prefix to file location of KERI keystore",
    )
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option(
      "-c, --config-dir <dir>",
      "Directory override for configuration data",
    )
    .option("--config-file <file>", "Configuration filename override")
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .requiredOption(
      "-a, --alias <alias>",
      "Human readable alias for the new identifier prefix",
    )
    .option("-f, --file <file>", "Filename to use to create the identifier", "")
    .option(
      "-tf, --transferable",
      "Whether the prefix is transferable or non-transferable",
    )
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
          configDir: options.configDir,
          configFile: options.configFile,
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
      return;
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
    .requiredOption(
      "-a, --alias <alias>",
      "Human readable alias for identifier to export",
    )
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
      return;
    });
}

/**
 * Registers the list command with the program.
 * Equivalent to `kli list` from KERIpy.
 *
 * @param program The tufa Commander program instance
 * @param dispatch The command dispatch function
 */
function regListCmd(program: Command, dispatch: CommandDispatch): void {
  program
    .command("list")
    .description("List existing identifiers")
    .requiredOption("-n, --name <name>", "Keystore name")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "list",
        args: {
          name: options.name,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
      return;
    });
}

/**
 * Registers the aid command with the program.
 * Equivalent to `kli aid` from KERIpy.
 *
 * @param program The tufa Commander program instance
 * @param dispatch The command dispatch function
 */
function regAidCmd(program: Command, dispatch: CommandDispatch): void {
  program
    .command("aid")
    .description("Print the AID for a given alias")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption(
      "-a, --alias <alias>",
      "Human readable alias for the identifier",
    )
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "aid",
        args: {
          name: options.name,
          alias: options.alias,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
      return;
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
    .option("--colored", "Colorize annotation output (stdout only)")
    .action(
      (
        options: {
          in?: string;
          out?: string;
          qb2?: boolean;
          pretty?: boolean;
          colored?: boolean;
        },
      ) => {
        dispatch({
          name: "annotate",
          args: {
            inPath: options.in,
            outPath: options.out,
            qb2: options.qb2 || false,
            pretty: options.pretty || false,
            colored: options.colored || false,
          },
        });
        return;
      },
    );
}

/**
 * Registers the agent command with the program.
 *
 * Operator contract:
 * - this starts the long-lived indirect-mode host for one local habery
 * - the command still dispatches lazily through the shared CLI command loader,
 *   so `tufa --help` does not eagerly import Gate E runtime dependencies
 *
 * @param program The tufa Commander program instance
 * @param dispatch The command dispatch function
 */
function regAgentCmd(program: Command, dispatch: CommandDispatch): void {
  program
    .command("agent")
    .description("Start the KERI agent server")
    .requiredOption("-n, --name <name>", "Keystore name")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-P, --passcode <passcode>", "Encryption passcode for keystore")
    .option(
      "-p, --port <port>",
      "Port number for the server (default: 8000)",
      "8000",
    )
    .action(function (this: Command) {
      const options = this.opts();
      dispatch({
        name: "agent",
        args: {
          name: options.name,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
          port: options.port ? Number(options.port) : 8000,
        },
      });
      return;
    });
}

/** Register the `challenge` subcommands. */
function regChallengeSubCmd(program: Command, dispatch: CommandDispatch): void {
  const challenge = program.command("challenge").description(
    "Generate, respond to, and verify challenge phrases",
  );

  challenge
    .command("generate")
    .description("Generate a cryptographically random challenge phrase")
    .option(
      "-s, --strength <bits>",
      "Approximate challenge entropy strength in bits",
      (value: string) => Number(value),
      128,
    )
    .option(
      "-o, --out <out>",
      "Output mode: json, string, or words",
      "json",
    )
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "challenge.generate",
        args: {
          strength: options.strength,
          out: options.out,
        },
      });
    });

  challenge
    .command("respond")
    .description(
      "Respond to challenge words by signing and sending an exchange message",
    )
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-a, --alias <alias>", "Local identifier alias")
    .requiredOption("-r, --recipient <prefix>", "Recipient identifier prefix")
    .requiredOption(
      "-w, --words <words>",
      "Challenge words as JSON array or whitespace-separated string",
    )
    .option(
      "-t, --transport <transport>",
      "Transport mode: auto, direct, or indirect",
      "auto",
    )
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "challenge.respond",
        args: {
          name: options.name,
          alias: options.alias,
          recipient: options.recipient,
          words: options.words,
          transport: options.transport,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });

  challenge
    .command("verify")
    .description(
      "Verify that a signer responded with the expected challenge words",
    )
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-s, --signer <prefix>", "Signer identifier prefix")
    .requiredOption("-w, --words <words>", "Expected challenge words")
    .option(
      "--timeout <seconds>",
      "How long to wait for a matching response before failing",
      (value: string) => Number(value),
      10,
    )
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "challenge.verify",
        args: {
          name: options.name,
          signer: options.signer,
          words: options.words,
          timeout: options.timeout,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });
}

/**
 * Register the `ends` subcommands.
 *
 * Current Gate E scope is intentionally narrow: only `ends add` is exposed
 * until the wider endpoint authorization surface reaches parity.
 */
function regEndsSubCmd(program: Command, dispatch: CommandDispatch): void {
  const ends = program.command("ends").description(
    "Manage endpoint authorizations",
  );
  ends
    .command("add")
    .description("Authorize an endpoint role for one AID")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-a, --alias <alias>", "Local identifier alias")
    .requiredOption("-r, --role <role>", "Endpoint role")
    .requiredOption("-e, --eid <eid>", "Endpoint AID")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "ends.add",
        args: {
          name: options.name,
          alias: options.alias,
          role: options.role,
          eid: options.eid,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
      return;
    });
}

/** Register the `exchange` subcommands. */
function regExchangeSubCmd(program: Command, dispatch: CommandDispatch): void {
  const exchange = program.command("exchange").description(
    "Send peer-to-peer exchange messages",
  );

  exchange
    .command("send")
    .description(
      "Send one signed exchange message to a resolved remote identifier",
    )
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-a, --alias <alias>", "Local identifier alias")
    .requiredOption("-r, --recipient <prefix>", "Recipient identifier prefix")
    .requiredOption("-R, --route <route>", "Exchange route")
    .requiredOption("-d, --payload <json>", "Exchange payload as a JSON object")
    .option(
      "-t, --transport <transport>",
      "Transport mode: auto, direct, or indirect",
      "auto",
    )
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "exchange.send",
        args: {
          name: options.name,
          alias: options.alias,
          recipient: options.recipient,
          route: options.route,
          payload: options.payload,
          transport: options.transport,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });
}

/**
 * Register the `loc` subcommands.
 *
 * Current Gate E scope is the local `loc add` parity path used to seed
 * accepted `LocationScheme` reply state through normal parser/routing flows.
 */
function regLocSubCmd(program: Command, dispatch: CommandDispatch): void {
  const loc = program.command("loc").description(
    "Manage local endpoint locations",
  );
  loc
    .command("add")
    .description(
      "Add one local location scheme record through reply acceptance",
    )
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-a, --alias <alias>", "Local identifier alias")
    .requiredOption("-u, --url <url>", "Endpoint URL")
    .option(
      "-e, --eid <eid>",
      "Endpoint AID (defaults to the local habitat prefix)",
    )
    .option("-t, --time <time>", "Explicit reply timestamp")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "loc.add",
        args: {
          name: options.name,
          alias: options.alias,
          url: options.url,
          eid: options.eid,
          time: options.time,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
      return;
    });
}

/**
 * Register the `oobi` subcommands.
 *
 * The generate/resolve pair both dispatch through the same shared runtime
 * design, but `generate` is readonly while `resolve` mutates local OOBI and
 * reply/KEL state through normal protocol processing.
 */
function regOobiSubCmd(program: Command, dispatch: CommandDispatch): void {
  const oobi = program.command("oobi").description(
    "Generate and resolve OOBIs",
  );

  oobi
    .command("generate")
    .description("Generate OOBI URL(s) for one local identifier")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-a, --alias <alias>", "Local identifier alias")
    .requiredOption("-r, --role <role>", "OOBI role")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "oobi.generate",
        args: {
          name: options.name,
          alias: options.alias,
          role: options.role,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
      return;
    });

  oobi
    .command("resolve")
    .description("Resolve one remote OOBI URL")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-u, --url <url>", "Remote OOBI URL")
    .option("-A, --oobi-alias <alias>", "Alias hint for the resolved OOBI")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "oobi.resolve",
        args: {
          name: options.name,
          url: options.url,
          oobiAlias: options.oobiAlias,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
      return;
    });
}

/**
 * Registers benchmark subcommands with the program.
 *
 * @param program The tufa Commander program instance
 * @param dispatch The command dispatch function
 */
function regBenchmarkSubCmd(program: Command, dispatch: CommandDispatch): void {
  const benchmarkCommand = program.command("benchmark").description(
    "Benchmark operations",
  );
  regBenchmarkCesrCmd(benchmarkCommand, dispatch);
}

/**
 * Registers the CESR benchmark command.
 *
 * @param benchmarkCommand The benchmark sub-command instance
 * @param dispatch The command dispatch function
 */
function regBenchmarkCesrCmd(
  benchmarkCommand: Command,
  dispatch: CommandDispatch,
): void {
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
      return;
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
      return;
    });
}

/**
 * Registers the experimental sub command with the program.
 * This is for commands not yet implemented, finished, or supported by tufa.
 *
 * @param program The tufa Commander program instance
 * @param dispatch The command dispatch function
 */
function regExperimentalSubCmd(
  program: Command,
  dispatch: CommandDispatch,
): void {
  const experimentalCommand = program
    .command("experimental")
    .description("Experimental or placeholder commands");
  regInteractCmd(experimentalCommand, dispatch);
  regWitnessCmd(experimentalCommand, dispatch);
}

/** Register the placeholder experimental interact command. */
function regInteractCmd(
  experimentalCommand: Command,
  dispatch: CommandDispatch,
): void {
  experimentalCommand
    .command("interact")
    .description("Create an interaction event (placeholder)")
    .action(() => {
      dispatch({ name: "interact", args: {} });
      return;
    });
}

/** Register the placeholder experimental witness command. */
function regWitnessCmd(
  experimentalCommand: Command,
  dispatch: CommandDispatch,
): void {
  experimentalCommand
    .command("witness")
    .description("Start a witness server (placeholder)")
    .action(() => {
      dispatch({ name: "witness", args: {} });
      return;
    });
}

/**
 * Placeholder handler for the future experimental interact command surface.
 *
 * The real implementation is intentionally deferred; this keeps the CLI route
 * wired while making the unfinished status explicit.
 */
// deno-lint-ignore require-yield
function* interactCommand(_args: CommandArgs): Operation<void> {
  console.log("tufa experimental interact command - coming soon!");
}

/**
 * Placeholder handler for the future experimental witness command surface.
 *
 * Like `interactCommand`, this exists so the parser/dispatch path remains
 * stable while the underlying feature work is still pending.
 */
// deno-lint-ignore require-yield
function* witnessCommand(_args: CommandArgs): Operation<void> {
  console.log("tufa experimental witness command - coming soon!");
}
