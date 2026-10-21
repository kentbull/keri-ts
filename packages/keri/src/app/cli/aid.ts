import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { withExistingHab } from "./common/context.ts";
import { parseBooleanOption, parseStringOption } from "./common/parsing.ts";

interface AidArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  compat?: boolean;
}

/** Implements `tufa aid`. */
export function* aidCommand(args: Record<string, unknown>): Operation<void> {
  const aidArgs: AidArgs = {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    alias: parseStringOption(args.alias, "alias"),
    compat: parseBooleanOption(args.compat, "compat"),
  };

  if (!aidArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!aidArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }

  yield* withExistingHab(
    aidArgs,
    aidArgs.alias,
    {
      compat: aidArgs.compat ?? false,
      readonly: true,
      skipConfig: true,
      skipSignator: true,
    },
    function*({ hab }) {
      console.log(hab.pre);
    },
  );
}
