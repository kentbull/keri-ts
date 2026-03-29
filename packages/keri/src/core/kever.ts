import { ed25519 } from "npm:@noble/curves@1.9.7/ed25519";
import {
  Dater,
  Diger,
  NON_TRANSFERABLE_PREFIX_CODES,
  NumberPrimitive,
  Prefixer,
  SerderKERI,
  type Siger,
  Tholder,
  Verfer,
} from "../../../cesr/mod.ts";
import { encodeDateTimeToDater } from "../app/keeping.ts";
import type { Baser } from "../db/basing.ts";
import type { AgentCue } from "./cues.ts";
import { Deck } from "./deck.ts";
import type {
  DispatchOrdinal,
  FirstSeenReplayCouple,
  SourceSealCouple,
  SourceSealTriple,
} from "./dispatch.ts";
import { ValidationError } from "./errors.ts";
import type { KeyStateRecord } from "./records.ts";

/**
 * Build one UTC ISO-8601 timestamp in the text form expected by KERI records.
 *
 * This is used when inbound first-seen replay attachments do not provide a
 * datetime and the local runtime still needs a deterministic durable stamp.
 */
function makeNowIso8601(): string {
  const now = new Date();
  const y = now.getUTCFullYear().toString().padStart(4, "0");
  const m = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = now.getUTCDate().toString().padStart(2, "0");
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const mm = now.getUTCMinutes().toString().padStart(2, "0");
  const ss = now.getUTCSeconds().toString().padStart(2, "0");
  const micros = (now.getUTCMilliseconds() * 1000).toString().padStart(6, "0");
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}.${micros}+00:00`;
}

/**
 * Convert one integer into the Huge-number CESR family used for durable replay
 * ordinals in `fels.`/`fons.`-adjacent state.
 */
function encodeHugeOrdinal(num: number | bigint): NumberPrimitive {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new NumberPrimitive({ code: "0A", raw });
}

/**
 * Convert one simple hex threshold into a numeric signature threshold.
 *
 * Current `keri-ts` limitation:
 * - the active `Kever` port only enforces simple numeric threshold expressions
 * - weighted threshold satisfaction remains later parity work
 */
function parseNumericThreshold(
  sith: string | null | undefined,
  count: number,
): number {
  if (!sith) {
    return Math.max(1, count);
  }
  const parsed = Number.parseInt(sith, 16);
  return Number.isNaN(parsed) ? Math.max(1, count) : parsed;
}

/** Convert one dispatch ordinal into the Huge-number family used in DB tuples. */
function normalizeOrdinal(ordinal: DispatchOrdinal): NumberPrimitive {
  return ordinal instanceof NumberPrimitive
    ? ordinal
    : encodeHugeOrdinal(ordinal.sn);
}

/** Return true when a string list has no duplicates. */
function hasUniqueEntries(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const THOLDER_NUMERIC_CAPACITIES = [
  { code: "M", rawSize: 2 },
  { code: "0H", rawSize: 4 },
  { code: "R", rawSize: 5 },
  { code: "N", rawSize: 8 },
  { code: "S", rawSize: 11 },
  { code: "T", rawSize: 14 },
  { code: "0A", rawSize: 16 },
  { code: "U", rawSize: 17 },
] as const;

/**
 * Small latest-establishment pointer carried in a live `Kever`.
 *
 * KERIpy correspondence:
 * - mirrors `LastEstLoc`, but stays as a plain immutable TS object
 */
export interface LastEstLoc {
  s: number;
  d: string;
}

/** Shared constructor options for live or reloaded `Kever` instances. */
interface KeverBaseInit {
  db: Baser;
  cues?: Deck<AgentCue>;
  local?: boolean;
  check?: boolean;
}

/** Reload one live `Kever` directly from durable key-state content. */
export interface KeverStateInit extends KeverBaseInit {
  state: KeyStateRecord;
}

/** Create one live `Kever` from an accepted first-seen inception event. */
export interface KeverEventInit extends KeverBaseInit {
  serder: SerderKERI;
  sigers: readonly Siger[];
  wigers?: readonly Siger[];
  frcs?: readonly FirstSeenReplayCouple[];
  sscs?: readonly SourceSealCouple[];
  ssts?: readonly SourceSealTriple[];
}

export type KeverInit = KeverStateInit | KeverEventInit;

/**
 * One live current-state machine for an accepted identifier KEL.
 *
 * KERIpy correspondence:
 * - this is the `keri-ts` port of `keri.core.eventing.Kever`
 *
 * Current scope:
 * - constructor/reload/state/log parity for accepted `icp`/`dip`
 * - bootstrap `update()` support for `rot`, `drt`, and `ixn`
 *
 * Deferred parity:
 * - full witness, delegation, misfit, duplicitous, and recovery breadth still
 *   lives in later `Kevery` + escrow work
 */
export class Kever {
  readonly db: Baser;
  readonly cues: Deck<AgentCue>;

  version!: readonly [number, number];
  prefixer!: Prefixer;
  sner!: NumberPrimitive;
  fner!: NumberPrimitive;
  dater!: Dater;
  serder!: SerderKERI;
  ilk!: string;
  tholder!: Tholder | null;
  verfers!: Verfer[];
  ndigers!: Diger[];
  ntholder!: Tholder | null;
  toader!: NumberPrimitive;
  wits!: string[];
  cuts!: string[];
  adds!: string[];
  estOnly = false;
  doNotDelegate = false;
  lastEst!: LastEstLoc;
  delegated = false;
  delpre: string | null = null;

  constructor(init: KeverInit) {
    this.db = init.db;
    this.cues = init.cues ?? new Deck();

    if ("state" in init) {
      this.reload(init.state);
      return;
    }

    const { serder } = init;
    if (!serder || init.sigers.length === 0) {
      throw new ValidationError(
        "Missing required Kever constructor event or indexed signatures.",
      );
    }

    this.version = [serder.pvrsn.major, serder.pvrsn.minor];
    if (serder.ilk !== "icp" && serder.ilk !== "dip") {
      throw new ValidationError(
        `Expected icp or dip for Kever constructor, got ${String(serder.ilk)}.`,
      );
    }

    this.ilk = serder.ilk;
    this.incept(serder);
    this.config(serder);

    const verified = this.validateSignatures(
      serder.raw,
      init.sigers,
      serder.verfers,
      this.tholder,
      serder.said ?? "<unknown>",
    );

    const { fn, dater } = this.logEvent({
      serder,
      sigers: verified,
      wigers: init.wigers ?? [],
      wits: this.wits,
      first: !init.check,
      frc: init.frcs?.[0] ?? null,
      sourceSeal: this.normalizeSourceSeal(init.sscs, init.ssts),
      local: init.local ?? false,
    });

    if (fn !== null) {
      this.fner = encodeHugeOrdinal(fn);
      this.dater = dater;
      this.db.pinState(this.pre, this.state());
    }
  }

  /** Current identifier prefix. */
  get pre(): string {
    return this.prefixer.qb64;
  }

  /** Current accepted sequence number. */
  get sn(): number {
    return Number(this.sner.num);
  }

  /** Current first-seen ordinal number. */
  get fn(): number {
    return Number(this.fner.num);
  }

  /** Current event SAID. */
  get said(): string {
    return this.serder.said ?? "";
  }

  /** Current next-key digests as qb64 strings. */
  get ndigs(): string[] {
    return this.ndigers.map((diger) => diger.qb64);
  }

  /** Live accepted-state cache shared by the backing `Baser`. */
  get kevers(): Map<string, Kever> {
    return this.db.kevers;
  }

  /** Locally managed identifier prefixes known to the backing `Baser`. */
  get prefixes(): Set<string> {
    return this.db.prefixes;
  }

  /** Group prefixes known to the backing `Baser`. */
  get groups(): Set<string> {
    return this.db.groups;
  }

  /** Whether the current identifier is transferable. */
  get transferable(): boolean {
    return !NON_TRANSFERABLE_PREFIX_CODES.has(this.prefixer.code);
  }

  /**
   * Return true when the provided prefix is an exclusively locally controlled
   * non-group AID.
   */
  locallyOwned(pre?: string | null): boolean {
    const current = pre ?? this.pre;
    return this.prefixes.has(current) && !this.groups.has(current);
  }

  /** Return true when the provided delegator prefix is locally controlled. */
  locallyDelegated(pre: string | null | undefined): boolean {
    return !!pre && this.prefixes.has(pre);
  }

  /**
   * Return true when the current or derived witness set includes a local AID.
   *
   * This follows the KERIpy intent while keeping the derivation logic explicit
   * and local to the `Kever` instead of requiring callers to rebuild witness
   * set state manually.
   */
  locallyWitnessed(
    opts: { wits?: string[]; serder?: SerderKERI } = {},
  ): boolean {
    let wits = opts.wits;
    if (!wits) {
      if (!opts.serder) {
        wits = this.wits;
      } else {
        if (opts.serder.pre !== this.pre) {
          return false;
        }
        wits = opts.serder.estive ? this.deriveBacks(opts.serder).wits : this.wits;
      }
    }
    return wits.some((wit) => this.prefixes.has(wit));
  }

  /**
   * Reload all live `Kever` state from one persisted `KeyStateRecord`.
   *
   * The corresponding accepted event must already exist in `evts.` because the
   * live kever keeps the full current event serder, not only the record fields.
   */
  reload(state: KeyStateRecord): void {
    if (!state.i || !state.d || !state.s || !state.f || !state.dt || !state.et) {
      throw new ValidationError("Incomplete key-state record for Kever reload.");
    }

    this.version = [
      typeof state.vn?.[0] === "number" ? state.vn[0] : 1,
      typeof state.vn?.[1] === "number" ? state.vn[1] : 0,
    ];
    this.prefixer = new Prefixer({ qb64: state.i });
    this.sner = encodeHugeOrdinal(BigInt(`0x${state.s}`));
    this.fner = encodeHugeOrdinal(BigInt(`0x${state.f}`));
    this.dater = new Dater({ qb64: encodeDateTimeToDater(state.dt) });
    this.ilk = state.et;
    this.tholder = state.kt ? serderThreshold(state.kt) : null;
    this.ntholder = state.nt ? serderThreshold(state.nt) : null;
    this.verfers = (state.k ?? []).map((key) => new Verfer({ qb64: key }));
    this.ndigers = (state.n ?? []).map((dig) => new Diger({ qb64: dig }));
    this.toader = encodeHugeOrdinal(BigInt(`0x${state.bt ?? "0"}`));
    this.wits = [...(state.b ?? [])];
    this.cuts = [...(state.ee?.br ?? [])];
    this.adds = [...(state.ee?.ba ?? [])];
    this.estOnly = (state.c ?? []).includes("EO");
    this.doNotDelegate = (state.c ?? []).includes("DND");
    this.lastEst = {
      s: Number.parseInt(state.ee?.s ?? "0", 16),
      d: state.ee?.d ?? state.d,
    };
    this.delpre = state.di || null;
    this.delegated = !!this.delpre;

    const serder = this.db.getEvtSerder(this.pre, state.d);
    if (!serder) {
      throw new ValidationError(
        `Missing accepted event for reloaded Kever state ${this.pre}:${state.d}.`,
      );
    }
    this.serder = serder;
  }

  /**
   * Verify and apply one first-seen inception or delegated inception event.
   *
   * This is the constructor-time state initializer for accepted KELs.
   */
  incept(serder: SerderKERI): void {
    const pre = serder.pre;
    const said = serder.said;
    const sn = serder.sn;
    if (!pre || !said || sn === null) {
      throw new ValidationError(
        "Inception event must include pre, said, and sn.",
      );
    }
    if (sn !== 0) {
      throw new ValidationError(`Inception event ${said} must have sn=0.`);
    }

    this.prefixer = new Prefixer({ qb64: pre });
    this.serder = serder;
    this.sner = serder.sner ?? encodeHugeOrdinal(0);
    this.ilk = serder.ilk ?? "icp";
    this.verfers = serder.verfers;
    this.tholder = serder.tholder;
    if (this.verfers.length < parseNumericThreshold(this.tholder?.sith, 0)) {
      throw new ValidationError(
        `Invalid inception threshold for ${said}: not enough keys.`,
      );
    }

    if (!this.transferable && serder.ndigs.length > 0) {
      throw new ValidationError(
        `Non-transferable inception ${said} may not include next key digests.`,
      );
    }
    this.ndigers = serder.ndigers;
    this.ntholder = serder.ntholder;
    this.cuts = [];
    this.adds = [];

    if (!hasUniqueEntries(serder.backs)) {
      throw new ValidationError(
        `Inception event ${said} has duplicate witnesses/backers.`,
      );
    }
    if (!this.transferable && serder.backs.length > 0) {
      throw new ValidationError(
        `Non-transferable inception ${said} may not include witnesses.`,
      );
    }

    const toad = serder.bn ?? 0;
    if (serder.backs.length > 0) {
      if (toad < 1 || toad > serder.backs.length) {
        throw new ValidationError(
          `Invalid witness threshold ${toad} for inception ${said}.`,
        );
      }
    } else if (toad !== 0) {
      throw new ValidationError(
        `Invalid witness threshold ${toad} without witnesses for inception ${said}.`,
      );
    }

    this.wits = [...serder.backs];
    this.toader = encodeHugeOrdinal(toad);
    if (!this.transferable && serder.seals.length > 0) {
      throw new ValidationError(
        `Non-transferable inception ${said} may not include seal data.`,
      );
    }

    this.lastEst = { s: 0, d: said };
    this.delpre = serder.delpre;
    this.delegated = !!this.delpre;
  }

  /**
   * Apply configuration traits from one accepted establishment event.
   *
   * Current scope:
   * - `EO` establishment-only
   * - `DND` do-not-delegate
   */
  config(serder: SerderKERI): void {
    const cnfg = serder.traits;
    this.estOnly = cnfg.includes("EO");
    this.doNotDelegate = cnfg.includes("DND");
  }

  /**
   * Update this `Kever` with one accepted non-inceptive event.
   *
   * Current scope:
   * - `rot`
   * - `drt`
   * - `ixn`
   *
   * Deferred parity:
   * - full delegation/witness/escrow breadth remains later work on this seam
   */
  update(init: Omit<KeverEventInit, "db" | "cues">): void {
    const { serder } = init;
    if (!this.transferable) {
      throw new ValidationError(
        `Unexpected event ${serder.ilk ?? "<unknown>"} for non-transferable AID ${this.pre}.`,
      );
    }
    if (serder.pre !== this.pre) {
      throw new ValidationError(
        `Event prefix ${String(serder.pre)} does not match Kever ${this.pre}.`,
      );
    }

    const ilk = serder.ilk;
    const sn = serder.sn;
    if (!ilk || sn === null) {
      throw new ValidationError("Event update requires ilk and sn.");
    }

    switch (ilk) {
      case "rot":
      case "drt": {
        if (this.delegated && ilk !== "drt") {
          throw new ValidationError(
            `Delegated AID ${this.pre} requires drt, not rot.`,
          );
        }
        if (!this.delegated && ilk === "drt") {
          throw new ValidationError(
            `Non-delegated AID ${this.pre} may not accept drt.`,
          );
        }
        if (sn !== this.sn + 1) {
          throw new ValidationError(
            `Rotation for ${this.pre} must advance from sn=${this.sn} to ${this.sn + 1}.`,
          );
        }
        if (serder.prior !== this.said) {
          throw new ValidationError(
            `Rotation prior ${String(serder.prior)} does not match current SAID ${this.said}.`,
          );
        }

        const tholder = serder.tholder;
        const ntholder = serder.ntholder;
        if (serder.verfers.length < parseNumericThreshold(tholder?.sith, 0)) {
          throw new ValidationError(
            `Rotation ${serder.said ?? "<unknown>"} does not carry enough current keys.`,
          );
        }

        const { wits, cuts, adds, toader } = this.deriveBacks(serder);
        const verified = this.validateSignatures(
          serder.raw,
          init.sigers,
          serder.verfers,
          tholder,
          serder.said ?? "<unknown>",
        );
        const { fn, dater } = this.logEvent({
          serder,
          sigers: verified,
          wigers: init.wigers ?? [],
          wits,
          first: !init.check,
          frc: init.frcs?.[0] ?? null,
          sourceSeal: this.normalizeSourceSeal(init.sscs, init.ssts),
          local: init.local ?? false,
        });

        this.sner = serder.sner ?? encodeHugeOrdinal(sn);
        this.serder = serder;
        this.ilk = ilk;
        this.tholder = tholder;
        this.verfers = serder.verfers;
        this.ndigers = serder.ndigers;
        this.ntholder = ntholder;
        this.toader = encodeHugeOrdinal(toader);
        this.wits = wits;
        this.cuts = cuts;
        this.adds = adds;
        this.lastEst = { s: sn, d: serder.said ?? "" };
        if (fn !== null) {
          this.fner = encodeHugeOrdinal(fn);
          this.dater = dater;
          this.db.pinState(this.pre, this.state());
        }
        return;
      }
      case "ixn": {
        if (this.estOnly) {
          throw new ValidationError(
            `Unexpected ixn for establishment-only AID ${this.pre}.`,
          );
        }
        if (sn !== this.sn + 1) {
          throw new ValidationError(
            `Interaction for ${this.pre} must advance from sn=${this.sn} to ${this.sn + 1}.`,
          );
        }
        if (serder.prior !== this.said) {
          throw new ValidationError(
            `Interaction prior ${String(serder.prior)} does not match current SAID ${this.said}.`,
          );
        }

        const verified = this.validateSignatures(
          serder.raw,
          init.sigers,
          this.verfers,
          this.tholder,
          serder.said ?? "<unknown>",
        );
        const { fn, dater } = this.logEvent({
          serder,
          sigers: verified,
          wigers: init.wigers ?? [],
          first: !init.check,
          frc: init.frcs?.[0] ?? null,
          local: init.local ?? false,
        });

        this.sner = serder.sner ?? encodeHugeOrdinal(sn);
        this.serder = serder;
        this.ilk = ilk;
        if (fn !== null) {
          this.fner = encodeHugeOrdinal(fn);
          this.dater = dater;
          this.db.pinState(this.pre, this.state());
        }
        return;
      }
      default:
        throw new ValidationError(
          `Unsupported Kever update ilk=${String(ilk)} for ${this.pre}.`,
        );
    }
  }

  /**
   * Idempotently log one verified accepted event into the durable KEL surface.
   *
   * This is the shared logging seam used by fresh acceptance, late signatures,
   * and future replay/recovery flows.
   */
  logEvent(args: {
    serder: SerderKERI;
    sigers?: readonly Siger[];
    wigers?: readonly Siger[];
    wits?: readonly string[];
    first?: boolean;
    frc?: FirstSeenReplayCouple | null;
    sourceSeal?: SourceSealCouple | SourceSealTriple | null;
    local?: boolean;
  }): { fn: number | null; dater: Dater } {
    const local = args.local ?? false;
    const pre = args.serder.pre;
    const said = args.serder.said;
    const sn = args.serder.sn;
    if (!pre || !said || sn === null) {
      throw new ValidationError("logEvent requires pre, said, and sn.");
    }

    const first = args.first ?? false;
    const replayDater = args.frc?.dater ?? null;
    const nowIso8601 = replayDater?.iso8601 ?? makeNowIso8601();
    const nowDater = replayDater ?? new Dater({ qb64: encodeDateTimeToDater(nowIso8601) });

    this.db.dtss.put([pre, said], nowDater);
    if (args.sigers && args.sigers.length > 0) {
      this.db.sigs.put([pre, said], [...args.sigers]);
    }
    if (args.wigers && args.wigers.length > 0) {
      this.db.wigs.put([pre, said], [...args.wigers]);
    }
    if (args.wits && args.wits.length > 0) {
      this.db.wits.put(
        [pre, said],
        args.wits.map((wit) => new Prefixer({ qb64: wit })),
      );
    }

    this.db.evts.put([pre, said], args.serder);

    if (args.sourceSeal && this.delegated && args.serder.ilk !== "ixn") {
      this.db.aess.pin([pre, said], [
        normalizeOrdinal(args.sourceSeal.seqner),
        args.sourceSeal.diger,
      ]);
    }

    const existingEsr = this.db.esrs.get([pre, said]);
    if (existingEsr) {
      if (local && !existingEsr.local) {
        existingEsr.local = true;
        this.db.esrs.pin([pre, said], existingEsr);
      }
    } else {
      this.db.esrs.put([pre, said], { local });
    }

    let fn: number | null = null;
    if (first) {
      fn = this.db.appendFel(pre, said);
      if (args.frc && fn !== Number(args.frc.firner.num)) {
        this.cues.push({
          kin: "noticeBadCloneFN",
          serder: args.serder,
          fn,
          firner: args.frc.firner,
          dater: args.frc.dater,
        });
      }
      this.db.dtss.pin([pre, said], nowDater);
      this.db.fons.pin([pre, said], encodeHugeOrdinal(fn));
    }

    this.db.putKel(pre, sn, said);
    return { fn, dater: nowDater };
  }

  /** Serialize the current accepted state into durable `states.` form. */
  state(): KeyStateRecord {
    return {
      vn: [...this.version],
      i: this.pre,
      s: this.sn.toString(16),
      p: this.serder.prior ?? "",
      d: this.said,
      f: this.fn.toString(16),
      dt: this.dater.iso8601,
      et: this.ilk,
      kt: this.tholder?.sith ?? "0",
      k: this.verfers.map((verfer) => verfer.qb64),
      nt: this.ntholder?.sith ?? "0",
      n: this.ndigs,
      bt: Number(this.toader.num).toString(16),
      b: [...this.wits],
      c: [
        ...(this.estOnly ? ["EO"] : []),
        ...(this.doNotDelegate ? ["DND"] : []),
      ],
      ee: {
        s: this.lastEst.s.toString(16),
        d: this.lastEst.d,
        br: [...this.cuts],
        ba: [...this.adds],
      },
      di: this.delpre ?? "",
    };
  }

  /**
   * Verify indexed signatures against one key set and return the verified list.
   *
   * Current scope:
   * - threshold satisfaction is numeric-only
   * - duplicate signature indices are ignored after the first verified signer
   */
  private validateSignatures(
    raw: Uint8Array,
    sigers: readonly Siger[],
    verfers: readonly Verfer[],
    tholder: Tholder | null,
    said: string,
  ): Siger[] {
    const threshold = parseNumericThreshold(tholder?.sith, verfers.length);
    const verified = new Map<number, Siger>();

    for (const siger of sigers) {
      const verfer = verfers[siger.index];
      if (!verfer || verified.has(siger.index)) {
        continue;
      }
      if (!ed25519.verify(siger.raw, raw, verfer.raw)) {
        continue;
      }
      verified.set(siger.index, siger);
    }

    if (verified.size < threshold) {
      throw new ValidationError(
        `Event ${said} does not satisfy signature threshold ${threshold}.`,
      );
    }

    return [...verified.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, siger]) => siger);
  }

  /**
   * Derive the post-establishment witness set for one inception/rotation event.
   *
   * This is the small TS-native equivalent of KERIpy's witness-derivation
   * logic used by establishment validation and local witness queries.
   */
  private deriveBacks(
    serder: SerderKERI,
  ): { wits: string[]; cuts: string[]; adds: string[]; toader: number } {
    if (serder.ilk === "icp" || serder.ilk === "dip") {
      return {
        wits: [...serder.backs],
        cuts: [],
        adds: [],
        toader: serder.bn ?? 0,
      };
    }

    const cuts = [...serder.cuts];
    const adds = [...serder.adds];
    if (!hasUniqueEntries(cuts) || !hasUniqueEntries(adds)) {
      throw new ValidationError(
        `Rotation ${serder.said ?? "<unknown>"} has duplicate witness cuts/adds.`,
      );
    }
    if (cuts.some((wit) => adds.includes(wit))) {
      throw new ValidationError(
        `Rotation ${serder.said ?? "<unknown>"} has overlapping witness cuts/adds.`,
      );
    }

    const next = this.wits.filter((wit) => !cuts.includes(wit));
    for (const add of adds) {
      next.push(add);
    }
    if (!hasUniqueEntries(next)) {
      throw new ValidationError(
        `Rotation ${serder.said ?? "<unknown>"} produces duplicate witnesses.`,
      );
    }

    const toader = serder.bn ?? 0;
    if (next.length > 0) {
      if (toader < 1 || toader > next.length) {
        throw new ValidationError(
          `Invalid witness threshold ${toader} for rotation ${serder.said ?? "<unknown>"}.`,
        );
      }
    } else if (toader !== 0) {
      throw new ValidationError(
        `Invalid witness threshold ${toader} without witnesses for rotation ${serder.said ?? "<unknown>"}.`,
      );
    }

    return { wits: next, cuts, adds, toader };
  }

  /** Normalize the first available delegated/source-seal attachment if any. */
  private normalizeSourceSeal(
    sscs?: readonly SourceSealCouple[],
    ssts?: readonly SourceSealTriple[],
  ): SourceSealCouple | SourceSealTriple | null {
    return ssts?.[0] ?? sscs?.[0] ?? null;
  }
}

/** Rehydrate one threshold primitive directly from a hex threshold expression. */
function serderThreshold(sith: string): Tholder {
  const value = BigInt(`0x${sith || "0"}`);
  const raw = value === 0n ? new Uint8Array([0]) : (() => {
    const bytes: number[] = [];
    let current = value;
    while (current > 0n) {
      bytes.push(Number(current & 0xffn));
      current >>= 8n;
    }
    bytes.reverse();
    return new Uint8Array(bytes);
  })();
  const entry = THOLDER_NUMERIC_CAPACITIES.find(({ rawSize }) =>
    raw.length <= rawSize
  );
  if (!entry) {
    throw new ValidationError(`Unsupported numeric threshold width for sith=${sith}.`);
  }
  const padded = new Uint8Array(entry.rawSize);
  padded.set(raw, entry.rawSize - raw.length);
  return new Tholder({ code: entry.code, raw: padded });
}
