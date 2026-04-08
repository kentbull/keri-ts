/**
 * `tufa verify` command implementation.
 *
 * KERIpy correspondence:
 * - mirrors `keri.cli.commands.verify`
 * - verifies indexed signatures against the locally accepted key state for the
 *   supplied prefix rather than consulting remote state on demand
 *
 * Maintainer implication:
 * - signature validity after a remote rotation depends on whether local state
 *   has already been updated, which is why the interop proof must include the
 *   pre-query failure and post-query success cases
 */
import { type Operation, spawn } from "npm:effection@^3.6.0";
import { Siger } from "../../../../cesr/mod.ts";
import { ValidationError } from "../../core/errors.ts";
import { setupHby } from "./common/existing.ts";
import { loadTextArgument } from "./common/parsing.ts";

/** Parsed command arguments for one `tufa verify` invocation. */
interface VerifyArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  prefix?: string;
  compat?: boolean;
  text?: string;
  signature?: string[];
}

/**
 * Verify one or more indexed signatures against locally accepted key state.
 *
 * KLI/KERIpy compatibility:
 * - `--signature` values are raw qb64 signatures, not the numbered lines from
 *   `tufa sign`
 * - each `Siger` is rebound to `kever.verfers[index]` before verification
 */
export function* verifyCommand(args: Record<string, unknown>): Operation<void> {
  const verifyArgs: VerifyArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    prefix: args.prefix as string | undefined,
    compat: args.compat as boolean | undefined,
    text: args.text as string | undefined,
    signature: args.signature as string[] | undefined,
  };

  if (!verifyArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!verifyArgs.prefix) {
    throw new ValidationError("Prefix is required and cannot be empty");
  }
  if (!verifyArgs.text) {
    throw new ValidationError("Text is required and cannot be empty");
  }
  if (!verifyArgs.signature || verifyArgs.signature.length === 0) {
    throw new ValidationError("At least one signature is required");
  }

  const doer = yield* spawn(function*() {
    const hby = yield* setupHby(
      verifyArgs.name!,
      verifyArgs.base ?? "",
      verifyArgs.passcode,
      false,
      verifyArgs.headDirPath,
      {
        compat: verifyArgs.compat ?? false,
        readonly: false,
        skipConfig: true,
        skipSignator: true,
      },
    );
    try {
      const kever = hby.db.getKever(verifyArgs.prefix!);
      if (!kever) {
        throw new ValidationError(
          `No known key state for prefix ${verifyArgs.prefix!}.`,
        );
      }

      const ser = loadTextArgument(verifyArgs.text!);
      for (const rawSignature of verifyArgs.signature!) {
        const siger = new Siger({ qb64: rawSignature });
        if (siger.index >= kever.verfers.length) {
          throw new ValidationError(
            `Index = ${siger.index} to large for keys.`,
          );
        }
        const verfer = kever.verfers[siger.index];
        if (!verfer) {
          throw new ValidationError(
            `Missing verifier at index ${siger.index}.`,
          );
        }
        if (!verfer.verify(siger.raw, ser)) {
          throw new ValidationError(
            `Signature ${siger.index + 1} is invalid.`,
          );
        }
        console.log(`Signature ${siger.index + 1} is valid.`);
      }
    } finally {
      yield* hby.close();
    }
  });

  yield* doer;
}
