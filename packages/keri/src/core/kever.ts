import {
  Dater,
  Diger,
  Ilks,
  NumberPrimitive,
  Prefixer,
  SealEvent,
  SealSource,
  SerderKERI,
  Siger,
  Tholder,
  Verfer,
} from "../../../cesr/mod.ts";
import type { Baser } from "../db/basing.ts";
import { dgKey } from "../db/core/keys.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../time/mod.ts";
import type { AgentCue } from "./cues.ts";
import { Deck } from "./deck.ts";
import { DispatchOrdinal, FirstSeenReplayCouple } from "./dispatch.ts";
import { ValidationError } from "./errors.ts";
import type {
  AttachmentDecision,
  AttachmentEscrow,
  AttachmentReject,
  EscrowKind,
  KELEventState,
  KeverDecision,
  KeverEscrow,
  KeverReject,
  KeverTransition,
  RejectKind,
} from "./kever-decisions.ts";
import { KeyStateRecord } from "./records.ts";
import { deriveRotatedWitnessSet } from "./witnesses.ts";

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

type DelegationSourceSeal = SealSource | SealEvent;

function sourceSealOrdinal(seal: DelegationSourceSeal): NumberPrimitive {
  return seal.s;
}

function sourceSealDigest(seal: DelegationSourceSeal): Diger {
  return seal.d;
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
  sscs?: readonly SealSource[];
  ssts?: readonly SealEvent[];
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
  sourceSeal?: DelegationSourceSeal | null;
  local: boolean;
  eager?: boolean;
  check?: boolean;
  isEstablishment?: boolean;
}

interface DelegatingEventLookup {
  serder: SerderKERI;
  sourceSeal: SealSource;
  sealIndex: number;
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
    return this.prefixer.transferable;
  }

  /**
   * Return true when the provided prefix is an exclusively locally controlled
   * non-group AID.
   */
  locallyOwned(pre?: string | null): boolean {
    const current = pre ?? this.pre;
    return this.prefixes.has(current) && !this.groups.has(current);
  }

  /**
   * Return true when the provided delegator prefix is locally controlled.
   *
   * Current `keri-ts` scope:
   * - matches KERIpy's coarse protected-party check
   * - does not yet model stale local group membership deeply enough to prove
   *   that a local member is still a current signer of the delegator group
   */
  locallyDelegated(pre: string | null | undefined): boolean {
    return !!pre && this.prefixes.has(pre);
  }

  /**
   * Return true when this kever represents a locally membered group AID.
   *
   * Current `keri-ts` scope:
   * - mirrors the KERIpy concept but currently relies on `db.groups`
   * - richer per-member provenance is later multisig work
   * - stale-member caveats from KERIpy still apply until group membership is
   *   tracked against current signer state instead of coarse group presence
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
   *
   * This is a protected-party classification helper, not proof that the event
   * already carries sufficient witness receipts.
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
   *
   * This is intentionally a two-phase decision seam:
   * - `verifyIncept()` checks the inception event body itself
   * - once that passes, `Kever` builds provisional accepted state and a scratch
   *   live kever so attachment validation can run against the same state shape
   *   later acceptance will persist
   *
   * This mirrors the substance of KERIpy's `__init__` + `incept()` +
   * `valSigsWigsDel()` flow while keeping normal outcomes as typed decisions
   * instead of exception-driven control flow.
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
    // Once the inception body is structurally valid, attachment validation
    // should run against provisional accepted state instead of ad hoc serder
    // fields so inception and later update paths share the same mental model.
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

    // Attachment validation needs a live kever-shaped view of the provisional
    // state because local/remote witness and delegation rules are defined in
    // terms of accepted-state helpers, not raw inception fields.
    const scratch = Kever.fromTransition(icpTransition, runtime);

    // This is the TypeScript equivalent of KERIpy's controller-signature,
    // witness-receipt, and delegation-validation pass, expressed as a typed
    // attachment decision.
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
          sourceSeal: attachments.attachments.sourceSeal
            ?? provisionalSourceSeal,
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
      case Ilks.rot:
      case Ilks.drt:
        return this.evaluateRotation(init, local);
      case Ilks.ixn:
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
   * Weighted `kt`/`nt` forms are intentionally rehydrated through semantic
   * `Tholder` construction instead of being flattened during reload.
   */
  reload(state: KeyStateRecord): void {
    if (
      !state.i || !state.d || !state.s || !state.f || !state.dt || !state.et
    ) {
      throw new ValidationError(
        "Incomplete key-state record for Kever reload.",
      );
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
    return new KeyStateRecord({
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
    });
  }

  /**
   * Idempotently log one verified accepted event into the durable KEL surface.
   *
   * This is the shared logging seam used by fresh acceptance, late signatures,
   * and future replay/recovery flows.
   *
   * Logging rules are intentionally split:
   * - accepted-event material (`dtss.`, `sigs.`, `wigs.`, `wits.`, `evts.`) is
   *   always safe to write idempotently
   * - delegator source seals are only persisted for accepted delegated
   *   non-`ixn` events so provisional or malicious source-seal attachments do
   *   not become accepted state
   * - first-seen side effects (`fels.`/`fons.` and replay-fn anomaly cues)
   *   remain isolated behind `first`
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
    const nowDater = replayDater
      ?? new Dater({ qb64: encodeDateTimeToDater(nowIso8601) });
    const dgkey = dgKey(pre, said);

    this.db.dtss.put(dgkey, nowDater);
    if (args.sigers && args.sigers.length > 0) {
      this.db.sigs.put(dgkey, [...args.sigers]);
    }
    if (args.wigers && args.wigers.length > 0) {
      this.db.wigs.put(dgkey, [...args.wigers]);
    }
    if (args.wits && args.wits.length > 0) {
      this.db.wits.put(
        dgkey,
        args.wits.map((wit) => new Prefixer({ qb64: wit })),
      );
    }

    this.db.evts.put(dgkey, args.serder);

    if (args.sourceSeal && this.delegated && args.serder.ilk !== Ilks.ixn) {
      this.db.aess.pin(dgkey, [
        normalizeOrdinal(sourceSealOrdinal(args.sourceSeal)),
        sourceSealDigest(args.sourceSeal),
      ]);
    }

    const existingEsr = this.db.esrs.get(dgkey);
    if (existingEsr) {
      if (local && !existingEsr.local) {
        existingEsr.local = true;
        this.db.esrs.pin(dgkey, existingEsr);
      }
    } else {
      this.db.esrs.put(dgkey, { local });
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
      this.db.dtss.pin(dgkey, nowDater);
      this.db.fons.pin(dgkey, encodeHugeOrdinal(fn));
    }

    this.db.kels.add(pre, sn, said);
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
   * Lookup order:
   * - for already accepted delegated events being treated as the "original"
   *   recovery candidate, prefer the stored `.aess` source seal because it
   *   preserves the accepted authorizing event even if that event was later
   *   superseded in the delegator's KEL
   * - for a new or superseding candidate, treat any attached source seal as a
   *   hint to the delegating-event sequence number, but always resolve that
   *   hint through the latest authoritative event at that sequence number
   * - if the hint path fails and `eager` is enabled, search the delegator KEL:
   *   across all accepted events for `original`, or only the current
   *   authoritative branch for a new candidate
   *
   * This is the TypeScript equivalent of KERIpy's
   * `fetchDelegatingEvent(... original=...)`. When an accepted delegated event
   * is rediscovered via the KEL walk, the `.aess` hint is repaired so later
   * recursive delegation-recovery checks can start from durable source-seal
   * state instead of re-walking the KEL every time.
   */
  fetchDelegatingEvent(
    delpre: string,
    serder: SerderKERI,
    {
      sourceSeal,
      original = false,
      eager = false,
    }: {
      sourceSeal?: DelegationSourceSeal | null;
      original?: boolean;
      eager?: boolean;
    } = {},
  ): DelegatingEventLookup | null {
    if (original) {
      const stored = this.acceptedSourceSealForEvent(serder);
      if (stored) {
        const exact = this.lookupAcceptedDelegatingEvent(
          delpre,
          stored,
          serder,
        );
        if (exact) {
          return exact;
        }
        this.dropAcceptedSourceSeal(serder);
      }
      if (!eager) {
        return null;
      }
      const found = this.searchDelegatingEvent(delpre, serder, {
        original: true,
      });
      if (found) {
        this.repairAcceptedSourceSeal(serder, found);
      }
      return found;
    }

    if (sourceSeal) {
      const hinted = this.lookupAuthoritativeDelegatingEvent(
        delpre,
        sourceSeal,
        serder,
      );
      if (hinted) {
        return hinted;
      }
    }

    const stored = this.acceptedSourceSealForEvent(serder);
    if (stored) {
      const authoritative = this.lookupAuthoritativeDelegatingEvent(
        delpre,
        stored,
        serder,
      );
      if (authoritative) {
        this.repairAcceptedSourceSeal(serder, authoritative);
        return authoritative;
      }
    }

    if (!eager) {
      return null;
    }

    const found = this.searchDelegatingEvent(delpre, serder, {
      original: false,
    });
    if (found) {
      this.repairAcceptedSourceSeal(serder, found);
    }
    return found;
  }

  /**
   * Load one state record and its corresponding serder into the live kever.
   *
   * This is used by both durable reload and accepted-transition application.
   */
  private loadState(state: KeyStateRecord, serder: SerderKERI): void {
    if (
      !state.i || !state.d || !state.s || !state.f || !state.dt || !state.et
    ) {
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
    this.tholder = state.kt !== undefined
      ? new Tholder({ sith: state.kt })
      : null;
    this.ntholder = state.nt !== undefined
      ? new Tholder({ sith: state.nt })
      : null;
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

  /**
   * Evaluate one non-mutating rotation or delegated rotation transition.
   *
   * The branch structure mirrors KERIpy's `rotate()` / `update()` split:
   * - in-order events advance normally
   * - same-or-earlier sequence numbers are either stale or recovery candidates
   * - stale same-sn arrivals are still defended here even though `Kevery`
   *   normally gets the first chance to classify duplicitous routing
   *
   * Recovery is intentionally narrow: only a rotation may supersede an `ixn`
   * state at the same sequence number.
   */
  private evaluateRotation(
    init: KeverEventInit,
    local: boolean,
  ): KeverDecision {
    const { serder } = init;
    const ilk = serder.ilk ?? Ilks.rot;
    const sn = serder.sn ?? -1;

    if (this.delegated && ilk !== Ilks.drt) {
      return Kever.reject(
        "invalidDelegation",
        `Delegated AID ${this.pre} requires drt, not rot.`,
      );
    }
    if (!this.delegated && ilk === Ilks.drt) {
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
      // Same-or-earlier sequence numbers are either stale or recovery
      // candidates. A bare `Kever` still enforces those rules even when the
      // normal remote-processing path routes through `Kevery` first.
      if (
        (ilk === Ilks.rot && sn <= this.lastEst.s)
        || (ilk === Ilks.drt && sn < this.lastEst.s)
      ) {
        return Kever.reject(
          "stale",
          `Stale ${ilk} event sn=${sn} for ${this.pre}.`,
        );
      }
      if (ilk === Ilks.rot && this.ilk !== Ilks.ixn) {
        return Kever.reject(
          "invalidRecovery",
          `Recovery rotation for ${this.pre} may only supersede an ixn state.`,
        );
      }

      // Recovery compares against the accepted event immediately before the
      // candidate recovery point, not just against current head state.
      const psn = sn - 1;
      const pdig = this.db.kels.getLast(this.pre, psn);
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

    // Witness derivation happens before attachment validation so controller
    // signatures, witness receipts, and delegation checks all see the same
    // post-establishment witness set.
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

    const state = new KeyStateRecord({
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
    });

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

  /**
   * Evaluate one non-mutating interaction transition.
   *
   * Interaction events reuse the currently accepted signing threshold,
   * verifiers, witness list, and delegation state rather than carrying new
   * establishment material of their own.
   */
  private evaluateInteraction(
    init: KeverEventInit,
    local: boolean,
  ): KeverDecision {
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
        state: new KeyStateRecord({
          vn: [...this.version],
          i: this.pre,
          s: sn.toString(16),
          p: serder.prior ?? "",
          d: serder.said ?? "",
          f: this.fn.toString(16),
          dt: this.dater.iso8601,
          et: Ilks.ixn,
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
        }),
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

  /**
   * Validate attachments using explicit decisions instead of exception flow.
   *
   * Validation order is intentional and carries over the substantive KERIpy
   * `valSigsWigsDel()` model:
   * - strip remotely supplied signatures that came from local group members
   * - require at least one verified controller signature before any escrow path
   * - run misfit checks before partial-signature, witness, or delegation
   *   escrows so locally protected events never fall into a weaker escrow class
   * - satisfy controller threshold, then prior-next exposure threshold for
   *   establishment rotations, then witness threshold, and only then
   *   delegation approval
   *
   * The TypeScript difference is that each branch returns `verified`,
   * `escrow`, or `reject` instead of raising the KERIpy family of normal
   * control-flow exceptions.
   */
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

    // Remote processing may not count signatures contributed by local members
    // of a locally membered group AID. Otherwise, a remotely compromised local
    // member key could satisfy threshold from the wrong trust domain.
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

    // get unique, verified sigers and indices lists from sigers list
    const verified = Kever.verifyIndexedSignatures(
      input.serder.raw,
      sigers,
      verfers,
    );
    if (verified.sigers.length === 0) {
      return Kever.rejectAttachment(
        "invalidThreshold",
        `No verified signatures for event ${said}.`,
      );
    }

    // Once at least one controller signature verifies, the event is eligible
    // for escrow. Misfit checks come first so locally protected events do not
    // leak into a more permissive partial-signature or partial-delegation
    // class.
    if (
      !input.local
      && (this.locallyOwned()
        || this.locallyWitnessed({ wits: [...input.wits] })
        || this.locallyDelegated(delpre))
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

    // Establishment rotations must also satisfy the prior-next threshold
    // exposed by the newly current signatures against the prior digest list.
    if (
      input.isEstablishment
      && this.ntholder
      && (input.serder.ilk === Ilks.rot || input.serder.ilk === Ilks.drt)
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
    } else if (
      !(this.locallyOwned() || this.locallyMembered()
        || this.locallyWitnessed({ wits: [...input.wits] }))
    ) {
      // Only non-protected validators require the witness threshold to be
      // satisfied up front. Local controllers, local witnesses, and locally
      // membered groups may accept earlier so they can drive later receipts and
      // follow-on approval work.
      if (
        input.toader.num < 1n || input.toader.num > BigInt(input.wits.length)
      ) {
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

    // Delegation is the final attachment gate because it depends on the event
    // already being controller-valid and, for non-protected validators,
    // witnessed enough to ask whether the delegator has actually anchored it.
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
        sourceSeal: delegation.attachments.sourceSeal ?? input.sourceSeal
          ?? null,
        cues: [...remoteMemberedCues, ...(delegation.attachments.cues ?? [])],
      },
    };
  }

  /**
   * Validate delegation or produce typed delegation-related escrow/reject results.
   *
   * Role model carried over from KERIpy:
   * - local delegatees and local witnesses may accept without waiting for the
   *   remote-validator form of delegator proof, because their local acceptance
   *   is what triggers later witness receipts and delegator approval
   * - local delegators still withhold acceptance until they have supplied an
   *   approval source seal, which maps here to `delegables` escrow
   * - everyone else behaves like a third-party validator and requires a known
   *   delegator KEL plus an anchoring delegating event
   *
   * Superseding delegated recovery:
   * - once the current event is controller-valid, witnessed enough, and known
   *   to be anchored, `drt` recovery compares the new delegating-event chain to
   *   the latest accepted delegated establishment event at the same delegate
   *   sequence number
   * - the comparison implements the substantive KERIpy B/C rules: later
   *   delegating-event sequence number wins, later seal index in the same
   *   delegating event wins, a delegating rotation may supersede a delegating
   *   `ixn` at the same sequence number, and otherwise the comparison climbs
   *   recursively through the delegator's own delegation chain
   */
  private validateDelegation(
    input: AttachmentValidationInput & {
      delpre: string | null;
      sourceSeal: DelegationSourceSeal | null;
    },
  ): AttachmentDecision {
    const delpre = input.delpre;
    // Non-delegated events short-circuit here so the caller can keep one
    // attachment pipeline for delegated and non-delegated events.
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

    // Protected parties to the delegation may accept before full remote-style
    // delegation proof because their local acceptance is what drives later
    // witness and approval processing.
    if (
      this.locallyOwned()
      || this.locallyMembered()
      || this.locallyWitnessed({ wits: [...input.wits] })
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

    // Third-party-style validators need the delegator KEL before any attached
    // source seal can be treated as meaningful.
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

    // A local delegator without an attached approval seal is not a generic
    // partial-delegation case. It is specifically waiting for local
    // out-of-band approval to be attached and reprocessed.
    if (
      (input.serder.ilk === Ilks.dip || input.serder.ilk === Ilks.drt)
      && this.locallyDelegated(delpre)
      && !this.locallyOwned()
      && !input.sourceSeal
    ) {
      return this.makeAttachmentEscrowDecision(
        "delegables",
        input,
        `Missing local delegator approval for delegated event ${input.serder.said ?? "<unknown>"}.`,
      );
    }

    // At this point the event is controller-valid and witnessed enough for the
    // current trust domain, so the remaining question is whether the delegator
    // has actually anchored it.
    const delegatingEvent = this.fetchDelegatingEvent(delpre, input.serder, {
      sourceSeal: input.sourceSeal,
      original: false,
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
            sn: input.sourceSeal
              ? ordinalHex(sourceSealOrdinal(input.sourceSeal))
              : undefined,
            dig: input.sourceSeal
              ? sourceSealDigest(input.sourceSeal).qb64
              : undefined,
          },
          pre: delpre ?? undefined,
        }],
      );
    }

    // The simple cases are the same as KERIpy: inception is never a recovery
    // problem, an in-order delegated rotation is fine once anchored, and a
    // same-sn `drt` may directly supersede an `ixn` head state.
    if (
      input.serder.ilk !== Ilks.drt
      || input.serder.sn === null
      || input.serder.sn === this.sn + 1
      || (input.serder.sn === this.sn && this.ilk === Ilks.ixn)
    ) {
      return {
        kind: "verified",
        attachments: {
          sigers: [],
          wigers: [],
          wits: [...input.wits],
          delpre,
          sourceSeal: delegatingEvent.sourceSeal,
        },
      };
    }

    const originalDelegatedEvent = this.latestAcceptedDelegatedEventAtSn(
      input.serder.sn,
    );
    if (!originalDelegatedEvent) {
      return Kever.rejectAttachment(
        "invalidDelegation",
        `Missing accepted delegated establishment event at sn=${input.serder.sn} for ${this.pre}.`,
      );
    }

    const originalDelegatingEvent = this.fetchDelegatingEvent(
      delpre,
      originalDelegatedEvent,
      {
        original: true,
        eager: input.eager ?? false,
      },
    );
    if (!originalDelegatingEvent) {
      return this.makeAttachmentEscrowDecision(
        "partialDels",
        input,
        `No original delegation seal found for accepted recovery target ${originalDelegatedEvent.said ?? "<unknown>"}.`,
        [{
          kin: "query",
          q: { pre: delpre ?? undefined },
          pre: delpre ?? undefined,
        }],
      );
    }

    const recoveryDecision = this.validateDelegatedRecovery({
      input,
      delpre,
      candidateEvent: input.serder,
      candidateDelegation: delegatingEvent,
      originalEvent: originalDelegatedEvent,
      originalDelegation: originalDelegatingEvent,
    });
    if (recoveryDecision) {
      return recoveryDecision;
    }

    return {
      kind: "verified",
      attachments: {
        sigers: [],
        wigers: [],
        wits: [...input.wits],
        delpre,
        sourceSeal: delegatingEvent.sourceSeal,
      },
    };
  }

  /**
   * Compare a candidate delegated recovery against the latest accepted
   * delegated establishment chain it wants to supersede.
   *
   * The comparison climbs one boss/original pair at a time until one of the
   * KERIpy superseding rules succeeds or the undelegated root is reached.
   */
  private validateDelegatedRecovery(
    {
      input,
      delpre,
      candidateEvent,
      candidateDelegation,
      originalEvent,
      originalDelegation,
    }: {
      input: AttachmentValidationInput & {
        delpre: string | null;
        sourceSeal: DelegationSourceSeal | null;
      };
      delpre: string;
      candidateEvent: SerderKERI;
      candidateDelegation: DelegatingEventLookup;
      originalEvent: SerderKERI;
      originalDelegation: DelegatingEventLookup;
    },
  ): AttachmentDecision | null {
    let currentDelpre = delpre;
    let candidate = candidateEvent;
    let candidateBoss = candidateDelegation;
    let original = originalEvent;
    let originalBoss = originalDelegation;
    const visited = new Set<string>();

    while (true) {
      const candidateBossSn = candidateBoss.serder.sn;
      const originalBossSn = originalBoss.serder.sn;
      if (candidateBossSn === null || originalBossSn === null) {
        return Kever.rejectAttachment(
          "invalidDelegation",
          `Delegation recovery chain for ${candidateEvent.said ?? "<unknown>"} is missing sequence numbers.`,
        );
      }

      const cycleKey = `${currentDelpre}:${candidateBoss.serder.said ?? ""}:${originalBoss.serder.said ?? ""}`;
      if (visited.has(cycleKey)) {
        return Kever.rejectAttachment(
          "invalidDelegation",
          `Delegation recovery chain for ${candidateEvent.said ?? "<unknown>"} contains a cycle.`,
        );
      }
      visited.add(cycleKey);

      if (candidateBossSn > originalBossSn) {
        return null;
      }

      const candidateBossIlk = candidateBoss.serder.ilk;
      const originalBossIlk = originalBoss.serder.ilk;
      if (
        candidateBossSn === originalBossSn
        && (candidateBossIlk === Ilks.rot || candidateBossIlk === Ilks.drt)
        && originalBossIlk === Ilks.ixn
      ) {
        return null;
      }

      if (candidateBoss.serder.said === originalBoss.serder.said) {
        if (candidateBoss.sealIndex > originalBoss.sealIndex) {
          return null;
        }
        return Kever.rejectAttachment(
          "invalidDelegation",
          `Delegated recovery ${candidateEvent.said ?? "<unknown>"} does not supersede accepted event ${
            originalEvent.said ?? "<unknown>"
          }.`,
        );
      }

      const upstreamDelpre = this.delegatorPreForEvent(candidateBoss.serder);
      const originalUpstreamDelpre = this.delegatorPreForEvent(
        originalBoss.serder,
      );
      if (!upstreamDelpre || !originalUpstreamDelpre) {
        return Kever.rejectAttachment(
          "invalidDelegation",
          `Delegated recovery ${
            candidateEvent.said ?? "<unknown>"
          } is not later than the accepted delegation chain rooted at ${currentDelpre}.`,
        );
      }
      if (upstreamDelpre !== originalUpstreamDelpre) {
        return Kever.rejectAttachment(
          "invalidDelegation",
          `Delegated recovery ${
            candidateEvent.said ?? "<unknown>"
          } diverges across delegator chains ${upstreamDelpre} and ${originalUpstreamDelpre}.`,
        );
      }

      currentDelpre = upstreamDelpre;
      candidate = candidateBoss.serder;
      original = originalBoss.serder;

      const nextCandidateBoss = this.fetchDelegatingEvent(
        currentDelpre,
        candidate,
        {
          original: false,
          eager: input.eager ?? false,
        },
      );
      if (!nextCandidateBoss) {
        return this.makeAttachmentEscrowDecision(
          "partialDels",
          input,
          `No delegating recovery chain found for ${candidate.said ?? "<unknown>"} under ${currentDelpre}.`,
          [{
            kin: "query",
            q: { pre: currentDelpre ?? undefined },
            pre: currentDelpre ?? undefined,
          }],
        );
      }

      const nextOriginalBoss = this.fetchDelegatingEvent(
        currentDelpre,
        original,
        {
          original: true,
          eager: input.eager ?? false,
        },
      );
      if (!nextOriginalBoss) {
        return this.makeAttachmentEscrowDecision(
          "partialDels",
          input,
          `No original delegating recovery chain found for ${original.said ?? "<unknown>"} under ${currentDelpre}.`,
          [{
            kin: "query",
            q: { pre: currentDelpre ?? undefined },
            pre: currentDelpre ?? undefined,
          }],
        );
      }

      candidateBoss = nextCandidateBoss;
      originalBoss = nextOriginalBoss;
    }
  }

  /** Load the authoritative accepted delegated establishment event at `sn`. */
  private latestAcceptedDelegatedEventAtSn(sn: number): SerderKERI | null {
    if (this.lastEst.s !== sn) {
      return null;
    }
    return this.db.getEvtSerder(this.pre, this.lastEst.d);
  }

  /** Read the stored accepted source-seal hint for one already accepted event. */
  private acceptedSourceSealForEvent(
    serder: SerderKERI,
  ): SealSource | null {
    const pre = serder.pre;
    const said = serder.said;
    if (!pre || !said) {
      return null;
    }
    const seal = this.db.aess.get(dgKey(pre, said));
    if (!seal) {
      return null;
    }
    return SealSource.fromTuple(seal);
  }

  /** Remove one broken accepted source-seal hint so a later eager pass can repair it. */
  private dropAcceptedSourceSeal(serder: SerderKERI): void {
    const pre = serder.pre;
    const said = serder.said;
    if (!pre || !said) {
      return;
    }
    this.db.aess.rem(dgKey(pre, said));
  }

  /** Repair `.aess` for accepted delegated events after re-discovering the real boss. */
  private repairAcceptedSourceSeal(
    serder: SerderKERI,
    lookup: DelegatingEventLookup,
  ): void {
    const pre = serder.pre;
    const said = serder.said;
    const dgkey = pre && said ? dgKey(pre, said) : null;
    if (!dgkey || !this.db.fons.get(dgkey)) {
      return;
    }
    this.db.aess.pin(dgkey, [
      normalizeOrdinal(sourceSealOrdinal(lookup.sourceSeal)),
      sourceSealDigest(lookup.sourceSeal),
    ]);
  }

  /** Resolve one stored source seal to the exact accepted delegating event it names. */
  private lookupAcceptedDelegatingEvent(
    delpre: string,
    sourceSeal: DelegationSourceSeal,
    serder: SerderKERI,
  ): DelegatingEventLookup | null {
    const candidate = this.db.getEvtSerder(delpre, sourceSealDigest(sourceSeal).qb64);
    if (
      !candidate || !candidate.said
      || !this.db.fons.get(dgKey(delpre, candidate.said))
    ) {
      return null;
    }
    return this.delegatingLookup(candidate, serder);
  }

  /**
   * Resolve one source-seal hint through the current authoritative event at
   * that delegator sequence number.
   */
  private lookupAuthoritativeDelegatingEvent(
    delpre: string,
    sourceSeal: DelegationSourceSeal,
    serder: SerderKERI,
  ): DelegatingEventLookup | null {
    const said = this.db.kels.getLast(delpre, ordinalNumber(sourceSealOrdinal(sourceSeal)));
    if (!said) {
      return null;
    }
    return this.delegatingLookup(this.db.getEvtSerder(delpre, said), serder);
  }

  /**
   * Search the delegator KEL for the best sealing event for one delegated event.
   *
   * Search policy mirrors the KERIpy split:
   * - `original=true` walks accepted history and chooses the latest accepted
   *   sealing event by first-seen ordinal
   * - otherwise the search follows the current authoritative KEL branch only
   */
  private searchDelegatingEvent(
    delpre: string,
    serder: SerderKERI,
    { original }: { original: boolean },
  ): DelegatingEventLookup | null {
    if (original) {
      let best: DelegatingEventLookup | null = null;
      let bestFn: bigint | null = null;
      for (const [, , said] of this.db.kels.getAllItemIter(delpre)) {
        const fn = this.db.fons.get(dgKey(delpre, said));
        if (!fn) {
          continue;
        }
        const lookup = this.delegatingLookup(
          this.db.getEvtSerder(delpre, said),
          serder,
        );
        if (!lookup) {
          continue;
        }
        if (bestFn === null || fn.num > bestFn) {
          best = lookup;
          bestFn = fn.num;
        }
      }
      return best;
    }

    let best: DelegatingEventLookup | null = null;
    for (const [, said] of this.db.getKelItemIter(delpre)) {
      const lookup = this.delegatingLookup(
        this.db.getEvtSerder(delpre, said),
        serder,
      );
      if (lookup) {
        best = lookup;
      }
    }
    return best;
  }

  /** Normalize one accepted delegating event plus the matching seal index. */
  private delegatingLookup(
    candidate: SerderKERI | null,
    serder: SerderKERI,
  ): DelegatingEventLookup | null {
    if (!candidate || candidate.sn === null || !candidate.said) {
      return null;
    }
    const sealIndex = this.eventAnchorSealIndex(candidate, serder);
    if (sealIndex < 0) {
      return null;
    }
    return {
      serder: candidate,
      sourceSeal: SealSource.fromTuple([
        candidate.sner ?? encodeHugeOrdinal(candidate.sn),
        new Diger({ qb64: candidate.said }),
      ]),
      sealIndex,
    };
  }

  /** Resolve whether one accepted event's AID is itself delegated. */
  private delegatorPreForEvent(serder: SerderKERI): string | null {
    const pre = serder.pre;
    if (!pre) {
      return null;
    }
    if (serder.ilk === Ilks.dip && serder.delpre) {
      return serder.delpre;
    }
    return this.db.getState(pre)?.di || null;
  }

  /** Return the zero-based index of the matching event seal or `-1`. */
  private eventAnchorSealIndex(
    candidate: SerderKERI,
    serder: SerderKERI,
  ): number {
    for (const [index, seal] of candidate.eventSeals.entries()) {
      if (
        seal.i.qb64 === serder.pre
        && seal.s.numh === serder.snh
        && seal.d.qb64 === serder.said
      ) {
        return index;
      }
    }
    return -1;
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
      if (!verfer.verify(siger.raw, raw)) {
        continue;
      }
      verified.set(
        siger.index,
        new Siger(
          {
            code: siger.code,
            raw: siger.raw,
            index: siger.index,
            ondex: siger.ondex,
          },
          verfer,
        ),
      );
    }

    const ordered = [...verified.entries()].sort((a, b) => a[0] - b[0]);
    return {
      sigers: ordered.map(([, siger]) => siger),
      indices: ordered.map(([index]) => index),
    };
  }

  /**
   * Verify inception-specific event semantics before attachment validation.
   *
   * This method only checks the inception event body itself: prefix/ilk/sn,
   * threshold material, transferability constraints, witness-set shape, and
   * inception-only non-transferable restrictions. Signature, witness, and
   * delegation approval rules are intentionally deferred to the later
   * attachment phase so `evaluateInception()` can keep one acceptance pipeline
   * for both `icp` and `dip`.
   */
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
    if (ilk !== Ilks.icp && ilk !== Ilks.dip) {
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
    const transferable = new Prefixer({ qb64: pre }).transferable;
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
    return new KeyStateRecord({
      vn: [serder.pvrsn.major, serder.pvrsn.minor],
      i: pre,
      s: "0",
      p: "",
      d: said,
      f: frc ? frc.fnh : "0",
      dt: frc?.dater.iso8601 ?? makeNowIso8601(),
      et: serder.ilk ?? Ilks.icp,
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
    });
  }

  /**
   * Derive the post-establishment witness set for one event or return `null`.
   *
   * KERIpy correspondence:
   * - this is the decision-returning equivalent of `deriveBacks()`
   *
   * The important invariant is witness ordering. Cuts/adds are validated before
   * composing the next witness list so later indexed witness receipts still
   * refer to the correct witness positions across establishment events.
   */
  private deriveBacksDecision(serder: SerderKERI): DerivedBacksResult | null {
    if (serder.ilk === Ilks.icp || serder.ilk === Ilks.dip) {
      return {
        wits: [...serder.backs],
        cuts: [],
        adds: [],
        toader: serder.bner ?? numberPrimitiveFromBigInt(0n),
      };
    }

    const cuts = [...serder.cuts];
    const adds = [...serder.adds];
    // Ordered witness math matters here: duplicate or intersecting cut/add
    // sets would make the next witness list ambiguous for indexed receipts.
    const derived = deriveRotatedWitnessSet(this.wits, cuts, adds);
    if (derived.kind !== "accept") {
      return null;
    }
    const nextWitnesses = derived.value;

    const toader = serder.bner ?? numberPrimitiveFromBigInt(0n);
    if (nextWitnesses.wits.length > 0) {
      if (toader.num < 1n || toader.num > BigInt(nextWitnesses.wits.length)) {
        return null;
      }
    } else if (toader.num !== 0n) {
      return null;
    }

    return {
      wits: nextWitnesses.wits,
      cuts: nextWitnesses.cuts,
      adds: nextWitnesses.adds,
      toader,
    };
  }

  /** Normalize the first available delegated/source-seal attachment if any. */
  private normalizeSourceSeal(
    sscs?: readonly SealSource[],
    ssts?: readonly SealEvent[],
  ): DelegationSourceSeal | null {
    return ssts?.[0] ?? sscs?.[0] ?? null;
  }

  /** Return true when one delegating event contains the seal for the supplied event. */
  private eventAnchorsSeal(candidate: SerderKERI, serder: SerderKERI): boolean {
    return this.eventAnchorSealIndex(candidate, serder) >= 0;
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
  const entry = THOLDER_NUMERIC_CAPACITIES.find(({ rawSize }) => raw.length <= rawSize);
  if (!entry) {
    throw new ValidationError(
      `Unsupported numeric threshold width for value=${value.toString(16)}.`,
    );
  }
  const padded = new Uint8Array(entry.rawSize);
  padded.set(raw, entry.rawSize - raw.length);
  return new NumberPrimitive({ code: entry.code, raw: padded });
}
