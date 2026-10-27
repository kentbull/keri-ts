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
  Diger,
  Ilks,
  type NumberPrimitive,
  ParserError,
  type SealEvent,
  type SealSource,
  type SerderACDC,
  type SerderKERI,
} from "cesr-ts";
import type { Baser } from "../db/basing.ts";
import { timestampMicros } from "../time/mod.ts";

/** A parsed disclosure belongs to this node; neighboring or parent proofs do not count. */
export type RegistryDisclosure = BlindState | BoundState;
/** Caller-supplied KEL location hints, keyed by TEL event SAID. */
export type RegistrySources = ReadonlyMap<string, number | string>;
/** Unsigned parsed source hints apply to this intake only, never to later replay. */
export interface RegistrySourceLocators {
  sscs?: readonly SealSource[];
  ssts?: readonly SealEvent[];
}
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
  if (typeof sequence !== "string" || !/^(0|[1-9a-f][0-9a-f]*)$/.test(sequence) || ordinal(event) >= 2n ** 128n) {
    return { kind: "reject", reason: "sequence" };
  }
  const stamp = event.sad?.dt;
  if (
    typeof stamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}[+-]\d{2}:\d{2}$/.test(stamp)
    || stamp.startsWith("0000-")
    || timestampMicros(stamp) === null
  ) return { kind: "reject", reason: "timestamp" };
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
 * Check a local TEL anchor against the current accepted KEL branch and its witness quorum.
 * Every supplied coordinate in the supported registry seal must match.
 * Missing or mismatched evidence returns false; database failures propagate.
 */
export function verifyRegistryAnchor(
  event: RegistryEvent,
  { db, issuer, number, diger }: { db: Baser; issuer: string; number?: NumberPrimitive; diger?: Diger },
): boolean {
  if (!number || !diger || number.num > BigInt(Number.MAX_SAFE_INTEGER)) return false;
  const said = db.kels.getLast(issuer, Number(number.num));
  const anchor = said ? db.getEvtSerder(issuer, said) : null;
  if (
    !anchor || anchor.said !== diger.qb64 || !onCurrentRegistryBranch(db, issuer, anchor)
    || !db.fullyWitnessed(anchor)
  ) return false;
  return anchor.seals.some((seal) => matchesRegistrySeal(seal, event.serder));
}

/** Descend the current head's exact prior digests, stopping at missing or noncontiguous ancestry. */
function* currentRegistryBranch(db: Baser, issuer: string): Generator<SerderKERI> {
  let current: SerderKERI | null = db.getKever(issuer)?.serder ?? null;
  while (current) {
    yield current;
    const prior = current.prior ? db.getEvtSerder(issuer, current.prior) : null;
    if (!prior || prior.sn !== current.sn! - 1) return;
    current = prior;
  }
}

/** Recovery preserves disputed buckets; new TEL authority comes only from the current branch. */
function onCurrentRegistryBranch(db: Baser, issuer: string, anchor: SerderKERI): boolean {
  for (const current of currentRegistryBranch(db, issuer)) {
    if (current.sn! < anchor.sn!) return false;
    if (current.said === anchor.said) return true;
  }
  return false;
}

/** Match only the selected digest/couple/triple shapes, without dropping supplied coordinates. */
function matchesRegistrySeal(candidate: unknown, event: SerderACDC): boolean {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const seal = candidate as Record<string, unknown>;
  const fields = Object.keys(seal).sort().join(",");
  if (!["d", "d,s", "d,i,s"].includes(fields)) return false;
  return seal.d === event.said
    && (!("s" in seal) || seal.s === event.sad!.n)
    && (!("i" in seal) || seal.i === (event.ilk === Ilks.rip ? event.said : event.regid));
}

/** Refuse resolvable false locators before publication, without persisting unsigned requirements. */
export function validateRegistrySourceLocators(
  event: SerderACDC,
  db: Baser,
  issuer: string | null,
  { sscs = [], ssts = [] }: RegistrySourceLocators,
): boolean {
  const locators = [
    ...sscs.map((seal) => ({ controller: issuer, number: seal.s, diger: seal.d })),
    ...ssts.map((seal) => ({ controller: seal.i.qb64, number: seal.s, diger: seal.d })),
  ];
  for (const { controller, number, diger } of locators) {
    if (issuer !== null && controller !== issuer) return false;
    if (controller === null || number.num > BigInt(Number.MAX_SAFE_INTEGER)) continue;
    const accepted = db.kels.getLast(controller, Number(number.num));
    if (!accepted) continue;
    if (accepted !== diger.qb64) return false;
    const anchor = db.getEvtSerder(controller, accepted);
    if (
      anchor && (!onCurrentRegistryBranch(db, controller, anchor)
        || !anchor.seals.some((seal) => matchesRegistrySeal(seal, event)))
    ) return false;
  }
  return true;
}

/** Extract hint digests only to distinguish an unsupported root seal from a mistaken source. */
function sealDigests(event: SerderKERI): unknown[] {
  return event.seals.flatMap((seal) => {
    if (typeof seal === "string") return [seal];
    if (seal && typeof seal === "object" && !Array.isArray(seal) && "d" in seal) return [seal.d];
    return [];
  });
}

/** Find an accepted controller event carrying an exact registry seal and its historical witness quorum. */
export function findRegistryAnchor(db: Baser, issuer: string, registry: SerderACDC): readonly [number, string] | null {
  let earliest: readonly [number, string] | null = null;
  for (const event of currentRegistryBranch(db, issuer)) {
    if (
      db.fullyWitnessed(event)
      && event.seals.some((seal) => matchesRegistrySeal(seal, registry))
    ) {
      earliest = [event.sn!, event.said!];
    }
  }
  return earliest;
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
    if (
      anchor && db.kels.getLast(issuer, anchor.sn!) === anchor.said
      && onCurrentRegistryBranch(db, issuer, anchor)
    ) {
      const digests = sealDigests(anchor);
      if (db.fullyWitnessed(anchor) && anchor.seals.some((seal) => matchesRegistrySeal(seal, event))) {
        return { kind: "verified", anchor: [anchor.sn!, anchor.said!] };
      }
      if (digests.length && !digests.some((digest) => typeof digest === "string" && told.has(digest))) {
        return { kind: "reject", reason: "rootSeal" };
      }
    }
  }
  const anchor = findRegistryAnchor(db, issuer, event);
  if (anchor) return { kind: "verified", anchor };
  for (const pre of db.kevers.keys()) {
    if (pre !== issuer && findRegistryAnchor(db, pre, event)) return { kind: "reject", reason: "anchor" };
  }
  return missing;
}

/** Authenticate the declared native BLID against the exact carried primitive tuple. */
function vetBlind(blinder: RegistryDisclosure, blid: string): boolean {
  if (!/^[E-I][A-Za-z0-9_-]{43}$/.test(blid) || blinder.d.nonce !== blid) return false;
  let digest: Diger;
  try {
    digest = new Diger({ qb64: blid });
  } catch (error) {
    if (error instanceof ParserError) return false;
    throw error;
  }
  if (new Diger({ code: digest.code, raw: digest.raw }).qb64 !== blid) return false;
  const redone = "bn" in blinder ? commitBoundState(blinder, digest.code) : commitBlindState(blinder, digest.code);
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
