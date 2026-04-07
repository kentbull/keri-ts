import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { isEndpointRole } from "../../core/roles.ts";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../agent-runtime.ts";
import { setupHby } from "./common/existing.ts";

/** Parsed arguments for `tufa ends add`. */
interface EndsAddArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  role?: string;
  eid?: string;
  compat?: boolean;
}

/**
 * Implement `tufa ends add` on top of the shared local runtime.
 *
 * Flow:
 * - reopen the local habery
 * - build a signed `/end/role/add` reply from the selected habitat
 * - feed that reply back through the local runtime path
 * - confirm the accepted authorization landed in `ends.`
 *
 * This command mutates local state only through normal KERI reply processing,
 * not through a side-channel direct DB write.
 */
export function* endsAddCommand(args: Record<string, unknown>): Operation<void> {
  const commandArgs: EndsAddArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    role: args.role as string | undefined,
    eid: args.eid as string | undefined,
    compat: args.compat as boolean | undefined,
  };

  if (!commandArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!commandArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }
  if (!commandArgs.role || !isEndpointRole(commandArgs.role)) {
    throw new ValidationError(`Unsupported endpoint role ${String(commandArgs.role)}`);
  }
  if (!commandArgs.eid) {
    throw new ValidationError("Endpoint AID is required and cannot be empty");
  }

  const hby = yield* setupHby(
    commandArgs.name,
    commandArgs.base ?? "",
    commandArgs.passcode,
    false,
    commandArgs.headDirPath,
    {
      compat: commandArgs.compat ?? false,
      readonly: false,
      skipConfig: false,
      skipSignator: false,
    },
  );

  try {
    const hab = hby.habByName(commandArgs.alias);
    if (!hab) {
      throw new ValidationError(`No local AID found for alias ${commandArgs.alias}`);
    }

    const runtime = yield* createAgentRuntime(hby, { mode: "local" });
    ingestKeriBytes(runtime, hab.makeEndRole(commandArgs.eid, commandArgs.role, true));
    yield* processRuntimeTurn(runtime, { hab });

    const end = hby.db.ends.get([hab.pre, commandArgs.role, commandArgs.eid]);
    if (!end?.allowed) {
      throw new ValidationError(
        `Endpoint role ${commandArgs.role} for ${commandArgs.eid} was not accepted into local state.`,
      );
    }

    console.log(`${commandArgs.role} ${commandArgs.eid}`);
  } finally {
    yield* hby.close();
  }
}
