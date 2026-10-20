import { action, type Operation, spawn } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { runAgentRuntime } from "../agent-runtime.ts";
import { type CesrBodyMode, normalizeCesrBodyMode } from "../cesr-http.ts";
import {
  CHALLENGE_RESPONSE_ROUTE,
  type ChallengeOutput,
  type ChallengeResponsePayload,
  findVerifiedChallengeResponse,
  formatChallengeWords,
  generateChallengeWords,
  markChallengeVerified,
  parseChallengeWords,
} from "../challenging.ts";
import { sendExchangeMessage } from "../exchange-messaging.ts";
import type { Habery } from "../habbing.ts";
import { FetchHttpClient } from "../http-client.ts";
import { Organizer } from "../organizing.ts";
import { systemClock } from "../runtime-clock.ts";

import { withAgentRuntime, withExistingHab } from "./common/context.ts";

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
  compat?: boolean;
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

/**
 * Implement `tufa challenge respond` by sending a signed `/challenge/response` exchange message.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
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
    compat: args.compat as boolean | undefined,
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
  const recipient = commandArgs.recipient;

  yield* withExistingHab(
    commandArgs,
    commandArgs.alias,
    {
      compat: commandArgs.compat ?? false,
      readonly: false,
      skipConfig: false,
      skipSignator: false,
      cesrBodyMode: commandArgs.cesrBodyMode,
    },
    function*({ hby, hab }) {
      const payload: ChallengeResponsePayload = { words };
      const { serder } = yield* sendExchangeMessage(
        hby,
        hab,
        new FetchHttpClient(),
        systemClock,
        {
          dest: recipient,
          route: CHALLENGE_RESPONSE_ROUTE,
          topic: "challenge",
          payload: { i: hab.pre, ...payload },
        },
      );
      console.log("Sent EXN message");
      console.log(serder.pretty());
    },
  );
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
  const signerInput = commandArgs.signer;

  yield* withAgentRuntime(
    commandArgs,
    {
      compat: commandArgs.compat ?? false,
      readonly: false,
      skipConfig: false,
      skipSignator: true,
      cesrBodyMode: commandArgs.cesrBodyMode,
    },
    function*({ hby, runtime }) {
      const signer = resolveSigner(hby, signerInput);
      if (commandArgs.generate) {
        console.log(
          formatChallengeWords(words, normalizeOutput(commandArgs.out)),
        );
      }

      runtime.mailboxDirector.topics.clear();
      runtime.mailboxDirector.registerTopic("/challenge");
      const timeoutMs = Math.max(1, commandArgs.timeout ?? 10) * 1000;
      const pollDelayMs = Math.max(1, commandArgs.pollDelayMs ?? 250);
      const deadline = Date.now() + timeoutMs;
      let match = findVerifiedChallengeResponse(hby.db, signer, words);

      if (!match) {
        const worker = yield* spawn(() => runAgentRuntime(runtime));
        try {
          while (!match && Date.now() < deadline) {
            yield* sleep(Math.min(pollDelayMs, Math.max(0, deadline - Date.now())));
            match = findVerifiedChallengeResponse(hby.db, signer, words);
          }
        } finally {
          yield* worker.halt();
        }
      }

      if (!match) {
        throw new ValidationError(
          `No challenge response from ${signerInput} matched the provided words.`,
        );
      }

      markChallengeVerified(hby.db, signer, match);
      console.log(`${signer} ${match.said}`);
    },
  );
}

function resolveSigner(
  hby: Habery,
  signer: string,
): string {
  if (hby.db.getKever(signer)) {
    return signer;
  }

  const matches = new Organizer(hby.db, hby.signator).findExact("alias", signer);
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

function* sleep(ms: number): Operation<void> {
  yield* action((resolve) => {
    const timeoutId = setTimeout(() => resolve(undefined), ms);
    return () => clearTimeout(timeoutId);
  });
}
