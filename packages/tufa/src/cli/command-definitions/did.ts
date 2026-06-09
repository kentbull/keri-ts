/** Commander registrations for DID Webs and DID KERI operations. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";

export function registerDidCmds(
  program: Command,
  dispatch: CommandDispatch,
): void {
  registerDwsCmds(program, dispatch);
  registerDkrCmds(program, dispatch);
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

function addDidOption(cmd: Command): Command {
  return cmd.requiredOption("--did <did>", "DID to use");
}

function dispatchArgs(options: Record<string, unknown>): Record<string, unknown> {
  const { headDir, ...rest } = options;
  return {
    ...rest,
    headDirPath: headDir,
  };
}

function registerDwsCmds(program: Command, dispatch: CommandDispatch): void {
  const dws = program.command("dws").description("DID Webs operations");

  addStoreOptions(
    dws.command("bind")
      .description("Bind a local AID to replacement designated-alias ACDC")
      .requiredOption("-a, --alias <alias>", "Local identifier alias")
      .requiredOption(
        "--did <did>",
        "Designated alias DID; may be repeated",
        (value: string, prev: string[] = []) => {
          prev.push(value);
          return prev;
        },
        [],
      )
      .option("--registry-name <name>", "Designated-alias registry name")
      .option("--no-create-registry", "Require the registry to already exist")
      .option(
        "--allow-external-did",
        "Allow opaque non-KERI DID aliases as self-attested DA values",
      ),
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "dws.bind", args: dispatchArgs(options) });
  });

  addDidOption(
    addStoreOptions(
      dws.command("generate")
        .description("Generate static did:webs artifacts")
        .requiredOption("-a, --alias <alias>", "Local identifier alias")
        .requiredOption("--output-dir <dir>", "Directory for generated artifacts")
        .option("--meta", "Write DID Resolution Result envelope to did.json"),
    ),
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "dws.generate", args: dispatchArgs(options) });
  });

  addDidOption(
    addStoreOptions(
      dws.command("resolve")
        .description("Resolve and verify a did:webs identifier")
        .option("--meta", "Emit DID Resolution Result")
        .option("--insecure-http", "Use http:// artifact URLs for localhost/dev workflows"),
    ),
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "dws.resolve", args: dispatchArgs(options) });
  });

  addStoreOptions(
    dws.command("resolver")
      .description("Run Universal Resolver compatible DID service")
      .option("--port <port>", "HTTP port", (value: string) => Number(value), 7723)
      .option("--listen-host <host>", "Listen host", "127.0.0.1")
      .option("--static-files-dir <dir>", "Static artifact root directory")
      .option("--did-path <path>", "DID artifact path prefix")
      .option("--dynamic", "Serve dynamic did.json and keri.cesr for hosted AIDs")
      .option(
        "--hosted-prefix <aid>",
        "Hosted AID prefix; may be repeated",
        (value: string, prev: string[] = []) => {
          prev.push(value);
          return prev;
        },
        [],
      )
      .option("--insecure-http", "Use http:// when this resolver fetches did:webs artifacts"),
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "dws.resolver", args: dispatchArgs(options) });
  });
}

function registerDkrCmds(program: Command, dispatch: CommandDispatch): void {
  const dkr = program.command("dkr").description("DID KERI operations");
  addDidOption(
    addStoreOptions(
      dkr.command("resolve")
        .description("Resolve a did:keri identifier")
        .option(
          "--oobi <url>",
          "OOBI URL; may be repeated",
          (value: string, prev: string[] = []) => {
            prev.push(value);
            return prev;
          },
          [],
        )
        .option("--meta", "Emit DID Resolution Result"),
    ),
  ).action((options: Record<string, unknown>) => {
    dispatch({ name: "dkr.resolve", args: dispatchArgs(options) });
  });
}
