/**
 * Transaction event log state processing.
 *
 * KERIpy correspondence:
 * - mirrors `keri.vdr.eventing.Tever` and the TEL-facing portions of
 *   `Tevery`
 *
 * `keri-ts` difference:
 * - normal remote-processing outcomes are returned as typed decisions instead
 *   of being represented by Python control-flow exceptions.
 */
import {
  Dater,
  Diger,
  Ilks,
  NumberPrimitive,
  ParserError,
  Prefixer,
  type SealSource,
  SerderKERI,
  Siger,
  TraitDex,
  Verfer,
  Vrsn_2_0,
} from "cesr-ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { DatabaseOperationError, ValidationError } from "../core/errors.ts";
import type { QueryEnvelope } from "../core/eventing.ts";
import { acceptEscrow, dropEscrow, keepEscrow } from "../core/kever-decisions.ts";
import { Kever } from "../core/kever.ts";
import { consoleLogger } from "../core/logger.ts";
import {
  projectRegistrySeal,
  state as registryState,
  vcstate as credentialState,
} from "../core/protocol-vdr-eventing.ts";
import { RegStateRecord } from "../core/records.ts";
import {
  acceptReplyDecision,
  type ReplyPlan,
  type ReplyProcessDecision,
  Revery,
  type Router,
  unverifiedReplyDecision,
} from "../core/routing.ts";
import type { Baser } from "../db/basing.ts";
import { dgKey } from "../db/core/keys.ts";
import type { BrokerProcessReplyArgs } from "../db/escrowing.ts";
import type { Reger } from "../db/reger.ts";
import { encodeDateTimeToDater, makeNowIso8601, timestampMicros } from "../time/mod.ts";
import { backerThreshold, resolveBackerState } from "./backer-state.ts";
import { credentialRecord } from "./credential-tsn-record.ts";
import { qualifiedPrefix, registryRecord } from "./registry-tsn-record.ts";
import { verifyTelAnchor } from "./tel-anchor.ts";
import { prepareTsnQuery } from "./tsn-query.ts";

type TelIlk =
  | typeof Ilks.vcp
  | typeof Ilks.vrt
  | typeof Ilks.iss
  | typeof Ilks.rev
  | typeof Ilks.bis
  | typeof Ilks.brv;

type TelEscrowKind = "outOfOrder" | "anchorless" | "partialWitness";

export type TelProcessDecision =
  | {
    kind: "accept";
    regk: string;
    pre: string;
    said: string;
    ilk: TelIlk;
  }
  | {
    kind: "duplicate";
    regk: string;
    pre: string;
    said: string;
    ilk: TelIlk;
    reason: string;
  }
  | {
    kind: "escrow";
    escrow: TelEscrowKind;
    regk: string;
    pre: string;
    said: string;
    ilk: TelIlk;
    reason: string;
  }
  | {
    kind: "reject";
    regk?: string;
    pre?: string;
    said?: string;
    ilk?: string | null;
    reason: string;
  };

/** TEL query refusals are normal remote outcomes; absence of a response does not imply acceptance. */
export type TelQueryDecision = void | {
  kind: "drop";
  reason: "unsupportedRoute" | "missingAuthentication" | "invalidQuery";
};

export interface TelProcessEventArgs {
  serder: SerderKERI;
  seqner?: SealSource["s"] | NumberPrimitive | null;
  saider?: SealSource["d"] | Diger | null;
  wigers?: readonly Siger[] | null;
  sigers?: readonly Siger[] | null;
  local?: boolean;
}

/** Carry an existing pending decision across Tever's constructor-only boundary. */
class PendingTelInception extends Error {
  /** @param decision Recoverable inception outcome retained in its existing protocol escrow. */
  constructor(readonly decision: Extract<TelProcessDecision, { kind: "escrow" }>) {
    super(decision.reason);
  }
}

export interface TeveryOptions {
  /** Reply proof service for transaction-state notice admission; absent for TEL-only processors. */
  rvy?: Revery;
  reger: Reger;
  db: Baser;
  local?: boolean;
  lax?: boolean;
  cues?: Deck<AgentCue>;
}

export interface TeverOptions extends Omit<TeveryOptions, "rvy" | "cues"> {
  rsr?: RegStateRecord | null;
  serder?: SerderKERI | null;
  seqner?: NumberPrimitive | null;
  saider?: Diger | null;
  bigers?: readonly Siger[] | null;
  noBackers?: boolean | null;
  estOnly?: boolean | null;
  regk?: string | null;
}

function okSaid(serder: SerderKERI): string {
  if (!serder.said) {
    throw new ValidationError("TEL event missing SAID.");
  }
  return serder.said;
}

function okPre(serder: SerderKERI): string {
  if (!serder.pre) {
    throw new ValidationError("TEL event missing prefix.");
  }
  return serder.pre;
}

function okSn(serder: SerderKERI): number {
  if (serder.sn === null) {
    throw new ValidationError("TEL event missing sequence number.");
  }
  return serder.sn;
}

function okKed(serder: SerderKERI): Record<string, unknown> {
  if (!serder.ked) {
    throw new ValidationError("TEL event missing decoded body.");
  }
  return serder.ked;
}

function telIlk(serder: SerderKERI): TelIlk {
  switch (serder.ilk) {
    case Ilks.vcp:
    case Ilks.vrt:
    case Ilks.iss:
    case Ilks.rev:
    case Ilks.bis:
    case Ilks.brv:
      return serder.ilk;
    default:
      throw new ValidationError(`Unsupported TEL ilk=${String(serder.ilk)}.`);
  }
}

function nowDater(): Dater {
  return new Dater({ qb64: encodeDateTimeToDater(makeNowIso8601()) });
}

function reject(
  reason: string,
  serder?: SerderKERI,
  regk?: string,
): Extract<TelProcessDecision, { kind: "reject" }> {
  return {
    kind: "reject",
    regk,
    pre: serder?.pre ?? undefined,
    said: serder?.said ?? undefined,
    ilk: serder?.ilk,
    reason,
  };
}

function duplicate(
  reason: string,
  serder: SerderKERI,
  regk: string,
): Extract<TelProcessDecision, { kind: "duplicate" }> {
  return {
    kind: "duplicate",
    regk,
    pre: okPre(serder),
    said: okSaid(serder),
    ilk: telIlk(serder),
    reason,
  };
}

function escrow(
  escrowKind: TelEscrowKind,
  reason: string,
  serder: SerderKERI,
  regk: string,
): Extract<TelProcessDecision, { kind: "escrow" }> {
  return {
    kind: "escrow",
    escrow: escrowKind,
    regk,
    pre: okPre(serder),
    said: okSaid(serder),
    ilk: telIlk(serder),
    reason,
  };
}

function accept(serder: SerderKERI, regk: string): TelProcessDecision {
  return {
    kind: "accept",
    regk,
    pre: okPre(serder),
    said: okSaid(serder),
    ilk: telIlk(serder),
  };
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function stringField(
  data: Record<string, unknown>,
  field: string,
): string | null {
  const value = data[field];
  return typeof value === "string" ? value : null;
}

function stringListField(
  data: Record<string, unknown>,
  field: string,
): string[] {
  const value = data[field];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : [];
}

/** Validated inception fields shared by TEL admission and local signing policy. */
export interface RegistryInception {
  issuer: string;
  prefixer: Prefixer;
  baks: string[];
  toad: number;
  noBackers: boolean;
  estOnly: boolean;
}

/**
 * Validate VCP identity, ordinal, backer policy and configuration without writes.
 * Existing constructor overrides retain their KERIpy semantics: an explicit true
 * or a signed configuration trait enables the corresponding registry policy.
 */
export function validateRegistryInception(
  serder: SerderKERI,
  noBackers?: boolean | null,
  estOnly?: boolean | null,
): RegistryInception {
  if (serder.ilk !== Ilks.vcp) throw new ValidationError(`Expected vcp got ${String(serder.ilk)}.`);
  const ked = okKed(serder);
  const issuer = stringField(ked, "ii");
  if (!issuer) throw new ValidationError("Registry inception missing ii.");
  const prefixer = new Prefixer({ qb64: okPre(serder) });
  const sn = okSn(serder);
  if (sn !== 0) throw new ValidationError(`Invalid vcp sn=${sn}.`);
  const baks = stringListField(ked, "b");
  if (!unique(baks)) throw new ValidationError(`Invalid duplicate baks=${baks}.`);
  const toad = backerThreshold(ked.bt);
  if (toad === null) throw new ValidationError("Invalid registry backer threshold.");
  validateBackerThreshold(toad, baks);
  const cnfg = stringListField(ked, "c");
  const backerless = (noBackers ?? false) || cnfg.includes(TraitDex.NoBackers);
  if (backerless && baks.length > 0) throw new ValidationError("NoBackers registry may not configure baks.");
  return {
    issuer,
    prefixer,
    baks,
    toad,
    noBackers: backerless,
    estOnly: (estOnly ?? false) || cnfg.includes(TraitDex.EstOnly),
  };
}

/** Enforce the same exact quorum bounds for inception, rotation and endorsement admission. */
function validateBackerThreshold(toad: number, baks: readonly string[]): void {
  if (!Number.isSafeInteger(toad) || toad < 0) throw new ValidationError("Invalid registry backer threshold.");
  if (baks.length === 0) {
    if (toad !== 0) throw new ValidationError(`Invalid toad=${toad} for empty backer set.`);
  } else if (toad < 1 || toad > baks.length) {
    throw new ValidationError(`Invalid toad=${toad} for baks=${baks}.`);
  }
}

/** Leave untrusted fields unknown until each lookup checks the fields it consumes. */
function sealRecord(value: unknown): object | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function digestForTel(reger: Reger, pre: string, sn: number): Diger | null {
  return reger.tels.getOn(pre, sn);
}

function serderForTel(
  reger: Reger,
  pre: string,
  said: string,
): SerderKERI | null {
  const raw = reger.tvts.get(dgKey(pre, said));
  return raw === null ? null : new SerderKERI({ raw });
}

/**
 * Registry transaction event verifier.
 *
 * `Tever` carries registry state and evaluates/writes one private admission
 * candidate through `Reger`. Input policy is supplied for that admission rather
 * than cached. `Tevery` owns transactions, accepted cache publication, cues and replay.
 */
export class Tever {
  readonly db: Baser;
  readonly reger: Reger;

  version: { major: number; minor: number };
  pre!: string;
  regk!: string;
  prefixer!: Prefixer;
  sn!: number;
  ilk!: TelIlk;
  serder!: SerderKERI;
  toad!: number;
  baks!: string[];
  cuts: string[] = [];
  adds: string[] = [];
  noBackers = false;
  estOnly = false;

  constructor(options: TeverOptions) {
    this.db = options.db;
    this.reger = options.reger;

    if (options.rsr) {
      this.version = { major: 1, minor: 0 };
      this.reload(options.rsr);
      return;
    }
    if (!options.serder) {
      throw new ValidationError("Missing TEL inception event.");
    }
    if (options.serder.ilk !== Ilks.vcp) {
      throw new ValidationError(`Expected vcp got ${String(options.serder.ilk)}.`);
    }

    this.version = options.serder.pvrsn;
    this.regk = options.regk ?? okPre(options.serder);
    const inception = validateRegistryInception(options.serder, options.noBackers, options.estOnly);
    this.pre = inception.issuer;
    this.prefixer = inception.prefixer;
    this.sn = 0;
    this.baks = inception.baks;
    this.toad = inception.toad;
    this.noBackers = inception.noBackers;
    this.estOnly = inception.estOnly;
    this.ilk = Ilks.vcp;
    this.serder = options.serder;

    const checked = this.valAnchorBigs({
      serder: options.serder,
      seqner: options.seqner ?? null,
      saider: options.saider ?? null,
      bigers: options.bigers ?? [],
      toad: this.toad,
      baks: this.baks,
      local: options.local ?? false,
    });
    if (checked.kind !== "accept") {
      throw new PendingTelInception(checked.decision);
    }
    this.logEvent({
      pre: this.prefixer.qb64,
      sn: 0,
      serder: options.serder,
      seqner: options.seqner ?? null,
      saider: options.saider ?? null,
      bigers: checked.bigers,
      baks: this.baks,
    });
    this.regk = this.prefixer.qb64;
  }

  /** Reload one registry state from `Reger.states`. */
  reload(rsr: RegStateRecord): void {
    const regk = rsr.i;
    const said = rsr.d;
    if (!regk || !said) {
      throw new ValidationError("Malformed registry state record.");
    }
    const raw = this.reger.tvts.get(dgKey(regk, said));
    if (raw === null) {
      throw new ValidationError(`Missing TEL event for registry state ${regk}.`);
    }
    this.pre = rsr.ii ?? "";
    this.regk = regk;
    this.prefixer = new Prefixer({ qb64: regk });
    this.sn = parseInt(rsr.s ?? "0", 16);
    this.ilk = (rsr.et ?? Ilks.vcp) as TelIlk;
    const toad = backerThreshold(rsr.bt);
    if (toad === null) throw new DatabaseOperationError("Stored registry backer threshold is invalid.");
    this.toad = toad;
    this.baks = [...(rsr.b ?? [])];
    this.noBackers = (rsr.c ?? []).includes(TraitDex.NoBackers);
    this.estOnly = (rsr.c ?? []).includes(TraitDex.EstOnly);
    this.serder = new SerderKERI({ raw });
  }

  /** Current registry transaction-state record. */
  state(): ReturnType<typeof registryState> {
    const said = okSaid(this.serder);
    const cnfg: string[] = this.noBackers ? [TraitDex.NoBackers] : [];
    if (this.estOnly) {
      cnfg.push(TraitDex.EstOnly);
    }
    if (this.reger.ancs.get(dgKey(this.regk, said)) === null) {
      throw new ValidationError(`Missing TEL anchor for ${this.regk}.${said}.`);
    }
    return registryState(this.pre, said, this.sn, this.regk, this.ilk, {
      toad: this.toad,
      wits: this.baks,
      cnfg,
    });
  }

  /** Current credential transaction-state record for one credential SAID. */
  vcState(vci: string): ReturnType<typeof credentialState> | null {
    const digs = [...this.reger.tels.getAllItemIter(vci)]
      .sort((left, right) => left[1] - right[1])
      .map(([, , dig]) => dig);
    if (digs.length === 0) {
      return null;
    }
    const vcsn = digs.length - 1;
    const dig = digs[vcsn]!;
    const said = dig.qb64;
    const serder = serderForTel(this.reger, vci, said);
    if (!serder) {
      throw new ValidationError(`Missing credential TEL event ${vci}.${said}.`);
    }
    const anchor = this.reger.ancs.get(dgKey(vci, said));
    if (anchor === null) {
      throw new ValidationError(`Missing credential TEL anchor ${vci}.${said}.`);
    }
    const [number, diger] = anchor;
    const eilk = this.noBackers ? (digs.length === 1 ? Ilks.iss : Ilks.rev) : (digs.length === 1 ? Ilks.bis : Ilks.brv);
    const ked = okKed(serder);
    const ra = this.noBackers ? {} : projectRegistrySeal(ked.ra);
    return credentialState(
      vci,
      said,
      vcsn,
      this.regk,
      eilk,
      { s: Number(number.num), d: diger.qb64 },
      {
        ra,
        dts: typeof ked.dt === "string" ? ked.dt : undefined,
      },
    );
  }

  /** Return the latest credential TEL ordinal, or `null` when never issued. */
  vcSn(vci: string): number | null {
    const count = this.reger.tels.cntOn(vci, 0);
    return count === 0 ? null : count - 1;
  }

  /** Apply TEL input; the internal recorder preserves publication failures through router catches. */
  update(args: TelProcessEventArgs, recordPublicationFailure?: (error: unknown) => void): TelProcessDecision {
    let publicationFailure: { error: unknown } | undefined;
    try {
      const serder = args.serder;
      const ilk = telIlk(serder);
      const sn = okSn(serder);
      if (ilk === Ilks.vrt) {
        return this.updateRotation(serder, sn, args);
      }
      if (ilk === Ilks.iss || ilk === Ilks.bis) {
        return this.issue(serder, sn, args);
      }
      if (ilk === Ilks.rev || ilk === Ilks.brv) {
        return this.revoke(
          serder,
          sn,
          args,
          (error) => {
            publicationFailure = { error };
            recordPublicationFailure?.(error);
          },
        );
      }
      return reject(`Unsupported TEL ilk=${ilk}.`, serder, this.regk);
    } catch (error) {
      if (publicationFailure && publicationFailure.error === error) throw error;
      if (!(error instanceof ValidationError) && !(error instanceof ParserError)) throw error;
      return reject(error instanceof Error ? error.message : String(error), args.serder, this.regk);
    }
  }

  private updateRotation(
    serder: SerderKERI,
    sn: number,
    args: TelProcessEventArgs,
  ): TelProcessDecision {
    if (this.noBackers) {
      return reject("Backerless registry cannot rotate TEL backers.", serder, this.regk);
    }
    const rotated = this.rotate(serder, sn);
    if (rotated.kind === "reject") {
      return rotated;
    }
    const checked = this.valAnchorBigs({
      serder,
      seqner: args.seqner ?? null,
      saider: args.saider ?? null,
      bigers: args.wigers ?? [],
      toad: rotated.toad,
      baks: rotated.baks,
      local: args.local ?? false,
    });
    if (checked.kind !== "accept") {
      return checked.decision;
    }
    this.sn = sn;
    this.serder = serder;
    this.ilk = Ilks.vrt;
    this.toad = rotated.toad;
    this.baks = rotated.baks;
    this.cuts = rotated.cuts;
    this.adds = rotated.adds;
    this.logEvent({
      pre: this.prefixer.qb64,
      sn,
      serder,
      seqner: args.seqner ?? null,
      saider: args.saider ?? null,
      bigers: checked.bigers,
      baks: this.baks,
    });
    return accept(serder, this.regk);
  }

  private rotate(
    serder: SerderKERI,
    sn: number,
  ):
    | { kind: "rotated"; toad: number; baks: string[]; cuts: string[]; adds: string[] }
    | Extract<TelProcessDecision, { kind: "reject" }>
  {
    const ked = okKed(serder);
    if (okPre(serder) !== this.prefixer.qb64) {
      return reject("Registry rotation prefix mismatch.", serder, this.regk);
    }
    if (sn !== this.sn + 1) {
      return reject(`Invalid registry rotation sn=${sn}, expected ${this.sn + 1}.`, serder, this.regk);
    }
    const prior = stringField(ked, "p");
    if (!prior || !this.serder.compare(prior)) {
      return reject("Registry rotation prior digest mismatch.", serder, this.regk);
    }
    const cuts = stringListField(ked, "br");
    const adds = stringListField(ked, "ba");
    if (!unique(cuts) || !unique(adds)) {
      return reject("Registry rotation cuts/adds contain duplicates.", serder, this.regk);
    }
    const bakSet = new Set(this.baks);
    if (!cuts.every((cut) => bakSet.has(cut))) {
      return reject("Registry rotation cuts are not all current backers.", serder, this.regk);
    }
    if (cuts.some((cut) => adds.includes(cut)) || adds.some((add) => bakSet.has(add))) {
      return reject("Registry rotation cuts/adds overlap existing backers.", serder, this.regk);
    }
    const next = this.baks.filter((bak) => !cuts.includes(bak));
    next.push(...adds);
    const toad = backerThreshold(ked.bt);
    if (toad === null) return reject("Invalid registry backer threshold.", serder, this.regk);
    try {
      validateBackerThreshold(toad, next);
    } catch (error) {
      if (!(error instanceof ValidationError) && !(error instanceof ParserError)) throw error;
      return reject(error.message, serder, this.regk);
    }
    return { kind: "rotated", toad, baks: next, cuts, adds };
  }

  private issue(
    serder: SerderKERI,
    sn: number,
    args: TelProcessEventArgs,
  ): TelProcessDecision {
    const ilk = telIlk(serder);
    if (ilk === Ilks.iss) {
      if (!this.noBackers) {
        return reject("Simple issue is invalid against backer-based registry.", serder, this.regk);
      }
      if (stringField(okKed(serder), "ri") !== this.prefixer.qb64) {
        return reject("Simple issue registry prefix mismatch.", serder, this.regk);
      }
      if (!this.verifyAnchor(serder, args.seqner ?? null, args.saider ?? null)) {
        this.escrowALEvent(serder, args.seqner ?? null, args.saider ?? null);
        return escrow("anchorless", "Missing KEL anchor for TEL issue.", serder, this.regk);
      }
      this.logEvent({
        pre: okPre(serder),
        sn,
        serder,
        seqner: args.seqner ?? null,
        saider: args.saider ?? null,
      });
      return accept(serder, this.regk);
    }

    if (this.noBackers) {
      return reject("Backer issue is invalid against backerless registry.", serder, this.regk);
    }
    const state = resolveBackerState(this.reger, this.regk, okKed(serder).ra);
    if (state.kind === "reject") return reject(state.reason, serder, this.regk);
    if (state.kind === "missing") return escrow("outOfOrder", state.reason, serder, this.regk);
    const checked = this.valAnchorBigs({
      serder,
      seqner: args.seqner ?? null,
      saider: args.saider ?? null,
      bigers: args.wigers ?? [],
      toad: state.toad,
      baks: state.baks,
      local: args.local ?? false,
    });
    if (checked.kind !== "accept") {
      return checked.decision;
    }
    this.logEvent({
      pre: okPre(serder),
      sn,
      serder,
      seqner: args.seqner ?? null,
      saider: args.saider ?? null,
      bigers: checked.bigers,
    });
    return accept(serder, this.regk);
  }

  private revoke(
    serder: SerderKERI,
    sn: number,
    args: TelProcessEventArgs,
    recordPublicationFailure?: (error: unknown) => void,
  ): TelProcessDecision {
    const vci = okPre(serder);
    const prior = digestForTel(this.reger, vci, sn - 1);
    if (prior === null) {
      return reject("Credential revoke arrived before issue.", serder, this.regk);
    }
    const iserder = serderForTel(this.reger, vci, prior.qb64);
    const priorField = stringField(okKed(serder), "p");
    if (!iserder || !priorField || !iserder.compare(priorField)) {
      return reject("Credential revoke prior digest mismatch.", serder, this.regk);
    }

    const ilk = telIlk(serder);
    if (ilk === Ilks.rev) {
      if (!this.noBackers) {
        return reject("Simple revoke is invalid against backer-based registry.", serder, this.regk);
      }
      if (!this.verifyAnchor(serder, args.seqner ?? null, args.saider ?? null)) {
        this.escrowALEvent(serder, args.seqner ?? null, args.saider ?? null);
        return escrow("anchorless", "Missing KEL anchor for TEL revoke.", serder, this.regk);
      }
      this.logRevoked(serder, sn, args, undefined, recordPublicationFailure);
      return accept(serder, this.regk);
    }

    if (this.noBackers) {
      return reject("Backer revoke is invalid against backerless registry.", serder, this.regk);
    }
    const state = resolveBackerState(this.reger, this.regk, okKed(serder).ra);
    if (state.kind === "reject") return reject(state.reason, serder, this.regk);
    if (state.kind === "missing") return escrow("outOfOrder", state.reason, serder, this.regk);
    const checked = this.valAnchorBigs({
      serder,
      seqner: args.seqner ?? null,
      saider: args.saider ?? null,
      bigers: args.wigers ?? [],
      toad: state.toad,
      baks: state.baks,
      local: args.local ?? false,
    });
    if (checked.kind !== "accept") {
      return checked.decision;
    }
    this.logRevoked(serder, sn, args, checked.bigers, recordPublicationFailure);
    return accept(serder, this.regk);
  }

  /** Persist accepted revocation evidence; Tevery publishes its cue after commit. */
  private logRevoked(
    serder: SerderKERI,
    sn: number,
    args: TelProcessEventArgs,
    bigers?: readonly Siger[],
    recordPublicationFailure?: (error: unknown) => void,
  ): void {
    try {
      this.logEvent({
        pre: okPre(serder),
        sn,
        serder,
        seqner: args.seqner ?? null,
        saider: args.saider ?? null,
        bigers,
      });
    } catch (error) {
      recordPublicationFailure?.(error);
      throw error;
    }
  }

  private valAnchorBigs(args: {
    serder: SerderKERI;
    seqner: NumberPrimitive | null;
    saider: Diger | null;
    bigers: readonly Siger[];
    toad: number;
    baks: readonly string[];
    local: boolean;
  }):
    | { kind: "accept"; bigers: Siger[] }
    | { kind: "escrow"; decision: Extract<TelProcessDecision, { kind: "escrow" }>; reason: string }
  {
    const verfers = args.baks.map((bak) => new Verfer({ qb64: bak }));
    const verified = Kever.verifyIndexedSignatures(
      args.serder.raw,
      // Every arrival and retry verifies the union against this exact historical cohort.
      [...this.reger.tibs.get(dgKey(okPre(args.serder), okSaid(args.serder))), ...args.bigers],
      verfers,
    ).sigers;

    if (!this.verifyAnchor(args.serder, args.seqner, args.saider)) {
      this.escrowALEvent(
        args.serder,
        args.seqner,
        args.saider,
        verified,
        [...args.baks],
      );
      const decision = escrow("anchorless", "Missing KEL anchor for TEL event.", args.serder, this.regk);
      return { kind: "escrow", decision, reason: decision.reason };
    }

    if (!args.local && args.baks.length > 0) {
      validateBackerThreshold(args.toad, args.baks);
      if (verified.length < args.toad) {
        this.escrowPWEvent(args.serder, args.seqner, args.saider, verified, args.baks);
        const decision = escrow(
          "partialWitness",
          `TEL event does not satisfy backer threshold ${args.toad}.`,
          args.serder,
          this.regk,
        );
        return { kind: "escrow", decision, reason: decision.reason };
      }
    }
    return { kind: "accept", bigers: verified };
  }

  private verifyAnchor(
    serder: SerderKERI,
    seqner?: NumberPrimitive | null,
    saider?: Diger | null,
  ): boolean {
    return verifyTelAnchor(this.db, this.pre, serder, seqner, saider);
  }

  /** Retain partial-witness evidence with its qualified source ordinal. */
  private escrowPWEvent(
    serder: SerderKERI,
    seqner?: NumberPrimitive | null,
    saider?: Diger | null,
    bigers: readonly Siger[] = [],
    baks: readonly string[] = [],
  ): void {
    const pre = okPre(serder);
    const said = okSaid(serder);
    const key = dgKey(pre, said);
    if (seqner && saider) {
      this.reger.ancs.put(key, [seqner, new Diger({ qb64: saider.qb64 })]);
    }
    this.reger.tibs.pin(key, [...bigers]);
    this.reger.baks.rem(key);
    this.reger.baks.put(key, [...baks]);
    this.reger.tvts.put(key, serder.raw);
    this.reger.twes.put(pre, okSn(serder), said);
  }

  /** Retain anchorless evidence without changing the source seal representation. */
  private escrowALEvent(
    serder: SerderKERI,
    seqner?: NumberPrimitive | null,
    saider?: Diger | null,
    bigers: readonly Siger[] = [],
    baks: readonly string[] = [],
  ): void {
    const pre = okPre(serder);
    const said = okSaid(serder);
    const key = dgKey(pre, said);
    if (seqner && saider) {
      this.reger.ancs.put(key, [seqner, new Diger({ qb64: saider.qb64 })]);
    }
    this.reger.tibs.pin(key, [...bigers]);
    if (baks.length > 0) {
      this.reger.baks.rem(key);
      this.reger.baks.put(key, [...baks]);
    }
    this.reger.tvts.put(key, serder.raw);
    this.reger.taes.put(pre, okSn(serder), said);
  }

  /** Persist accepted TEL evidence and the exact qualified source seal. */
  private logEvent(args: {
    pre: string;
    sn: number;
    serder: SerderKERI;
    seqner?: NumberPrimitive | null;
    saider?: Diger | null;
    bigers?: readonly Siger[] | null;
    baks?: readonly string[] | null;
  }): void {
    const said = okSaid(args.serder);
    const key = dgKey(args.pre, said);
    if (!args.seqner || !args.saider) {
      throw new ValidationError("Cannot log TEL event without source seal.");
    }
    // Keep the qualified Number; widening it here would alter v2 replay evidence.
    this.reger.ancs.put(key, [args.seqner, new Diger({ qb64: args.saider.qb64 })]);
    this.reger.tibs.pin(key, [...(args.bigers ?? [])]);
    if (args.baks && args.baks.length > 0) {
      this.reger.baks.rem(key);
      this.reger.baks.put(key, [...args.baks]);
    }
    this.reger.tets.pin([args.pre, said], nowDater());
    this.reger.tvts.put(key, args.serder.raw);
    this.reger.tels.putOn(args.pre, args.sn, new Diger({ qb64: said }));
  }
}

/** Missing dependencies for registry and credential transaction-state notices. */
type RegistryEscrowFamily = "registry-mae" | "registry-ooo";
type CredentialEscrowFamily = "credential-mre" | "credential-mae" | "credential-ooo";
export type RegistryReplyDecision = ReplyProcessDecision<RegistryEscrowFamily>;
export type CredentialReplyDecision = ReplyProcessDecision<CredentialEscrowFamily>;

/**
 * TEL event and transaction-state notice processor.
 *
 * `Tevery` owns registry-key routing, expected sequence checks, accepted
 * `Tever` cache persistence, and replay of anchorless/out-of-order TEL
 * escrows, plus TSN reply admission and dependency retries.
 */
export class Tevery {
  static readonly TimeoutTSN = 3600_000;

  private readonly rvy?: Revery;

  readonly db: Baser;
  readonly reger: Reger;
  readonly local: boolean;
  readonly lax: boolean;
  readonly cues: Deck<AgentCue>;

  constructor(options: TeveryOptions) {
    this.rvy = options.rvy;
    this.db = options.db;
    this.reger = options.reger;
    this.local = options.local ?? false;
    this.lax = options.lax ?? true;
    this.cues = options.cues ?? new Deck<AgentCue>();
    this.reloadRegistryStates();
  }

  get tevers(): Map<string, Tever> {
    return this.reger.tevers as Map<string, Tever>;
  }

  get registries(): Set<string> {
    return this.reger.registries;
  }

  /** Rehydrate cached TEL state from KERIpy-compatible registry state records. */
  reloadRegistryStates(): void {
    for (const [, state] of this.reger.states.getTopItemIter()) {
      if (!state.i || this.tevers.has(state.i)) {
        continue;
      }
      this.tevers.set(
        state.i,
        new Tever({
          db: this.db,
          reger: this.reger,
          rsr: state,
        }),
      );
      this.registries.add(state.i);
    }
  }

  /** Decide and persist under one owned writer, then publish accepted cache state and cues. */
  processEvent(args: TelProcessEventArgs): TelProcessDecision {
    if (this.reger.inWriteTransaction) {
      throw new Error("Tevery must own the TEL transaction; process events outside caller-owned writers");
    }
    let accepted: Tever | undefined;
    let publicationFailure: { error: unknown } | undefined;
    let decision: TelProcessDecision;
    try {
      decision = this.reger.env!.transactionSync((): TelProcessDecision => {
        const serder = args.serder;
        const ilk = telIlk(serder);
        const pre = okPre(serder);
        const sn = okSn(serder);
        const regk = Tevery.registryKey(serder);

        if (!this.lax) {
          if (this.local && !this.registries.has(regk)) {
            return reject(`Nonlocal TEL event regk=${regk} in local mode.`, serder, regk);
          }
          if (!this.local && this.registries.has(regk)) {
            return reject(`Local TEL event regk=${regk} in nonlocal mode.`, serder, regk);
          }
        }

        // Work on a private candidate from accepted storage, never a shared cached state machine.
        const stored = this.reger.states.get(regk);
        const tever = stored ? new Tever({ db: this.db, reger: this.reger, rsr: stored }) : undefined;
        if (!tever) {
          if (ilk !== Ilks.vcp) {
            this.escrowOOEvent(serder, args.seqner ?? null, args.saider ?? null, args.wigers ?? []);
            return escrow("outOfOrder", "TEL event arrived before registry inception.", serder, regk);
          }
          try {
            const next = new Tever({
              serder,
              seqner: args.seqner ?? null,
              saider: args.saider ?? null,
              bigers: args.wigers ?? [],
              db: this.db,
              reger: this.reger,
              regk,
              local: this.local,
            });
            this.reger.states.pin(regk, next.state());
            accepted = next;
            return accept(serder, regk);
          } catch (error) {
            // Constructor admission persists missing evidence in its real protocol escrow.
            if (error instanceof PendingTelInception) return error.decision;
            throw error;
          }
        }

        if (ilk === Ilks.vcp) return this.processAcceptedDuplicate(args, regk);

        const expected = ilk === Ilks.vrt ? tever.sn + 1 : (tever.vcSn(pre) ?? -1) + 1;
        if (sn > expected) {
          this.escrowOOEvent(serder, args.seqner ?? null, args.saider ?? null, args.wigers ?? []);
          return escrow("outOfOrder", `TEL event sn=${sn} expected=${expected}.`, serder, regk);
        }
        if (sn < expected) return this.processAcceptedDuplicate(args, regk);

        const result = tever.update({ ...args, local: this.local }, (error) => {
          publicationFailure = { error };
        });
        if (result.kind === "escrow" && result.escrow === "outOfOrder") {
          this.escrowOOEvent(serder, args.seqner ?? null, args.saider ?? null, args.wigers ?? []);
        }
        if (result.kind === "accept" && ilk === Ilks.vrt) {
          this.reger.states.pin(regk, tever.state());
          accepted = tever;
        }
        return result;
      });
    } catch (error) {
      if (publicationFailure && publicationFailure.error === error) throw error;
      if (!(error instanceof ValidationError) && !(error instanceof ParserError)) throw error;
      return reject(error instanceof Error ? error.message : String(error), args.serder);
    }
    if (accepted) this.tevers.set(accepted.regk, accepted);
    if (decision.kind === "accept" && (decision.ilk === Ilks.rev || decision.ilk === Ilks.brv)) {
      // Keep publication outside semantic error conversion and after the writer has committed.
      this.cues.push({ kin: "revoked", serder: args.serder });
    }
    return decision;
  }

  /** Add valid late backer receipts to an exact accepted event without reapplying its business state. */
  private processAcceptedDuplicate(args: TelProcessEventArgs, regk: string): TelProcessDecision {
    const { serder } = args;
    const pre = okPre(serder), sn = okSn(serder), said = okSaid(serder);
    if (this.reger.tels.getOn(pre, sn)?.qb64 !== said) {
      return reject("TEL event conflicts with the accepted coordinate.", serder, regk);
    }
    if (args.wigers?.length && serder.ilk !== Ilks.iss && serder.ilk !== Ilks.rev) {
      const seal = serder.ilk === Ilks.vcp || serder.ilk === Ilks.vrt
        ? { i: pre, s: serder.snh, d: said }
        : okKed(serder).ra;
      const state = resolveBackerState(this.reger, regk, seal);
      if (state.kind !== "backers") {
        throw new DatabaseOperationError("Accepted TEL event has no accepted backer cohort.");
      }
      const key = dgKey(pre, said);
      const verified = Kever.verifyIndexedSignatures(
        serder.raw,
        [...this.reger.tibs.get(key), ...args.wigers],
        state.baks.map((bak) => new Verfer({ qb64: bak })),
      ).sigers;
      this.reger.tibs.pin(key, verified);
    }
    return duplicate("TEL event already accepted.", serder, regk);
  }

  /**
   * Serve legacy TEL replay or an ordered TSN pair with independent receiver verification.
   * Actual 714 leaves query signature validation TODO. Requester material identifies the destination;
   * optional KRAM and sender policy remain separate. Replay uses the parsed request genus;
   * direct callers default to the body-declared context and may select another genus explicitly.
   *
   * @param args TEL query body, authenticated source and nontransferable cigar evidence.
   */
  processQuery({ serder, source, cigars, gvrsn }: QueryEnvelope): TelQueryDecision {
    if (serder.route === "tsn") {
      const result = prepareTsnQuery({ serder, source, cigars }, this.tevers);
      if (result.kind === "drop") return result;
      if (result.kind === "reply") this.cues.extend(result.replies);
      return;
    }
    if (serder.route !== "tels") return { kind: "drop", reason: "unsupportedRoute" };
    const dest = source?.qb64 ?? cigars?.[0]?.verfer?.qb64;
    if (!dest) return { kind: "drop", reason: "missingAuthentication" };
    const query = serder.ked?.q;
    if (
      !query || typeof query !== "object" || Array.isArray(query)
      || !("ri" in query) || typeof query.ri !== "string" || !query.ri
      || !("src" in query) || typeof query.src !== "string" || !query.src
      || !("i" in query) || typeof query.i !== "string"
    ) return { kind: "drop", reason: "invalidQuery" };
    const selected = gvrsn ?? serder.gvrsn ?? serder.pvrsn;
    const settings = { gvrsn: selected, genusify: selected.major >= 2 };
    const management = this.reger.replay(query.ri, settings);
    const credential = query.i ? this.reger.replay(query.i, settings) : null;
    if (!management && !credential) return;
    const messages = {
      *[Symbol.iterator]() {
        if (management) yield* management;
        if (credential) yield* credential;
      },
    };
    this.cues.push({
      kin: "replay",
      querySaid: serder.said ?? undefined,
      src: query.src,
      dest,
      msgs: messages,
    });
  }

  /** Register both semantic TSN routes against this processor, as KERIpy Tevery does. */
  registerReplyRoutes(router: Router): void {
    this.replyVerifier();
    router.addRoute("/tsn/registry/{aid}", this, "RegistryTxnState");
    router.addRoute("/tsn/credential/{aid}", this, "CredentialTxnState");
  }

  /** TEL-only processors have no implicit reply verifier or TSN capability. */
  private replyVerifier(): Revery {
    if (!this.rvy) throw new TypeError("Transaction-state notice processing requires Revery.");
    return this.rvy;
  }

  /** Admit a registry TSN using independent attester proof, accepted trust and current TEL correspondence. */
  processReplyRegistryTxnState(
    { serder, diger, route, aid, cigars = [], tsgs = [] }: BrokerProcessReplyArgs,
  ): RegistryReplyDecision {
    const rvy = this.replyVerifier();
    const record = registryRecord(serder.ked?.a);
    const stamp = serder.ked?.dt;
    if (
      !record || !qualifiedPrefix(aid) || typeof stamp !== "string" || timestampMicros(stamp) === null
      || route !== `/tsn/registry/${aid}`
      || serder.said !== diger.qb64 || !serder.verify()
    ) {
      return unverifiedReplyDecision("Invalid registry transaction-state notice.");
    }
    const regk = record.i, issuer = record.ii, sn = Number.parseInt(record.s, 16);
    const previous = this.reger.txnsb.current([regk, aid]);
    const disposeIncoming = () => {
      if (previous?.qb64 !== diger.qb64) rvy.removeReply(diger);
    };
    const reject = (reason: string) => {
      disposeIncoming();
      return unverifiedReplyDecision(reason);
    };
    const saved = this.reger.states.get(regk);
    const stored = saved ? registryRecord(saved.asDict()) : null;
    if (saved && !stored) throw new Error("Corrupt stored registry state.");
    if (stored && (stored.ii !== issuer || BigInt(`0x${stored.s}`) > BigInt(sn))) {
      return reject("Mismatched issuer or stale registry state.");
    }
    const kever = this.db.getKever(issuer, { refresh: true });

    let queryCues: readonly AgentCue[] = [];
    const escrow = (typ: RegistryEscrowFamily, query: boolean, proof?: ReplyPlan): RegistryReplyDecision => {
      const isNew = !this.reger.txnsb.hasStateNotice(typ, regk, aid, diger);
      const cues: AgentCue[] = !isNew || !query
        ? []
        : typ === "registry-mae"
        ? [{ kin: "query", pre: issuer, src: aid, route: "logs", q: {} }]
        : [{ kin: "query", pre: issuer, src: aid, route: "tels", q: { ri: regk, i: "" } }];

      if (proof) rvy.writeReply(proof);
      const added = this.reger.txnsb.escrowStateNotice({
        typ,
        pre: regk,
        aid,
        serder,
        diger,
        dater: new Dater({ qb64: encodeDateTimeToDater(stamp) }),
        cigars,
        tsgs,
      });
      if (added !== isNew) throw new Error("Registry escrow membership changed before publication");
      // Broker now owns copied pending proof; retain prior accepted BADA evidence in Baser.
      disposeIncoming();
      if (queryCues.length) rvy.cues.extend(queryCues);
      if (cues.length) rvy.cues.extend(cues);
      return {
        kind: "unverified",
        reason: "dependencyPending",
        family: typ,
        message: "Registry state dependency unavailable.",
      };
    };
    if (!kever) return escrow("registry-mae", true);
    const watchers = new Set<string>();
    for (const [, habitat] of this.db.getHabItemIter()) {
      for (const watcher of habitat.watchers ?? []) watchers.add(watcher);
    }
    const trusted = aid === issuer || watchers.has(aid)
      || (!!stored && (stored.c.includes(TraitDex.NoBackers) ? kever.wits : stored.b).includes(aid));
    if (!trusted && stored) return reject("Untrusted registry state attester.");
    if (previous && (!this.db.sdts.get([previous.qb64]) || !this.db.rpys.get([previous.qb64]))) {
      throw new Error("Corrupt prior registry reply evidence.");
    }
    const proof = rvy.decideReply({
      serder,
      saider: diger,
      route,
      aid,
      cigars,
      tsgs,
      osaider: previous?.qb64 === diger.qb64 ? null : previous,
      retainPrevious: true,
      externalEscrow: true,
    });
    queryCues = proof.cues;

    if (proof.kind !== "accept") {
      if (proof.reason === "proofPending") return escrow("registry-mae", false, proof);
      rvy.writeReply(proof);
      if (queryCues.length) rvy.cues.extend(queryCues);
      return reject("Unverified registry state attester.");
    }
    const accepted = this.reger.tels.getOn(regk, sn);
    if (!accepted) return escrow("registry-ooo", true, proof);
    const raw = this.reger.tvts.get(dgKey(regk, accepted.qb64));
    if (!raw || !stored || stored.d !== accepted.qb64) throw new Error("Corrupt accepted registry TEL state.");
    const event = new SerderKERI({ raw });
    if (!event.verify() || event.said !== accepted.qb64 || event.pre !== regk || event.sn !== sn) {
      throw new Error("Corrupt accepted registry TEL body.");
    }
    if (!trusted || accepted.qb64 !== record.d) return reject("Registry state does not match accepted TEL.");
    // Receiver-generated record time is descriptive; configuration and state fields must agree.
    const fields = ["vn", "i", "s", "d", "ii", "et", "bt", "b", "c"] as const;
    if (fields.some((key) => JSON.stringify(record[key]) !== JSON.stringify(stored[key]))) {
      return reject("Registry state metadata mismatch.");
    }
    const dater = new Dater({ qb64: encodeDateTimeToDater(stamp) });
    const cues: AgentCue[] = [{ kin: "txnStateSaved", record }];

    rvy.writeReply(proof);
    this.reger.txnsb.updateReply(aid, serder, diger, dater);
    if (previous?.qb64 !== diger.qb64) rvy.removeReply(previous);
    if (queryCues.length) rvy.cues.extend(queryCues);
    if (cues.length) rvy.cues.extend(cues);
    return acceptReplyDecision();
  }

  /** Admit a credential TSN against its own proof, registry dependency and current TEL/anchor commitments. */
  processReplyCredentialTxnState(
    { serder, diger, route, aid, cigars = [], tsgs = [] }: BrokerProcessReplyArgs,
  ): CredentialReplyDecision {
    const rvy = this.replyVerifier();
    const record = credentialRecord(serder.ked?.a);
    const stamp = serder.ked?.dt;
    if (
      !record || !qualifiedPrefix(aid) || typeof stamp !== "string" || timestampMicros(stamp) === null
      || route !== `/tsn/credential/${aid}` || serder.said !== diger.qb64 || !serder.verify()
    ) return unverifiedReplyDecision("Invalid credential transaction-state notice.");
    const vci = record.i, regk = record.ri, sn = Number.parseInt(record.s, 16);
    const previous = this.reger.txnsb.current([vci, aid]);
    const disposeIncoming = () => {
      if (previous?.qb64 !== diger.qb64) rvy.removeReply(diger);
    };
    const reject = (reason: string) => {
      disposeIncoming();
      return unverifiedReplyDecision(reason);
    };
    const saved = this.reger.states.get(regk);
    const stored = saved ? registryRecord(saved.asDict()) : null;
    if (saved && !stored) throw new Error("Corrupt stored registry state.");
    const issuer = stored?.ii ?? aid;

    let queryCues: readonly AgentCue[] = [];
    const escrow = (typ: CredentialEscrowFamily, query: boolean, proof?: ReplyPlan): CredentialReplyDecision => {
      const isNew = !this.reger.txnsb.hasStateNotice(typ, vci, aid, diger);
      const cues: AgentCue[] = !isNew || !query
        ? []
        : typ === "credential-mae"
        ? [{ kin: "query", pre: issuer, src: aid, route: "logs", q: {} }]
        : [{
          kin: "query",
          pre: issuer,
          src: aid,
          route: "tels",
          q: { ri: regk, i: typ === "credential-mre" ? "" : vci },
        }];

      if (proof) rvy.writeReply(proof);
      const added = this.reger.txnsb.escrowStateNotice({
        typ,
        pre: vci,
        aid,
        serder,
        diger,
        dater: new Dater({ qb64: encodeDateTimeToDater(stamp) }),
        cigars,
        tsgs,
      });
      if (added !== isNew) throw new Error("Credential escrow membership changed before publication");
      disposeIncoming();
      if (queryCues.length) rvy.cues.extend(queryCues);
      if (cues.length) rvy.cues.extend(cues);
      return {
        kind: "unverified",
        reason: "dependencyPending",
        family: typ,
        message: "Credential state dependency unavailable.",
      };
    };
    const regsn = record.ra.s === undefined ? 0 : Number.parseInt(record.ra.s, 16);
    if (!stored || Number.parseInt(stored.s, 16) < regsn) return escrow("credential-mre", true);
    const tever = new Tever({ db: this.db, reger: this.reger, rsr: stored });
    if (
      !tever.serder.verify() || tever.serder.said !== stored.d
      || this.reger.tels.getOn(regk, tever.sn)?.qb64 !== stored.d
    ) throw new Error("Corrupt accepted registry TEL state.");
    const kever = this.db.getKever(issuer, { refresh: true });
    if (!kever) return escrow("credential-mae", true);
    const watchers = new Set<string>();
    for (const [, habitat] of this.db.getHabItemIter()) {
      for (const watcher of habitat.watchers ?? []) watchers.add(watcher);
    }
    if (
      aid !== issuer && !watchers.has(aid)
      && !(stored.c.includes(TraitDex.NoBackers) ? kever.wits : stored.b).includes(aid)
    ) {
      return reject("Untrusted credential state attester.");
    }
    if (previous && (!this.db.sdts.get([previous.qb64]) || !this.db.rpys.get([previous.qb64]))) {
      throw new Error("Corrupt prior credential reply evidence.");
    }
    const proof = rvy.decideReply({
      serder,
      saider: diger,
      route,
      aid,
      cigars,
      tsgs,
      osaider: previous?.qb64 === diger.qb64 ? null : previous,
      retainPrevious: true,
      externalEscrow: true,
    });
    queryCues = proof.cues;

    if (proof.kind !== "accept") {
      if (proof.reason === "proofPending") return escrow("credential-mae", false, proof);
      rvy.writeReply(proof);
      if (queryCues.length) rvy.cues.extend(queryCues);
      return reject("Unverified credential state attester.");
    }
    const accepted = this.reger.tels.getOn(vci, sn);
    if (!accepted) return escrow("credential-ooo", true, proof);
    const current = tever.vcState(vci);
    const raw = this.reger.tvts.get(dgKey(vci, accepted.qb64));
    if (!raw || !current) throw new Error("Corrupt accepted credential TEL state.");
    const event = new SerderKERI({ raw });
    if (!event.verify() || event.pre !== vci || event.sn !== sn || event.said !== accepted.qb64) {
      throw new Error("Corrupt accepted credential TEL body.");
    }
    if (Tevery.registryKey(event) !== regk) return reject("Credential belongs to a different registry.");
    const fields = ["vn", "i", "s", "d", "ri", "dt", "et"] as const;
    if (
      accepted.qb64 !== record.d || fields.some((key) => JSON.stringify(record[key]) !== JSON.stringify(current[key]))
      || (["s", "d"] as const).some((key) => record.a[key] !== current.a[key])
      || (["i", "s", "d"] as const).some((key) => record.ra[key] !== current.ra[key])
    ) return reject("Credential state does not match current accepted TEL and anchors.");
    const cues: AgentCue[] = [{ kin: "txnStateSaved", record }];

    rvy.writeReply(proof);
    this.reger.txnsb.updateReply(
      aid,
      serder,
      diger,
      new Dater({ qb64: encodeDateTimeToDater(stamp) }),
    );
    if (previous?.qb64 !== diger.qb64) rvy.removeReply(previous);
    if (queryCues.length) rvy.cues.extend(queryCues);
    if (cues.length) rvy.cues.extend(cues);
    return acceptReplyDecision();
  }

  /**
   * Retry TEL dependencies, then each complete captured TSN family horizon.
   * Pages bound materialization; new rows beyond the captured horizon wait for a
   * later sweep. The synchronous turn can outlast an asynchronous caller deadline.
   */
  processEscrows(): void {
    this.processEscrowAnchorless();
    this.processEscrowOutOfOrders();
    this.retryDependencyEscrow("partialWitness", this.reger.twes);
    if (!this.rvy) return;
    for (const typ of ["registry-mae", "registry-ooo", "credential-mre", "credential-mae", "credential-ooo"]) {
      let done = false;
      while (!done) {
        const page = this.reger.txnsb.retryStateNotices(typ, (args) => {
          const decision = typ.startsWith("registry-")
            ? this.processReplyRegistryTxnState(args)
            : this.processReplyCredentialTxnState(args);
          if (decision.kind === "accept") return acceptEscrow();
          if (decision.reason === "dependencyPending") {
            // The new family owns the retained evidence; removing this index is not rejection.
            return decision.family === typ ? keepEscrow("recoverableError") : acceptEscrow();
          }
          return dropEscrow("processingError", decision.message);
        });
        done = page.done;
      }
    }
  }

  /** Retry out-of-order TEL events; report terminal removal after its index write succeeds. */
  processEscrowOutOfOrders(): void {
    const entries = [...this.reger.oots.getAllItemIter()];
    for (const [keys, sn, dig] of entries) {
      const pre = keys[0] ?? "";
      const key = dgKey(pre, dig);
      const raw = this.reger.tvts.get(key);
      const couple = this.reger.ancs.get(key);
      if (raw === null || couple === null) {
        if (this.reger.oots.remOn(pre, sn, dig)) {
          consoleLogger.warn("Tevery ejected out-of-order TEL event from escrow", {
            family: "outOfOrder",
            pre,
            sn,
            said: dig,
            reason: raw === null ? "missingEvent" : "missingSourceSeal",
          });
        }
        continue;
      }
      const [seqner, saider] = couple;
      const decision = this.processEvent({
        serder: new SerderKERI({ raw }),
        seqner,
        saider,
        wigers: this.reger.tibs.get(key),
      });
      if (decision.kind === "escrow" && decision.escrow === "outOfOrder") {
        continue;
      }
      const removed = this.reger.oots.remOn(pre, sn, dig);
      if (removed && decision.kind === "reject") {
        consoleLogger.warn("Tevery ejected out-of-order TEL event from escrow", {
          family: "outOfOrder",
          pre,
          sn,
          said: dig,
          reason: decision.reason,
        });
      }
    }
  }

  /** Retry anchorless TEL events; missing source seals remain pending rather than being ejected. */
  processEscrowAnchorless(): void {
    this.retryDependencyEscrow("anchorless", this.reger.taes);
  }

  /** Retry each retained body with its accumulated proofs; commit before removing the old family index. */
  private retryDependencyEscrow(family: "anchorless" | "partialWitness", table: Reger["taes"]): void {
    const entries = [...table.getAllItemIter()];
    for (const [keys, sn, dig] of entries) {
      const pre = keys[0] ?? "";
      const key = dgKey(pre, dig);
      const raw = this.reger.tvts.get(key);
      const couple = this.reger.ancs.get(key);
      if (raw === null || couple === null) {
        if (raw === null) {
          if (table.remOn(pre, sn, dig)) {
            consoleLogger.warn("Tevery ejected TEL dependency escrow", {
              family,
              pre,
              sn,
              said: dig,
              reason: "missingEvent",
            });
          }
        }
        continue;
      }
      const [seqner, saider] = couple;
      const decision = this.processEvent({
        serder: new SerderKERI({ raw }),
        seqner,
        saider,
        wigers: this.reger.tibs.get(key),
      });
      if (decision.kind === "escrow" && decision.escrow === family) {
        continue;
      }
      const removed = table.remOn(pre, sn, dig);
      if (removed && decision.kind === "reject") {
        consoleLogger.warn("Tevery ejected TEL dependency escrow", {
          family,
          pre,
          sn,
          said: dig,
          reason: decision.reason,
        });
      }
    }
  }

  static registryKey(serder: SerderKERI): string {
    switch (telIlk(serder)) {
      case Ilks.vcp:
      case Ilks.vrt:
        return okPre(serder);
      case Ilks.iss:
      case Ilks.rev: {
        const regk = stringField(okKed(serder), "ri");
        if (!regk) {
          throw new ValidationError("TEL credential event missing ri.");
        }
        return regk;
      }
      case Ilks.bis:
      case Ilks.brv: {
        const ra = sealRecord(okKed(serder).ra);
        const regk = ra && "i" in ra && typeof ra.i === "string" ? ra.i : null;
        if (!regk) {
          throw new ValidationError("Backer TEL event missing ra.i.");
        }
        return regk;
      }
    }
  }

  /** Preserve the original source seal while waiting for earlier TEL events. */
  private escrowOOEvent(
    serder: SerderKERI,
    seqner?: NumberPrimitive | null,
    saider?: Diger | null,
    bigers: readonly Siger[] = [],
  ): void {
    const pre = okPre(serder);
    const said = okSaid(serder);
    const key = dgKey(pre, said);
    // The historical roster may be unavailable. Retain candidates, then verify
    // their union in valAnchorBigs before any threshold or acceptance decision.
    this.reger.tibs.put(key, bigers);
    this.reger.tvts.put(key, serder.raw);
    if (seqner && saider) {
      this.reger.ancs.put(key, [seqner, new Diger({ qb64: saider.qb64 })]);
    }
    this.reger.oots.put(pre, okSn(serder), said);
  }
}

export function isAcceptedTelDecision(
  decision: TelProcessDecision,
): decision is Extract<TelProcessDecision, { kind: "accept" }> {
  return decision.kind === "accept";
}
