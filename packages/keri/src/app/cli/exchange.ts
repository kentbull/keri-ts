import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import {
  type ExchangeTransport,
  resolveExchangeTransportUrl,
  sendSignedExchangeMessage,
} from "../exchanging.ts";
import { setupHby } from "./common/existing.ts";

interface ExchangeSendArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  recipient?: string;
  route?: string;
  payload?: string;
  transport?: string;
  compat?: boolean;
}

/**
 * Implement `tufa exchange send` for one already-resolved remote identifier.
 *
 * Current scope:
 * - build and sign one `exn`
 * - deliver it over the selected direct or mailbox-authorized transport URL
 * - keep payload parsing explicit at the CLI seam instead of inventing a
 *   contacts/forwarding abstraction before the transport layer lands fully
 */
export function* exchangeSendCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: ExchangeSendArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    recipient: args.recipient as string | undefined,
    route: args.route as string | undefined,
    payload: args.payload as string | undefined,
    transport: args.transport as string | undefined,
    compat: args.compat as boolean | undefined,
  };

  if (!commandArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!commandArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }
  if (!commandArgs.recipient) {
    throw new ValidationError("Recipient prefix is required.");
  }
  if (!commandArgs.route) {
    throw new ValidationError("Exchange route is required.");
  }
  if (!commandArgs.payload) {
    throw new ValidationError("Exchange payload JSON is required.");
  }

  const transport = normalizeTransport(commandArgs.transport);
  const payload = parsePayload(commandArgs.payload);
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
      skipSignator: true,
    },
  );

  try {
    const hab = hby.habByName(commandArgs.alias);
    if (!hab) {
      throw new ValidationError(
        `No local AID found for alias ${commandArgs.alias}.`,
      );
    }

    const previewUrl = resolveExchangeTransportUrl(
      hab,
      commandArgs.recipient,
      transport,
    );
    if (!previewUrl) {
      throw new ValidationError(
        `No ${transport} transport endpoint is available for ${commandArgs.recipient}.`,
      );
    }

    const { serder, url } = yield* sendSignedExchangeMessage(hab, {
      route: commandArgs.route,
      payload,
      recipient: commandArgs.recipient,
      transport,
    });
    console.log(`${serder.said} ${url}`);
  } finally {
    yield* hby.close();
  }
}

function parsePayload(input: string): Record<string, unknown> {
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError("Exchange payload must be a JSON object.");
  }
  return parsed;
}

function normalizeTransport(input?: string): ExchangeTransport {
  const value = input ?? "auto";
  if (value === "auto" || value === "direct" || value === "indirect") {
    return value;
  }
  throw new ValidationError(
    `Unsupported exchange transport ${String(input)}.`,
  );
}
