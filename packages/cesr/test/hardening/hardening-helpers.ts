import { assert, assertEquals } from "jsr:@std/assert";
import {
  createParser,
  type ParserOptions,
} from "../../src/core/parser-engine.ts";
import { concatBytes, decodeB64, intToB64 } from "../../src/core/bytes.ts";
import type { CesrFrame } from "../../src/core/types.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import {
  counterV1,
  counterV2,
  sigerToken,
} from "../fixtures/counter-token-fixtures.ts";
import { chunkByBoundaries, encode } from "../fixtures/stream-byte-fixtures.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "../fixtures/external-vectors.ts";

/**
 * Shared hardening-test utilities for P2 vector suites.
 *
 * Maintainer intent:
 * - keep vector tests focused on behavioral contracts, not parser plumbing
 * - centralize deterministic split/mutation generators to avoid test drift
 * - expose one stable frame-summary shape for cross-domain/text-vs-qb2 assertions
 */
export interface FrameSummary {
  /** High-level body kind (`CESR`, `JSON`, `MGPK`, `CBOR`, ...). */
  kind: string;
  /** Protocol version as `major.minor` string for stable equality checks. */
  pvrsn: string;
  /** Event ilk when present, empty string otherwise. */
  ilk: string;
  /** SAID when present, empty string otherwise. */
  said: string;
  /** Native CESR body-group counter code for native frames, empty when absent. */
  nativeBodyCode: string;
  /** Attachment summary as `code:count` preserving parse order. */
  attachments: string[];
}

export interface ParsedSummaryPair {
  /** Summary from qb64/text-domain parse path. */
  txt: FrameSummary[];
  /** Summary from qb2/binary-domain parse path. */
  qb2: FrameSummary[];
}

/**
 * Parse stream bytes through optional chunk boundaries and return all events.
 *
 * This is the canonical harness for hardening vectors that need to validate:
 * - normal feed/flush lifecycle
 * - chunk split determinism
 * - policy-specific behavior via parser options.
 */
export function parseEvents(
  input: Uint8Array,
  boundaries: number[] = [],
  options?: ParserOptions,
): CesrFrame[] {
  const parser = createParser(options);
  const out: CesrFrame[] = [];
  for (const chunk of chunkByBoundaries(input, boundaries)) {
    out.push(...parser.feed(chunk));
  }
  out.push(...parser.flush());
  return out;
}

/**
 * Parse events and require error-free extraction.
 *
 * Use this in vectors where parser errors are not the behavior under test.
 * Vectors that intentionally exercise failures should call `parseEvents`
 * directly and assert on emitted `error` events themselves.
 */
export function parseFramesNoError(
  input: Uint8Array,
  boundaries: number[] = [],
  options?: ParserOptions,
): CesrFrame[] {
  const events = parseEvents(input, boundaries, options);
  const errors = events.filter((event) => event.type === "error");
  assertEquals(errors.length, 0);
  return events.filter((event) => event.type === "frame");
}

/**
 * Normalize frame events into a deterministic comparison shape.
 *
 * The summary intentionally excludes raw bytes and verbose nested payload detail,
 * so vector tests can assert contract-level semantics without overfitting.
 */
export function summarizeFrames(frames: CesrFrame[]): FrameSummary[] {
  return frames
    .filter((event) => event.type === "frame")
    .map((event) => ({
      kind: event.frame.body.kind,
      pvrsn: `${event.frame.body.pvrsn.major}.${event.frame.body.pvrsn.minor}`,
      ilk: event.frame.body.ilk ?? "",
      said: event.frame.body.said ?? "",
      nativeBodyCode: event.frame.body.native?.bodyCode ?? "",
      attachments: event.frame.attachments.map((attachment) =>
        `${attachment.code}:${attachment.count}`
      ),
    }));
}

/** Parse one qb64 stream in both text and qb2 domains and summarize each path. */
export function parseTxtQb2Summaries(
  txtStream: string,
  boundaries: number[] = [],
  options?: ParserOptions,
): ParsedSummaryPair {
  const txtBytes = encode(txtStream);
  const qb2Bytes = decodeB64(txtStream);
  return {
    txt: summarizeFrames(parseFramesNoError(txtBytes, boundaries, options)),
    qb2: summarizeFrames(parseFramesNoError(qb2Bytes, boundaries, options)),
  };
}

/**
 * Assert semantic parity between text and qb2 parses for the same stream.
 *
 * Returns the text summary as baseline so callers can add vector-specific
 * assertions (frame count, attachment expectations, version profile, etc).
 */
export function assertTxtQb2Parity(
  txtStream: string,
  boundaries: number[] = [],
  options?: ParserOptions,
): FrameSummary[] {
  const { txt, qb2 } = parseTxtQb2Summaries(txtStream, boundaries, options);
  assertEquals(qb2, txt);
  return txt;
}

/** Stable two-cut split utility used by boundary-focused vector tests. */
export function splitIntoThirds(input: Uint8Array): number[] {
  const a = Math.max(1, Math.floor(input.length / 3));
  const b = Math.max(a + 1, Math.floor((2 * input.length) / 3));
  return [a, b];
}

/**
 * Build deterministic split plans with `nMin..nMax` cuts each.
 *
 * Determinism is mandatory for CI reliability; do not replace this with
 * non-seeded randomness unless you also introduce reproducible seed capture.
 */
export function buildNWaySplitPlans(
  inputLength: number,
  nMin: number,
  nMax: number,
  plansPerN = 4,
  seed = 0x5eed_baad,
): number[][] {
  if (inputLength < 3) return [];
  let state = seed >>> 0;
  const nextU32 = () => {
    // LCG parameters from Numerical Recipes (deterministic only, not crypto)
    state = (1664525 * state + 1013904223) >>> 0;
    return state;
  };

  const plans: number[][] = [];
  const maxCuts = Math.max(1, inputLength - 1);

  for (let n = nMin; n <= nMax; n++) {
    const cuts = Math.min(Math.max(1, n), maxCuts);
    for (let p = 0; p < plansPerN; p++) {
      const points = new Set<number>();
      while (points.size < cuts) {
        const candidate = (nextU32() % (inputLength - 1)) + 1;
        points.add(candidate);
      }
      plans.push([...points].sort((a, b) => a - b));
    }
  }

  return plans;
}

/**
 * Generate deterministic text-stream mutations for robustness fuzz vectors.
 *
 * Mutations are intentionally shallow (1-3 char edits) with header/selector
 * bias, which makes them effective at surfacing parser-state edge handling
 * without requiring heavyweight fuzz infrastructure.
 */
export function mutateTextStream(
  base: string,
  seed = 0x00c0ffee,
  variants = 24,
): string[] {
  if (base.length < 4) return [];
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_!~";
  let state = seed >>> 0;
  const nextU32 = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state;
  };

  const out: string[] = [];
  for (let i = 0; i < variants; i++) {
    const chars = base.split("");
    // Mutate 1-3 locations with bias toward stream headers/selectors.
    const edits = 1 + (nextU32() % 3);
    for (let j = 0; j < edits; j++) {
      const biasSpan = Math.max(1, Math.floor(base.length / 4));
      const biased = (nextU32() & 1) === 0
        ? nextU32() % biasSpan
        : nextU32() % base.length;
      const replacement = alphabet[nextU32() % alphabet.length];
      chars[biased] = replacement;
    }
    out.push(chars.join(""));
  }

  return out;
}

/** Wrap a quadlet-aligned payload with a v2 group counter. */
export function wrapQuadletGroupV2(code: string, payload: string): string {
  if (payload.length % 4 !== 0) {
    throw new Error(`Payload must be quadlet-aligned for ${code}`);
  }
  return `${counterV2(code, payload.length / 4)}${payload}`;
}

/** Build `KERIACDCGenusVersion` selector token for explicit version-context vectors. */
export function genusVersionCounter(major: 1 | 2, minor = 0): string {
  const patch = 0;
  return `${CtrDexV2.KERIACDCGenusVersion}${intToB64(major, 1)}${intToB64(minor, 1)}${intToB64(patch, 1)}`;
}

/**
 * Canonical wrapper-heavy stream used by multiple breadth/recovery/fuzz vectors.
 *
 * Stream composition intentionally mixes short + big counters and both body and
 * attachment wrappers to maximize parser-surface coverage per fixture.
 */
export function wrapperHeavyV2Stream(): string {
  const nestedSigGroup = `${counterV2(CtrDexV2.ControllerIdxSigs, 1)}${sigerToken()}`;
  const shortGeneric = wrapQuadletGroupV2(
    CtrDexV2.GenericGroup,
    KERIPY_NATIVE_V2_ICP_FIX_BODY,
  );
  const bigGeneric = wrapQuadletGroupV2(
    CtrDexV2.BigGenericGroup,
    KERIPY_NATIVE_V2_ICP_FIX_BODY,
  );
  const shortBodyWithAttachment = wrapQuadletGroupV2(
    CtrDexV2.BodyWithAttachmentGroup,
    `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedSigGroup}`,
  );
  const bigBodyWithAttachment = wrapQuadletGroupV2(
    CtrDexV2.BigBodyWithAttachmentGroup,
    `${KERIPY_NATIVE_V2_ICP_FIX_BODY}${nestedSigGroup}`,
  );
  const shortAttachmentGroup = wrapQuadletGroupV2(
    CtrDexV2.AttachmentGroup,
    nestedSigGroup,
  );
  const bigAttachmentGroup = wrapQuadletGroupV2(
    CtrDexV2.BigAttachmentGroup,
    nestedSigGroup,
  );

  return `${shortGeneric}${bigGeneric}${shortBodyWithAttachment}${bigBodyWithAttachment}${KERIPY_NATIVE_V2_ICP_FIX_BODY}${shortAttachmentGroup}${KERIPY_NATIVE_V2_ICP_FIX_BODY}${bigAttachmentGroup}`;
}

/**
 * Build a nested v2 MapBody stream with label/value interleaving.
 *
 * Used by native-body breadth vectors to stress map tokenization and
 * syntax/semantic boundary handling under chunked parsing.
 */
export function buildNestedMapBodyV2(): string {
  const innerPayload = `VAAA${sigerToken()}`;
  const innerMap = wrapQuadletGroupV2(CtrDexV2.MapBodyGroup, innerPayload);
  const outerPayload = `VAAA${innerMap}VAAA${sigerToken()}VAAA${KERIPY_NATIVE_V2_ICP_FIX_BODY}`;
  return wrapQuadletGroupV2(CtrDexV2.MapBodyGroup, outerPayload);
}

/** Join stream parts with `ano` (0x0A) separators between each adjacent pair. */
export function concatWithAno(parts: Uint8Array[], anoRuns = 2): Uint8Array {
  const sep = new Uint8Array(anoRuns).fill(0x0a);
  const out: Uint8Array[] = [];
  for (let i = 0; i < parts.length; i++) {
    out.push(parts[i]);
    if (i < parts.length - 1) out.push(sep);
  }
  return concatBytes(...out);
}

/**
 * Guardrail for mutation-fuzz vectors: parser may fail, but only with known,
 * bounded parser error classes.
 */
export function assertNoUnexpectedErrorClasses(events: CesrFrame[]): void {
  const allowed = new Set([
    "ParserError",
    "ShortageError",
    "ColdStartError",
    "VersionError",
    "UnknownCodeError",
    "GroupSizeError",
    "DeserializeError",
    "SyntaxParseError",
    "SemanticInterpretationError",
  ]);
  for (const event of events) {
    if (event.type !== "error") continue;
    assert(
      allowed.has(event.error.name),
      `unexpected error class from mutation fuzz: ${event.error.name} (${event.error.message})`,
    );
  }
}
