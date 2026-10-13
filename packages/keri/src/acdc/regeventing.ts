/**
 * Verify supplied ACDC v2 registry evidence against accepted KEL state.
 * Mirrors frozen KERIpy acdc.regeventing.vet/vetBinds. Parsing, KEL acceptance,
 * fetching, escrow persistence, and issuer-side TEL processing belong to callers.
 */
import {
  type BlindState,
  type BoundState,
  commitBlindState,
  commitBoundState,
  type Diger,
  Ilks,
  type NumberPrimitive,
  type SerderACDC,
  type SerderKERI,
} from "cesr-ts";
import type { Baser } from "../db/basing.ts";
import { timestampMicros } from "../time/mod.ts";

/** A parsed disclosure belongs to this node; neighboring or parent proofs do not count. */
export type RegistryDisclosure = BlindState | BoundState;
/** Caller-supplied KEL location hints, keyed by TEL event SAID. */
export type RegistrySources = ReadonlyMap<string, number | string>;
/** Verified registry head and optional disclosed target binding. */
export interface RegistryState {
  regid: string;
  issuer: string;
  said: string;
  sn: bigint;
  ilk: typeof Ilks.rip | typeof Ilks.bup;
  acdc: string | null;
  state: string | null;
  stamp: string;
  binding: "mutual" | "oneway" | "presentation" | null;
  anchors: readonly (readonly [sn: number, said: string])[];
}
/** Missing anchors are retryable observations, not a durable escrow operation. */
export type RegistryRefusal =
  | { kind: "missing"; reason: "anchor"; issuer: string; said: string }
  | {
    kind: "reject";
    reason:
      | "event"
      | "sequence"
      | "prior"
      | "registry"
      | "issuer"
      | "anchor"
      | "rootSeal"
      | "duplicity"
      | "binding"
      | "disclosure"
      | "timestamp";
  };
/** No state is returned until every supplied event and requested binding verifies. */
export type RegistryVerification = { kind: "verified"; state: RegistryState } | RegistryRefusal;
/** Registry verification consumes parsed messages and borrows the accepted KEL database. */
export interface RegistryEvidence {
  rip: SerderACDC;
  updates?: readonly SerderACDC[];
  db: Baser;
  sources?: RegistrySources;
  acdc?: SerderACDC;
  blinder?: RegistryDisclosure;
}

/** Sequence numbers retain protocol precision; database KEL lookups remain safe integers. */
function ordinal(event: SerderACDC): bigint {
  return BigInt(`0x${event.sad!.n}`);
}

/** Parsed facts shared by observer validation and local TEL processing. */
export interface RegistryEvent {
  serder: SerderACDC;
  said: string;
  ilk: typeof Ilks.rip | typeof Ilks.bup;
  regid: string;
  sn: bigint;
  prior: string | null;
  issuer: string | null;
}
/** Field validity alone establishes neither KEL anchoring nor TEL acceptance. */
export type RegistryEventValidation =
  | { kind: "valid"; event: RegistryEvent }
  | Extract<RegistryRefusal, { kind: "reject" }>;

/** Registry rules supplement, rather than replace, Serder field/order/SAID validation. */
function normalizeEvent(event: SerderACDC): RegistryEventValidation {
  if (!event.verify() || (event.ilk !== Ilks.rip && event.ilk !== Ilks.bup)) return { kind: "reject", reason: "event" };
  const sequence = event.sad?.n;
  if (typeof sequence !== "string" || !/^[0-9a-fA-F]+$/.test(sequence) || ordinal(event) >= 2n ** 128n) {
    return { kind: "reject", reason: "sequence" };
  }
  return {
    kind: "valid",
    event: {
      serder: event,
      said: event.said!,
      ilk: event.ilk,
      regid: event.ilk === Ilks.rip ? event.said! : event.sad!.rd as string,
      sn: ordinal(event),
      prior: event.ilk === Ilks.rip ? null : event.sad!.p as string,
      issuer: event.issuer,
    },
  };
}

/** Validate inception fields and, for a local processor, its controlling issuer. */
export function validateRip(serder: SerderACDC, issuer?: string): RegistryEventValidation {
  const result = normalizeEvent(serder);
  if (result.kind === "reject") return result;
  const event = result.event;
  if (event.ilk !== Ilks.rip) return { kind: "reject", reason: "event" };
  if (event.sn !== 0n) return { kind: "reject", reason: "sequence" };
  if (issuer !== undefined && event.issuer !== issuer) return { kind: "reject", reason: "issuer" };
  return result;
}

/** Validate update fields; ordering against an accepted head belongs to the processor. */
export function validateUpdate(serder: SerderACDC, regid: string, prior?: string): RegistryEventValidation {
  const result = normalizeEvent(serder);
  if (result.kind === "reject") return result;
  const event = result.event;
  if (event.ilk !== Ilks.bup) return { kind: "reject", reason: "event" };
  if (event.regid !== regid) return { kind: "reject", reason: "registry" };
  if (event.sn < 1n) return { kind: "reject", reason: "sequence" };
  if (prior !== undefined && event.prior !== prior) return { kind: "reject", reason: "prior" };
  return result;
}

/**
 * Check a local TEL anchor against the last accepted, fully witnessed KEL event.
 * Unlike observer vetting, this requires the full registry/ordinal/digest tuple.
 * Missing or mismatched evidence returns false; database failures propagate.
 */
export function verifyRegistryAnchor(
  event: RegistryEvent,
  { db, issuer, number, diger }: { db: Baser; issuer: string; number?: NumberPrimitive; diger?: Diger },
): boolean {
  if (!number || !diger || number.num > BigInt(Number.MAX_SAFE_INTEGER)) return false;
  const said = db.kels.getLast(issuer, Number(number.num));
  const anchor = said ? db.getEvtSerder(issuer, said) : null;
  if (!anchor || anchor.said !== diger.qb64 || !db.fullyWitnessed(anchor)) return false;
  return anchor.seals.some((seal) =>
    !!seal && typeof seal === "object" && !Array.isArray(seal)
    && "i" in seal && "s" in seal && "d" in seal
    && seal.i === event.regid && seal.s === event.serder.sad!.n && seal.d === event.said
  );
}

/** Verifier anchors match digests; a seal's TEL sequence hint is not authoritative. */
function sealDigests(event: SerderKERI): unknown[] {
  return event.seals.flatMap((seal) => {
    if (typeof seal === "string") return [seal];
    if (seal && typeof seal === "object" && !Array.isArray(seal) && "d" in seal) return [seal.d];
    return [];
  });
}

/** Scan only the accepted controller's KEL frontier; this does not verify KEL signatures. */
function scanKel(db: Baser, issuer: string, said: string): readonly [number, string] | null {
  const kever = db.getKever(issuer);
  if (!kever) return null;
  for (const [sn, digest] of db.getKelItemIter(issuer)) {
    if (sn > kever.sn) break;
    const event = db.getEvtSerder(issuer, digest);
    if (event && sealDigests(event).includes(said)) return [sn, event.said!];
  }
  return null;
}

/** Match the reference's source-hint fallback and named aggregate-seal refusal. */
function vetAnchor(
  event: SerderACDC,
  issuer: string,
  db: Baser,
  told: ReadonlySet<string>,
  source?: number | string,
): { kind: "verified"; anchor: readonly [number, string] } | RegistryRefusal {
  const missing: RegistryRefusal = { kind: "missing", reason: "anchor", issuer, said: event.said! };
  if (typeof source === "number" && (!Number.isSafeInteger(source) || source < 0)) {
    throw new RangeError("Registry KEL source must be a non-negative safe integer or SAID.");
  }
  if (!db.getKever(issuer)) return missing;
  if (source !== undefined) {
    const said = typeof source === "string" ? source : db.kels.getLast(issuer, source);
    const anchor = said ? db.getEvtSerder(issuer, said) : null;
    if (anchor) {
      const digests = sealDigests(anchor);
      if (digests.includes(event.said)) return { kind: "verified", anchor: [anchor.sn!, anchor.said!] };
      if (digests.length && !digests.some((digest) => typeof digest === "string" && told.has(digest))) {
        return { kind: "reject", reason: "rootSeal" };
      }
    }
  }
  const anchor = scanKel(db, issuer, event.said!);
  if (anchor) return { kind: "verified", anchor };
  for (const pre of db.kevers.keys()) {
    if (pre !== issuer && scanKel(db, pre, event.said!)) return { kind: "reject", reason: "anchor" };
  }
  return missing;
}

/** Recompute the disclosed tuple with the reference's default Blake3 commitment. */
function vetBlind(blinder: RegistryDisclosure, blid: string): boolean {
  const redone = "bn" in blinder ? commitBoundState(blinder, "E") : commitBlindState(blinder, "E");
  return redone.d.nonce === blid;
}

/** A registry must bind both the exact credential and its issuer, plus rd when present. */
function binding(acdc: SerderACDC, state: RegistryState): "mutual" | "oneway" | null {
  if (!acdc.verify() || state.acdc !== acdc.said || acdc.issuer !== state.issuer) return null;
  const regid = acdc.sad!.rd;
  return regid ? (regid === state.regid ? "mutual" : null) : "oneway";
}

/**
 * Verify an entire supplied rip/bup chain, accepting unordered exact duplicates.
 * A missing anchor anywhere prevents a partial-head success, including before
 * deciding whether competing events constitute anchored duplicity. No writes occur.
 */
export function vet(
  { rip, updates = [], db, sources = new Map(), acdc, blinder }: RegistryEvidence,
): RegistryVerification {
  const inception = validateRip(rip);
  if (inception.kind === "reject") return inception;
  for (const update of updates) {
    const result = validateUpdate(update, inception.event.regid);
    if (result.kind === "reject") return result;
  }
  const issuer = rip.issuer!;
  const told = new Set([rip.said!, ...updates.map((event) => event.said!)]);
  const first = vetAnchor(rip, issuer, db, told, sources.get(rip.said!));
  if (first.kind !== "verified") return first;
  const anchors = [first.anchor];
  let remaining = [...updates];
  let head = rip;
  let n = 1n;
  while (remaining.length) {
    const candidates = remaining.filter((event) => ordinal(event) === n);
    if (!candidates.length) return { kind: "reject", reason: "sequence" };
    if (candidates.some((event) => event.sad!.p !== head.said)) return { kind: "reject", reason: "prior" };
    const unique = [...new Map(candidates.map((event) => [event.said!, event])).values()];
    const couples = [];
    for (const event of unique) {
      const result = vetAnchor(event, issuer, db, told, sources.get(event.said!));
      if (result.kind !== "verified") return result;
      couples.push(result.anchor);
    }
    if (unique.length > 1) return { kind: "reject", reason: "duplicity" };
    head = unique[0];
    anchors.push(couples[0]);
    remaining = remaining.filter((event) => ordinal(event) !== n);
    n++;
  }
  const state: RegistryState = {
    regid: rip.said!,
    issuer,
    said: head.said!,
    sn: ordinal(head),
    ilk: head.ilk as RegistryState["ilk"],
    acdc: null,
    state: null,
    stamp: head.sad!.dt as string,
    binding: null,
    anchors,
  };
  if (head.ilk === Ilks.bup && blinder) {
    if (!vetBlind(blinder, head.sad!.b as string)) return { kind: "reject", reason: "disclosure" };
    state.acdc = blinder.td.nonce || null;
    state.state = blinder.ts.text || null;
  }
  if (acdc) {
    if (head.ilk === Ilks.bup && !blinder) return { kind: "reject", reason: "disclosure" };
    state.binding = binding(acdc, state);
    if (!state.binding) return { kind: "reject", reason: "binding" };
  }
  return { kind: "verified", state };
}

/** Node-local disclosures and optional receiver-observed historical cutoff. */
export interface RegistryBindingEvidence extends Omit<RegistryEvidence, "blinder"> {
  blinders: readonly RegistryDisclosure[];
  target: string;
  controller?: string;
  cutoff?: string;
  requireSource?: boolean;
}

/**
 * Resolve the latest non-vacuous binding behind a verified (possibly historical)
 * head. Every intervening vacuous update needs exactly one authentic disclosure.
 * The caller supplies a trusted receiver timestamp; this creates no KRAM state.
 */
export function vetBinds(
  { rip, updates = [], db, sources = new Map(), acdc, blinders, target, controller, cutoff, requireSource = false }:
    RegistryBindingEvidence,
): RegistryVerification {
  if (cutoff !== undefined) {
    const when = timestampMicros(cutoff);
    const inception = timestampMicros(rip.sad?.dt);
    if (when === null || inception === null) return { kind: "reject", reason: "timestamp" };
    if (inception > when) return { kind: "reject", reason: "binding" };
    const selected = [];
    for (const update of updates) {
      const stamp = timestampMicros(update.sad?.dt);
      if (stamp === null) return { kind: "reject", reason: "timestamp" };
      if (stamp <= when) selected.push(update);
    }
    updates = selected;
  }
  const result = vet({ rip, updates, db, sources });
  if (result.kind !== "verified") return result;
  if (controller !== undefined && result.state.issuer !== controller) return { kind: "reject", reason: "binding" };
  const newest = [...updates].sort((a, b) => ordinal(a) > ordinal(b) ? -1 : ordinal(a) < ordinal(b) ? 1 : 0);
  for (const update of newest) {
    const matches = blinders.filter((blinder) => blinder.d.nonce === update.sad!.b);
    if (matches.length !== 1 || !vetBlind(matches[0], update.sad!.b as string)) {
      return { kind: "reject", reason: "disclosure" };
    }
    const blinder = matches[0];
    const td = blinder.td.nonce;
    const state = blinder.ts.text;
    if (!td && !state) continue;
    if (td !== target) return { kind: "reject", reason: "binding" };
    if (requireSource && !sources.has(update.said!)) return { kind: "reject", reason: "anchor" };
    const bound: RegistryState = {
      ...result.state,
      acdc: td,
      state,
      stamp: update.sad!.dt as string,
      binding: "presentation",
    };
    if (acdc) {
      bound.binding = binding(acdc, bound);
      if (!bound.binding) return { kind: "reject", reason: "binding" };
    }
    return { kind: "verified", state: bound };
  }
  return { kind: "reject", reason: "binding" };
}
