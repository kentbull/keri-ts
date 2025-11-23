import { Command } from "commander";
import { action, type Operation } from "effection";
import { agentCommand } from "./agent.ts";
import { dumpEvts } from "./db-dump.ts";
import { initCommand } from "./init.ts";

/**
 * Promise to Structured Concurrency Helper: Convert Promise to Effection Operation
 * This allows us to integrate promise-based APIs (like Commander) into Effection's structured concurrency
 */
function* toOp<T>(promise: Promise<T>): Operation<T> {
  return yield* action((resolve, reject) => {
    promise.then(resolve, reject);
    return () => {}; // Cleanup function (can add abort logic if needed)
  });
}

/**
 * Command execution context - allows action handlers to signal which command to execute
 */
interface CommandContext {
  command?: string;
  args?: Record<string, unknown>;
}

/**
 * Create the CLI program with action handlers that signal command execution
 */
function createCLIProgram(context: CommandContext) {
  const program = new Command();
  program.name("kli").version("0.0.2").description("KERI TypeScript CLI");

  // Prevent Commander from exiting automatically so we can run Effection operations
  program.exitOverride();

  program
    .command("init")
    .description("Create a database and keystore")
    .option("-n, --name <name>", "Keystore name and file location of KERI keystore (required)")
    .option("-b, --base <base>", "Additional optional prefix to file location of KERI keystore")
    .option("-t, --temp", "Create a temporary keystore, used for testing")
    .option("-s, --salt <salt>", "Qualified base64 salt for creating key pairs")
    .option("-c, --config-dir <dir>", "Directory override for configuration data")
    .option("--config-file <file>", "Configuration filename override")
    .option(
      "-p, --passcode <passcode>",
      "22 character encryption passcode for keystore (is not saved)"
    )
    .option("--nopasscode", "Create an unencrypted keystore")
    .option(
      "-a, --aeid <aeid>",
      "Qualified base64 of non-transferable identifier prefix for authentication and encryption of secrets in keystore"
    )
    .option(
      "-e, --seed <seed>",
      "Qualified base64 private-signing key (seed) for the aeid from which the private decryption key may be derived"
    )
    .action((options: Record<string, unknown>) => {
      // Store command info in context for execution within Effection
      context.command = "init";
      context.args = {
        name: options.name,
        base: options.base,
        temp: options.temp || false,
        salt: options.salt,
        configDir: options.configDir,
        configFile: options.configFile,
        passcode: options.passcode,
        nopasscode: options.nopasscode || false,
        aeid: options.aeid,
        seed: options.seed,
      };
      // Return immediately - actual execution happens in kli operation
      return Promise.resolve();
    });

  program
    .command("agent")
    .description("Start the KERI agent server")
    .option("-p, --port <port>", "Port number for the server (default: 8000)", "8000")
    .action(function (this: Command) {
      const options = this.opts();
      context.command = "agent";
      context.args = {
        port: options.port ? Number(options.port) : 8000,
      };
      return Promise.resolve();
    });

  program
    .command("incept")
    .description("Create a new identifier")
    .action(() => {
      context.command = "incept";
      context.args = {};
      return Promise.resolve();
    });

  program
    .command("rotate")
    .description("Rotate keys for an identifier")
    .action(() => {
      context.command = "rotate";
      context.args = {};
      return Promise.resolve();
    });

  program
    .command("interact")
    .description("Create an interaction event")
    .action(() => {
      context.command = "interact";
      context.args = {};
      return Promise.resolve();
    });

  program
    .command("witness")
    .description("Start a witness server")
    .action(() => {
      context.command = "witness";
      context.args = {};
      return Promise.resolve();
    });

  // Create db command with dump subcommand using chained .command() pattern
  const dbCommand = program.command("db").description("Database operations");

  dbCommand
    .command("dump")
    .description("Dump database contents")
    .requiredOption("-n, --name <name>", "Database name")
    .option("-b, --base <base>", "Additional optional prefix to database path")
    .option("-t, --temp", "Use temporary database")
    .action((options: { name: string; base?: string; temp?: boolean }) => {
      context.command = "db.dump";
      context.args = {
        name: options.name,
        base: options.base,
        temp: options.temp || false,
      };
      return Promise.resolve();
    });

  return program;
}

/**
 * Stub command operations (to be implemented)
 * These are placeholder operations that will be fully implemented later
 */
// deno-lint-ignore require-yield
function* inceptCommand(_args: Record<string, unknown>): Operation<void> {
  console.log("kli incept command - coming soon!");
}

// deno-lint-ignore require-yield
function* rotateCommand(_args: Record<string, unknown>): Operation<void> {
  console.log("kli rotate command - coming soon!");
}

// deno-lint-ignore require-yield
function* interactCommand(_args: Record<string, unknown>): Operation<void> {
  console.log("kli interact command - coming soon!");
}

// deno-lint-ignore require-yield
function* witnessCommand(_args: Record<string, unknown>): Operation<void> {
  console.log("kli witness command - coming soon!");
}

/**
 * Command handler registry - maps command names to Effection operations
 */
const commandHandlers: Map<string, (args: Record<string, unknown>) => Operation<void>> = new Map([
  ["init", (args: Record<string, unknown>) => initCommand(args)],
  ["agent", (args: Record<string, unknown>) => agentCommand(args)],
  ["incept", (args: Record<string, unknown>) => inceptCommand(args)],
  ["rotate", (args: Record<string, unknown>) => rotateCommand(args)],
  ["interact", (args: Record<string, unknown>) => interactCommand(args)],
  ["witness", (args: Record<string, unknown>) => witnessCommand(args)],
  ["db.dump", (args: Record<string, unknown>) => dumpEvts(args)],
]);

/**
 * Main CLI operation - runs within Effection's structured concurrency
 * This is the outermost runtime, not JavaScript's event loop
 */
export function* kli(args: string[] = []): Operation<void> {
  // Create a context for command execution
  const context: CommandContext = {};

  // Use Commander.js for all command parsing
  const program = createCLIProgram(context);

  try {
    // Parse arguments - Commander expects full argv or args array
    // In Deno, Deno.args gives us the arguments without the executable info
    const argsToParse = args.length > 0 ? args : Deno.args;
    program.parse(argsToParse, { from: "user" });
  } catch (error: unknown) {
    // Handle Commander-specific errors
    if (error && typeof error === "object" && "code" in error) {
      const commanderError = error as { code: string; exitCode?: number };

      // Help was requested - Commander already printed it, just return
      if (commanderError.code === "commander.help") {
        return;
      }

      // Unknown command or other parsing errors - Commander already printed the error
      if (
        commanderError.code === "commander.unknownCommand" ||
        commanderError.code === "commander.missingArgument"
      ) {
        // Commander already printed the error message, just exit gracefully
        return;
      }
    }

    // For other errors, log and rethrow
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    throw error;
  }

  // Execute the appropriate command operation based on context
  if (context.command && context.args) {
    const handler = commandHandlers.get(context.command);

    if (handler) {
      // Execute the command operation within Effection's structured concurrency
      yield* handler(context.args);
    }
  }
}
