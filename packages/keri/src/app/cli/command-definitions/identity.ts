import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";

/** Register identifier, signing, and inspection commands. */
export function registerIdentityCmds(
  program: Command,
  dispatch: CommandDispatch,
): void {
  registerSignCmd(program, dispatch);
  registerVerifyCmd(program, dispatch);
  registerQueryCmd(program, dispatch);
  registerExportCmd(program, dispatch);
  registerListCmd(program, dispatch);
  registerAidCmd(program, dispatch);
  registerAnnotateCmd(program, dispatch);
}

function registerSignCmd(program: Command, dispatch: CommandDispatch): void {
  program
    .command("sign")
    .description("Sign an arbitrary string")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption(
      "-a, --alias <alias>",
      "Human readable alias for the identifier prefix",
    )
    .requiredOption(
      "-t, --text <text>",
      "Text or file (starts with '@') to sign",
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
        name: "sign",
        args: {
          name: options.name,
          alias: options.alias,
          text: options.text,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });
}

function registerVerifyCmd(program: Command, dispatch: CommandDispatch): void {
  program
    .command("verify")
    .description("Verify signature(s) on arbitrary data")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("--prefix <prefix>", "Identifier prefix of the signer")
    .requiredOption(
      "-t, --text <text>",
      "Original signed text or file (starts with '@')",
    )
    .requiredOption(
      "-s, --signature <signature>",
      "Signature to verify",
      (value: string, prev: string[] = []) => {
        prev.push(value);
        return prev;
      },
      [],
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
        name: "verify",
        args: {
          name: options.name,
          prefix: options.prefix,
          text: options.text,
          signature: options.signature || [],
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });
}

function registerQueryCmd(program: Command, dispatch: CommandDispatch): void {
  program
    .command("query")
    .description("Request KEL from Witness")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption(
      "-a, --alias <alias>",
      "Human readable alias for the identifier prefix",
    )
    .requiredOption("--prefix <prefix>", "QB64 identifier to query")
    .option("--anchor <file>", "JSON file containing the anchor to search for")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "query",
        args: {
          name: options.name,
          alias: options.alias,
          prefix: options.prefix,
          anchor: options.anchor,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });
}

function registerExportCmd(program: Command, dispatch: CommandDispatch): void {
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
    });
}

function registerListCmd(program: Command, dispatch: CommandDispatch): void {
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
    });
}

function registerAidCmd(program: Command, dispatch: CommandDispatch): void {
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
    .option("--outboxer", "Enable the tufa-local durable outbox sidecar", false)
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
    });
}

function registerAnnotateCmd(program: Command, dispatch: CommandDispatch): void {
  program
    .command("annotate")
    .description("Annotate CESR stream from file or stdin")
    .option("--in <path>", "Input file path (defaults to stdin)")
    .option("--out <path>", "Output file path (defaults to stdout)")
    .option("--qb2", "Treat input as qb2 binary instead of text CESR")
    .option("--pretty", "Pretty-print annotation output")
    .option("--colored", "Colorize annotation output (stdout only)")
    .action((
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
    });
}
