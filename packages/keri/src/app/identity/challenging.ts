import { Diger, type SerderKERI } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import type { Baser } from "../../db/basing.ts";
import { sendExchangeMessage } from "../exchanges/exchange-messaging.ts";
import type { ExchangeAttachment, ExchangeRouteHandler } from "../exchanges/exchanging.ts";
import type { Exchanger } from "../exchanges/exchanging.ts";
import { type RuntimeClock, systemClock } from "../runtime/runtime-clock.ts";
import { observeUntil, type WaitResult } from "../runtime/workflow-contract.ts";
import type { HttpClient } from "../transport/http-client.ts";
import { isLocalGroupHab } from "./endpoint-roleing.ts";
import type { Hab, Habery } from "./habbing.ts";

const CHALLENGE_CONSONANTS = [
  "b",
  "c",
  "d",
  "f",
  "g",
  "h",
  "j",
  "k",
  "l",
  "m",
  "n",
  "p",
  "r",
  "s",
  "t",
  "v",
] as const;
const CHALLENGE_VOWELS = ["a", "e", "i", "o"] as const;
const BITS_PER_WORD = 12;

/** Built-in challenge route; the EXN sender is the authenticated responder. */
export const CHALLENGE_RESPONSE_ROUTE = "/challenge/response";

/** Known challenge content; EXN recipient projection is separate wire metadata. */
export type ChallengeResponsePayload = { words: string[] };

/** Output mode supported by `challenge generate`. */
export type ChallengeOutput = "json" | "string" | "words";

/**
 * Register the built-in challenge-response route handler on one exchanger.
 *
 * This keeps runtime creation explicit: the `Exchanger` owns exchange routing,
 * while the challenge module owns the `/challenge/response` application
 * behavior layered on top of it.
 */
export function loadChallengeHandlers(
  db: Baser,
  exchanger: Exchanger,
): void {
  exchanger.addHandler(new ChallengeHandler(db));
}

/**
 * Accepted `/challenge/response` handler.
 *
 * Responsibilities:
 * - validate the route payload shape enough for durable storage
 * - record successful signed responses in `reps.`
 *
 * Verification of the expected challenge words remains a verifier-side policy
 * decision in `challenge verify`, so this handler stores all accepted
 * responses rather than only one caller's currently expected phrase.
 */
export class ChallengeHandler implements ExchangeRouteHandler {
  static readonly resource = CHALLENGE_RESPONSE_ROUTE;
  readonly resource = ChallengeHandler.resource;
  readonly db: Baser;

  constructor(db: Baser) {
    this.db = db;
  }

  verify(args: {
    serder: SerderKERI;
    attachments: ExchangeAttachment[];
  }): boolean {
    return challengeWordsFromPayload(args.serder.ked?.a) !== null
      && args.attachments.length === 0;
  }

  handle(args: {
    serder: SerderKERI;
  }): void {
    const signer = args.serder.pre;
    const said = args.serder.said;
    if (!signer || !said) {
      return;
    }
    this.db.reps.add([signer], new Diger({ qb64: said }));
  }
}

/** Return one accepted challenge-response exchange message whose words match `expected`. */
export function findVerifiedChallengeResponse(
  db: Baser,
  signer: string,
  expected: readonly string[],
): SerderKERI | null {
  for (const diger of db.reps.get([signer])) {
    const exn = db.exns.get([diger.qb64]);
    if (!exn) {
      continue;
    }
    const words = challengeWordsFromPayload(exn.ked?.a);
    if (words && challengeWordsEqual(words, expected)) {
      return exn;
    }
  }
  return null;
}

/** Collaborators for sending a challenge response. */
export interface ChallengeRespondDeps {
  /** Borrowed identities and stores. */
  readonly hby: Habery;
  /** Borrowed HTTP implementation used to deliver the message. */
  readonly http: HttpClient;
  /** Borrowed clock for network deadlines. */
  readonly clock: RuntimeClock;
}

/**
 * Respond to a challenge: sign and send a `/challenge/response` exchange message
 * carrying `words` to `recipient`. Each call authors a new message (the exchange
 * carries a timestamp); the verifier's matching is idempotent over repeats.
 *
 * @returns The signed exchange message that was sent.
 * @throws ValidationError for a group habitat or empty words; send failures propagate.
 */
export function* respondToChallenge(
  deps: ChallengeRespondDeps,
  hab: Hab,
  recipient: string,
  words: readonly string[],
): Operation<SerderKERI> {
  if (isLocalGroupHab(deps.hby, hab)) {
    throw new ValidationError(
      "Challenge respond does not coordinate group approval. Select the responding member alias.",
    );
  }
  if (words.length === 0) throw new ValidationError("Challenge words must not be empty.");
  const payload: ChallengeResponsePayload = { words: [...words] };
  const { serder } = yield* sendExchangeMessage(deps.hby, hab, deps.http, deps.clock, {
    dest: recipient,
    route: CHALLENGE_RESPONSE_ROUTE,
    topic: "challenge",
    payload: { i: hab.pre, ...payload },
  });
  return serder;
}

/**
 * Status of one expected challenge from one signer, derived from stored exchange
 * messages: `waiting` until an accepted response with exactly these words exists,
 * `received` once it does, `verified` after the verifier recorded it in `chas.`.
 */
export type ChallengeStatus =
  | { state: "waiting" }
  | { state: "received" | "verified"; response: SerderKERI };

/** Read the status of `words` from `signer`; mutates nothing. */
export function challengeStatus(
  deps: { readonly db: Baser },
  signer: string,
  words: readonly string[],
): ChallengeStatus {
  const response = findVerifiedChallengeResponse(deps.db, signer, words);
  if (!response) return { state: "waiting" };
  const recorded = deps.db.chas.get([signer]).some((diger) => diger.qb64 === response.said);
  return { state: recorded ? "verified" : "received", response };
}

/** Choices for `waitForChallengeResponse`. */
export interface WaitForChallengeOptions {
  /** Wall-clock budget in milliseconds; zero reads once. */
  timeoutMs: number;
  /** Elapsed milliseconds between reads. */
  pollMs?: number;
  clock?: RuntimeClock;
}

/**
 * Observe stored exchange messages until a response with the expected words from
 * `signer` arrives or the budget expires. Starts no worker: the host's runtime
 * (mailbox polling, exchange intake) is what stores the response.
 */
export function* waitForChallengeResponse(
  deps: { readonly db: Baser },
  signer: string,
  words: readonly string[],
  { timeoutMs, pollMs = 250, clock = systemClock }: WaitForChallengeOptions,
): Operation<WaitResult<ChallengeStatus>> {
  const done = yield* observeUntil(() => challengeStatus(deps, signer, words).state !== "waiting", {
    timeoutMs,
    pollMs,
    clock,
  });
  const status = challengeStatus(deps, signer, words);
  return done ? { outcome: "settled", status } : { outcome: "timed-out", status, timeoutMs };
}

/** Persist one verifier-confirmed challenge response in `chas.`. */
export function markChallengeVerified(
  db: Baser,
  signer: string,
  serder: SerderKERI,
): void {
  if (!serder.said) {
    return;
  }
  db.chas.add([signer], new Diger({ qb64: serder.said }));
}

/** Parse CLI input into challenge words from JSON-array or whitespace-separated text. */
export function parseChallengeWords(input: string): string[] {
  const trimmed = input.trim();
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isChallengeWords(parsed)) {
      throw new Error("Challenge words JSON must be an array of strings.");
    }
    return parsed.map((item) => item.trim()).filter((item) => item.length > 0);
  }

  return trimmed.split(/\s+/).filter((item) => item.length > 0);
}

/** Format one challenge-word list using the requested CLI output mode. */
export function formatChallengeWords(
  words: readonly string[],
  out: ChallengeOutput,
): string {
  switch (out) {
    case "string":
      return words.join(" ");
    case "words":
      return words.join("\n");
    case "json":
    default:
      return JSON.stringify(words);
  }
}

/**
 * Generate a cryptographically random challenge phrase.
 *
 * The generator intentionally avoids a bundled external wordlist dependency by
 * deriving pronounceable four-letter pseudo-words from 12 random bits each.
 * That keeps the command self-contained while still giving human-friendly
 * tokens suitable for challenge/response workflows.
 */
export function generateChallengeWords(strength = 128): string[] {
  const normalized = Number.isFinite(strength) && strength > 0
    ? Math.trunc(strength)
    : 128;
  const count = Math.max(1, Math.ceil(normalized / BITS_PER_WORD));
  const words: string[] = [];
  const random = new Uint8Array(count * 2);
  crypto.getRandomValues(random);

  for (let i = 0; i < count; i += 1) {
    const value = ((random[i * 2] << 8) | random[(i * 2) + 1]) & 0x0fff;
    words.push(challengeWordFromValue(value));
  }

  return words;
}

function challengeWordFromValue(value: number): string {
  const c1 = CHALLENGE_CONSONANTS[(value >> 8) & 0x0f];
  const v1 = CHALLENGE_VOWELS[(value >> 6) & 0x03];
  const c2 = CHALLENGE_CONSONANTS[(value >> 2) & 0x0f];
  const v2 = CHALLENGE_VOWELS[value & 0x03];
  return `${c1}${v1}${c2}${v2}`;
}

function challengeWordsEqual(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return actual.length === expected.length
    && actual.every((word, index) => word === expected[index]);
}

/** Narrow decoded EXN attributes before the handler or verifier reads known challenge content. */
function challengeWordsFromPayload(payload: unknown): ChallengeResponsePayload["words"] | null {
  if (!payload || typeof payload !== "object" || !("words" in payload)) return null;
  const words = payload.words;
  return isChallengeWords(words) ? words : null;
}

/** CLI JSON and decoded response content share the same word-list contract. */
function isChallengeWords(value: unknown): value is ChallengeResponsePayload["words"] {
  return Array.isArray(value) && value.every((word: unknown) => typeof word === "string");
}
