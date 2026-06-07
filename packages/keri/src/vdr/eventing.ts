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
  NumDex,
  Prefixer,
  type SealSource,
  SerderKERI,
  Siger,
  TraitDex,
  Verfer,
} from "../../../cesr/mod.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { ValidationError } from "../core/errors.ts";
import { Kever } from "../core/kever.ts";
import { state as registryState, vcstate as credentialState } from "../core/protocol-vdr-eventing.ts";
import { RegStateRecord, VcStateRecord } from "../core/records.ts";
import type { Baser } from "../db/basing.ts";
import { dgKey } from "../db/core/keys.ts";
import type { Reger } from "../db/reger.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../time/mod.ts";

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

export interface TelProcessEventArgs {
  serder: SerderKERI;
  seqner?: SealSource["s"] | NumberPrimitive | null;
  saider?: SealSource["d"] | Diger | null;
  wigers?: readonly Siger[] | null;
  sigers?: readonly Siger[] | null;
  local?: boolean;
}

export interface TeveryOptions {
  reger: Reger;
  db: Baser;
  local?: boolean;
  lax?: boolean;
  cues?: Deck<AgentCue>;
}

export interface TeverOptions extends TeveryOptions {
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

function ordinal(num: number | bigint): NumberPrimitive {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new NumberPrimitive({ code: NumDex.Huge, raw });
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

function sealRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
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
 * `Tever` owns accepted TEL state for one registry. It writes durable TEL
 * artifacts through `Reger`; `Tevery` owns routing, cache insertion, and escrow
 * replay.
 */
export class Tever {
  readonly db: Baser;
  readonly reger: Reger;
  readonly local: boolean;
  readonly cues: Deck<AgentCue>;

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
    this.local = options.local ?? false;
    this.cues = options.cues ?? new Deck<AgentCue>();

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
    this.incept(options.serder);
    this.config(options.serder, options.noBackers, options.estOnly);

    const checked = this.valAnchorBigs({
      serder: options.serder,
      seqner: options.seqner ?? null,
      saider: options.saider ?? null,
      bigers: options.bigers ?? [],
      toad: this.toad,
      baks: this.baks,
    });
    if (checked.kind !== "accept") {
      throw new ValidationError(checked.reason);
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
    this.toad = parseInt(rsr.bt ?? "0", 16);
    this.baks = [...(rsr.b ?? [])];
    this.noBackers = (rsr.c ?? []).includes(TraitDex.NoBackers);
    this.estOnly = (rsr.c ?? []).includes(TraitDex.EstOnly);
    this.serder = new SerderKERI({ raw });
  }

  /** Current registry transaction-state record. */
  state(): RegStateRecord {
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
  vcState(vci: string): VcStateRecord | null {
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
    const ra = this.noBackers ? {} : sealRecord(ked.ra) ?? {};
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

  update(args: TelProcessEventArgs): TelProcessDecision {
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
        return this.revoke(serder, sn, args);
      }
      return reject(`Unsupported TEL ilk=${ilk}.`, serder, this.regk);
    } catch (error) {
      return reject(error instanceof Error ? error.message : String(error), args.serder, this.regk);
    }
  }

  private incept(serder: SerderKERI): void {
    const ked = okKed(serder);
    const pre = stringField(ked, "ii");
    if (!pre) {
      throw new ValidationError("Registry inception missing ii.");
    }
    this.pre = pre;
    this.prefixer = new Prefixer({ qb64: okPre(serder) });
    this.sn = okSn(serder);
    if (this.sn !== 0) {
      throw new ValidationError(`Invalid vcp sn=${this.sn}.`);
    }
    this.cuts = [];
    this.adds = [];
    const baks = stringListField(ked, "b");
    if (!unique(baks)) {
      throw new ValidationError(`Invalid duplicate baks=${baks}.`);
    }
    this.baks = baks;
    const toad = parseInt(stringField(ked, "bt") ?? "0", 16);
    this.validateToad(toad, baks);
    this.toad = toad;
    this.ilk = Ilks.vcp;
    this.serder = serder;
  }

  private config(
    serder: SerderKERI,
    noBackers?: boolean | null,
    estOnly?: boolean | null,
  ): void {
    const cnfg = stringListField(okKed(serder), "c");
    this.noBackers = noBackers ?? false;
    this.estOnly = estOnly ?? false;
    if (cnfg.includes(TraitDex.NoBackers)) {
      this.noBackers = true;
    }
    if (cnfg.includes(TraitDex.EstOnly)) {
      this.estOnly = true;
    }
    if (this.noBackers && this.baks.length > 0) {
      throw new ValidationError("NoBackers registry may not configure baks.");
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
    const toad = parseInt(stringField(ked, "bt") ?? "0", 16);
    try {
      this.validateToad(toad, next);
    } catch (error) {
      return reject(error instanceof Error ? error.message : String(error), serder, this.regk);
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
    const state = this.getBackerState(okKed(serder), serder);
    if (state.kind === "reject") {
      return state;
    }
    const checked = this.valAnchorBigs({
      serder,
      seqner: args.seqner ?? null,
      saider: args.saider ?? null,
      bigers: args.wigers ?? [],
      toad: state.toad,
      baks: state.baks,
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
      this.logEvent({
        pre: vci,
        sn,
        serder,
        seqner: args.seqner ?? null,
        saider: args.saider ?? null,
      });
      this.cues.push({ kin: "revoked", serder });
      return accept(serder, this.regk);
    }

    if (this.noBackers) {
      return reject("Backer revoke is invalid against backerless registry.", serder, this.regk);
    }
    const state = this.getBackerState(okKed(serder), serder);
    if (state.kind === "reject") {
      return state;
    }
    const checked = this.valAnchorBigs({
      serder,
      seqner: args.seqner ?? null,
      saider: args.saider ?? null,
      bigers: args.wigers ?? [],
      toad: state.toad,
      baks: state.baks,
    });
    if (checked.kind !== "accept") {
      return checked.decision;
    }
    this.logEvent({
      pre: vci,
      sn,
      serder,
      seqner: args.seqner ?? null,
      saider: args.saider ?? null,
      bigers: checked.bigers,
    });
    this.cues.push({ kin: "revoked", serder });
    return accept(serder, this.regk);
  }

  private validateToad(toad: number, baks: readonly string[]): void {
    if (baks.length === 0) {
      if (toad !== 0) {
        throw new ValidationError(`Invalid toad=${toad} for empty backer set.`);
      }
    } else if (toad < 1 || toad > baks.length) {
      throw new ValidationError(`Invalid toad=${toad} for baks=${baks}.`);
    }
  }

  private valAnchorBigs(args: {
    serder: SerderKERI;
    seqner: NumberPrimitive | null;
    saider: Diger | null;
    bigers: readonly Siger[];
    toad: number;
    baks: readonly string[];
  }):
    | { kind: "accept"; bigers: Siger[] }
    | { kind: "escrow"; decision: TelProcessDecision; reason: string }
  {
    const verfers = args.baks.map((bak) => new Verfer({ qb64: bak }));
    const verified = Kever.verifyIndexedSignatures(
      args.serder.raw,
      args.bigers,
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

    if (!this.local && args.baks.length > 0) {
      this.validateToad(args.toad, args.baks);
      if (verified.length < args.toad) {
        this.escrowPWEvent(args.serder, args.seqner, args.saider, verified);
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
    if (!seqner || !saider) {
      return false;
    }
    const anchorSaid = this.db.kels.getLast(this.pre, Number(seqner.num));
    if (!anchorSaid || anchorSaid !== saider.qb64) {
      return false;
    }
    const anchor = this.db.getEvtSerder(this.pre, anchorSaid);
    if (!anchor || anchor.said !== saider.qb64) {
      return false;
    }
    const anchorKed = okKed(anchor);
    const seals = Array.isArray(anchorKed.a) ? anchorKed.a : [];
    if (seals.length !== 1) {
      return false;
    }
    const seal = sealRecord(seals[0]);
    return seal?.i === serder.pre
      && seal?.s === serder.snh
      && seal?.d === serder.said;
  }

  private escrowPWEvent(
    serder: SerderKERI,
    seqner?: NumberPrimitive | null,
    saider?: Diger | null,
    bigers: readonly Siger[] = [],
  ): void {
    const pre = okPre(serder);
    const said = okSaid(serder);
    const key = dgKey(pre, said);
    if (seqner && saider) {
      this.reger.ancs.put(key, [ordinal(seqner.num), new Diger({ qb64: saider.qb64 })]);
    }
    if (bigers.length > 0) {
      this.reger.tibs.pin(key, [...bigers]);
    }
    this.reger.tvts.put(key, serder.raw);
    this.reger.twes.put(pre, okSn(serder), said);
  }

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
      this.reger.ancs.put(key, [ordinal(seqner.num), new Diger({ qb64: saider.qb64 })]);
    }
    if (bigers.length > 0) {
      this.reger.tibs.pin(key, [...bigers]);
    }
    if (baks.length > 0) {
      this.reger.baks.rem(key);
      this.reger.baks.put(key, [...baks]);
    }
    this.reger.tvts.put(key, serder.raw);
    this.reger.taes.put(pre, okSn(serder), said);
  }

  private getBackerState(
    ked: Record<string, unknown>,
    serder: SerderKERI,
  ):
    | { kind: "backers"; toad: number; baks: string[] }
    | Extract<TelProcessDecision, { kind: "reject" }>
  {
    const ra = sealRecord(ked.ra);
    const regi = typeof ra?.i === "string" ? ra.i : null;
    const regd = typeof ra?.d === "string" ? ra.d : null;
    if (!regi || !regd || regi !== this.prefixer.qb64) {
      return reject("Backer TEL event registry anchor mismatch.", serder, this.regk);
    }
    const rserder = serderForTel(this.reger, regi, regd);
    if (!rserder) {
      return reject("Backer TEL event references missing registry state.", serder, this.regk);
    }
    const toad = parseInt(stringField(okKed(rserder), "bt") ?? "0", 16);
    const baks = this.reger.baks.get(dgKey(regi, regd));
    return { kind: "backers", toad, baks };
  }

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
    this.reger.ancs.put(key, [ordinal(args.seqner.num), new Diger({ qb64: args.saider.qb64 })]);
    if (args.bigers && args.bigers.length > 0) {
      this.reger.tibs.pin(key, [...args.bigers]);
    }
    if (args.baks && args.baks.length > 0) {
      this.reger.baks.rem(key);
      this.reger.baks.put(key, [...args.baks]);
    }
    this.reger.tets.pin([args.pre, said], nowDater());
    this.reger.tvts.put(key, args.serder.raw);
    this.reger.tels.putOn(args.pre, args.sn, new Diger({ qb64: said }));
  }
}

/**
 * TEL event router and escrow reprocessor.
 *
 * `Tevery` owns registry-key routing, expected sequence checks, accepted
 * `Tever` cache persistence, and replay of anchorless/out-of-order TEL
 * escrows.
 */
export class Tevery {
  static readonly TimeoutTSN = 3600_000;

  readonly db: Baser;
  readonly reger: Reger;
  readonly local: boolean;
  readonly lax: boolean;
  readonly cues: Deck<AgentCue>;

  constructor(options: TeveryOptions) {
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
          local: this.local,
          cues: this.cues,
          rsr: state,
        }),
      );
      this.registries.add(state.i);
    }
  }

  processEvent(args: TelProcessEventArgs): TelProcessDecision {
    try {
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

      const tever = this.tevers.get(regk);
      if (!tever) {
        if (ilk !== Ilks.vcp) {
          this.escrowOOEvent(serder, args.seqner ?? null, args.saider ?? null);
          return escrow("outOfOrder", "TEL event arrived before registry inception.", serder, regk);
        }
        const next = new Tever({
          serder,
          seqner: args.seqner ?? null,
          saider: args.saider ?? null,
          bigers: args.wigers ?? [],
          db: this.db,
          reger: this.reger,
          regk,
          local: this.local,
          cues: this.cues,
        });
        this.cacheTever(regk, next);
        return accept(serder, regk);
      }

      if (ilk === Ilks.vcp) {
        return duplicate("Registry inception already accepted.", serder, regk);
      }

      const expected = ilk === Ilks.vrt ? tever.sn + 1 : (tever.vcSn(pre) ?? -1) + 1;
      if (sn > expected) {
        this.escrowOOEvent(serder, args.seqner ?? null, args.saider ?? null);
        return escrow("outOfOrder", `TEL event sn=${sn} expected=${expected}.`, serder, regk);
      }
      if (sn < expected) {
        return duplicate(`TEL event sn=${sn} older than expected=${expected}.`, serder, regk);
      }

      const decision = tever.update(args);
      if (decision.kind === "accept" && ilk === Ilks.vrt) {
        this.cacheTever(regk, tever);
      }
      return decision;
    } catch (error) {
      return reject(error instanceof Error ? error.message : String(error), args.serder);
    }
  }

  processEscrows(): void {
    this.processEscrowAnchorless();
    this.processEscrowOutOfOrders();
  }

  processEscrowOutOfOrders(): void {
    const entries = [...this.reger.oots.getAllItemIter()];
    for (const [keys, sn, dig] of entries) {
      const pre = keys[0] ?? "";
      const key = dgKey(pre, dig);
      const raw = this.reger.tvts.get(key);
      const couple = this.reger.ancs.get(key);
      if (raw === null || couple === null) {
        this.reger.oots.remOn(pre, sn, dig);
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
      this.reger.oots.remOn(pre, sn, dig);
    }
  }

  processEscrowAnchorless(): void {
    const entries = [...this.reger.taes.getAllItemIter()];
    for (const [keys, sn, dig] of entries) {
      const pre = keys[0] ?? "";
      const key = dgKey(pre, dig);
      const raw = this.reger.tvts.get(key);
      const couple = this.reger.ancs.get(key);
      if (raw === null || couple === null) {
        if (raw === null) {
          this.reger.taes.remOn(pre, sn, dig);
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
      if (decision.kind === "escrow" && decision.escrow === "anchorless") {
        continue;
      }
      this.reger.taes.remOn(pre, sn, dig);
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
        const regk = typeof ra?.i === "string" ? ra.i : null;
        if (!regk) {
          throw new ValidationError("Backer TEL event missing ra.i.");
        }
        return regk;
      }
    }
  }

  private cacheTever(regk: string, tever: Tever): void {
    this.tevers.set(regk, tever);
    this.reger.states.pin(regk, tever.state());
  }

  private escrowOOEvent(
    serder: SerderKERI,
    seqner?: NumberPrimitive | null,
    saider?: Diger | null,
  ): void {
    const pre = okPre(serder);
    const said = okSaid(serder);
    const key = dgKey(pre, said);
    this.reger.tvts.put(key, serder.raw);
    if (seqner && saider) {
      this.reger.ancs.put(key, [ordinal(seqner.num), new Diger({ qb64: saider.qb64 })]);
    }
    this.reger.oots.put(pre, okSn(serder), said);
  }
}

export function isAcceptedTelDecision(
  decision: TelProcessDecision,
): decision is Extract<TelProcessDecision, { kind: "accept" }> {
  return decision.kind === "accept";
}
