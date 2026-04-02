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
import type { Baser } from "../db/basing.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../time/mod.ts";
import type { AgentCue } from "./cues.ts";
import { Deck } from "./deck.ts";
import {
  DispatchOrdinal,
  FirstSeenReplayCouple,
  SourceSealCouple,
  SourceSealTriple,
} from "./dispatch.ts";
import { ValidationError } from "./errors.ts";
import type {
  AttachmentEscrow,
  AttachmentDecision,
  AttachmentReject,
  EscrowKind,
  KeverDecision,
  KeverEscrow,
  KeverReject,
  KELEventState,
  KeverTransition,
  RejectKind,
} from "./kever-decisions.ts";
import type { KeyStateRecord } from "./records.ts";

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

/** Return true when threshold material exists and the key list is large enough. */
function hasValidThresholdMaterial(
  tholder: Tholder | null,
  count: number,
): boolean {
  return tholder !== null && count >= tholder.size;
}

/** Render one threshold expression for diagnostics without losing structure. */
function formatThreshold(tholder: Tholder | null): string {
  if (!tholder) {
    return "null";
  }
  return typeof tholder.sith === "string"
    ? tholder.sith
    : JSON.stringify(tholder.sith);
}

/** Convert one dispatch ordinal into the Huge-number family used in DB tuples. */
function normalizeOrdinal(ordinal: DispatchOrdinal): NumberPrimitive {
  return ordinal instanceof NumberPrimitive
    ? ordinal
    : encodeHugeOrdinal(ordinal.sn);
}

/** Project one dispatch ordinal into its numeric value. */
function ordinalNumber(ordinal: DispatchOrdinal): number {
  return Number(ordinal instanceof NumberPrimitive ? ordinal.num : ordinal.sn);
}

/** Project one dispatch ordinal into its hex-text representation. */
function ordinalHex(ordinal: DispatchOrdinal): string {
  return ordinal instanceof NumberPrimitive ? ordinal.numh : ordinal.snh;
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

/** Small latest-establishment pointer carried in a live `Kever`. */
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

/** Evaluate or accept one normalized KEL event against a `Kever`. */
export interface KeverEventInit extends KeverBaseInit {
  serder: SerderKERI;
  sigers: readonly Siger[];
  wigers?: readonly Siger[];
  frcs?: readonly FirstSeenReplayCouple[];
  sscs?: readonly SourceSealCouple[];
  ssts?: readonly SourceSealTriple[];
  eager?: boolean;
}

interface SignerVerificationResult {
  sigers: Siger[];
  indices: number[];
}

interface DerivedBacksResult {
  wits: string[];
  cuts: string[];
  adds: string[];
  toader: NumberPrimitive;
}

interface AttachmentValidationInput {
  serder: SerderKERI;
  sigers: readonly Siger[];
  wigers: readonly Siger[];
  verfers: readonly Verfer[];
  tholder: Tholder | null;
  wits: readonly string[];
  toader: NumberPrimitive;
  delpre?: string | null;
  sourceSeal?: SourceSealCouple | SourceSealTriple | null;
  local: boolean;
  eager?: boolean;
  check?: boolean;
  isEstablishment?: boolean;
}

/**
 * One live current-state machine for an accepted identifier KEL.
 *
 * KERIpy correspondence:
 * - this is the `keri-ts` port of `keri.core.eventing.Kever`
 *
 * `keri-ts` difference:
 * - normal remote-processing outcomes are returned through typed decisions
 *   instead of using exceptions as regular control flow
 * - exceptions remain for invariant failures, corrupt durable state, and misuse
 *   of accepted-state-only helpers
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

  /**
   * Bind the live dependency context shared by all `Kever` hydration modes.
   *
   * Hydration itself stays in explicit factory methods so durable-state reload
   * and accepted-transition materialization do not have to fight over one
   * constructor policy.
   */
  private constructor(db: Baser, cues?: Deck<AgentCue>) {
    this.db = db;
    this.cues = cues ?? new Deck();
  }

  /** Rebuild one live `Kever` from durable key-state content. */
  static fromState(init: KeverStateInit): Kever {
    const kever = new Kever(init.db, init.cues);
    kever.reload(init.state);
    return kever;
  }

  /**
   * Materialize one live `Kever` from an already accepted transition.
   *
   * This constructor bypasses durable-event reload because `applyDecision()`
   * may need a working `Kever` instance before the event state has been persisted.
   */
  static fromTransition(
    transition: KeverTransition,
    { db, cues }: { db: Baser; cues?: Deck<AgentCue> },
  ): Kever {
    const kever = new Kever(db, cues);
    kever.loadState(transition.state, transition.log.serder);
    return kever;
  }

  /** Apply one previously accepted transition onto this live kever. */
  applyTransition(transition: KeverTransition): void {
    this.loadState(transition.state, transition.log.serder);
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
   * Return true when this kever represents a locally membered group AID.
   *
   * Current `keri-ts` scope:
   * - mirrors the KERIpy concept but currently relies on `db.groups`
   * - richer per-member provenance is later multisig work
   */
  locallyMembered(): boolean {
    return this.groups.has(this.pre);
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
        const derived = this.deriveBacksDecision(opts.serder);
        if (!derived) {
          return false;
        }
        wits = derived.wits;
      }
    }
    return wits.some((wit) => this.prefixes.has(wit));
  }

  /**
   * Evaluate one first-seen inception or delegated inception without mutating DB.
   */
  static evaluateInception(init: KeverEventInit): KeverDecision {
    const { serder } = init;
    const pre = serder.pre;
    const said = serder.said;
    const sn = serder.sn;
    const verification = Kever.verifyIncept(init);
    if (verification) {
      return verification;
    }
    // all event verification checks passed so create initial key state and continue on to
    // threshold and attachment verification
    const verifiedPre = pre!;
    const verifiedSaid = said!;
    const verifiedSn = sn!;

    const toader = serder.bner ?? numberPrimitiveFromBigInt(0n);
    const provisionalWits = [...serder.backs];
    const provisionalDelpre = serder.delpre;
    const provisionalSourceSeal = (init.ssts?.[0] ?? init.sscs?.[0]) ?? null;
    const frc = init.frcs?.[0] ?? null;
    const provisionalState = Kever.initialKeyState({
      serder,
      pre: verifiedPre,
      said: verifiedSaid,
      toader,
      frc,
    });
    const eventState: KELEventState = {
      serder,
      sigers: [],
      wigers: [],
      wits: provisionalWits,
      first: !init.check,
      frc,
      sourceSeal: provisionalSourceSeal,
      local: init.local ?? false,
    };
    const icpTransition: KeverTransition = {
      mode: "create",
      acceptKind: "inception",
      pre: verifiedPre,
      said: verifiedSaid,
      sn: verifiedSn,
      state: provisionalState,
      log: eventState,
    };
    const runtime = { db: init.db, cues: init.cues };

    // Create new Kever to be stored
    const scratch = Kever.fromTransition(icpTransition, runtime);

    // Like KERIpy's valSigsWigsDel and validateDelegation
    const attachments = Kever.validateAttachments({
      kever: scratch,
      serder,
      sigers: init.sigers,
      wigers: init.wigers ?? [],
      verfers: serder.verfers,
      tholder: serder.tholder,
      wits: provisionalWits,
      toader,
      delpre: provisionalDelpre,
      sourceSeal: provisionalSourceSeal,
      local: init.local ?? false,
      eager: init.eager,
      check: init.check,
      isEstablishment: true,
    });
    if (attachments.kind !== "verified") {
      return Kever.fromAttachmentDecision(attachments);
    }

    return {
      kind: "accept",
      transition: {
        mode: "create",
        acceptKind: "inception",
        pre: verifiedPre,
        said: verifiedSaid,
        sn: verifiedSn,
        state: provisionalState,
        log: {
          serder,
          sigers: attachments.attachments.sigers,
          wigers: attachments.attachments.wigers,
          wits: attachments.attachments.wits,
          first: !init.check,
          frc,
          sourceSeal: attachments.attachments.sourceSeal ?? provisionalSourceSeal,
          local: init.local ?? false,
        },
      },
      cues: attachments.attachments.cues,
    };
  }

  /** Evaluate one non-inceptive event against the current accepted state. */
  evaluateUpdate(init: KeverEventInit): KeverDecision {
    const { serder } = init;
    const ilk = serder.ilk;
    const sn = serder.sn;
    const local = init.local ?? false;

    if (!this.transferable) {
      return Kever.reject(
        "nontransferableViolation",
        `Unexpected event ${String(ilk)} for non-transferable AID ${this.pre}.`,
      );
    }
    if (serder.pre !== this.pre) {
      return Kever.reject(
        "invalidPre",
        `Event prefix ${String(serder.pre)} does not match Kever ${this.pre}.`,
      );
    }
    if (!ilk) {
      return Kever.reject("invalidIlk", "Event update requires ilk.");
    }
    if (sn === null) {
      return Kever.reject("invalidSn", "Event update requires sn.");
    }

    switch (ilk) {
      case "rot":
      case "drt":
        return this.evaluateRotation(init, local);
      case "ixn":
        return this.evaluateInteraction(init, local);
      default:
        return Kever.reject(
          "unsupported",
          `Unsupported Kever update ilk=${String(ilk)} for ${this.pre}.`,
        );
    }
  }

  /**
   * Validate signatures, witnesses, misfit rules, and delegation as a typed
   * attachment decision.
   */
  static validateAttachments(
    input: AttachmentValidationInput & { kever: Kever },
  ): AttachmentDecision {
    return input.kever.validateAttachmentsInternal(input);
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
    const serder = this.db.getEvtSerder(state.i, state.d);
    if (!serder) {
      throw new ValidationError(
        `Missing accepted event for reloaded Kever state ${state.i}:${state.d}.`,
      );
    }
    this.loadState(state, serder);
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
      bt: this.toader.numh,
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
   * Idempotently log one verified accepted event into the durable KEL surface.
   *
   * This is the shared logging seam used by fresh acceptance, late signatures,
   * and future replay/recovery flows.
   */
  logEvent(args: KELEventState): { fn: number | null; dater: Dater } {
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

  /**
   * Return the exposed prior-next digest indices satisfied by `sigers`.
   *
   * This is the TypeScript port of KERIpy `Kever.exposeds`.
   */
  exposeds(sigers: readonly Siger[]): number[] {
    const indices: number[] = [];
    for (const siger of sigers) {
      if (typeof siger.ondex !== "number") {
        continue;
      }
      const diger = this.ndigers[siger.ondex];
      if (!diger || !siger.verfer) {
        continue;
      }
      if (Diger.compare(siger.verfer.qb64b, diger.code, diger.raw)) {
        indices.push(siger.ondex);
      }
    }
    return indices;
  }

  /**
   * Return indices contributed by keys also present in a locally controlled KEL.
   *
   * Current `keri-ts` scope:
   * - approximates KERIpy's locally membered signature filtering by comparing
   *   verfer qb64 values across locally accepted kevers
   */
  locallyContributedIndices(verfers: readonly Verfer[]): number[] {
    const localKeys = new Set<string>();
    for (const pre of this.prefixes) {
      const kever = this.db.getKever(pre);
      if (!kever) {
        continue;
      }
      for (const verfer of kever.verfers) {
        localKeys.add(verfer.qb64);
      }
    }
    const indices: number[] = [];
    for (const [index, verfer] of verfers.entries()) {
      if (localKeys.has(verfer.qb64)) {
        indices.push(index);
      }
    }
    return indices;
  }

  /**
   * Fetch the delegating event that anchors the supplied delegated event.
   *
   * Current `keri-ts` scope:
   * - validates explicit source seals first
   * - optionally performs an eager linear KEL walk when no usable seal is
   *   attached and `eager` is enabled
   * - recursive superseding-delegation parity remains later work
   */
  fetchDelegatingEvent(
    delpre: string,
    serder: SerderKERI,
    {
      sourceSeal,
      eager = false,
    }: {
      sourceSeal?: SourceSealCouple | SourceSealTriple | null;
      eager?: boolean;
    } = {},
  ): SerderKERI | null {
    const eventMatches = (candidate: SerderKERI | null): candidate is SerderKERI =>
      !!candidate && this.eventAnchorsSeal(candidate, serder);

    if (sourceSeal) {
      const bySaid = this.db.getEvtSerder(delpre, sourceSeal.diger.qb64);
      if (eventMatches(bySaid)) {
        return bySaid;
      }
      const bySn = this.db.getKel(delpre, ordinalNumber(sourceSeal.seqner));
      if (bySn) {
        const event = this.db.getEvtSerder(delpre, bySn);
        if (eventMatches(event)) {
          return event;
        }
      }
    }

    if (!eager) {
      return null;
    }

    for (const [, said] of this.db.getKelItemIter(delpre)) {
      const candidate = this.db.getEvtSerder(delpre, said);
      if (eventMatches(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Load one state record and its corresponding serder into the live kever.
   *
   * This is used by both durable reload and accepted-transition application.
   */
  private loadState(state: KeyStateRecord, serder: SerderKERI): void {
    if (!state.i || !state.d || !state.s || !state.f || !state.dt || !state.et) {
      throw new ValidationError("Incomplete key-state record for Kever load.");
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
    this.tholder = state.kt !== undefined ? new Tholder({ sith: state.kt }) : null;
    this.ntholder = state.nt !== undefined ? new Tholder({ sith: state.nt }) : null;
    this.verfers = (state.k ?? []).map((key) => new Verfer({ qb64: key }));
    this.ndigers = (state.n ?? []).map((dig) => new Diger({ qb64: dig }));
    this.toader = numberPrimitiveFromHex(state.bt ?? "0");
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
    this.serder = serder;
  }

  /** Evaluate one non-mutating rotation or delegated rotation transition. */
  private evaluateRotation(init: KeverEventInit, local: boolean): KeverDecision {
    const { serder } = init;
    const ilk = serder.ilk ?? "rot";
    const sn = serder.sn ?? -1;

    if (this.delegated && ilk !== "drt") {
      return Kever.reject(
        "invalidDelegation",
        `Delegated AID ${this.pre} requires drt, not rot.`,
      );
    }
    if (!this.delegated && ilk === "drt") {
      return Kever.reject(
        "invalidDelegation",
        `Non-delegated AID ${this.pre} may not accept drt.`,
      );
    }
    if (sn > this.sn + 1) {
      return this.makeEscrowDecision(
        "ooo",
        init,
        `Rotation for ${this.pre} arrived out of order at sn=${sn}.`,
      );
    }
    if (sn <= this.sn) {
      if ((ilk === "rot" && sn <= this.lastEst.s) || (ilk === "drt" && sn < this.lastEst.s)) {
        return Kever.reject(
          "stale",
          `Stale ${ilk} event sn=${sn} for ${this.pre}.`,
        );
      }
      if (ilk === "rot" && this.ilk !== "ixn") {
        return Kever.reject(
          "invalidRecovery",
          `Recovery rotation for ${this.pre} may only supersede an ixn state.`,
        );
      }

      const psn = sn - 1;
      const pdig = this.db.getKel(this.pre, psn);
      if (!pdig) {
        return Kever.reject(
          "invalidRecovery",
          `Recovery rotation for ${this.pre} is missing prior event at sn=${psn}.`,
        );
      }
      const pserder = this.db.getEvtSerder(this.pre, pdig);
      if (!pserder || !pserder.compare(serder.prior ?? "")) {
        return Kever.reject(
          "invalidRecovery",
          `Recovery rotation prior ${String(serder.prior)} does not match stored state for ${this.pre}.`,
        );
      }
    } else if (serder.prior !== this.said) {
      return Kever.reject(
        "invalidPriorDigest",
        `Rotation prior ${String(serder.prior)} does not match current SAID ${this.said}.`,
      );
    }

    const tholder = serder.tholder;
    const ntholder = serder.ntholder;
    if (!hasValidThresholdMaterial(tholder, serder.verfers.length)) {
      return Kever.reject(
        "invalidThreshold",
        `Rotation ${serder.said ?? "<unknown>"} does not carry enough current keys.`,
      );
    }

    const derived = this.deriveBacksDecision(serder);
    if (!derived) {
      return Kever.reject(
        "invalidWitnessSet",
        `Rotation ${serder.said ?? "<unknown>"} carries invalid witness cuts/adds.`,
      );
    }

    const attachments = this.validateAttachmentsInternal({
      serder,
      sigers: init.sigers,
      wigers: init.wigers ?? [],
      verfers: serder.verfers,
      tholder,
      wits: derived.wits,
      toader: derived.toader,
      delpre: this.delpre,
      sourceSeal: this.normalizeSourceSeal(init.sscs, init.ssts),
      local,
      eager: init.eager,
      check: init.check,
      isEstablishment: true,
    });
    if (attachments.kind !== "verified") {
      return Kever.fromAttachmentDecision(attachments);
    }

    const state: KeyStateRecord = {
      vn: [...this.version],
      i: this.pre,
      s: sn.toString(16),
      p: serder.prior ?? "",
      d: serder.said ?? "",
      f: this.fn.toString(16),
      dt: this.dater.iso8601,
      et: ilk,
      kt: tholder?.sith ?? "0",
      k: serder.verfers.map((verfer) => verfer.qb64),
      nt: ntholder?.sith ?? "0",
      n: serder.ndigers.map((diger) => diger.qb64),
      bt: derived.toader.numh,
      b: [...derived.wits],
      c: [
        ...(serder.traits.includes("EO") ? ["EO"] : []),
        ...(serder.traits.includes("DND") ? ["DND"] : []),
      ],
      ee: {
        s: sn.toString(16),
        d: serder.said ?? "",
        br: [...derived.cuts],
        ba: [...derived.adds],
      },
      di: this.delpre ?? "",
    };

    return {
      kind: "accept",
      transition: {
        mode: "update",
        acceptKind: sn <= this.sn ? "recovery" : "update",
        pre: this.pre,
        said: serder.said ?? "",
        sn,
        state,
        log: {
          serder,
          sigers: attachments.attachments.sigers,
          wigers: attachments.attachments.wigers,
          wits: attachments.attachments.wits,
          first: !init.check,
          frc: init.frcs?.[0] ?? null,
          sourceSeal: attachments.attachments.sourceSeal,
          local,
        },
      },
      cues: attachments.attachments.cues,
    };
  }

  /** Evaluate one non-mutating interaction transition. */
  private evaluateInteraction(init: KeverEventInit, local: boolean): KeverDecision {
    const { serder } = init;
    const sn = serder.sn ?? -1;

    if (this.estOnly) {
      return Kever.reject(
        "estOnlyViolation",
        `Unexpected ixn for establishment-only AID ${this.pre}.`,
      );
    }
    if (sn > this.sn + 1) {
      return this.makeEscrowDecision(
        "ooo",
        init,
        `Interaction for ${this.pre} arrived out of order at sn=${sn}.`,
      );
    }
    if (sn <= this.sn) {
      return Kever.reject(
        "stale",
        `Stale ixn event sn=${sn} for ${this.pre}.`,
      );
    }
    if (serder.prior !== this.said) {
      return Kever.reject(
        "invalidPriorDigest",
        `Interaction prior ${String(serder.prior)} does not match current SAID ${this.said}.`,
      );
    }

    const attachments = this.validateAttachmentsInternal({
      serder,
      sigers: init.sigers,
      wigers: init.wigers ?? [],
      verfers: this.verfers,
      tholder: this.tholder,
      wits: this.wits,
      toader: this.toader,
      delpre: null,
      sourceSeal: null,
      local,
      eager: init.eager,
      check: init.check,
    });
    if (attachments.kind !== "verified") {
      return Kever.fromAttachmentDecision(attachments);
    }

    return {
      kind: "accept",
      transition: {
        mode: "update",
        acceptKind: "update",
        pre: this.pre,
        said: serder.said ?? "",
        sn,
        state: {
          vn: [...this.version],
          i: this.pre,
          s: sn.toString(16),
          p: serder.prior ?? "",
          d: serder.said ?? "",
          f: this.fn.toString(16),
          dt: this.dater.iso8601,
          et: "ixn",
          kt: this.tholder?.sith ?? "0",
          k: this.verfers.map((verfer) => verfer.qb64),
          nt: this.ntholder?.sith ?? "0",
          n: this.ndigers.map((diger) => diger.qb64),
          bt: this.toader.numh,
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
        },
        log: {
          serder,
          sigers: attachments.attachments.sigers,
          wigers: attachments.attachments.wigers,
          first: !init.check,
          frc: init.frcs?.[0] ?? null,
          local,
        },
      },
      cues: attachments.attachments.cues,
    };
  }

  /** Validate attachments using explicit decisions instead of exception flow. */
  private validateAttachmentsInternal(
    input: AttachmentValidationInput,
  ): AttachmentDecision {
    const remoteMemberedCues: AgentCue[] = [];
    const verfers = [...input.verfers];
    const sigers = [...input.sigers];
    const wigers = [...input.wigers];
    const tholder = input.tholder;
    const delpre = input.delpre ?? null;
    const pre = this.pre;
    const said = input.serder.said ?? "<unknown>";

    if (!hasValidThresholdMaterial(tholder, verfers.length)) {
      return Kever.rejectAttachment(
        "invalidThreshold",
        `Invalid threshold material for event ${said}.`,
      );
    }

    if (!input.local && this.locallyMembered()) {
      const indices = this.locallyContributedIndices(verfers);
      if (indices.length > 0) {
        for (const siger of [...sigers]) {
          if (indices.includes(siger.index)) {
            const position = sigers.indexOf(siger);
            if (position >= 0) {
              sigers.splice(position, 1);
            }
            remoteMemberedCues.push({
              kin: "remoteMemberedSig",
              serder: input.serder,
              index: siger.index,
            });
          }
        }
      }
    }

    const verified = Kever.verifyIndexedSignatures(input.serder.raw, sigers, verfers);
    if (verified.sigers.length === 0) {
      return Kever.rejectAttachment(
        "invalidThreshold",
        `No verified signatures for event ${said}.`,
      );
    }

    if (
      !input.local &&
      (this.locallyOwned() || this.locallyWitnessed({ wits: [...input.wits] }) ||
        this.locallyDelegated(delpre))
    ) {
      return this.makeAttachmentEscrowDecision(
        "misfit",
        input,
        `Nonlocal source for locally protected event ${said}.`,
        remoteMemberedCues,
      );
    }

    if (!tholder || !tholder.satisfy(verified.indices)) {
      return this.makeAttachmentEscrowDecision(
        "partialSigs",
        input,
        `Event ${said} does not yet satisfy controller threshold ${formatThreshold(tholder)}.`,
        remoteMemberedCues,
      );
    }

    if (
      input.isEstablishment &&
      this.ntholder &&
      (input.serder.ilk === "rot" || input.serder.ilk === "drt")
    ) {
      const ondices = this.exposeds(verified.sigers);
      if (!this.ntholder.satisfy(ondices)) {
        return this.makeAttachmentEscrowDecision(
          "partialSigs",
          input,
          `Event ${said} does not yet satisfy prior-next threshold ${formatThreshold(this.ntholder)}.`,
          remoteMemberedCues,
        );
      }
    }

    const werfers = [...input.wits].map((wit) => new Verfer({ qb64: wit }));
    const verifiedWigs = Kever.verifyIndexedSignatures(
      input.serder.raw,
      wigers,
      werfers,
    ).sigers;

    if (input.wits.length === 0) {
      if (input.toader.num !== 0n) {
        return Kever.rejectAttachment(
          "invalidWitnessThreshold",
          `Invalid witness threshold ${input.toader.num} without witnesses for ${said}.`,
        );
      }
    } else if (!(this.locallyOwned() || this.locallyMembered() || this.locallyWitnessed({ wits: [...input.wits] }))) {
      if (input.toader.num < 1n || input.toader.num > BigInt(input.wits.length)) {
        return Kever.rejectAttachment(
          "invalidWitnessThreshold",
          `Invalid witness threshold ${input.toader.num} for event ${said}.`,
        );
      }

      if (BigInt(verifiedWigs.length) < input.toader.num) {
        return this.makeAttachmentEscrowDecision(
          "partialWigs",
          input,
          `Event ${said} does not yet satisfy witness threshold ${input.toader.num}.`,
          [
            ...remoteMemberedCues,
            {
              kin: "query",
              q: {
                pre: input.serder.pre ?? undefined,
                sn: input.serder.snh ?? undefined,
              },
              pre: input.serder.pre ?? undefined,
            },
          ],
        );
      }
    }

    const delegation = this.validateDelegation({
      ...input,
      delpre,
      sourceSeal: input.sourceSeal ?? null,
    });
    if (delegation.kind !== "verified") {
      if (remoteMemberedCues.length > 0 && delegation.kind === "escrow") {
        delegation.cues = [...(delegation.cues ?? []), ...remoteMemberedCues];
      }
      return delegation;
    }

    return {
      kind: "verified",
      attachments: {
        sigers: verified.sigers,
        wigers: verifiedWigs,
        wits: [...input.wits],
        delpre,
        sourceSeal: delegation.attachments.sourceSeal ?? input.sourceSeal ?? null,
        cues: [...remoteMemberedCues, ...(delegation.attachments.cues ?? [])],
      },
    };
  }

  /** Validate delegation or produce typed delegation-related escrow/reject results. */
  private validateDelegation(
    input: AttachmentValidationInput & {
      delpre: string | null;
      sourceSeal: SourceSealCouple | SourceSealTriple | null;
    },
  ): AttachmentDecision {
    const delpre = input.delpre;
    if (!delpre) {
      return {
        kind: "verified",
        attachments: {
          sigers: [],
          wigers: [],
          wits: [...input.wits],
          delpre: null,
          sourceSeal: null,
        },
      };
    }

    if (
      this.locallyOwned() ||
      this.locallyMembered() ||
      this.locallyWitnessed({ wits: [...input.wits] })
    ) {
      return {
        kind: "verified",
        attachments: {
          sigers: [],
          wigers: [],
          wits: [...input.wits],
          delpre,
          sourceSeal: input.sourceSeal,
        },
      };
    }

    const delegator = this.db.getKever(delpre);
    if (!delegator) {
      return this.makeAttachmentEscrowDecision(
        "partialDels",
        input,
        `Missing delegator KEL for ${delpre} while validating ${input.serder.said ?? "<unknown>"}.`,
        [{
          kin: "query",
          q: { pre: delpre ?? undefined },
          pre: delpre ?? undefined,
        }],
      );
    }

    if (delegator.doNotDelegate) {
      return Kever.rejectAttachment(
        "delegationPolicyViolation",
        `Delegator ${delpre} does not allow delegation for ${input.serder.said ?? "<unknown>"}.`,
      );
    }

    if (
      (input.serder.ilk === "dip" || input.serder.ilk === "drt") &&
      this.locallyDelegated(delpre) &&
      !this.locallyOwned() &&
      !input.sourceSeal
    ) {
      return this.makeAttachmentEscrowDecision(
        "delegables",
        input,
        `Missing local delegator approval for delegated event ${input.serder.said ?? "<unknown>"}.`,
      );
    }

    const delegatingEvent = this.fetchDelegatingEvent(delpre, input.serder, {
      sourceSeal: input.sourceSeal,
      eager: input.eager ?? false,
    });
    if (!delegatingEvent) {
      return this.makeAttachmentEscrowDecision(
        "partialDels",
        input,
        `No delegation seal found for ${input.serder.said ?? "<unknown>"}.`,
        [{
          kin: "query",
          q: {
            pre: delpre ?? undefined,
            sn: input.sourceSeal ? ordinalHex(input.sourceSeal.seqner) : undefined,
            dig: input.sourceSeal?.diger.qb64,
          },
          pre: delpre ?? undefined,
        }],
      );
    }

    if (
      input.serder.ilk === "drt" &&
      input.serder.sn !== null &&
      input.serder.sn <= this.sn &&
      !(input.serder.sn === this.sn && this.ilk === "ixn")
    ) {
      return Kever.rejectAttachment(
        "invalidDelegation",
        `Invalid delegated recovery ordering for ${input.serder.said ?? "<unknown>"}.`,
      );
    }

    return {
      kind: "verified",
      attachments: {
        sigers: [],
        wigers: [],
        wits: [...input.wits],
        delpre,
        sourceSeal: input.sourceSeal ??
          new SourceSealCouple(delegatingEvent.sner ?? encodeHugeOrdinal(delegatingEvent.sn ?? 0), new Diger({ qb64: delegatingEvent.said ?? "" })),
      },
    };
  }

  /**
   * Verify one indexed-signature set against a given verifier list.
   *
   * The return value is ordered by signer index and ignores duplicates after the
   * first verified signer for a given index.
   */
  static verifyIndexedSignatures(
    raw: Uint8Array,
    sigers: readonly Siger[],
    verfers: readonly Verfer[],
  ): SignerVerificationResult {
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

    const ordered = [...verified.entries()].sort((a, b) => a[0] - b[0]);
    return {
      sigers: ordered.map(([, siger]) => siger),
      indices: ordered.map(([index]) => index),
    };
  }

  /** Verify inception-specific event semantics before attachment validation. */
  private static verifyIncept(init: KeverEventInit): KeverDecision | null {
    const { serder } = init;
    const pre = serder.pre;
    const said = serder.said;
    const sn = serder.sn;
    const ilk = serder.ilk;

    if (!pre) {
      return Kever.reject(
        "invalidPre",
        `Inception event ${said ?? "<unknown>"} is missing a prefix.`,
      );
    }
    try {
      new Prefixer({ qb64: pre });
    } catch (error) {
      return Kever.reject(
        "invalidPre",
        `Invalid prefix ${pre} for inception ${said ?? "<unknown>"}.`,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    if (!said || sn === null) {
      return Kever.reject(
        "invalidSn",
        "Inception event must include said and sn.",
      );
    }
    if (ilk !== "icp" && ilk !== "dip") {
      return Kever.reject(
        "invalidIlk",
        `Expected icp or dip for inception, got ${String(ilk)}.`,
      );
    }
    if (sn !== 0) {
      return Kever.reject(
        "invalidSn",
        `Inception event ${said} must have sn=0.`,
      );
    }

    const backers = serder.backs.length;
    const nextKeyDigs = serder.ndigs.length;
    const transferable = !NON_TRANSFERABLE_PREFIX_CODES.has(
      new Prefixer({ qb64: pre }).code,
    );
    if (!hasValidThresholdMaterial(serder.tholder, serder.verfers.length)) {
      return Kever.reject(
        "invalidThreshold",
        `Invalid inception threshold for ${said}: not enough keys.`,
      );
    }
    if (!transferable && nextKeyDigs > 0) {
      return Kever.reject(
        "nontransferableViolation",
        `Non-transferable inception ${said} may not include next key digests.`,
      );
    }
    if (!transferable && backers > 0) {
      return Kever.reject(
        "nontransferableViolation",
        `Non-transferable inception ${said} may not include witnesses.`,
      );
    }
    if (!hasUniqueEntries(serder.backs)) {
      return Kever.reject(
        "invalidWitnessSet",
        `Inception event ${said} has duplicate witnesses/backers.`,
      );
    }

    const toader = serder.bner ?? numberPrimitiveFromBigInt(0n);
    if (backers > 0) {
      if (toader.num < 1n || toader.num > BigInt(backers)) {
        return Kever.reject(
          "invalidWitnessThreshold",
          `Invalid witness threshold ${toader.num} for inception ${said} with ${backers} backers.`,
        );
      }
    } else if (toader.num !== 0n) {
      return Kever.reject(
        "invalidWitnessThreshold",
        `Invalid witness threshold ${toader.num} without witnesses for inception ${said}.`,
      );
    }

    if (!transferable && serder.seals.length > 0) {
      return Kever.reject(
        "nontransferableViolation",
        `Non-transferable inception ${said} may not include seal data.`,
      );
    }

    return null;
  }

  /** Build the initial durable key-state projection for one accepted inception. */
  private static initialKeyState(
    {
      serder,
      pre,
      said,
      toader,
      frc,
    }: {
      serder: SerderKERI;
      pre: string;
      said: string;
      toader: NumberPrimitive;
      frc: FirstSeenReplayCouple | null;
    },
  ): KeyStateRecord {
    return {
      vn: [serder.pvrsn.major, serder.pvrsn.minor],
      i: pre,
      s: "0",
      p: "",
      d: said,
      f: frc ? frc.fnh : "0",
      dt: frc?.dater.iso8601 ?? makeNowIso8601(),
      et: serder.ilk ?? "icp",
      kt: serder.tholder?.sith ?? "0",
      k: serder.verfers.map((verfer) => verfer.qb64),
      nt: serder.ntholder?.sith ?? "0",
      n: serder.ndigers.map((diger) => diger.qb64),
      bt: toader.numh,
      b: [...serder.backs],
      c: [
        ...(serder.traits.includes("EO") ? ["EO"] : []),
        ...(serder.traits.includes("DND") ? ["DND"] : []),
      ],
      ee: {
        s: "0",
        d: said,
        br: [],
        ba: [],
      },
      di: serder.delpre ?? "",
    };
  }

  /** Derive the post-establishment witness set for one event or return `null`. */
  private deriveBacksDecision(serder: SerderKERI): DerivedBacksResult | null {
    if (serder.ilk === "icp" || serder.ilk === "dip") {
      return {
        wits: [...serder.backs],
        cuts: [],
        adds: [],
        toader: serder.bner ?? numberPrimitiveFromBigInt(0n),
      };
    }

    const cuts = [...serder.cuts];
    const adds = [...serder.adds];
    if (!hasUniqueEntries(cuts) || !hasUniqueEntries(adds)) {
      return null;
    }
    if (cuts.some((wit) => adds.includes(wit))) {
      return null;
    }

    const next = this.wits.filter((wit) => !cuts.includes(wit));
    for (const add of adds) {
      next.push(add);
    }
    if (!hasUniqueEntries(next)) {
      return null;
    }

    const toader = serder.bner ?? numberPrimitiveFromBigInt(0n);
    if (next.length > 0) {
      if (toader.num < 1n || toader.num > BigInt(next.length)) {
        return null;
      }
    } else if (toader.num !== 0n) {
      return null;
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

  /** Return true when one delegating event contains the seal for the supplied event. */
  private eventAnchorsSeal(candidate: SerderKERI, serder: SerderKERI): boolean {
    for (const seal of candidate.seals) {
      if (
        typeof seal === "object" &&
        seal !== null &&
        "i" in seal &&
        "s" in seal &&
        "d" in seal &&
        seal.i === serder.pre &&
        seal.s === serder.snh &&
        seal.d === serder.said
      ) {
        return true;
      }
    }
    return false;
  }

  /** Build one typed duplicate/escrow decision from an attachment decision. */
  private static fromAttachmentDecision(
    decision: AttachmentDecision,
  ): KeverEscrow | KeverReject {
    if (decision.kind === "reject") {
      return {
        kind: "reject",
        code: decision.code,
        message: decision.message,
        context: decision.context,
      };
    }
    if (decision.kind === "escrow") {
      return {
        kind: "escrow",
        reason: decision.reason,
        message: decision.message,
        instruction: decision.instruction,
        cues: decision.cues,
        context: decision.context,
      };
    }
    return {
      kind: "reject",
      code: "unsupported",
      message: "Unexpected verified attachment decision at event boundary.",
    };
  }

  /** Helper to produce one reject decision. */
  private static reject(
    code: RejectKind,
    message: string,
    context?: Record<string, unknown>,
  ): KeverReject {
    return { kind: "reject", code, message, context };
  }

  /** Helper to produce one reject attachment decision. */
  private static rejectAttachment(
    code: RejectKind,
    message: string,
    context?: Record<string, unknown>,
  ): AttachmentReject {
    return { kind: "reject", code, message, context };
  }

  /** Build one typed escrow decision for event-level routing. */
  private makeEscrowDecision(
    escrow: EscrowKind,
    init: KeverEventInit,
    message: string,
    cues?: readonly AgentCue[],
  ): KeverEscrow {
    const serder = init.serder;
    return {
      kind: "escrow",
      reason: escrow,
      message,
      instruction: {
        escrow,
        pre: serder.pre ?? this.pre,
        said: serder.said ?? "",
        sn: serder.sn ?? -1,
        log: {
          serder,
          sigers: [...init.sigers],
          wigers: [...(init.wigers ?? [])],
          first: false,
          frc: init.frcs?.[0] ?? null,
          sourceSeal: this.normalizeSourceSeal(init.sscs, init.ssts),
          local: init.local ?? false,
        },
      },
      cues,
    };
  }

  /** Build one typed attachment-escrow decision. */
  private makeAttachmentEscrowDecision(
    escrow: EscrowKind,
    input: AttachmentValidationInput,
    message: string,
    cues?: readonly AgentCue[],
  ): AttachmentEscrow {
    return {
      kind: "escrow",
      reason: escrow,
      message,
      instruction: {
        escrow,
        pre: input.serder.pre ?? this.pre,
        said: input.serder.said ?? "",
        sn: input.serder.sn ?? -1,
        log: {
          serder: input.serder,
          sigers: [...input.sigers],
          wigers: [...input.wigers],
          wits: [...input.wits],
          first: false,
          sourceSeal: input.sourceSeal,
          local: input.local,
        },
      },
      cues,
    };
  }
}

/** Rehydrate one numeric primitive directly from a hex threshold expression. */
function numberPrimitiveFromHex(value: string): NumberPrimitive {
  return numberPrimitiveFromBigInt(BigInt(`0x${value || "0"}`));
}

/** Rehydrate one numeric primitive directly from an exact integer value. */
function numberPrimitiveFromBigInt(value: bigint): NumberPrimitive {
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
    throw new ValidationError(`Unsupported numeric threshold width for value=${value.toString(16)}.`);
  }
  const padded = new Uint8Array(entry.rawSize);
  padded.set(raw, entry.rawSize - raw.length);
  return new NumberPrimitive({ code: entry.code, raw: padded });
}
