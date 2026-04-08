import { Command, Option } from "npm:commander@^10.0.1";
import { type Operation } from "npm:effection@^3.6.0";
import { AppError } from "../../core/errors.ts";
import { LOG_LEVELS, type LogLevel, setLogLevel } from "../../core/logger.ts";
import { DISPLAY_VERSION } from "../version.ts";
import { createCmdHandlers, registerCmds } from "./command-definitions.ts";
import { CommandHandler, type CommandSelection } from "./command-types.ts";

/** Structured handled CLI exit used to suppress fatal-stack reporting. */
export class CliExitError extends Error {
  constructor(
    public readonly exitCode: number,
    public readonly alreadyReported: boolean,
    public readonly debugError: boolean,
    public readonly originalError?: unknown,
    message = `CLI exited with code ${exitCode}`,
  ) {
    super(message);
    this.name = "CliExitError";
  }
}

/**
 * Create the CLI program with action handlers that signal command execution.
 * Command declaration is delegated to focused command modules.
 */
function createCLIProgram(onCommand: (selection: CommandSelection) => void) {
  const program = new Command();
  program.name("tufa").version(DISPLAY_VERSION).description(
    "Trust Utilities for Agents CLI",
  );
  program.addOption(
    new Option(
      "--loglevel <level>",
      `Set runtime log verbosity (${LOG_LEVELS.join(", ")})`,
    ).choices([...LOG_LEVELS]),
  );
  program.option(
    "--debug-error",
    "Print full error objects and stack traces for handled CLI failures",
    false,
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

function cliArgs(args: string[]): string[] {
  return args.length > 0 ? args : Deno.args;
}

function debugErrorRequested(args: string[]): boolean {
  return cliArgs(args).includes("--debug-error");
}

function isCommanderExitError(error: unknown): error is { code: string } {
  return !!(error && typeof error === "object" && "code" in error);
}

function commanderExitCode(error: unknown): number {
  if (
    error && typeof error === "object" && "exitCode" in error
    && typeof error.exitCode === "number"
  ) {
    return error.exitCode;
  }
  return 1;
}

function handleParseError(error: unknown): void {
  if (isCommanderExitError(error) && error.code.startsWith("commander.")) {
    const exitCode = commanderExitCode(error);
    if (exitCode === 0) {
      return;
    }
    throw new CliExitError(exitCode, true, false, error);
  }

  throw error;
}

function reportAppError(error: AppError, debugError: boolean): never {
  if (error.context) {
    console.error(`Error: ${error.message}`, error.context);
  } else {
    console.error(`Error: ${error.message}`);
  }
  throw new CliExitError(1, true, debugError, error);
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
  const debugError = debugErrorRequested(args);
  setLogLevel("warn");

  // Use Commander.js for all command parsing
  const program = createCLIProgram((next) => {
    dispatch.selection = next;
  });

  try {
    parseCLIArgs(program, args);
  } catch (error: unknown) {
    try {
      handleParseError(error);
    } catch (handled: unknown) {
      if (handled instanceof CliExitError) {
        throw new CliExitError(
          handled.exitCode,
          handled.alreadyReported,
          debugError,
          handled.originalError,
          handled.message,
        );
      }
      throw handled;
    }
    return;
  }

  const options = program.opts<{ loglevel?: LogLevel; debugError?: boolean }>();
  setLogLevel(options.loglevel ?? "warn");

  const commandHandlers = createCmdHandlers();
  try {
    yield* runCmd(dispatch.selection, commandHandlers);
  } catch (error: unknown) {
    if (error instanceof AppError) {
      reportAppError(error, options.debugError ?? debugError);
    }
    throw error;
  }
}

/**
 * Convert one top-level CLI error into the correct process exit code.
 *
 * Handled CLI exits should not surface a fatal stack trace, while unexpected
 * failures still must remain diagnosable.
 */
export function reportCliFailure(error: unknown): number {
  if (error instanceof CliExitError) {
    if (error.debugError && error.originalError) {
      console.error(error.originalError);
    }
    if (!error.alreadyReported && error.message.length > 0) {
      console.error(error.message);
    }
    return error.exitCode;
  }

  console.error("Fatal error:", error);
  return 1;
}
