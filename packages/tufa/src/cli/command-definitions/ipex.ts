/** Commander registrations for ipex operations; command adapters own effects. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";
import { addGvrsnOption, addHabOption, addStoreOptions, dispatchArgs } from "./options.ts";
import { registerDispatchedCommand, registerKeriCliCommand } from "./shared.ts";

/** Register conversation and group-approval inputs; lazy dispatch owns execution and resource lifetimes. */
export function registerIpexCmds(program: Command, dispatch: CommandDispatch): void {
  const ipex = program.command("ipex").description("IPEX credential exchange operations");

  registerDispatchedCommand(
    addHabOption(
      addStoreOptions(
        ipex.command("apply")
          .description("Send an IPEX apply")
          .requiredOption("-r, --recipient <aid>", "Recipient AID or contact alias")
          .requiredOption("--schema <said>", "Requested schema SAID")
          .option("--attrs <json>", "Requested attributes JSON or @file")
          .option("--approval-timeout <seconds>", "Wait for group approval (default: 60; 0 returns pending)")
          .option("-m, --message <text>", "Human-readable message"),
      ),
    ),
    dispatch,
    {
      name: "ipex.apply",
      load: () => import("../commands/ipex.ts"),
      exportName: "ipexApplyCommand",
      args: dispatchArgs,
    },
  );

  registerDispatchedCommand(
    addHabOption(
      addStoreOptions(
        ipex.command("offer")
          .description("Send an IPEX offer")
          .requiredOption("-r, --recipient <aid>", "Recipient AID or contact alias")
          .requiredOption("--acdc <file>", "Embedded ACDC stream file")
          .option("--apply <said>", "Prior apply EXN SAID")
          .option("--approval-timeout <seconds>", "Wait for group approval (default: 60; 0 returns pending)")
          .option("-m, --message <text>", "Human-readable message"),
      ),
    ),
    dispatch,
    {
      name: "ipex.offer",
      load: () => import("../commands/ipex.ts"),
      exportName: "ipexOfferCommand",
      args: dispatchArgs,
    },
  );

  registerDispatchedCommand(
    addHabOption(
      addStoreOptions(
        ipex.command("agree")
          .description("Send an IPEX agree")
          .requiredOption("-r, --recipient <aid>", "Recipient AID or contact alias")
          .requiredOption("--offer <said>", "Prior offer EXN SAID")
          .option("--approval-timeout <seconds>", "Wait for group approval (default: 60; 0 returns pending)")
          .option("-m, --message <text>", "Human-readable message"),
      ),
    ),
    dispatch,
    {
      name: "ipex.agree",
      load: () => import("../commands/ipex.ts"),
      exportName: "ipexAgreeCommand",
      args: dispatchArgs,
    },
  );

  registerDispatchedCommand(
    addGvrsnOption(
      addHabOption(
        addStoreOptions(
          ipex.command("grant")
            .description("Send or write an IPEX credential grant")
            .requiredOption("-r, --recipient <aid>", "Recipient AID or contact alias")
            .requiredOption("--said <said>", "Credential SAID")
            .option("--agree <said>", "Prior agree EXN SAID")
            .option("-m, --message <text>", "Human-readable message")
            .option(
              "--approval-timeout <seconds>",
              "Seconds to wait for multisig IPEX approval before returning",
            )
            .option("--out <file>", "Write support artifacts plus grant wire"),
        ),
      ),
    ),
    dispatch,
    {
      name: "ipex.grant",
      load: () => import("../commands/ipex.ts"),
      exportName: "ipexGrantCommand",
      args: dispatchArgs,
    },
  );

  registerDispatchedCommand(
    addGvrsnOption(addHabOption(
      addStoreOptions(
        ipex.command("admit")
          .description("Send or write an IPEX admit after local credential acceptance")
          .option("--said <said>", "Accepted grant EXN SAID")
          .option("--grant-file <file>", "Authenticated grant/support wire file")
          .option("--timeout <seconds>", "Wait for local credential acceptance (default: 60; 0 returns pending)")
          .option("--approval-timeout <seconds>", "Wait for group approval (default: 60; 0 returns pending)")
          .option("-m, --message <text>", "Human-readable message")
          .option("--out <file>", "Write completed admit wire")
          .option("--no-wait", "Skip the saved-credential requirement; grant authentication remains required"),
      ),
    )),
    dispatch,
    {
      name: "ipex.admit",
      load: () => import("../commands/ipex.ts"),
      exportName: "ipexAdmitCommand",
      args: options => ({ ...dispatchArgs(options), noWait: options.wait === false }),
    },
  );

  registerDispatchedCommand(
    addHabOption(
      addStoreOptions(
        ipex.command("spurn")
          .description("Send an IPEX spurn")
          .requiredOption("-r, --recipient <aid>", "Recipient AID or contact alias")
          .requiredOption("--prior <said>", "Prior IPEX EXN SAID")
          .option("--approval-timeout <seconds>", "Wait for group approval (default: 60; 0 returns pending)")
          .option("-m, --message <text>", "Human-readable message"),
      ),
    ),
    dispatch,
    {
      name: "ipex.spurn",
      load: () => import("../commands/ipex.ts"),
      exportName: "ipexSpurnCommand",
      args: dispatchArgs,
    },
  );

  registerKeriCliCommand(
    addStoreOptions(
      ipex.command("list")
        .description("List stored IPEX EXNs"),
    ),
    dispatch,
    "ipex.list",
    "ipexListCommand",
  );

  registerDispatchedCommand(
    addHabOption(
      addGvrsnOption(addStoreOptions(
        ipex.command("poll")
          .description("Wait for new IPEX mailbox state until an elapsed deadline")
          .option(
            "--timeout <seconds>",
            "Elapsed mailbox wait in seconds (default 40)",
          ),
      )),
    ),
    dispatch,
    { name: "ipex.poll", load: () => import("../commands/ipex.ts"), exportName: "ipexPollCommand", args: dispatchArgs },
  );

  registerDispatchedCommand(
    addGvrsnOption(
      addStoreOptions(
        ipex.command("join")
          .description("Approve or validate a single-sig or multisig IPEX message")
          .option("--said <said>", "IPEX or multisig wrapper EXN SAID")
          .option("--auto", "Approve a multisig IPEX proposal without prompting", false)
          .option(
            "--approval-timeout <seconds>",
            "Elapsed proposal wait in seconds (default 60)",
          ),
      ),
    ),
    dispatch,
    { name: "ipex.join", load: () => import("../commands/ipex.ts"), exportName: "ipexJoinCommand", args: dispatchArgs },
  );
}
