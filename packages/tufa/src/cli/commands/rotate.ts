/** Resolve explicit provider credentials before the ordinary rotation owner changes keys. */
import type { Operation } from "effection";
import { parseStringOption, rotateCommand } from "keri-ts/cli";
import { ValidationError } from "keri-ts/runtime";
import { authoringWitnessAuths } from "../support/witness-auth.ts";

/** Borrow the core command's single Habery and preserve its ordinary code/prompt path. */
export function* rotateWithCredentialsCommand(args: Record<string, unknown>): Operation<void> {
  const file = parseStringOption(args.witnessCredentials, "witness-credentials");
  if (file !== undefined && !file.trim()) throw new ValidationError("--witness-credentials requires a file path.");
  yield* rotateCommand(
    args,
    file === undefined ? {} : {
      witnessAuths: (hab, witnesses) => {
        const auths = authoringWitnessAuths(hab, args);
        if (witnesses.some(witness => !auths[witness])) {
          throw new ValidationError("Witness credentials do not cover the selected rotation witnesses.");
        }
        return auths;
      },
    },
  );
}
