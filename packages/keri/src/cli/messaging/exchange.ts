import { type Operation } from "npm:effection@^3.6.0";
import { sendExchangeMessage } from "../../app/exchanges/exchange-messaging.ts";
import { isLocalGroupHab } from "../../app/multisig/group-members.ts";
import { systemClock } from "../../app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../app/transport/http-client.ts";
import { ValidationError } from "../../core/errors.ts";

import { withExistingHab } from "../common/context.ts";
import { parseBooleanOption, parseExnDataItems, parseStringListOption, parseStringOption } from "../common/parsing.ts";

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
}

/**
 * Implement `tufa exchange send` / `tufa exn send` with KERIpy-shaped EXN behavior.
 *
 * Public contract:
 * - sender is a local single-controller alias; group business workflows own approval
 * - recipient is an AID or exact contact alias
 * - payload comes from repeatable `--data`
 * - topic defaults to the first route segment
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* exchangeSendCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: ExnSendArgs = {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    sender: parseStringOption(args.sender, "sender"),
    recipient: parseStringOption(args.recipient, "recipient"),
    route: parseStringOption(args.route, "route"),
    topic: parseStringOption(args.topic, "topic"),
    data: normalizeDataArgs(args.data),
    compat: parseBooleanOption(args.compat, "compat"),
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
    },
    function*({ hby, hab }) {
      if (isLocalGroupHab(hby, hab)) {
        throw new ValidationError(
          "Generic exchange send does not coordinate group approval. Use a member alias or the matching group IPEX workflow.",
        );
      }
      const { serder } = yield* sendExchangeMessage(
        hby,
        hab,
        new FetchHttpClient(),
        systemClock,
        {
          dest: recipient,
          route,
          topic: commandArgs.topic,
          payload,
        },
      );
      console.log("Sent EXN message");
      console.log(serder.pretty());
    },
  );
}

function normalizeDataArgs(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  return parseStringListOption(value, "data") ?? [];
}
