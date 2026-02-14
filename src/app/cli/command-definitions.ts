import { Command } from "npm:commander@^10.0.1";
import {
  type CommandArgs,
  type CommandDispatch,
  type CommandHandler,
} from "./command-types.ts";
import { agentCommand } from "./agent.ts";
import { dumpEvts } from "./db-dump.ts";
import { initCommand } from "./init.ts";

export function createCoreCommandHandlers(): Map<string, CommandHandler> {
  return new Map([
    ["init", (args: CommandArgs) => initCommand(args)],
    ["agent", (args: CommandArgs) => agentCommand(args)],
    ["db.dump", (args: CommandArgs) => dumpEvts(args)],
  ]);
}

export function registerCoreCommands(
  program: Command,
  dispatch: CommandDispatch,
): void {
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

  program
    .command("agent")
    .description("Start the KERI agent server")
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
          port: options.port ? Number(options.port) : 8000,
        },
      });
      return Promise.resolve();
    });

  const dbCommand = program.command("db").description("Database operations");

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
