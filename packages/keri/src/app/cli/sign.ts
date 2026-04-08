import { type Operation, spawn } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { setupHby } from "./common/existing.ts";
import { loadTextArgument } from "./common/parsing.ts";

interface SignArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  compat?: boolean;
  text?: string;
}

/** Implements `tufa sign`. */
export function* signCommand(args: Record<string, unknown>): Operation<void> {
  const signArgs: SignArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    compat: args.compat as boolean | undefined,
    text: args.text as string | undefined,
  };

  if (!signArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!signArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }
  if (!signArgs.text) {
    throw new ValidationError("Text is required and cannot be empty");
  }

  const doer = yield* spawn(function*() {
    const hby = yield* setupHby(
      signArgs.name!,
      signArgs.base ?? "",
      signArgs.passcode,
      false,
      signArgs.headDirPath,
      {
        compat: signArgs.compat ?? false,
        readonly: false,
        skipConfig: true,
        skipSignator: true,
      },
    );
    try {
      const hab = hby.habByName(signArgs.alias!);
      if (!hab) {
        throw new ValidationError(`Alias ${signArgs.alias!} is invalid`);
      }

      const sigers = hab.sign(loadTextArgument(signArgs.text!), true);
      for (const [idx, siger] of sigers.entries()) {
        console.log(`${idx + 1}. ${siger.qb64}`);
      }
    } finally {
      yield* hby.close();
    }
  });

  yield* doer;
}
