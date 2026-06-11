/** Commander registrations for group multisig lifecycle commands. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";
import { collectOption } from "./options.ts";
import { registerCommandHandler } from "./shared.ts";

/** Register group multisig lifecycle commands. */
export function registerMultisigCmd(program: Command, dispatch: CommandDispatch): void {
  const multisig = program
    .command("multisig")
    .description("Group multisig identifier lifecycle commands");

  multisig
    .command("incept")
    .description("Initialize a group multisig prefix")
    .requiredOption("-n, --name <name>", "Keystore name")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .requiredOption(
      "-a, --alias <alias>",
      "Human readable alias for the local signing member",
    )
    .requiredOption(
      "-g, --group <group>",
      "Human readable alias for the new group prefix",
    )
    .requiredOption(
      "-f, --file <file>",
      "File path of KLI-style multisig inception options (JSON)",
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
      collectOption,
      [],
    )
    .option("--code-time <time>", "Time the witness codes were captured.")
    .option("--proxy <alias>", "Alias for delegation communication proxy")
    .option(
      "--approval-timeout <seconds>",
      "Maximum wait for delegated multisig completion",
      (value: string) => Number(value),
      10,
    )
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "multisig.incept",
        args: {
          name: options.name,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
          alias: options.alias,
          group: options.group,
          file: options.file,
          endpoint: options.receiptEndpoint || false,
          authenticate: options.authenticate || false,
          code: options.code || [],
          codeTime: options.codeTime,
          proxy: options.proxy,
          approvalTimeoutSeconds: options.approvalTimeout,
        },
      });
    });
  registerCommandHandler("multisig.incept", () => import("keri-ts/cli"), "multisigInceptCommand");

  multisig
    .command("interact")
    .description("Create and publish a group multisig interaction event")
    .requiredOption("-n, --name <name>", "Keystore name")
    .option(
      "-a, --alias <alias>",
      "Human readable alias for the group prefix",
    )
    .option("-g, --group <group>", "Human readable alias for the group prefix")
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
      collectOption,
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
      collectOption,
      [],
    )
    .option("--code-time <time>", "Time the witness codes were captured.")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "multisig.interact",
        args: {
          name: options.name,
          alias: options.alias,
          group: options.group,
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
  registerCommandHandler("multisig.interact", () => import("keri-ts/cli"), "multisigInteractCommand");

  multisig
    .command("join")
    .description("Join one pending group multisig proposal")
    .requiredOption("-n, --name <name>", "Keystore name")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .option(
      "-g, --group <group>",
      "Human readable alias for a newly joined group prefix",
    )
    .option("--registry-name <name>", "Registry name for multisig registry approvals")
    .option("--said <said>", "Specific multisig EXN SAID to approve")
    .option(
      "-Y, --auto",
      "Auto approve the matching multisig proposal non-interactively",
      false,
    )
    .option(
      "--poll-turns <turns>",
      "Maximum mailbox polling turns before failing",
      (value: string) => Number(value),
      32,
    )
    .option(
      "--poll-budget-ms <milliseconds>",
      "Mailbox polling budget per turn",
      (value: string) => Number(value),
      2000,
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
      collectOption,
      [],
    )
    .option("--code-time <time>", "Time the witness codes were captured.")
    .option("--proxy <alias>", "Alias for delegation communication proxy")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "multisig.join",
        args: {
          name: options.name,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
          group: options.group,
          registryName: options.registryName,
          said: options.said,
          auto: options.auto || false,
          pollTurns: options.pollTurns,
          pollBudgetMs: options.pollBudgetMs,
          endpoint: options.receiptEndpoint || false,
          authenticate: options.authenticate || false,
          code: options.code || [],
          codeTime: options.codeTime,
          proxy: options.proxy,
        },
      });
    });
  registerCommandHandler("multisig.join", () => import("keri-ts/cli"), "multisigJoinCommand");

  multisig
    .command("rotate")
    .description("Rotate a group multisig prefix")
    .requiredOption("-n, --name <name>", "Keystore name")
    .option(
      "-a, --alias <alias>",
      "Human readable alias for the group prefix",
    )
    .option("-g, --group <group>", "Human readable alias for the group prefix")
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
      collectOption,
      [],
    )
    .option(
      "-c, --witness-cut <prefix>",
      "Witness prefix to remove",
      collectOption,
      [],
    )
    .option(
      "-A, --witness-add <prefix>",
      "Witness prefix to add",
      collectOption,
      [],
    )
    .option(
      "-d, --data <data>",
      "Anchor data, '@' allowed",
      collectOption,
      [],
    )
    .option("--smids <prefix>", "Signing member prefix", collectOption, [])
    .option("--rmids <prefix>", "Rotation member prefix", collectOption, [])
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
      collectOption,
      [],
    )
    .option("--code-time <time>", "Time the witness codes were captured.")
    .option("--proxy <alias>", "Alias for delegation communication proxy")
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "multisig.rotate",
        args: {
          name: options.name,
          alias: options.alias,
          group: options.group,
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
          file: options.file,
          isith: options.isith,
          nsith: options.nsith,
          toad: options.toad,
          witnesses: options.witnesses || [],
          cuts: options.witnessCut || [],
          witnessAdd: options.witnessAdd || [],
          data: options.data || [],
          smids: options.smids || [],
          rmids: options.rmids || [],
          endpoint: options.receiptEndpoint || false,
          authenticate: options.authenticate || false,
          code: options.code || [],
          codeTime: options.codeTime,
          proxy: options.proxy,
        },
      });
    });
  registerCommandHandler("multisig.rotate", () => import("keri-ts/cli"), "multisigRotateCommand");

  multisig
    .command("rpy")
    .description("Propose a group endpoint-role authorization reply")
    .requiredOption("-n, --name <name>", "Keystore name")
    .option(
      "-a, --alias <alias>",
      "Human readable alias for the group prefix",
    )
    .option("-g, --group <group>", "Human readable alias for the group prefix")
    .requiredOption("--eid <aid>", "Endpoint provider AID")
    .option("--role <role>", "Endpoint role", "mailbox")
    .option("--cut", "Propose endpoint role removal", false)
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root (default fallback: ~/.tufa)",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore")
    .option(
      "--approval-timeout <seconds>",
      "Maximum wait for multisig reply completion",
      (value: string) => Number(value),
      0,
    )
    .action((options: Record<string, unknown>) => {
      dispatch({
        name: "multisig.rpy",
        args: {
          name: options.name,
          alias: options.alias,
          group: options.group,
          eid: options.eid,
          role: options.role,
          allow: !(options.cut || false),
          base: options.base,
          compat: options.compat || false,
          headDirPath: options.headDir,
          passcode: options.passcode,
          approvalTimeoutSeconds: options.approvalTimeout,
        },
      });
    });
  registerCommandHandler("multisig.rpy", () => import("keri-ts/cli"), "multisigRpyCommand");
}
