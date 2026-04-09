/** Commander registrations for mailbox management commands. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";

/** Register mailbox management commands. */
export function registerMailboxCmds(
  program: Command,
  dispatch: CommandDispatch,
): void {
  const mailbox = program.command("mailbox").description(
    "Manage mailbox relay authorization and cursors",
  );

  mailbox
    .command("start")
    .description("Provision and run one local mailbox host")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-a, --alias <alias>", "Local mailbox alias")
    .option("-u, --url <url>", "Advertised mailbox URL")
    .option("--datetime <time>", "Authoritative startup timestamp")
    .option("--config-file <name>", "Mailbox startup config file or path")
    .option("--port <port>", "Local HTTP port override")
    .option("--listen-host <host>", "Local listen host override")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--cesr-body-mode <mode>",
      "CESR HTTP transport mode: header (default) or body",
    )
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "mailbox.start",
        args: {
          name: options.name,
          alias: options.alias,
          url: options.url,
          datetime: options.datetime,
          configFile: options.configFile,
          port: options.port,
          listenHost: options.listenHost,
          base: options.base,
          compat: options.compat || false,
          cesrBodyMode: options.cesrBodyMode,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });

  mailbox
    .command("add")
    .description("Authorize one remote mailbox provider for a local identifier")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-a, --alias <alias>", "Local identifier alias")
    .requiredOption(
      "-w, --mailbox <mailbox>",
      "Mailbox AID or exact contact alias",
    )
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option("--outboxer", "Use the tufa-local durable outbox sidecar", false)
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "mailbox.add",
        args: {
          name: options.name,
          alias: options.alias,
          mailbox: options.mailbox,
          base: options.base,
          compat: options.compat || false,
          outboxer: options.outboxer || false,
          cesrBodyMode: options.cesrBodyMode,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });

  mailbox
    .command("remove")
    .description("Revoke one remote mailbox provider for a local identifier")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-a, --alias <alias>", "Local identifier alias")
    .requiredOption(
      "-w, --mailbox <mailbox>",
      "Mailbox AID or exact contact alias",
    )
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option("--outboxer", "Use the tufa-local durable outbox sidecar", false)
    .option(
      "--cesr-body-mode <mode>",
      "CESR HTTP transport mode: header (default) or body",
    )
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "mailbox.remove",
        args: {
          name: options.name,
          alias: options.alias,
          mailbox: options.mailbox,
          base: options.base,
          compat: options.compat || false,
          outboxer: options.outboxer || false,
          cesrBodyMode: options.cesrBodyMode,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });

  mailbox
    .command("list")
    .description("List authorized mailboxes for one local identifier")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-a, --alias <alias>", "Local identifier alias")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option("--outboxer", "Use the tufa-local durable outbox sidecar", false)
    .option(
      "--cesr-body-mode <mode>",
      "CESR HTTP transport mode: header (default) or body",
    )
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "mailbox.list",
        args: {
          name: options.name,
          alias: options.alias,
          base: options.base,
          compat: options.compat || false,
          outboxer: options.outboxer || false,
          cesrBodyMode: options.cesrBodyMode,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });

  mailbox
    .command("update")
    .description("Update one local mailbox topic cursor")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-a, --alias <alias>", "Local identifier alias")
    .requiredOption("-w, --witness <aid>", "Mailbox or witness AID")
    .requiredOption("-t, --topic <topic>", "Mailbox topic")
    .requiredOption("-i, --index <index>", "Next consumed topic index")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option("--outboxer", "Use the tufa-local durable outbox sidecar", false)
    .option(
      "--cesr-body-mode <mode>",
      "CESR HTTP transport mode: header (default) or body",
    )
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "mailbox.update",
        args: {
          name: options.name,
          alias: options.alias,
          witness: options.witness,
          topic: options.topic,
          index: options.index ? Number(options.index) : undefined,
          base: options.base,
          compat: options.compat || false,
          outboxer: options.outboxer || false,
          cesrBodyMode: options.cesrBodyMode,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });

  mailbox
    .command("debug")
    .description("Display mailbox cursor and remote mailbox topic state")
    .requiredOption("-n, --name <name>", "Keystore name")
    .requiredOption("-a, --alias <alias>", "Local identifier alias")
    .requiredOption("-w, --witness <aid>", "Mailbox or witness AID")
    .option("-V, --verbose", "Print full mailbox event bodies")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option("--outboxer", "Use the tufa-local durable outbox sidecar", false)
    .option(
      "--cesr-body-mode <mode>",
      "CESR HTTP transport mode: header (default) or body",
    )
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "mailbox.debug",
        args: {
          name: options.name,
          alias: options.alias,
          witness: options.witness,
          verbose: options.verbose || false,
          base: options.base,
          compat: options.compat || false,
          outboxer: options.outboxer || false,
          cesrBodyMode: options.cesrBodyMode,
          headDirPath: options.headDir,
          passcode: options.passcode,
        },
      });
    });
}
