import { type Operation, spawn } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { setupHby } from "./common/existing.ts";

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
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    compat: args.compat as boolean | undefined,
  };

  if (!aidArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!aidArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }

  const doer = yield* spawn(function* () {
    const hby = yield* setupHby(
      aidArgs.name!,
      aidArgs.base ?? "",
      aidArgs.passcode,
      false,
      aidArgs.headDirPath,
      {
        compat: aidArgs.compat ?? false,
        readonly: true,
        skipConfig: true,
        skipSignator: true,
      },
    );
    try {
      const hab = hby.habByName(aidArgs.alias!);
      if (!hab || !hab.pre) {
        throw new ValidationError(
          `No local AID found for alias ${aidArgs.alias}`,
        );
      }

      console.log(hab.pre);
    } finally {
      yield* hby.close();
    }
  });

  yield* doer;
}
