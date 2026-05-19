/**
 * Commander registrations for lifecycle and environment-management commands.
 *
 * Topic boundary:
 * - keystore/environment creation
 * - identifier establishment/rotation lifecycle
 * - long-lived agent hosting
 */
import { Command } from "npm:commander@^10.0.1";
import { tufaCliVersionLine } from "../../version-display.ts";
import type { CommandDispatch } from "../command-types.ts";

/** Register lifecycle-oriented top-level commands. */
export function registerLifecycleCmds(
  program: Command,
  dispatch: CommandDispatch,
): void {
  registerVersionCmd(program);
  registerInitCmd(program, dispatch);
  registerInceptCmd(program, dispatch);
  registerRotateCmd(program, dispatch);
  registerInteractCmd(program, dispatch);
  registerDelegateCmd(program, dispatch);
  registerAgentCmd(program, dispatch);
}

/** Register the lightweight version command that bypasses lazy command dispatch. */
function registerVersionCmd(program: Command): void {
  program
    .command("version")
    .description("Show tufa version")
    .action(() => {
      console.log(tufaCliVersionLine());
    });
}

/** Register the keystore/bootstrap creation command. */
function registerInitCmd(program: Command, dispatch: CommandDispatch): void {
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
    .option(
      "--outboxer",
      "Enable the tufa-local durable outbox sidecar for this keystore",
      false,
    )
    .option(
      "--cesr-body-mode <mode>",
      "CESR HTTP transport mode: header (default) or body",
      "header",
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
          outboxer: options.outboxer || false,
          cesrBodyMode: options.cesrBodyMode,
        },
      });
    });
}

/** Register the local identifier inception command surface. */
function registerInceptCmd(program: Command, dispatch: CommandDispatch): void {
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
    .option("--proxy <alias>", "Alias for delegation communication proxy")
    .option(
      "--receipt-endpoint",
      "Attempt to connect to witness receipt endpoint for witness receipts.",
      false,
    )
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
          proxy: options.proxy,
          endpoint: options.receiptEndpoint || false,
        },
      });
    });
}

/**
 * Register the single-sig rotation command surface.
 *
 * Maintainer note:
 * - the option set intentionally mirrors KLI even where runtime support is not
 *   yet complete, because parser/help parity is tracked independently from
 *   implementation parity
 */
function registerRotateCmd(program: Command, dispatch: CommandDispatch): void {
  program
    .command("rotate")
    .description("Rotate keys")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption(
      "-a, --alias <alias>",
      "Human readable alias for the identifier prefix",
    )
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .option(
      "-f, --file <file>",
      "File path of config options (JSON) for rotation",
      "",
    )
    .option(
      "-C, --next-count <count>",
      "Count of pre-rotated keys (signing keys after next rotation).",
      (value: string) => Number(value),
    )
    .option(
      "--receipt-endpoint",
      "Attempt to connect to witness receipt endpoint for witness receipts.",
      false,
    )
    .option(
      "-z, --authenticate",
      "Prompt the controller for authentication codes for each witness",
      false,
    )
    .option(
      "--code <code>",
      "<Witness AID>:<code> formatted witness auth codes",
      (value: string, prev: string[] = []) => {
        prev.push(value);
        return prev;
      },
      [],
    )
    .option("--code-time <time>", "Time the witness codes were captured.")
    .option("--proxy <alias>", "Alias for delegation communication proxy")
    .option("-i, --isith <isith>", "Current signing threshold")
    .option("-x, --nsith <nsith>", "Next signing threshold")
    .option(
      "-t, --toad <toad>",
      "Witness threshold (threshold of accountable duplicity)",
      (value: string) => Number(value),
    )
    .option(
      "-w, --witnesses <prefix>",
      "New set of witnesses, replaces all existing witnesses",
      (value: string, prev: string[] = []) => {
        prev.push(value);
        return prev;
      },
      [],
    )
    .option(
      "-c, --witness-cut <prefix>",
      "Witness prefix to remove",
      (value: string, prev: string[] = []) => {
        prev.push(value);
        return prev;
      },
      [],
    )
    .option(
      "-A, --witness-add <prefix>",
      "Witness prefix to add",
      (value: string, prev: string[] = []) => {
        prev.push(value);
        return prev;
      },
      [],
    )
    .option(
      "-d, --data <data>",
      "Anchor data, '@' allowed",
      (value: string, prev: string[] = []) => {
        prev.push(value);
        return prev;
      },
      [],
    )
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "rotate",
        args: {
          name: options.name,
          alias: options.alias,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
          file: options.file,
          nextCount: options.nextCount,
          endpoint: options.receiptEndpoint || false,
          authenticate: options.authenticate || false,
          code: options.code || [],
          codeTime: options.codeTime,
          proxy: options.proxy,
          isith: options.isith,
          nsith: options.nsith,
          toad: options.toad,
          witnesses: options.witnesses || [],
          cuts: options.witnessCut || [],
          witnessAdd: options.witnessAdd || [],
          data: options.data || [],
        },
      });
    });
}

/** Register the single-sig interaction command surface. */
function registerInteractCmd(
  program: Command,
  dispatch: CommandDispatch,
): void {
  program
    .command("interact")
    .description("Create and publish an interaction event")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption(
      "-a, --alias <alias>",
      "Human readable alias for the identifier prefix",
    )
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .option(
      "-d, --data <data>",
      "Anchor data, '@' allowed",
      (value: string, prev: string[] = []) => {
        prev.push(value);
        return prev;
      },
      [],
    )
    .option(
      "--receipt-endpoint",
      "Attempt to connect to witness receipt endpoint for witness receipts.",
      false,
    )
    .option(
      "-z, --authenticate",
      "Prompt the controller for authentication codes for each witness",
      false,
    )
    .option(
      "--code <code>",
      "<Witness AID>:<code> formatted witness auth codes",
      (value: string, prev: string[] = []) => {
        prev.push(value);
        return prev;
      },
      [],
    )
    .option("--code-time <time>", "Time the witness codes were captured.")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "interact",
        args: {
          name: options.name,
          alias: options.alias,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
          data: options.data || [],
          endpoint: options.receiptEndpoint || false,
          authenticate: options.authenticate || false,
          code: options.code || [],
          codeTime: options.codeTime,
        },
      });
    });
}

/** Register delegated-approval lifecycle commands. */
function registerDelegateCmd(
  program: Command,
  dispatch: CommandDispatch,
): void {
  const delegate = program
    .command("delegate")
    .description("Delegation lifecycle commands");

  delegate
    .command("confirm")
    .description("Approve delegated events anchored to one local delegator")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption(
      "-a, --alias <alias>",
      "Human readable alias for the delegator identifier prefix",
    )
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .option(
      "--interact",
      "Use an interaction event instead of a rotation event for approval",
      false,
    )
    .option(
      "--auto",
      "Approve all pending delegated events for this delegator in order",
      false,
    )
    .option(
      "-z, --authenticate",
      "Prompt the controller for authentication codes for each witness",
      false,
    )
    .option(
      "--code <code>",
      "<Witness AID>:<code> formatted witness auth codes",
      (value: string, prev: string[] = []) => {
        prev.push(value);
        return prev;
      },
      [],
    )
    .option("--code-time <time>", "Time the witness codes were captured.")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "delegate.confirm",
        args: {
          name: options.name,
          alias: options.alias,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
          interact: options.interact || false,
          auto: options.auto || false,
          authenticate: options.authenticate || false,
          code: options.code || [],
          codeTime: options.codeTime,
        },
      });
    });
}

/** Register the long-lived protocol host command surface. */
function registerAgentCmd(program: Command, dispatch: CommandDispatch): void {
  program
    .command("agent")
    .description("Start the KERI agent server")
    .requiredOption("-n, --name <name>", "Keystore name")
    .option("-b, --base <base>", "Optional base path prefix")
    .option(
      "-c, --config-dir <dir>",
      "Directory override for configuration data",
    )
    .option("--config-file <file>", "Configuration filename override")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-P, --passcode <passcode>", "Encryption passcode for keystore")
    .option("--outboxer", "Enable the tufa-local durable outbox sidecar", false)
    .option(
      "--cesr-body-mode <mode>",
      "CESR HTTP transport mode: header (default) or body",
    )
    .option(
      "-p, --port <port>",
      "Port number for the server (default: 8000)",
      "8000",
    )
    .action(function(this: Command) {
      const options = this.opts();
      dispatch({
        name: "agent",
        args: {
          name: options.name,
          base: options.base,
          configDir: options.configDir,
          configFile: options.configFile,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
          outboxer: options.outboxer || false,
          cesrBodyMode: options.cesrBodyMode,
          port: options.port ? Number(options.port) : 8000,
        },
      });
    });
}
