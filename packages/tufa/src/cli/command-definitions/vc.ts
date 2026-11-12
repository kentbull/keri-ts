/** Commander registrations for vc operations; command adapters own effects. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";
import {
  addHabOption,
  addStoreOptions,
  addWitnessAuthOptions,
  collectOption,
  dispatchArgs,
  witnessAuthArgs,
} from "./options.ts";
import { registerDispatchedCommand, registerKeriCliCommand } from "./shared.ts";

/**
 * Register credential commands and their operator inputs before lazy execution.
 *
 * @param program Borrowed Commander root receiving the `vc` subtree.
 * @param dispatch Receives parsed command arguments; handlers validate domain values before I/O.
 */
export function registerVcCmds(program: Command, dispatch: CommandDispatch): void {
  const vc = program.command("vc").description("Credential operations");
  const wallet = vc.command("wallet").description("ACDC v2 wallet inventory and exact admitted disclosures");
  for (const operation of ["list", "read"] as const) {
    const command = addStoreOptions(wallet.command(operation));
    if (operation === "read") {
      command.requiredOption("--grant <said>", "Admitted Grant SAID selecting the exact disclosure");
    }
    registerDispatchedCommand(command, dispatch, {
      name: `vc.wallet.${operation}`,
      load: () => import("../commands/credentials.ts"),
      exportName: operation === "list" ? "walletListCommand" : "walletReadCommand",
      args: dispatchArgs,
    });
  }

  const schema = vc.command("schema").description("Credential schema operations");
  registerKeriCliCommand(
    addStoreOptions(
      schema.command("import")
        .description("Import one or more ACDC JSON schemas")
        .requiredOption(
          "--schema <file>",
          "Schema JSON file",
          (value: string, prev: string[] = []) => {
            prev.push(value);
            return prev;
          },
          [],
        ),
    ),
    dispatch,
    "vc.schema.import",
    "vcSchemaImportCommand",
  );

  const registry = vc.command("registry").description("Credential registry operations");
  const root = registry.command("root").description(
    "Replicate existing ACDC v2 registry roots to members by ESSR exn (local profile)",
  );
  const verbs = [
    ["send", "Send one held registry root to members by ESSR exn through their mailboxes", "registryRootSendCommand"],
    [
      "receive",
      "Optional drain: any runtime that polls the credential mailbox already retains root copies",
      "registryRootReceiveCommand",
    ],
    [
      "newcomers",
      "Send every held group root to the members added by one accepted group rotation",
      "registryRootNewcomersCommand",
    ],
  ] as const;
  for (const [verb, description, exportName] of verbs) {
    const command = addHabOption(addStoreOptions(root.command(verb))).description(description)
      .option("--timeout <seconds>", "Finite whole-operation wait (default: 60)");
    if (verb === "send") {
      command.requiredOption("--registry <said>", "Accepted registry SAID whose root is held locally")
        .option(
          "--recipient <aid>",
          "Individual member AID or alias (repeatable); a group alias defaults to its other current members",
          collectOption,
          [],
        )
        .option("--holder <aid>", "AID the root is held for (defaults to the group alias, else the recipient)")
        .option("--event <said>", "Accepted BUP SAID hint (defaults to the registry head)")
        .option(
          "--acdc <said>",
          "ACDC SAID hint overriding the one derived per registry from a held opening or stored Grant",
        )
        .option("--out <file>", "Exclusive-create file for the signed exn instead of mailbox delivery");
    } else if (verb === "newcomers") {
      command.requiredOption("--rotation <said>", "Accepted group rotation SAID that added members")
        .option(
          "--registry <said>",
          "Limit to these registry SAIDs (repeatable; default: every held root)",
          collectOption,
          [],
        )
        .option(
          "--acdc <said>",
          "ACDC SAID hint overriding the one derived per registry from a held opening or stored Grant",
        )
        .option("--out <file>", "Exclusive-create file for the signed exns instead of mailbox delivery");
    } else {
      command.option("--registry <said>", "Require a retained root for this registry SAID; --listen waits for it")
        .option("--said <said>", "Manually retry this stored exn SAID (with --event/--opening)")
        .option("--event <said>", "Accepted BUP SAID overriding the sender hint for --said")
        .option("--opening <file>", "Held CESR state opening file for --said")
        .option("--listen", "Optional: process the credential mailbox until --registry is retained")
        .option("--message <file>", "Fallback: signed exn file (repeatable)", collectOption, []);
    }
    registerDispatchedCommand(command, dispatch, {
      name: `vc.registry.root.${verb}`,
      load: () => import("../commands/registry-root.ts"),
      exportName,
      args: dispatchArgs,
    });
  }
  registerDispatchedCommand(
    addHabOption(
      addStoreOptions(
        addWitnessAuthOptions(registry.command("incept"), true)
          .description("Create a local credential registry")
          .option("--acdc-v2", "Use ACDC v2 registry acceptance")
          .option("--witness-gvrsn <version>", "Configured witness attachment genus (default: 1)")
          .option("--with-custody", "Provision encrypted derivation custody after accepted inception")
          .requiredOption("--registry-name <name>", "Registry name")
          .option("--usage <text>", "Human-readable registry usage for multisig proposals")
          .option("--timeout <seconds>", "Wait for local TEL publication (default: 60; 0 returns pending state)")
          .option("--est-only", "Anchor TEL events only in establishment events", false),
      ),
    ),
    dispatch,
    {
      name: "vc.registry.incept",
      load: () => import("../commands/credentials.ts"),
      exportName: "vcRegistryInceptCommand",
      args: (options) => ({
        ...dispatchArgs(options),
        ...witnessAuthArgs(options, true),
        estOnly: options.estOnly || false,
        usage: options.usage,
      }),
    },
  );
  registerKeriCliCommand(
    addStoreOptions(
      registry.command("list")
        .description("List local credential registries"),
    ),
    dispatch,
    "vc.registry.list",
    "vcRegistryListCommand",
  );
  registerKeriCliCommand(
    addStoreOptions(
      registry.command("status")
        .description("Show one credential registry state")
        .requiredOption("--registry-name <name>", "Registry name"),
    ),
    dispatch,
    "vc.registry.status",
    "vcRegistryStatusCommand",
  );

  registerDispatchedCommand(
    addHabOption(
      addStoreOptions(
        addWitnessAuthOptions(vc.command("create"), true)
          .description("Create and issue a registry-backed credential")
          .option("--acdc-v2", "Use ACDC v2 issuance")
          .option("--prepare", "Write a fresh public ACDC v2 body to --out without root, BUP or inventory")
          .option("--witness-gvrsn <version>", "Configured witness attachment genus (default: 1)")
          .option("--public", "Deliberately publish the BUP opening; otherwise derive from custody")
          .option("--bound-event <said>", "Exact accepted witnessed Issuee event for derived BUP")
          .requiredOption("--registry-name <name>", "Registry name")
          .option(
            "--timeout <seconds>",
            "Wait for saved credential and local TEL publication (default: 60; 0 returns pending state)",
          )
          .option("--schema <said>", "Schema SAID")
          .option("--schema-file <file>", "Import schema JSON and use its SAID")
          .option("-r, --recipient <aid>", "Recipient AID or local alias")
          .option("--data <json>", "Credential subject data JSON or @file")
          .option("--edges <json>", "Credential edge/source links JSON or @file")
          .option("--rules <json>", "Credential rules JSON or @file")
          .option("--out <file>", "Write exportable credential stream"),
      ),
    ),
    dispatch,
    {
      name: "vc.create",
      load: () => import("../commands/credentials.ts"),
      exportName: "vcCreateCommand",
      args: options => ({ ...dispatchArgs(options), ...witnessAuthArgs(options, true) }),
    },
  );

  registerDispatchedCommand(
    addHabOption(addStoreOptions(
      addWitnessAuthOptions(vc.command("update"), true)
        .description("Advance ACDC v2 BUP state; never authors historical upd")
        .option("--witness-gvrsn <version>", "Configured witness attachment genus (default: 1)")
        .requiredOption("--registry-name <name>", "ACDC v2 registry alias")
        .requiredOption("--said <said>", "Locally issued credential")
        .requiredOption("--state <state>", "New explicit state")
        .option("--timeout <seconds>", "Wait for exact ACDC v2 acceptance (default: 60)")
        .option("--bound-event <said>", "Exact accepted witnessed Issuee event for derived BUP")
        .option("--public", "Deliberately publish the opening"),
    )),
    dispatch,
    {
      name: "vc.update",
      load: () => import("../commands/acdc-v2-authoring.ts"),
      exportName: "acdcV2UpdateCommand",
      args: options => ({ ...dispatchArgs(options), ...witnessAuthArgs(options) }),
    },
  );
  registerKeriCliCommand(
    addStoreOptions(
      vc.command("list")
        .description("List saved credentials")
        .option("-a, --alias <alias>", "Filter by local alias")
        .option("--aid <aid>", "Filter by subject or issuer AID")
        .option("--schema <said>", "Filter by schema SAID")
        .option("--issued", "List issued credentials instead of received"),
    ),
    dispatch,
    "vc.list",
    "vcListCommand",
  );

  registerKeriCliCommand(
    addStoreOptions(
      vc.command("export")
        .description("Export one credential stream")
        .requiredOption("--said <said>", "Credential SAID")
        .option("-r, --recipient <aid>", "Recipient AID or local alias")
        .option("--out <file>", "Output file"),
    ),
    dispatch,
    "vc.export",
    "vcExportCommand",
  );

  registerKeriCliCommand(
    addStoreOptions(
      vc.command("import")
        .description("Import a CESR credential stream")
        .option("--in <file>", "Input stream file; defaults to stdin")
        .option(
          "--settlement-timeout-ms <milliseconds>",
          "Positive post-input settlement timeout; fractions floor with a 1 ms minimum",
        ),
    ),
    dispatch,
    "vc.import",
    "vcImportCommand",
    (options) => ({ ...dispatchArgs(options), inPath: options.in }),
  );

  registerDispatchedCommand(
    addStoreOptions(
      addWitnessAuthOptions(vc.command("revoke"), true)
        .description("Revoke a local credential")
        .option("--acdc-v2", "Use an ACDC v2 revoked BUP")
        .option("--witness-gvrsn <version>", "Configured witness attachment genus (default: 1)")
        .option("--public", "Deliberately publish the BUP opening; otherwise derive from custody")
        .option("--bound-event <said>", "Exact accepted witnessed Issuee event for derived BUP")
        .option("-a, --alias <alias>", "Human readable alias for the local identifier")
        .requiredOption("--registry-name <name>", "Registry name")
        .requiredOption("--said <said>", "Credential SAID")
        .option("-r, --recipient <aid>", "Recipient AID or local alias")
        .option(
          "--send <recipient>",
          "Alias or AID to send revocation events to; may be repeated",
          (value: string, prev: string[] = []) => {
            prev.push(value);
            return prev;
          },
          [],
        )
        .option("--timeout <seconds>", "Wait for local REV publication (default: 60; 0 returns pending state)")
        .option("--out <file>", "Write the updated credential stream only after REV publication completes"),
    ),
    dispatch,
    {
      name: "vc.revoke",
      load: () => import("../commands/credentials.ts"),
      exportName: "vcRevokeCommand",
      args: options => ({ ...dispatchArgs(options), ...witnessAuthArgs(options, true) }),
    },
  );
}
