import { action, type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import {
  type ChallengeOutput,
  findVerifiedChallengeResponse,
  formatChallengeWords,
  generateChallengeWords,
  markChallengeVerified,
  parseChallengeWords,
} from "../challenging.ts";
import { type ExchangeTransport, sendSignedExchangeMessage } from "../exchanging.ts";
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
}

interface ChallengeVerifyArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  signer?: string;
  words?: string;
  timeout?: number;
  compat?: boolean;
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

    const { serder, url } = yield* sendSignedExchangeMessage(hab, {
      route: "/challenge/response",
      payload: { i: hab.pre, words },
      recipient: commandArgs.recipient,
      transport: normalizeTransport(commandArgs.transport),
    });
    console.log(`${serder.said} ${url}`);
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
    timeout: args.timeout ? Number(args.timeout) : 10,
    compat: args.compat as boolean | undefined,
  };

  if (!commandArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!commandArgs.signer) {
    throw new ValidationError("Signer prefix is required.");
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
      skipSignator: true,
    },
  );

  try {
    const timeoutMs = Math.max(1, commandArgs.timeout ?? 10) * 1000;
    const start = Date.now();
    let match = findVerifiedChallengeResponse(
      hby.db,
      commandArgs.signer,
      words,
    );

    while (!match && (Date.now() - start) < timeoutMs) {
      yield* sleep(250);
      match = findVerifiedChallengeResponse(hby.db, commandArgs.signer, words);
    }

    if (!match) {
      throw new ValidationError(
        `No challenge response from ${commandArgs.signer} matched the provided words.`,
      );
    }

    markChallengeVerified(hby.db, commandArgs.signer, match);
    console.log(`${commandArgs.signer} ${match.said}`);
  } finally {
    yield* hby.close();
  }
}

function normalizeOutput(input?: string): ChallengeOutput {
  const out = input ?? "json";
  if (out === "json" || out === "string" || out === "words") {
    return out;
  }
  throw new ValidationError(`Unsupported challenge output ${String(input)}.`);
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

function* sleep(ms: number): Operation<void> {
  yield* action((resolve) => {
    const timeoutId = setTimeout(() => resolve(undefined), ms);
    return () => clearTimeout(timeoutId);
  });
}
