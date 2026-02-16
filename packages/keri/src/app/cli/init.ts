import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";

interface InitArgs {
  name?: string;
  base?: string;
  temp?: boolean;
  salt?: string;
  configDir?: string;
  configFile?: string;
  passcode?: string;
  nopasscode?: boolean;
  aeid?: string;
  seed?: string;
  help?: boolean;
}

function printInitHelp() {
  console.log(`
tufa init - Create a database and keystore

Usage: tufa init [options]

Options:
  --name, -n <name>           Keystore name and file location of KERI keystore (required)
  --base, -b <base>           Additional optional prefix to file location of KERI keystore
  --temp, -t                  Create a temporary keystore, used for testing
  --salt, -s <salt>           Qualified base64 salt for creating key pairs
  --config-dir, -c <dir>      Directory override for configuration data
  --config-file <file>        Configuration filename override
  --passcode, -p <passcode>   22 character encryption passcode for keystore (is not saved)
  --nopasscode                Create an unencrypted keystore
  --aeid, -a <aeid>           Qualified base64 of non-transferable identifier prefix for authentication and encryption of secrets in keystore
  --seed, -e <seed>           Qualified base64 private-signing key (seed) for the aeid from which the private decryption key may be derived
  --help, -h                  Show this help message
`);
}

// TODO remove this ignore once init is finished
// deno-lint-ignore require-yield
export function* initCommand(args: Record<string, unknown>): Operation<void> {
  // Check for help flag
  if (args.help || args.h) {
    printInitHelp();
    return;
  }

  // Extract values from args (already parsed by Cliffy or test mocks)
  const initArgs: InitArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    temp: args.temp as boolean | undefined,
    salt: args.salt as string | undefined,
    configDir: args.configDir as string | undefined,
    configFile: args.configFile as string | undefined,
    passcode: args.passcode as string | undefined,
    nopasscode: args.nopasscode as boolean | undefined,
    aeid: args.aeid as string | undefined,
    seed: args.seed as string | undefined,
  };

  // Validate required name
  const name = initArgs.name;
  if (!name || name === "") {
    throw new ValidationError("Name is required and cannot be empty");
  }

  const base = initArgs.base || "";
  const temp = initArgs.temp || false;
  let bran = initArgs.passcode;
  const configFile = initArgs.configFile;
  const configDir = initArgs.configDir;
  const nopasscode = initArgs.nopasscode || false;

  // Handle passcode input if not provided and not using nopasscode
  if (!nopasscode && !bran) {
    console.log(
      "Creating encrypted keystore, please enter your 22 character passcode:",
    );

    // For now, we'll use a simple prompt since Deno doesn't have getpass equivalent
    // In a real implementation, you'd want to use a proper password input library
    const passcode = prompt("Passcode: ");
    const retry = prompt("Re-enter passcode: ");

    if (passcode !== retry) {
      throw new ValidationError("Passcodes do not match");
    }

    bran = passcode || undefined;
  }

  // TODO: Implement actual keystore and database creation
  // This is a stub implementation that mirrors the KERIpy structure

  console.log("KERI Keystore created at: [stub - keystore path]");
  console.log("KERI Database created at: [stub - database path]");
  console.log(
    "KERI Credential Store created at: [stub - credential store path]",
  );

  if (initArgs.aeid) {
    console.log("\taeid:", initArgs.aeid);
  }

  console.log("\nInitialization complete!");
  console.log(
    "Note: This is a stub implementation. Full keystore and database creation will be implemented in future versions.",
  );
}
