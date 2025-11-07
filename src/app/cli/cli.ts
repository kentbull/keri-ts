#!/usr/bin/env -S deno run --allow-sys --allow-net --allow-env --allow-read --allow-write
import { Command } from "@cliffy/command";
import { action, type Operation } from 'effection';
import { initCommand } from '@app/cli/init.ts';
import { agentCommand } from '@app/cli/agent.ts';

/**
 * Promise to Structured Concurrency Helper: Convert Promise to Effection Operation
 * This allows us to integrate promise-based APIs (like Cliffy) into Effection's structured concurrency
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
  const program = new Command()
    .name("kli")
    .version("0.1.0")
    .description("KERI TypeScript CLI")
    .command("init", "Create a database and keystore")
      .option("-n, --name <name:string>", "Keystore name and file location of KERI keystore (required)")
      .option("-b, --base <base:string>", "Additional optional prefix to file location of KERI keystore")
      .option("-t, --temp", "Create a temporary keystore, used for testing")
      .option("-s, --salt <salt:string>", "Qualified base64 salt for creating key pairs")
      .option("-c, --config-dir <dir:string>", "Directory override for configuration data")
      .option("--config-file <file:string>", "Configuration filename override")
      .option("-p, --passcode <passcode:string>", "22 character encryption passcode for keystore (is not saved)")
      .option("--nopasscode", "Create an unencrypted keystore")
      .option("-a, --aeid <aeid:string>", "Qualified base64 of non-transferable identifier prefix for authentication and encryption of secrets in keystore")
      .option("-e, --seed <seed:string>", "Qualified base64 private-signing key (seed) for the aeid from which the private decryption key may be derived")
      .action((options: Record<string, unknown>) => {
        // Store command info in context for execution within Effection
        context.command = 'init';
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
      })
    .command("agent", "Start the KERI agent server")
      .option("-p, --port <port:number>", "Port number for the server (default: 8000)")
      .action((options: Record<string, unknown>) => {
        context.command = 'agent';
        context.args = {
          port: options.port,
        };
        return Promise.resolve();
      })
    .command("incept", "Create a new identifier")
      .action(() => {
        context.command = 'incept';
        context.args = {};
        return Promise.resolve();
      })
    .command("rotate", "Rotate keys for an identifier")
      .action(() => {
        context.command = 'rotate';
        context.args = {};
        return Promise.resolve();
      })
    .command("interact", "Create an interaction event")
      .action(() => {
        context.command = 'interact';
        context.args = {};
        return Promise.resolve();
      })
    .command("witness", "Start a witness server")
      .action(() => {
        context.command = 'witness';
        context.args = {};
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
  ['init', (args: Record<string, unknown>) => initCommand(args)],
  ['agent', (args: Record<string, unknown>) => agentCommand(args)],
  ['incept', (args: Record<string, unknown>) => inceptCommand(args)],
  ['rotate', (args: Record<string, unknown>) => rotateCommand(args)],
  ['interact', (args: Record<string, unknown>) => interactCommand(args)],
  ['witness', (args: Record<string, unknown>) => witnessCommand(args)],
]);

/**
 * Main CLI operation - runs within Effection's structured concurrency
 * This is the outermost runtime, not JavaScript's event loop
 */
export function* kli(args: string[] = []): Operation<void> {
  // Create a context for command execution
  const context: CommandContext = {};
  
  const program = createCLIProgram(context);
  
  try {
    // Convert Cliffy's promise-based parse to an Effection operation
    // This ensures the CLI runs within Effection's event loop
    // Action handlers set context.command and return immediately
    yield* toOp(program.parse(args.length > 0 ? args : Deno.args));
    
    // Execute the appropriate command operation based on context
    // This happens after parse() completes, within Effection's structured concurrency
    if (context.command && context.args) {
      const handler = commandHandlers.get(context.command);
      
      if (handler) {
        // Execute the command operation within Effection's structured concurrency
        yield* handler(context.args);
      }
    }
    // If no command (e.g., help or version), parse() already handled it
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    throw error; // Re-throw so Effection can handle it properly
  }
}

