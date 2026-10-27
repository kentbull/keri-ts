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
          .option("--schema <said>", "Requested legacy schema SAID")
          .option("--acdc-v2", "Use ACDC v2 wallet IPEX")
          .option("--plan <json>", "ACDC v2 flat disclosure plan JSON or @file")
          .option("--xid <said>", "ACDC v2 conversation identifier")
          .option("--anchor", "Require witnessed source anchoring")
          .option("--out <file>", "Write ACDC v2 request wire")
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
          .option("--acdc <file>", "Embedded legacy ACDC stream file")
          .option("--apply <said>", "Prior apply EXN SAID")
          .option("--acdc-v2", "Offer an exact ACDC v2 wallet view")
          .option("--said <said>", "Issued ACDC v2 credential")
          .option("--from-grant <said>", "Exact admitted or authorized transferred Grant")
          .option("--view <file>", "Exact transferred ACDC v2 credential/proof stream")
          .option("--presenter-authorized", "Explicitly authorize presentation of a transferred view")
          .option("--disclose <json>", "Attribute paths JSON or @file")
          .option("--plan <json>", "ACDC v2 flat disclosure plan JSON or @file")
          .option("--xid <said>", "ACDC v2 conversation identifier")
          .option("--anchor", "Require witnessed source anchoring")
          .option("--out <file>", "Write ACDC v2 offer wire")
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
          .option("--acdc-v2", "Agree to an authenticated ACDC v2 offer")
          .option("--witness-gvrsn <version>", "Configured witness attachment genus (default: 1)")
          .option("--out <file>", "Write ACDC v2 agreement wire")
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
            .option("--said <said>", "Credential SAID")
            .option("--acdc-v2", "Grant an exact ACDC v2 wallet disclosure")
            .option("--witness-gvrsn <version>", "Configured witness attachment genus (default: 1)")
            .option("--from-grant <said>", "Exact admitted or authorized transferred Grant")
            .option("--view <file>", "Exact transferred ACDC v2 credential/proof stream")
            .option("--presenter-authorized", "Explicitly authorize presentation of a transferred view")
            .option("--disclose <json>", "Attribute paths JSON or @file")
            .option("--refresh", "Refresh proofs without expanding the retained credential view")
            .option("--derive", "Explicitly use provisioned registry custody")
            .option("--opening <files...>", "Exact counted blind/bound opening files")
            .option("--bound-event <said>", "Exact accepted witnessed Issuee KEL event")
            .option("--presentation-registry <name>", "Local registry declared by the selected Issuee view")
            .option("--plan <json>", "ACDC v2 flat disclosure plan JSON or @file")
            .option("--xid <said>", "ACDC v2 conversation identifier")
            .option("--anchor", "Require witnessed source anchoring")
            .option("--input <file>", "Ingest signed ACDC v2 evidence before this action")
            .option("--agree <said>", "Prior agree EXN SAID")
            .option("--prior <said>", "Prior ACDC v2 Apply or Agree EXN SAID")
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
          .option("--acdc-v2", "Admit an accepted ACDC v2 Grant into wallet inventory")
          .option("--witness-gvrsn <version>", "Configured witness attachment genus (default: 1)")
          .option("--consent", "Explicitly consent to ACDC v2 wallet admission after current graph verification")
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
      args: (options) => ({ ...dispatchArgs(options), noWait: options.wait === false }),
    },
  );

  registerDispatchedCommand(
    addHabOption(
      addStoreOptions(
        ipex.command("spurn")
          .description("Send an IPEX spurn")
          .requiredOption("-r, --recipient <aid>", "Recipient AID or contact alias")
          .requiredOption("--prior <said>", "Prior IPEX EXN SAID")
          .option("--acdc-v2", "Spurn the authenticated ACDC v2 predecessor")
          .option("--out <file>", "Write ACDC v2 spurn wire")
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
    addHabOption(addStoreOptions(
      ipex.command("unblind")
        .description("Recover an ACDC v2 opening candidate without claiming accepted standing")
        .requiredOption("--opening <file>", "Counted blind/bound opening file")
        .requiredOption("--said <said>", "Candidate credential SAID")
        .option("--states <json>", "Candidate state string array", "[]")
        .option("--out <file>", "Write the matching counted opening"),
    )),
    dispatch,
    {
      name: "ipex.unblind",
      load: () => import("../commands/ipex.ts"),
      exportName: "ipexUnblindCommand",
      args: dispatchArgs,
    },
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
