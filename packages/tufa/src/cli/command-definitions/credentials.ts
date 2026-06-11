/** Commander registrations for VC and IPEX credential workflows. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";
import { addDeliveryOptions, addGvrsnOption, addHabOption, addStoreOptions, dispatchArgs } from "./options.ts";
import { registerDispatchedCommand, registerKeriCliCommand } from "./shared.ts";

export function registerCredentialCmds(
  program: Command,
  dispatch: CommandDispatch,
): void {
  registerVcCmds(program, dispatch);
  registerIpexCmds(program, dispatch);
  registerVerifierCmds(program, dispatch);
  registerHookCmds(program, dispatch);
}

function registerVcCmds(program: Command, dispatch: CommandDispatch): void {
  const vc = program.command("vc").description("Credential operations");

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
  registerKeriCliCommand(
    addHabOption(
      addStoreOptions(
        registry.command("incept")
          .description("Create a local credential registry")
          .requiredOption("--registry-name <name>", "Registry name")
          .option("--usage <text>", "Human-readable registry usage for multisig proposals")
          .option("--backers", "Create a backer-enabled registry", false)
          .option("--est-only", "Anchor TEL events only in establishment events", false),
      ),
    ),
    dispatch,
    "vc.registry.incept",
    "vcRegistryInceptCommand",
    (options) => ({
      ...dispatchArgs(options),
      noBackers: !(options.backers || false),
      estOnly: options.estOnly || false,
      usage: options.usage,
    }),
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

  registerKeriCliCommand(
    addHabOption(
      addStoreOptions(
        vc.command("create")
          .description("Create and issue a registry-backed credential")
          .requiredOption("--registry-name <name>", "Registry name")
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
    "vc.create",
    "vcCreateCommand",
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
        .option("--in <file>", "Input stream file; defaults to stdin"),
    ),
    dispatch,
    "vc.import",
    "vcImportCommand",
    (options) => ({ ...dispatchArgs(options), inPath: options.in }),
  );

  registerKeriCliCommand(
    addDeliveryOptions(
      addStoreOptions(
        vc.command("revoke")
          .description("Revoke a local credential")
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
          .option("--out <file>", "Write updated credential stream"),
      ),
    ),
    dispatch,
    "vc.revoke",
    "vcRevokeCommand",
  );
}

function registerIpexCmds(program: Command, dispatch: CommandDispatch): void {
  const ipex = program.command("ipex").description("IPEX credential exchange operations");

  registerKeriCliCommand(
    addDeliveryOptions(
      addHabOption(
        addStoreOptions(
          ipex.command("apply")
            .description("Send an IPEX apply")
            .requiredOption("-r, --recipient <aid>", "Recipient AID or contact alias")
            .requiredOption("--schema <said>", "Requested schema SAID")
            .option("--attrs <json>", "Requested attributes JSON or @file")
            .option("-m, --message <text>", "Human-readable message"),
        ),
      ),
    ),
    dispatch,
    "ipex.apply",
    "ipexApplyCommand",
  );

  registerKeriCliCommand(
    addDeliveryOptions(
      addHabOption(
        addStoreOptions(
          ipex.command("offer")
            .description("Send an IPEX offer")
            .requiredOption("-r, --recipient <aid>", "Recipient AID or contact alias")
            .requiredOption("--acdc <file>", "Embedded ACDC stream file")
            .option("--apply <said>", "Prior apply EXN SAID")
            .option("-m, --message <text>", "Human-readable message"),
        ),
      ),
    ),
    dispatch,
    "ipex.offer",
    "ipexOfferCommand",
  );

  registerKeriCliCommand(
    addDeliveryOptions(
      addHabOption(
        addStoreOptions(
          ipex.command("agree")
            .description("Send an IPEX agree")
            .requiredOption("-r, --recipient <aid>", "Recipient AID or contact alias")
            .requiredOption("--offer <said>", "Prior offer EXN SAID")
            .option("-m, --message <text>", "Human-readable message"),
        ),
      ),
    ),
    dispatch,
    "ipex.agree",
    "ipexAgreeCommand",
  );

  registerKeriCliCommand(
    addDeliveryOptions(
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
                (value: string) => Number(value),
              )
              .option("--out <file>", "Write support artifacts plus grant wire"),
          ),
        ),
      ),
    ),
    dispatch,
    "ipex.grant",
    "ipexGrantCommand",
  );

  registerKeriCliCommand(
    addDeliveryOptions(
      addHabOption(
        addStoreOptions(
          ipex.command("admit")
            .description("Send or write an IPEX admit")
            .option("--said <said>", "Accepted grant EXN SAID")
            .option("--grant-file <file>", "Grant wire file")
            .option("-m, --message <text>", "Human-readable message")
            .option("--out <file>", "Write admit wire")
            .option("--no-wait", "Do not require the embedded credential to be saved"),
        ),
      ),
    ),
    dispatch,
    "ipex.admit",
    "ipexAdmitCommand",
  );

  registerKeriCliCommand(
    addDeliveryOptions(
      addHabOption(
        addStoreOptions(
          ipex.command("spurn")
            .description("Send an IPEX spurn")
            .requiredOption("-r, --recipient <aid>", "Recipient AID or contact alias")
            .requiredOption("--prior <said>", "Prior IPEX EXN SAID")
            .option("-m, --message <text>", "Human-readable message"),
        ),
      ),
    ),
    dispatch,
    "ipex.spurn",
    "ipexSpurnCommand",
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

  registerKeriCliCommand(
    addHabOption(
      addStoreOptions(
        ipex.command("poll")
          .description("Poll configured credential mailboxes once")
          .option("--poll-turns <count>", "Maximum bounded mailbox polling turns", (value: string) => Number(value))
          .option("--poll-budget-ms <ms>", "Per-turn mailbox polling budget", (value: string) => Number(value)),
      ),
    ),
    dispatch,
    "ipex.poll",
    "ipexPollCommand",
  );

  registerKeriCliCommand(
    addDeliveryOptions(
      addGvrsnOption(
        addStoreOptions(
          ipex.command("join")
            .description("Approve or validate a single-sig or multisig IPEX message")
            .option("--said <said>", "IPEX or multisig wrapper EXN SAID")
            .option("--auto", "Approve a multisig IPEX proposal without prompting", false)
            .option("--poll-turns <count>", "Maximum bounded mailbox polling turns", (value: string) => Number(value))
            .option("--poll-budget-ms <ms>", "Per-turn mailbox polling budget", (value: string) => Number(value)),
        ),
      ),
    ),
    dispatch,
    "ipex.join",
    "ipexJoinCommand",
  );
}

function registerVerifierCmds(program: Command, dispatch: CommandDispatch): void {
  const verifier = program.command("verifier").description("Verifier agent operations");

  registerKeriCliCommand(
    addStoreOptions(
      verifier.command("run")
        .description("Process verifier grants, revocations, and webhook delivery")
        .requiredOption("--hook <url>", "Webhook URL")
        .option("--config <file>", "Verifier schema validator config JSON")
        .option("--once", "Process one bounded verifier turn", false)
        .option("--interval-ms <ms>", "Loop interval in milliseconds")
        .option("--timeout-ms <ms>", "Escrow timeout in milliseconds"),
    ),
    dispatch,
    "verifier.run",
    "verifierRunCommand",
  );
}

function registerHookCmds(program: Command, dispatch: CommandDispatch): void {
  const hook = program.command("hook").description("Webhook target utilities");

  registerDispatchedCommand(
    hook
      .command("demo")
      .description("Launch a sample verifier webhook target")
      .option(
        "-p, --http <port>",
        "Port on which to listen for webhook events",
        (value: string) => Number(value),
        9923,
      ),
    dispatch,
    {
      name: "hook.demo",
      load: () => import("../hook.ts"),
      exportName: "hookDemoCommand",
      args: (options: Record<string, unknown>) => ({ http: options.http }),
    },
  );
}
