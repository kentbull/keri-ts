import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";

/** Register endpoint and OOBI-related commands. */
export function registerEndpointCmds(
  program: Command,
  dispatch: CommandDispatch,
): void {
  registerEndsCmds(program, dispatch);
  registerLocCmds(program, dispatch);
  registerOobiCmds(program, dispatch);
}

function registerEndsCmds(program: Command, dispatch: CommandDispatch): void {
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
    });
}

function registerLocCmds(program: Command, dispatch: CommandDispatch): void {
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
    });
}

function registerOobiCmds(program: Command, dispatch: CommandDispatch): void {
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
    });
}
