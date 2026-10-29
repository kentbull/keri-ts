/** Commander registrations for vc operations; command adapters own effects. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";
import { addHabOption, addStoreOptions, collectOption, dispatchArgs } from "./options.ts";
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
  const salt = registry.command("salt").description("Encrypted ACDC v2 registry salt replies");
  for (const operation of ["send", "receive", "status", "serve"] as const) {
    const command = addHabOption(addStoreOptions(salt.command(operation)))
      .requiredOption("--registry <said>", "Accepted registry inception SAID")
      .option("--evidence <file>", "Public CESR evidence file", collectOption, []);
    if (operation === "send") {
      command.requiredOption("--party <aid>", "Logical salt recipient")
        .option("--target <aid>", "Individual recipient member")
        .option(
          "--output <file>",
          "New signed encrypted reply file (group output is a signature contribution)",
        )
        .option("--endpoint <url>", "HTTP(S) CESR intake endpoint")
        .option("--essr", "Wrap the signed reply in an ESSR envelope for the individual recipient")
        .option("--timeout <seconds>", "Finite transport deadline (default: 30)");
    }
    if (operation === "serve") {
      command.option("--host <host>", "Listen host (default: 127.0.0.1)").option(
        "--port <port>",
        "HTTP port (default: 7723)",
      );
    }
    if (operation === "receive") command.requiredOption("--input <file>", "Signed encrypted reply file");
    registerDispatchedCommand(command, dispatch, {
      name: `vc.registry.salt.${operation}`,
      load: () => import("../commands/registry-salt.ts"),
      exportName: "registrySaltCommand",
      args: (options) => ({ ...dispatchArgs(options), operation }),
    });
  }

  registerDispatchedCommand(
    addHabOption(
      addStoreOptions(
        registry.command("incept")
          .description("Create a local credential registry")
          .option("--acdc-v2", "Use ACDC v2 registry acceptance")
          .option("--witness-gvrsn <version>", "Configured witness attachment genus (default: 1)")
          .option("--with-custody", "Provision encrypted derivation custody after accepted inception")
          .option("--discloser <aid>", "Explicit designated custody participant")
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
        vc.command("create")
          .description("Create and issue a registry-backed credential")
          .option("--acdc-v2", "Use ACDC v2 issuance")
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
      args: dispatchArgs,
    },
  );

  registerDispatchedCommand(
    addHabOption(addStoreOptions(
      vc.command("update")
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
      args: dispatchArgs,
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
      vc.command("revoke")
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
      args: dispatchArgs,
    },
  );
}
