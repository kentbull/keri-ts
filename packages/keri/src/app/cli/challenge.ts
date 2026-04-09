import { action, type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { createAgentRuntime, processMailboxTurn } from "../agent-runtime.ts";
import { type CesrBodyMode, normalizeCesrBodyMode } from "../cesr-http.ts";
import {
  type ChallengeOutput,
  findVerifiedChallengeResponse,
  formatChallengeWords,
  generateChallengeWords,
  markChallengeVerified,
  parseChallengeWords,
} from "../challenging.ts";
import { type ExchangeDeliveryPreference, sendExchangeMessage } from "../forwarding.ts";
import type { Habery } from "../habbing.ts";
import { Organizer } from "../organizing.ts";
import { setupHby } from "./common/existing.ts";

interface ChallengeGenerateArgs {
  strength?: number;
  out?: string;
}

interface ChallengeRespondArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  recipient?: string;
  words?: string;
  transport?: string;
  compat?: boolean;
  outboxer?: boolean;
  cesrBodyMode?: CesrBodyMode;
}

interface ChallengeVerifyArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  signer?: string;
  words?: string;
  generate?: boolean;
  strength?: number;
  out?: string;
  timeout?: number;
  compat?: boolean;
  outboxer?: boolean;
  cesrBodyMode?: CesrBodyMode;
  pollDelayMs?: number;
}

/** Implement `tufa challenge generate`. */
export function* challengeGenerateCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: ChallengeGenerateArgs = {
    strength: args.strength ? Number(args.strength) : 128,
    out: args.out as string | undefined,
  };

  const out = normalizeOutput(commandArgs.out);
  const words = generateChallengeWords(commandArgs.strength ?? 128);
  console.log(formatChallengeWords(words, out));
}

/** Implement `tufa challenge respond` by sending a signed `/challenge/response` exchange message. */
export function* challengeRespondCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: ChallengeRespondArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    recipient: args.recipient as string | undefined,
    words: args.words as string | undefined,
    transport: args.transport as string | undefined,
    compat: args.compat as boolean | undefined,
    outboxer: args.outboxer as boolean | undefined,
    cesrBodyMode: normalizeCesrBodyMode(
      args.cesrBodyMode as string | undefined,
    ),
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
  if (!commandArgs.words) {
    throw new ValidationError("Challenge words are required.");
  }

  const words = parseChallengeWords(commandArgs.words);
  if (words.length === 0) {
    throw new ValidationError("Challenge words must not be empty.");
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
      outboxer: commandArgs.outboxer ?? false,
      cesrBodyMode: commandArgs.cesrBodyMode,
    },
  );

  try {
    const hab = hby.habByName(commandArgs.alias);
    if (!hab) {
      throw new ValidationError(
        `No local AID found for alias ${commandArgs.alias}.`,
      );
    }

    const { serder } = yield* sendExchangeMessage(hby, hab, {
      recipient: commandArgs.recipient,
      route: "/challenge/response",
      topic: "challenge",
      payload: { i: hab.pre, words },
      delivery: normalizeTransport(commandArgs.transport),
    });
    console.log("Sent EXN message");
    console.log(serder.pretty());
  } finally {
    yield* hby.close();
  }
}

/** Implement `tufa challenge verify` by matching accepted challenge responses in local exchange state. */
export function* challengeVerifyCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: ChallengeVerifyArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    signer: args.signer as string | undefined,
    words: args.words as string | undefined,
    generate: args.generate as boolean | undefined,
    strength: args.strength ? Number(args.strength) : undefined,
    out: args.out as string | undefined,
    timeout: args.timeout ? Number(args.timeout) : 10,
    compat: args.compat as boolean | undefined,
    outboxer: args.outboxer as boolean | undefined,
    cesrBodyMode: normalizeCesrBodyMode(
      args.cesrBodyMode as string | undefined,
    ),
    pollDelayMs: args.pollDelayMs ? Number(args.pollDelayMs) : undefined,
  };

  if (!commandArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!commandArgs.signer) {
    throw new ValidationError(
      "Signer identifier or contact alias is required.",
    );
  }
  if (!commandArgs.generate && !commandArgs.words) {
    throw new ValidationError("Challenge words are required.");
  }

  const words = commandArgs.generate
    ? generateChallengeWords(commandArgs.strength ?? 128)
    : parseChallengeWords(commandArgs.words!);
  if (words.length === 0) {
    throw new ValidationError("Challenge words must not be empty.");
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
      skipSignator: true,
      outboxer: commandArgs.outboxer ?? false,
      cesrBodyMode: commandArgs.cesrBodyMode,
    },
  );

  try {
    const signer = resolveSigner(hby, commandArgs.signer);
    if (commandArgs.generate) {
      console.log(
        formatChallengeWords(words, normalizeOutput(commandArgs.out)),
      );
    }

    const runtime = yield* createAgentRuntime(hby, { mode: "local" });
    runtime.mailboxDirector.topics.clear();
    runtime.mailboxDirector.registerTopic("/challenge");
    const timeoutMs = Math.max(1, commandArgs.timeout ?? 10) * 1000;
    const pollDelayMs = Math.max(1, commandArgs.pollDelayMs ?? 250);
    const deadline = Date.now() + timeoutMs;
    let match = findVerifiedChallengeResponse(hby.db, signer, words);

    while (!match && Date.now() < deadline) {
      yield* processMailboxTurn(runtime);
      match = findVerifiedChallengeResponse(hby.db, signer, words);
      if (!match && Date.now() < deadline) {
        yield* sleep(pollDelayMs);
      }
    }

    if (!match) {
      throw new ValidationError(
        `No challenge response from ${commandArgs.signer} matched the provided words.`,
      );
    }

    markChallengeVerified(hby.db, signer, match);
    console.log(`${signer} ${match.said}`);
  } finally {
    yield* hby.close();
  }
}

function resolveSigner(
  hby: Habery,
  signer: string,
): string {
  if (hby.db.getKever(signer)) {
    return signer;
  }

  const matches = new Organizer(hby).findExact("alias", signer);
  if (matches.length === 0) {
    throw new ValidationError(`no contact found with alias '${signer}'`);
  }
  if (matches.length > 1) {
    throw new ValidationError(
      `multiple contacts match alias '${signer}', use prefix instead`,
    );
  }
  return matches[0]!.id;
}

function normalizeOutput(input?: string): ChallengeOutput {
  const out = input ?? "json";
  if (out === "json" || out === "string" || out === "words") {
    return out;
  }
  throw new ValidationError(`Unsupported challenge output ${String(input)}.`);
}

function normalizeTransport(input?: string): ExchangeDeliveryPreference {
  const value = input ?? "auto";
  if (value === "auto" || value === "direct" || value === "indirect") {
    return value;
  }
  throw new ValidationError(
    `Unsupported exchange transport ${String(input)}.`,
  );
}

function* sleep(ms: number): Operation<void> {
  yield* action((resolve) => {
    const timeoutId = setTimeout(() => resolve(undefined), ms);
    return () => clearTimeout(timeoutId);
  });
}
