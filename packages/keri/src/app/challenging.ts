import { Diger, type SerderKERI } from "../../../cesr/mod.ts";
import type { Baser } from "../db/basing.ts";
import type { ExchangeAttachment, ExchangeRouteHandler } from "./exchanging.ts";
import type { Exchanger } from "./exchanging.ts";

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
  static readonly resource = "/challenge/response";
  readonly resource = ChallengeHandler.resource;
  readonly db: Baser;

  constructor(db: Baser) {
    this.db = db;
  }

  verify(args: {
    serder: SerderKERI;
    attachments: ExchangeAttachment[];
  }): boolean {
    const payload = args.serder.ked?.a as Record<string, unknown> | undefined;
    return challengeWordsFromPayload(payload) !== null
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
    const words = challengeWordsFromPayload(
      exn.ked?.a as Record<string, unknown> | undefined,
    );
    if (words && challengeWordsEqual(words, expected)) {
      return exn;
    }
  }
  return null;
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
    const parsed = JSON.parse(trimmed);
    if (
      !Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")
    ) {
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

function challengeWordsFromPayload(
  payload: Record<string, unknown> | undefined,
): string[] | null {
  const words = payload?.words;
  if (!Array.isArray(words) || words.some((item) => typeof item !== "string")) {
    return null;
  }
  return words;
}
