import { Command } from "npm:commander@^10.0.1";
import { type Operation } from "npm:effection@^3.6.0";
import { AppError } from "../../core/errors.ts";
import {
  createCoreCommandHandlers,
  registerCoreCommands,
} from "./command-definitions.ts";
import { type CommandSelection } from "./command-types.ts";
import {
  createStubCommandHandlers,
  isStubCommandsEnabled,
  registerStubCommands,
} from "./stub-commands.ts";

/**
 * Create the CLI program with action handlers that signal command execution.
 * Command declaration is delegated to focused command modules.
 */
function createCLIProgram(onCommand: (selection: CommandSelection) => void) {
  const program = new Command();
  program.name("kli").version("0.0.2").description("KERI TypeScript CLI");

  // Prevent Commander from exiting automatically so we can run Effection operations
  program.exitOverride();

  registerCoreCommands(program, onCommand);
  if (isStubCommandsEnabled()) {
    registerStubCommands(program, onCommand);
  }

  return program;
}

/**
 * Main CLI operation - runs within Effection's structured concurrency
 * This is the outermost runtime, not JavaScript's event loop
 */
export function* kli(args: string[] = []): Operation<void> {
  const executionContext: { selection?: CommandSelection } = {};
  const commandHandlers = createCoreCommandHandlers();
  if (isStubCommandsEnabled()) {
    for (const [key, handler] of createStubCommandHandlers()) {
      commandHandlers.set(key, handler);
    }
  }

  // Use Commander.js for all command parsing
  const program = createCLIProgram((next) => {
    executionContext.selection = next;
  });

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
      if (
        commanderError.code === "commander.help" ||
        commanderError.code === "commander.helpDisplayed"
      ) {
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
    if (error instanceof AppError && error.context) {
      console.error(`Error: ${message}`, error.context);
    } else {
      console.error(`Error: ${message}`);
    }
    throw error;
  }

  // Execute the appropriate command operation based on context
  const selected = executionContext.selection;
  if (selected) {
    const handler = commandHandlers.get(selected.name);

    if (handler) {
      // Execute the command operation within Effection's structured concurrency
      yield* handler(selected.args);
    }
  }
}
