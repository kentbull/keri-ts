#!/usr/bin/env -S deno run --allow-sys --allow-net --allow-env --allow-read --allow-write
import { parseArgs } from "@std/cli/parse-args";
import { type Operation, run } from 'npm:effection@3.6.0';
import { initCommand } from './commands/init.ts';

interface CLIArgs {
  command?: string;
  help?: boolean;
  version?: boolean;
  [key: string]: unknown;
}

function printHelp() {
  console.log(`
KERI TypeScript CLI (kli)

Usage: kli <command> [options]

Commands:
  init     Create a database and keystore
  incept   Create a new identifier
  rotate   Rotate keys for an identifier
  interact Create an interaction event
  witness  Start a witness server

Options:
  --help, -h     Show this help message
  --version, -v  Show version information

For more information about a specific command, run:
  kli <command> --help
`);
}

function printVersion() {
  console.log("KERI TypeScript CLI v0.1.0");
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args, {
    boolean: ["help", "version"],
    string: ["command"],
    alias: {
      help: "h",
      version: "v",
    },
  });

  const cliArgs = args as CLIArgs;

  if (cliArgs.help) {
    printHelp();
    return;
  }

  if (cliArgs.version) {
    printVersion();
    return;
  }

  const command = cliArgs.command || args._[0];

  if (!command) {
    console.error("Error: No command specified");
    printHelp();
    Deno.exit(1);
  }

  try {
    switch (command) {
      case "init":
        await run(() => initCommand(args));
        break;
      case "incept":
        console.log("kli incept command - coming soon!");
        break;
      case "rotate":
        console.log("kli rotate command - coming soon!");
        break;
      case "interact":
        console.log("kli interact command - coming soon!");
        break;
      case "witness":
        console.log("kli witness command - coming soon!");
        break;
      default:
        console.error(`Error: Unknown command '${command}'`);
        printHelp();
        Deno.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
