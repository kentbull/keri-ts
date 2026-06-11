import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { isEndpointRole } from "../../core/roles.ts";
import { ingestKeriBytes, processRuntimeTurn } from "../agent-runtime.ts";
import { endpointRoleAccepted, isLocalGroupHab, proposeGroupEndpointRole } from "../endpoint-roleing.ts";
import { withHabAndAgentRuntime } from "./common/context.ts";

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
export function* endsAddCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: EndsAddArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    role: args.role as string | undefined,
    eid: args.eid as string | undefined,
    multisigMode: parseMultisigMode(args.multisigMode as string | undefined),
    compat: args.compat as boolean | undefined,
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

  yield* withHabAndAgentRuntime(
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
          const result = yield* proposeGroupEndpointRole(runtime, hab, {
            eid,
            role,
            allow: true,
          });
          console.log(JSON.stringify({
            route: result.route,
            said: result.said,
            group: result.group,
            accepted: result.accepted,
            deliveries: result.deliveries,
            attachmentBytes: result.attachmentBytes,
          }));
          return;
        }
        if (!endpointRoleAccepted(hby, hab.pre, role, eid)) {
          throw new ValidationError(
            `Endpoint role ${role} for ${eid} is not yet approved for group ${hab.pre}.`,
          );
        }
        console.log(`${role} ${eid}`);
        return;
      }

      if (commandArgs.multisigMode) {
        throw new ValidationError("--multisig-mode is only valid for local group aliases.");
      }
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(eid, role, true),
      );
      yield* processRuntimeTurn(runtime, { hab, pollMailbox: false });

      const end = hby.db.ends.get([hab.pre, role, eid]);
      if (!end?.allowed) {
        throw new ValidationError(
          `Endpoint role ${role} for ${eid} was not accepted into local state.`,
        );
      }

      console.log(`${role} ${eid}`);
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
