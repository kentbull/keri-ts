import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { type CesrBodyMode, normalizeCesrBodyMode } from "../cesr-http.ts";
import { sendExchangeMessage } from "../forwarding.ts";
import { withExistingHab } from "./common/context.ts";
import { parseExnDataItems } from "./common/parsing.ts";

interface ExnSendArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  sender?: string;
  recipient?: string;
  route?: string;
  topic?: string;
  data?: string[];
  compat?: boolean;
  outboxer?: boolean;
  cesrBodyMode?: CesrBodyMode;
}

/**
 * Implement `tufa exchange send` / `tufa exn send` with KERIpy-shaped EXN behavior.
 *
 * Public contract:
 * - sender is a local alias
 * - recipient is an AID or exact contact alias
 * - payload comes from repeatable `--data`
 * - topic defaults to the first route segment
 */
export function* exchangeSendCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: ExnSendArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    sender: args.sender as string | undefined,
    recipient: args.recipient as string | undefined,
    route: args.route as string | undefined,
    topic: args.topic as string | undefined,
    data: normalizeDataArgs(args.data),
    compat: args.compat as boolean | undefined,
    outboxer: args.outboxer as boolean | undefined,
    cesrBodyMode: normalizeCesrBodyMode(
      args.cesrBodyMode as string | undefined,
    ),
  };

  if (!commandArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!commandArgs.sender) {
    throw new ValidationError("Sender alias is required.");
  }
  if (!commandArgs.recipient) {
    throw new ValidationError("Recipient alias or prefix is required.");
  }
  if (!commandArgs.route) {
    throw new ValidationError("Exchange route is required.");
  }

  const recipient = commandArgs.recipient;
  const route = commandArgs.route;
  const payload = parseExnDataItems(commandArgs.data);
  yield* withExistingHab(
    commandArgs,
    commandArgs.sender,
    {
      compat: commandArgs.compat ?? false,
      readonly: false,
      skipConfig: false,
      skipSignator: false,
      outboxer: commandArgs.outboxer ?? false,
      cesrBodyMode: commandArgs.cesrBodyMode,
    },
    function*({ hby, hab }) {
      const { serder } = yield* sendExchangeMessage(hby, hab, {
        recipient,
        route,
        topic: commandArgs.topic,
        payload,
      });
      console.log("Sent EXN message");
      console.log(serder.pretty());
    },
  );
}

function normalizeDataArgs(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}
