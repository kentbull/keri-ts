/** Commander registrations for group multisig lifecycle commands. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";
import { addStoreOptions, addWitnessAuthOptions, collectOption, witnessAuthArgs } from "./options.ts";
import { registerKeriCliCommand } from "./shared.ts";

/** Register group multisig lifecycle commands. */
export function registerMultisigCmd(program: Command, dispatch: CommandDispatch): void {
  const multisig = program
    .command("multisig")
    .description("Group multisig identifier lifecycle commands");

  registerMultisigInceptCmd(multisig, dispatch);
  registerMultisigInteractCmd(multisig, dispatch);
  registerMultisigJoinCmd(multisig, dispatch);
  registerMultisigRotateCmd(multisig, dispatch);
  registerMultisigRpyCmd(multisig, dispatch);
}

function registerMultisigInceptCmd(multisig: Command, dispatch: CommandDispatch): void {
  registerKeriCliCommand(
    addWitnessAuthOptions(
      addStoreOptions(
        multisig.command("incept")
          .description("Initialize a group multisig prefix")
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
          ),
      )
        .option("--proxy <alias>", "Alias for delegation communication proxy")
        .option(
          "--approval-timeout <seconds>",
          "Maximum wait for delegated multisig completion",
          (value: string) => Number(value),
          10,
        ),
    ),
    dispatch,
    "multisig.incept",
    "multisigInceptCommand",
    (options) => ({
      name: options.name,
      base: options.base,
      compat: options.compat || false,
      headDirPath: options.headDir,
      passcode: options.passcode,
      alias: options.alias,
      group: options.group,
      file: options.file,
      ...witnessAuthArgs(options),
      proxy: options.proxy,
      approvalTimeoutSeconds: options.approvalTimeout,
    }),
  );
}

function registerMultisigInteractCmd(multisig: Command, dispatch: CommandDispatch): void {
  registerKeriCliCommand(
    addWitnessAuthOptions(
      addStoreOptions(
        multisig.command("interact")
          .description("Create and publish a group multisig interaction event")
          .option(
            "-a, --alias <alias>",
            "Human readable alias for the group prefix",
          )
          .option("-g, --group <group>", "Human readable alias for the group prefix")
          .option(
            "-d, --data <data>",
            "Anchor data, '@' allowed",
            collectOption,
            [],
          ),
      ),
    ),
    dispatch,
    "multisig.interact",
    "multisigInteractCommand",
    (options) => ({
      name: options.name,
      alias: options.alias,
      group: options.group,
      base: options.base,
      compat: options.compat || false,
      headDirPath: options.headDir,
      passcode: options.passcode,
      data: options.data || [],
      ...witnessAuthArgs(options),
    }),
  );
}

function registerMultisigJoinCmd(multisig: Command, dispatch: CommandDispatch): void {
  registerKeriCliCommand(
    addWitnessAuthOptions(
      addStoreOptions(
        multisig.command("join")
          .description("Join one pending group multisig proposal")
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
          ),
      )
        .option("--proxy <alias>", "Alias for delegation communication proxy"),
    ),
    dispatch,
    "multisig.join",
    "multisigJoinCommand",
    (options) => ({
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
      ...witnessAuthArgs(options),
      proxy: options.proxy,
    }),
  );
}

function registerMultisigRotateCmd(multisig: Command, dispatch: CommandDispatch): void {
  registerKeriCliCommand(
    addWitnessAuthOptions(
      addStoreOptions(
        multisig.command("rotate")
          .description("Rotate a group multisig prefix")
          .option(
            "-a, --alias <alias>",
            "Human readable alias for the group prefix",
          )
          .option("-g, --group <group>", "Human readable alias for the group prefix")
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
          .option("--rmids <prefix>", "Rotation member prefix", collectOption, []),
      )
        .option("--proxy <alias>", "Alias for delegation communication proxy"),
    ),
    dispatch,
    "multisig.rotate",
    "multisigRotateCommand",
    (options) => ({
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
      ...witnessAuthArgs(options),
      proxy: options.proxy,
    }),
  );
}

function registerMultisigRpyCmd(multisig: Command, dispatch: CommandDispatch): void {
  registerKeriCliCommand(
    addStoreOptions(
      multisig.command("rpy")
        .description("Propose a group endpoint-role authorization reply")
        .option(
          "-a, --alias <alias>",
          "Human readable alias for the group prefix",
        )
        .option("-g, --group <group>", "Human readable alias for the group prefix")
        .requiredOption("--eid <aid>", "Endpoint provider AID")
        .option("--role <role>", "Endpoint role", "mailbox")
        .option("--cut", "Propose endpoint role removal", false)
        .option(
          "--approval-timeout <seconds>",
          "Maximum wait for multisig reply completion",
          (value: string) => Number(value),
          0,
        ),
    ),
    dispatch,
    "multisig.rpy",
    "multisigRpyCommand",
    (options) => ({
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
    }),
  );
}
