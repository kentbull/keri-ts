/** Commander registrations for VC and IPEX credential workflows. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";
import { addGvrsnOption, addHabOption, addStoreOptions, dispatchArgs } from "./options.ts";
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

/**
 * Register credential commands and their operator inputs before lazy execution.
 *
 * @param program Borrowed Commander root receiving the `vc` subtree.
 * @param dispatch Receives parsed command arguments; handlers validate domain values before I/O.
 */
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
  registerDispatchedCommand(
    addHabOption(
      addStoreOptions(
        registry.command("incept")
          .description("Create a local credential registry")
          .requiredOption("--registry-name <name>", "Registry name")
          .option("--usage <text>", "Human-readable registry usage for multisig proposals")
          .option("--timeout <seconds>", "Wait for local TEL publication (default: 60; 0 returns pending state)")
          .option(
            "--backers",
            "Enable legacy/v1-style TEL backing by a configured backer quorum (not native ACDC v2)",
            false,
          )
          .option("--est-only", "Anchor TEL events only in establishment events", false),
      ),
    ),
    dispatch,
    {
      name: "vc.registry.incept",
      load: () => import("../credentials.ts"),
      exportName: "vcRegistryInceptCommand",
      args: (options) => ({
        ...dispatchArgs(options),
        noBackers: !(options.backers || false),
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
      load: () => import("../credentials.ts"),
      exportName: "vcCreateCommand",
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

  registerKeriCliCommand(
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
    dispatch,
    "vc.revoke",
    "vcRevokeCommand",
  );
}

function registerIpexCmds(program: Command, dispatch: CommandDispatch): void {
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
    { name: "ipex.apply", load: () => import("../ipex.ts"), exportName: "ipexApplyCommand", args: dispatchArgs },
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
    { name: "ipex.offer", load: () => import("../ipex.ts"), exportName: "ipexOfferCommand", args: dispatchArgs },
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
    { name: "ipex.agree", load: () => import("../ipex.ts"), exportName: "ipexAgreeCommand", args: dispatchArgs },
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
    { name: "ipex.grant", load: () => import("../ipex.ts"), exportName: "ipexGrantCommand", args: dispatchArgs },
  );

  registerDispatchedCommand(
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
    dispatch,
    { name: "ipex.admit", load: () => import("../ipex.ts"), exportName: "ipexAdmitCommand", args: dispatchArgs },
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
    { name: "ipex.spurn", load: () => import("../ipex.ts"), exportName: "ipexSpurnCommand", args: dispatchArgs },
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
    { name: "ipex.poll", load: () => import("../ipex.ts"), exportName: "ipexPollCommand", args: dispatchArgs },
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
    { name: "ipex.join", load: () => import("../ipex.ts"), exportName: "ipexJoinCommand", args: dispatchArgs },
  );
}

function registerVerifierCmds(program: Command, dispatch: CommandDispatch): void {
  const verifier = program.command("verifier").description("Verifier agent operations");

  registerKeriCliCommand(
    addGvrsnOption(addStoreOptions(
      verifier.command("run")
        .description("Process verifier grants, revocations, and webhook delivery")
        .requiredOption("--hook <url>", "Webhook URL")
        .option("--config <file>", "Verifier schema validator config JSON")
        .option("--once", "Process one bounded verifier turn", false)
        .option("--interval-ms <ms>", "Loop interval in milliseconds")
        .option("--timeout-ms <ms>", "Escrow timeout in milliseconds"),
    )),
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
        "9923",
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
