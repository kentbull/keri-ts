import { b, codeB64ToB2 } from "../../src/core/bytes.ts";
import type { Smellage } from "../../src/core/types.ts";
import { Counter } from "../../src/primitives/counter.ts";
import { parseCounter } from "../../src/primitives/counter.ts";
import { parseIlker } from "../../src/primitives/ilker.ts";
import { Matter } from "../../src/primitives/matter.ts";
import { NumberPrimitive } from "../../src/primitives/number.ts";
import { Tholder } from "../../src/primitives/tholder.ts";
import { parseVerser } from "../../src/primitives/verser.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { Kinds, Protocols, Vrsn_2_0 } from "../../src/tables/versions.ts";
import { KERIPY_NATIVE_V2_ICP_FIX_BODY } from "./external-vectors.ts";

/**
 * Maintainer-readable helpers for the pinned KERIpy native inception fixture.
 *
 * The goal of this file is pedagogical as much as functional: tests that use
 * these helpers should read like worked examples of CESR-native framing rather
 * than opaque assertions over one long fixture string.
 */

export interface NativeReadableSegment {
  /** Maintainer-facing name for the native body slice, e.g. `verser` or `keys`. */
  name: string;
  /** Exact qb64 text carried by that slice inside the native body. */
  qb64: string;
  /** Human-meaningful projection of the slice used by example-driven tests. */
  semantic: unknown;
}

interface ParsedMatterToken {
  /** Parsed CESR primitive at the current fixture offset. */
  token: Matter;
  /** Next unread character position in the qb64 native fixture. */
  nextOffset: number;
}

const V2 = Vrsn_2_0;

/** The pinned text-domain native KERI inception body used across native serder tests. */
export function nativeKeriIcpFixtureQb64(): string {
  return KERIPY_NATIVE_V2_ICP_FIX_BODY;
}

/** Binary/qb2 form of the same pinned native KERI inception body. */
export function nativeKeriIcpFixtureQb2(): Uint8Array {
  return codeB64ToB2(KERIPY_NATIVE_V2_ICP_FIX_BODY);
}

/** Canonical smellage used when directly exercising native inhale helpers. */
export function nativeKeriIcpSmellage(): Smellage {
  return {
    proto: Protocols.keri,
    pvrsn: V2,
    gvrsn: V2,
    kind: Kinds.cesr,
    size: KERIPY_NATIVE_V2_ICP_FIX_BODY.length,
  };
}

/** Semantic SAD expected from the pinned native KERI inception fixture. */
export function expectedNativeKeriIcpSad(): Record<string, unknown> {
  return {
    v: "KERICAACAACESRAADo.",
    t: "icp",
    d: "EFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN",
    i: "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx",
    s: "0",
    kt: "1",
    k: [
      "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx",
    ],
    nt: "1",
    n: [
      "EFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2",
    ],
    bt: "0",
    b: [],
    c: [],
    a: [],
  };
}

/**
 * Build a message-shaped KERI native map body from the pinned fixed-body fixture.
 *
 * Why this exists:
 * the result is intentionally "plausible enough" to reach the serder-native
 * decoder. It has a `v` label plus the normal KERI top-level labels in order,
 * but it still must be rejected because KERI top-level native bodies are fixed
 * field, not map bodies.
 *
 * ASCII shape:
 *
 * ```text
 * -G... | 0J_v <verser> | 0J_t <ilk> | 0J_d <said> | 0J_i <pre> | ...
 * ```
 */
export function invalidNativeKeriIcpMapBodyQb64(): string {
  const segments = breakdownNativeKeriIcpFixture();
  const byName = new Map(
    segments.map((segment) => [segment.name, segment.qb64]),
  );
  const payload = [
    "0J_v",
    byName.get("verser"),
    "0J_t",
    byName.get("ilk"),
    "0J_d",
    byName.get("said"),
    "0J_i",
    byName.get("pre"),
    "0J_s",
    byName.get("sn"),
    "0Kkt",
    byName.get("kt"),
    "0J_k",
    byName.get("keys"),
    "0Knt",
    byName.get("nt"),
    "0J_n",
    byName.get("ndigs"),
    "0Kbt",
    byName.get("bt"),
    "0J_b",
    byName.get("backs"),
    "0J_c",
    byName.get("traits"),
    "0J_a",
    byName.get("seals"),
  ].join("");

  if (payload.includes("undefined")) {
    throw new Error("Failed to build invalid KERI native map-body fixture");
  }

  return `${
    new Counter({
      code: CtrDexV2.MapBodyGroup,
      count: payload.length / 4,
      version: V2,
    }).qb64
  }${payload}`;
}

function parseMatterToken(raw: string, offset: number): ParsedMatterToken {
  // `Matter` can parse from a suffix, so callers only need to track offsets.
  const token = new Matter({ qb64: raw.slice(offset) });
  return {
    token,
    nextOffset: offset + token.fullSize,
  };
}

/**
 * Parse one generic-list-style native segment from the fixture.
 *
 * We use this for keys, next digs, backers, traits, and seal lists because the
 * top-level KERI fixed-body fixture encodes all of them as "list counter
 * followed by concatenated primitive members".
 */
function parseMatterListSegment(
  raw: string,
  offset: number,
  name: string,
): { segment: NativeReadableSegment; nextOffset: number } {
  const counter = parseCounter(b(raw.slice(offset)), V2, "txt");
  const total = counter.fullSize + counter.count * 4;
  const qb64 = raw.slice(offset, offset + total);
  const payload = raw.slice(offset + counter.fullSize, offset + total);

  const items: string[] = [];
  let inner = 0;
  while (inner < payload.length) {
    // Each list member is another CESR primitive packed back-to-back.
    const matter = new Matter({ qb64: payload.slice(inner) });
    items.push(matter.qb64);
    inner += matter.fullSize;
  }

  return {
    segment: {
      name,
      qb64,
      semantic: items,
    },
    nextOffset: offset + total,
  };
}

/**
 * Break the pinned native KERI inception fixture into named top-level segments.
 *
 * This is intended to mirror how a maintainer should reason about the body:
 * `body counter -> verser -> ilk -> fixed fields in field-order`.
 */
export function breakdownNativeKeriIcpFixture(): NativeReadableSegment[] {
  const raw = KERIPY_NATIVE_V2_ICP_FIX_BODY;
  const segments: NativeReadableSegment[] = [];

  let offset = 0;

  // Native bodies begin with the body-group counter that frames the whole
  // message. For this pinned fixture the counter is `-FA5`.
  const bodyCounter = parseCounter(b(raw), V2, "txt");
  segments.push({
    name: "bodyCounter",
    qb64: raw.slice(0, bodyCounter.fullSize),
    semantic: { code: bodyCounter.code, count: bodyCounter.count },
  });
  offset += bodyCounter.fullSize;

  // After the body-group counter come the fixed fields in protocol order:
  // verser -> ilk -> d -> i -> s -> kt -> k -> ...
  const verser = parseVerser(b(raw.slice(offset)), "txt");
  segments.push({
    name: "verser",
    qb64: verser.qb64,
    semantic: {
      proto: verser.proto,
      pvrsn: verser.pvrsn,
      gvrsn: verser.gvrsn,
    },
  });
  offset += verser.fullSize;

  const ilker = parseIlker(b(raw.slice(offset)), "txt");
  segments.push({
    name: "ilk",
    qb64: ilker.qb64,
    semantic: ilker.ilk,
  });
  offset += ilker.fullSize;

  const said = parseMatterToken(raw, offset);
  segments.push({
    name: "said",
    qb64: said.token.qb64,
    // For this segment the qb64 itself is already the most useful semantic form.
    semantic: said.token.qb64,
  });
  offset = said.nextOffset;

  const prefix = parseMatterToken(raw, offset);
  segments.push({
    name: "pre",
    qb64: prefix.token.qb64,
    semantic: prefix.token.qb64,
  });
  offset = prefix.nextOffset;

  const sn = parseMatterToken(raw, offset);
  segments.push({
    name: "sn",
    qb64: sn.token.qb64,
    semantic: new NumberPrimitive(sn.token).numh,
  });
  offset = sn.nextOffset;

  const kt = parseMatterToken(raw, offset);
  segments.push({
    name: "kt",
    qb64: kt.token.qb64,
    semantic: new Tholder(kt.token).sith,
  });
  offset = kt.nextOffset;

  const keys = parseMatterListSegment(raw, offset, "keys");
  segments.push(keys.segment);
  offset = keys.nextOffset;

  const nt = parseMatterToken(raw, offset);
  segments.push({
    name: "nt",
    qb64: nt.token.qb64,
    semantic: new Tholder(nt.token).sith,
  });
  offset = nt.nextOffset;

  const ndigs = parseMatterListSegment(raw, offset, "ndigs");
  segments.push(ndigs.segment);
  offset = ndigs.nextOffset;

  const bt = parseMatterToken(raw, offset);
  segments.push({
    name: "bt",
    qb64: bt.token.qb64,
    semantic: new NumberPrimitive(bt.token).numh,
  });
  offset = bt.nextOffset;

  const backs = parseMatterListSegment(raw, offset, "backs");
  segments.push(backs.segment);
  offset = backs.nextOffset;

  const traits = parseMatterListSegment(raw, offset, "traits");
  segments.push(traits.segment);
  offset = traits.nextOffset;

  const seals = parseMatterListSegment(raw, offset, "seals");
  segments.push(seals.segment);
  offset = seals.nextOffset;

  if (offset !== raw.length) {
    // This guards the helper itself: if the fixture changes shape we want the
    // teaching helper to fail loudly instead of silently truncating/guessing.
    throw new Error(
      `Fixture segmentation did not consume full native body: ${offset}/${raw.length}`,
    );
  }

  return segments;
}

function shorten(qb64: string): string {
  return qb64.length <= 20 ? qb64 : `${qb64.slice(0, 8)}...${qb64.slice(-6)}`;
}

/**
 * Render one compact ASCII summary line that keeps the segment order readable.
 *
 * Example output:
 * `bodyCounter=-FA5 | verser=0OKERICAACA | ilk=Xicp | said=EFaYE2LT...JKWXRN | ...`
 */
export function renderNativeSegmentSummary(
  segments: NativeReadableSegment[],
): string {
  // The summary is intentionally one line so test failures stay easy to scan in
  // CI logs while still teaching the segment order at a glance.
  return segments.map((segment) => `${segment.name}=${shorten(segment.qb64)}`)
    .join(" | ");
}
