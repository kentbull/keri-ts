import { Command } from "npm:commander@^10.0.1";
import { type Operation } from "npm:effection@^3.6.0";
import { AppError } from "../../core/errors.ts";
import { DISPLAY_VERSION } from "../version.ts";
import { createCmdHandlers, registerCmds } from "./command-definitions.ts";
import { CommandHandler, type CommandSelection } from "./command-types.ts";

/**
 * Create the CLI program with action handlers that signal command execution.
 * Command declaration is delegated to focused command modules.
 */
function createCLIProgram(onCommand: (selection: CommandSelection) => void) {
  const program = new Command();
  program.name("tufa").version(DISPLAY_VERSION).description(
    "Trust Utilities for Agents CLI",
  );

  // Prevent Commander from exiting automatically so we can run Effection operations
  program.exitOverride();

  registerCmds(program, onCommand);

  return program;
}

function parseCLIArgs(program: Command, args: string[]): void {
  // Commander expects full argv or args array.
  // In Deno, Deno.args gives us the arguments without executable info.
  const argsToParse = args.length > 0 ? args : Deno.args;
  program.parse(argsToParse, { from: "user" });
}

function isCommanderExitError(error: unknown): error is { code: string } {
  return !!(error && typeof error === "object" && "code" in error);
}

function isExpectedCommanderExit(code: string): boolean {
  return (
    code === "commander.help" ||
    code === "commander.helpDisplayed" ||
    code === "commander.version" ||
    code === "commander.unknownCommand" ||
    code === "commander.missingArgument"
  );
}

function handleParseError(error: unknown): void {
  if (isCommanderExitError(error) && isExpectedCommanderExit(error.code)) {
    // Commander already printed any relevant help/error output.
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof AppError && error.context) {
    console.error(`Error: ${message}`, error.context);
  } else {
    console.error(`Error: ${message}`);
  }
  throw error;
}

function* runCmd(
  selection: CommandSelection | undefined,
  commandHandlers: Map<string, CommandHandler>,
): Operation<void> {
  if (!selection) {
    return;
  }

  const handler = commandHandlers.get(selection.name);
  if (!handler) {
    return;
  }

  // Execute command operation within Effection's structured concurrency.
  yield* handler(selection.args);
}

/**
 * Main CLI operation - runs within Effection's structured concurrency
 * This is the outermost runtime, not JavaScript's event loop
 */
export function* tufa(args: string[] = []): Operation<void> {
  const dispatch: { selection?: CommandSelection } = {};

  // Use Commander.js for all command parsing
  const program = createCLIProgram((next) => {
    dispatch.selection = next;
  });

  try {
    parseCLIArgs(program, args);
  } catch (error: unknown) {
    handleParseError(error);
    return;
  }

  const commandHandlers = createCmdHandlers();
  yield* runCmd(dispatch.selection, commandHandlers);
}
