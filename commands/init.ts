import { parseArgs } from "@std/cli";
import { type Operation } from 'npm:effection@3.6.0';

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
kli init - Create a database and keystore

Usage: kli init [options]

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

export function* initCommand(args: Record<string, unknown>): Operation<void> {
  // Check for help flag in the main args first
  if (args.help || args.h) {
    printInitHelp();
    return;
  }
  
  // Extract the remaining arguments after the 'init' command
  const remainingArgs = (args._ as string[])?.slice(1) || [];
  
  // Check for help flag in the remaining args
  if (remainingArgs.includes("--help") || remainingArgs.includes("-h")) {
    printInitHelp();
    return;
  }
  
  // Parse the remaining arguments for init-specific options
  const initArgs = parseArgs(remainingArgs, {
    boolean: ["temp", "nopasscode", "help"],
    string: ["base", "salt", "configDir", "configFile", "passcode", "aeid", "seed"],
    alias: {
      base: "b", 
      temp: "t",
      salt: "s",
      configDir: "c",
      passcode: "p",
      aeid: "a",
      seed: "e",
      help: "h",
    },
  }) as InitArgs;

  // Use the name from the main args (already parsed)
  const name = args.name as string;
  if (!name || name === "") {
    throw new Error("Name is required and cannot be empty");
  }

  const base = initArgs.base || "";
  const temp = initArgs.temp || false;
  let bran = initArgs.passcode;
  const configFile = initArgs.configFile;
  const configDir = initArgs.configDir;
  const nopasscode = args.nopasscode as boolean || false;

  // Handle passcode input if not provided and not using nopasscode
  if (!nopasscode && !bran) {
    console.log("Creating encrypted keystore, please enter your 22 character passcode:");
    
    // For now, we'll use a simple prompt since Deno doesn't have getpass equivalent
    // In a real implementation, you'd want to use a proper password input library
    const passcode = prompt("Passcode: ");
    const retry = prompt("Re-enter passcode: ");
    
    if (passcode !== retry) {
      throw new Error("Passcodes do not match");
    }
    
    bran = passcode;
  }

  // TODO: Implement actual keystore and database creation
  // This is a stub implementation that mirrors the KERIpy structure
  
  console.log("KERI Keystore created at: [stub - keystore path]");
  console.log("KERI Database created at: [stub - database path]");
  console.log("KERI Credential Store created at: [stub - credential store path]");
  
  if (initArgs.aeid) {
    console.log("\taeid:", initArgs.aeid);
  }

  console.log("\nInitialization complete!");
  console.log("Note: This is a stub implementation. Full keystore and database creation will be implemented in future versions.");
}
