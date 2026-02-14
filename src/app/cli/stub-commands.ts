import { Command } from "npm:commander@^10.0.1";
import type { Operation } from "npm:effection@^3.6.0";
import {
  type CommandArgs,
  type CommandDispatch,
  type CommandHandler,
} from "./command-types.ts";

export function isStubCommandsEnabled(): boolean {
  return Deno.env.get("KLI_ENABLE_STUB_COMMANDS") === "1";
}

export function createStubCommandHandlers(): Map<string, CommandHandler> {
  return new Map([
    ["incept", inceptCommand],
    ["rotate", rotateCommand],
    ["interact", interactCommand],
    ["witness", witnessCommand],
  ]);
}

export function registerStubCommands(
  program: Command,
  dispatch: CommandDispatch,
): void {
  const exp = program
    .command("experimental")
    .description("Experimental or placeholder commands");

  exp
    .command("incept")
    .description("Create a new identifier (placeholder)")
    .action(() => {
      dispatch({ name: "incept", args: {} });
      return Promise.resolve();
    });

  exp
    .command("rotate")
    .description("Rotate keys for an identifier (placeholder)")
    .action(() => {
      dispatch({ name: "rotate", args: {} });
      return Promise.resolve();
    });

  exp
    .command("interact")
    .description("Create an interaction event (placeholder)")
    .action(() => {
      dispatch({ name: "interact", args: {} });
      return Promise.resolve();
    });

  exp
    .command("witness")
    .description("Start a witness server (placeholder)")
    .action(() => {
      dispatch({ name: "witness", args: {} });
      return Promise.resolve();
    });
}

// deno-lint-ignore require-yield
function* inceptCommand(_args: CommandArgs): Operation<void> {
  console.log("kli experimental incept command - coming soon!");
}

// deno-lint-ignore require-yield
function* rotateCommand(_args: CommandArgs): Operation<void> {
  console.log("kli experimental rotate command - coming soon!");
}

// deno-lint-ignore require-yield
function* interactCommand(_args: CommandArgs): Operation<void> {
  console.log("kli experimental interact command - coming soon!");
}

// deno-lint-ignore require-yield
function* witnessCommand(_args: CommandArgs): Operation<void> {
  console.log("kli experimental witness command - coming soon!");
}
