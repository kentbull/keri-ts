import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";
import { registerDispatchedCommand } from "./shared.ts";

/** Register local notification inspection and mutation commands. */
export function registerNotificationCmds(
  program: Command,
  dispatch: CommandDispatch,
): void {
  const notifications = program.command("notifications").description(
    "Inspect and manage local controller notifications",
  );

  registerDispatchedCommand(
    notifications
      .command("list")
      .description("List local controller notifications")
      .requiredOption("-n, --name <name>", "Keystore name")
      .option("-b, --base <base>", "Optional base path prefix")
      .option("--compat", "Use KERIpy compatibility-mode path layout")
      .option(
        "--head-dir <dir>",
        "Directory override for database and keystore root (default fallback: ~/.tufa)",
      )
      .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
      .option(
        "--start <start>",
        "Zero-based starting row",
        (value: string) => Number(value),
        0,
      )
      .option(
        "--limit <limit>",
        "Maximum rows to return",
        (value: string) => Number(value),
        25,
      ),
    dispatch,
    {
      name: "notifications.list",
      load: () => import("keri-ts/cli"),
      exportName: "notificationsListCommand",
      args: (options: Record<string, unknown>) => ({
        name: options.name,
        base: options.base,
        compat: options.compat || false,
        headDirPath: options.headDir,
        passcode: options.passcode,
        start: options.start,
        limit: options.limit,
      }),
    },
  );

  registerDispatchedCommand(
    notifications
      .command("mark-read")
      .description("Mark one local notification as read")
      .requiredOption("-n, --name <name>", "Keystore name")
      .argument("<rid>", "Notification random id")
      .option("-b, --base <base>", "Optional base path prefix")
      .option("--compat", "Use KERIpy compatibility-mode path layout")
      .option(
        "--head-dir <dir>",
        "Directory override for database and keystore root (default fallback: ~/.tufa)",
      )
      .option("-p, --passcode <passcode>", "Encryption passcode for keystore"),
    dispatch,
    {
      name: "notifications.mark-read",
      load: () => import("keri-ts/cli"),
      exportName: "notificationsMarkReadCommand",
      args: (rid: string, options: Record<string, unknown>) => ({
        name: options.name,
        base: options.base,
        compat: options.compat || false,
        headDirPath: options.headDir,
        passcode: options.passcode,
        rid,
      }),
    },
  );

  registerDispatchedCommand(
    notifications
      .command("remove")
      .description("Remove one local notification")
      .requiredOption("-n, --name <name>", "Keystore name")
      .argument("<rid>", "Notification random id")
      .option("-b, --base <base>", "Optional base path prefix")
      .option("--compat", "Use KERIpy compatibility-mode path layout")
      .option(
        "--head-dir <dir>",
        "Directory override for database and keystore root (default fallback: ~/.tufa)",
      )
      .option("-p, --passcode <passcode>", "Encryption passcode for keystore"),
    dispatch,
    {
      name: "notifications.remove",
      load: () => import("keri-ts/cli"),
      exportName: "notificationsRemoveCommand",
      args: (rid: string, options: Record<string, unknown>) => ({
        name: options.name,
        base: options.base,
        compat: options.compat || false,
        headDirPath: options.headDir,
        passcode: options.passcode,
        rid,
      }),
    },
  );
}
