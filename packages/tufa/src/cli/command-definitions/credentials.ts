/** Commander registrations for VC and IPEX credential workflows. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";

export function registerCredentialCmds(
  program: Command,
  dispatch: CommandDispatch,
): void {
  registerVcCmds(program, dispatch);
  registerIpexCmds(program, dispatch);
  registerVerifierCmds(program, dispatch);
  registerHookCmds(program, dispatch);
}

function addStoreOptions(cmd: Command): Command {
  return cmd
    .requiredOption("-n, --name <name>", "Keystore name")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--compat", "Use KERIpy compatibility-mode path layout")
    .option(
      "--head-dir <dir>",
      "Directory override for database and keystore root",
    )
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore");
}

function addHabOption(cmd: Command): Command {
  return cmd.requiredOption(
    "-a, --alias <alias>",
    "Human readable alias for the local identifier",
  );
}

function addDeliveryOptions(cmd: Command): Command {
  return cmd.option("--delivery <mode>", "Delivery mode: auto, direct, or indirect");
}

function dispatchArgs(options: Record<string, unknown>): Record<string, unknown> {
  return {
    ...options,
    headDirPath: options.headDir,
  };
}

function registerVcCmds(program: Command, dispatch: CommandDispatch): void {
  const vc = program.command("vc").description("Credential operations");

  const schema = vc.command("schema").description("Credential schema operations");
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
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "vc.schema.import", args: dispatchArgs(options) });
  });

  const registry = vc.command("registry").description("Credential registry operations");
  addHabOption(
    addStoreOptions(
      registry.command("incept")
        .description("Create a local credential registry")
        .requiredOption("--registry-name <name>", "Registry name")
        .option("--backers", "Create a backer-enabled registry", false)
        .option("--est-only", "Anchor TEL events only in establishment events", false),
    ),
  ).action((options: Record<string, unknown>) => {
    dispatch({
      name: "vc.registry.incept",
      args: {
        ...dispatchArgs(options),
        noBackers: !(options.backers || false),
        estOnly: options.estOnly || false,
      },
    });
  });
  addStoreOptions(
    registry.command("list")
      .description("List local credential registries"),
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "vc.registry.list", args: dispatchArgs(options) });
  });
  addStoreOptions(
    registry.command("status")
      .description("Show one credential registry state")
      .requiredOption("--registry-name <name>", "Registry name"),
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "vc.registry.status", args: dispatchArgs(options) });
  });

  addHabOption(
    addStoreOptions(
      vc.command("create")
        .description("Create and issue a registry-backed credential")
        .requiredOption("--registry-name <name>", "Registry name")
        .option("--schema <said>", "Schema SAID")
        .option("--schema-file <file>", "Import schema JSON and use its SAID")
        .option("-r, --recipient <aid>", "Recipient AID or local alias")
        .option("--data <json>", "Credential subject data JSON or @file")
        .option("--out <file>", "Write exportable credential stream"),
    ),
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "vc.create", args: dispatchArgs(options) });
  });

  addStoreOptions(
    vc.command("list")
      .description("List saved credentials")
      .option("-a, --alias <alias>", "Filter by local alias")
      .option("--aid <aid>", "Filter by subject or issuer AID")
      .option("--schema <said>", "Filter by schema SAID")
      .option("--issued", "List issued credentials instead of received"),
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "vc.list", args: dispatchArgs(options) });
  });

  addStoreOptions(
    vc.command("export")
      .description("Export one credential stream")
      .requiredOption("--said <said>", "Credential SAID")
      .option("-r, --recipient <aid>", "Recipient AID or local alias")
      .option("--out <file>", "Output file"),
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "vc.export", args: dispatchArgs(options) });
  });

  addStoreOptions(
    vc.command("import")
      .description("Import a CESR credential stream")
      .option("--in <file>", "Input stream file; defaults to stdin"),
  ).action((options: Record<string, unknown>) => {
    dispatch({
      name: "vc.import",
      args: { ...dispatchArgs(options), inPath: options.in },
    });
  });

  addStoreOptions(
    vc.command("revoke")
      .description("Revoke a local credential")
      .requiredOption("--registry-name <name>", "Registry name")
      .requiredOption("--said <said>", "Credential SAID")
      .option("-r, --recipient <aid>", "Recipient AID or local alias")
      .option("--out <file>", "Write updated credential stream"),
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "vc.revoke", args: dispatchArgs(options) });
  });
}

function registerIpexCmds(program: Command, dispatch: CommandDispatch): void {
  const ipex = program.command("ipex").description("IPEX credential exchange operations");

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
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "ipex.apply", args: dispatchArgs(options) });
  });

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
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "ipex.offer", args: dispatchArgs(options) });
  });

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
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "ipex.agree", args: dispatchArgs(options) });
  });

  addDeliveryOptions(
    addHabOption(
      addStoreOptions(
        ipex.command("grant")
          .description("Send or write an IPEX credential grant")
          .requiredOption("-r, --recipient <aid>", "Recipient AID or contact alias")
          .requiredOption("--said <said>", "Credential SAID")
          .option("--agree <said>", "Prior agree EXN SAID")
          .option("-m, --message <text>", "Human-readable message")
          .option("--out <file>", "Write support artifacts plus grant wire"),
      ),
    ),
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "ipex.grant", args: dispatchArgs(options) });
  });

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
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "ipex.admit", args: dispatchArgs(options) });
  });

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
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "ipex.spurn", args: dispatchArgs(options) });
  });

  addStoreOptions(
    ipex.command("list")
      .description("List stored IPEX EXNs"),
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "ipex.list", args: dispatchArgs(options) });
  });

  addStoreOptions(
    ipex.command("join")
      .description("Approve or validate a single-sig or multisig IPEX message")
      .requiredOption("--said <said>", "IPEX or multisig wrapper EXN SAID")
      .option("--auto", "Approve a multisig IPEX proposal without prompting", false),
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "ipex.join", args: dispatchArgs(options) });
  });
}

function registerVerifierCmds(program: Command, dispatch: CommandDispatch): void {
  const verifier = program.command("verifier").description("Verifier agent operations");

  addStoreOptions(
    verifier.command("run")
      .description("Process verifier grants, revocations, and webhook delivery")
      .requiredOption("--hook <url>", "Webhook URL")
      .option("--config <file>", "Verifier schema validator config JSON")
      .option("--once", "Process one bounded verifier turn", false)
      .option("--interval-ms <ms>", "Loop interval in milliseconds")
      .option("--timeout-ms <ms>", "Escrow timeout in milliseconds"),
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "verifier.run", args: dispatchArgs(options) });
  });
}

function registerHookCmds(program: Command, dispatch: CommandDispatch): void {
  const hook = program.command("hook").description("Webhook target utilities");

  hook
    .command("demo")
    .description("Launch a sample verifier webhook target")
    .option(
      "-p, --http <port>",
      "Port on which to listen for webhook events",
      (value: string) => Number(value),
      9923,
    )
    .action((options: Record<string, unknown>) => {
      dispatch({ name: "hook.demo", args: { http: options.http } });
    });
}
