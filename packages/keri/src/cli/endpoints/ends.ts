import { call, type Operation, spawn } from "npm:effection@^3.6.0";
import {
  endpointRoleAccepted,
  type GroupRoleResult,
  proposeGroupEndpointRole,
} from "../../app/identity/endpoint-roleing.ts";
import { isLocalGroupHab } from "../../app/multisig/group-members.ts";
import { settleRuntimeIngress } from "../../app/runtime/agent-runtime.ts";
import { ValidationError } from "../../core/errors.ts";
import { isEndpointRole } from "../../core/roles.ts";
import { withHabAndAgentRuntime } from "../common/context.ts";
import { parseBooleanOption, parseStringOption } from "../common/parsing.ts";

type MultisigEndpointRoleMode = "propose" | "complete";

/** Parsed arguments for `tufa ends add`. */
interface EndsAddArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  role?: string;
  eid?: string;
  multisigMode?: MultisigEndpointRoleMode;
  compat?: boolean;
}

/** Typed endpoint result; Tufa decides how to present the completed operation. */
export type EndRoleResult = GroupRoleResult | { role: string; eid: string };

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
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* endsAddCommand(
  args: Record<string, unknown>,
): Operation<EndRoleResult> {
  const commandArgs: EndsAddArgs = {
    name: parseStringOption(args.name, "--name"),
    base: parseStringOption(args.base, "--base"),
    headDirPath: parseStringOption(args.headDirPath, "--head-dir"),
    passcode: parseStringOption(args.passcode, "--passcode"),
    alias: parseStringOption(args.alias, "--alias"),
    role: parseStringOption(args.role, "--role"),
    eid: parseStringOption(args.eid, "--eid"),
    multisigMode: parseMultisigMode(parseStringOption(args.multisigMode, "--multisig-mode")),
    compat: parseBooleanOption(args.compat, "--compat"),
  };

  if (!commandArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!commandArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }
  if (!commandArgs.role || !isEndpointRole(commandArgs.role)) {
    throw new ValidationError(
      `Unsupported endpoint role ${String(commandArgs.role)}`,
    );
  }
  if (!commandArgs.eid) {
    throw new ValidationError("Endpoint AID is required and cannot be empty");
  }
  const eid = commandArgs.eid;
  const role = commandArgs.role;

  return yield* withHabAndAgentRuntime(
    commandArgs,
    commandArgs.alias,
    {
      compat: commandArgs.compat ?? false,
      readonly: false,
      skipConfig: false,
      skipSignator: false,
    },
    function*({ hby, hab, runtime }) {
      if (isLocalGroupHab(hby, hab)) {
        if (!commandArgs.multisigMode) {
          throw new ValidationError(
            "Group endpoint role authorization requires --multisig-mode propose or --multisig-mode complete.",
          );
        }
        if (commandArgs.multisigMode === "propose") {
          const result = yield* call(function*() {
            const postman = runtime.postman;
            const worker = yield* spawn(() => postman.deliverDo());
            try {
              return yield* proposeGroupEndpointRole(hby, runtime.protocol, postman, hab, {
                eid,
                role,
                allow: true,
              });
            } finally {
              yield* worker.halt();
            }
          });
          return result;
        }
        if (!endpointRoleAccepted(hby, hab.pre, role, eid)) {
          throw new ValidationError(
            `Endpoint role ${role} for ${eid} is not yet approved for group ${hab.pre}.`,
          );
        }
        return { role, eid };
      }

      if (commandArgs.multisigMode) {
        throw new ValidationError("--multisig-mode is only valid for local group aliases.");
      }
      yield* settleRuntimeIngress(runtime, [hab.makeEndRole(eid, role, true)]);

      const end = hby.db.ends.get([hab.pre, role, eid]);
      if (!end?.allowed) {
        throw new ValidationError(
          `Endpoint role ${role} for ${eid} was not accepted into local state.`,
        );
      }

      return { role, eid };
    },
  );
}

function parseMultisigMode(value: string | undefined): MultisigEndpointRoleMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "propose" || value === "complete") {
    return value;
  }
  throw new ValidationError("--multisig-mode must be propose or complete.");
}
