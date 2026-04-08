/**
 * Habitat and shared-environment primitives for local KERI operation.
 *
 * KERIpy correspondence:
 * - this module is the closest analogue to `keri.app.habbing`
 * - `Hab` owns local identifier behavior while `Habery` owns the shared
 *   keeper/database/router/parser environment
 *
 * `keri-ts` difference:
 * - parser ingress uses the CESR frame/envelope pipeline instead of KERIpy's
 *   monolithic `Parser`
 * - local bootstrap replies and events still flow through the same accepted
 *   state machinery instead of being written directly to persistent state
 */
import { type Operation } from "npm:effection@^3.6.0";
import {
  Cigar,
  concatBytes,
  Counter,
  createParser,
  CtrDexV1,
  DigDex,
  Diger,
  DIGEST_CODES,
  Ilks,
  parseMatter,
  PREFIX_CODES,
  Prefixer,
  Seqner,
  SerderKERI,
  Siger,
  Tholder,
  type ThresholdSith,
  type Tier,
  Tiers,
  Verfer,
} from "../../../cesr/mod.ts";
import { b } from "../../../cesr/mod.ts";
import type { AgentCue, CueEmission } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { TransIdxSigGroup, TransLastIdxSigGroup } from "../core/dispatch.ts";
import { ValidationError } from "../core/errors.ts";
import { Kevery } from "../core/eventing.ts";
import { Kever } from "../core/kever.ts";
import { makeQuerySerder, makeReceiptSerder, makeReplySerder } from "../core/messages.ts";
import { HabitatRecord, type VerferCigarCouple } from "../core/records.ts";
import { type Role, Roles } from "../core/roles.ts";
import { BasicReplyRouteHandler, Revery, Router } from "../core/routing.ts";
import { type Scheme, Schemes } from "../core/schemes.ts";
import { deriveRotatedWitnessSet } from "../core/witnesses.ts";
import { Baser, createBaser } from "../db/basing.ts";
import { dgKey } from "../db/core/keys.ts";
import { createKeeper, Keeper, PreSit } from "../db/keeping.ts";
import { createOutboxer, DisabledOutboxer, type OutboxerLike } from "../db/outboxing.ts";
import { makeNowIso8601 } from "../time/mod.ts";
import { type CesrBodyMode, DEFAULT_CESR_BODY_MODE } from "./cesr-http.ts";
import { Configer, createConfiger } from "./configing.ts";
import { Algos, branToSaltQb64, ensureKeeperCryptoReady, Manager, normalizeSaltQb64, saltySigner } from "./keeping.ts";
import { dispatchEnvelope, envelopesFromFrames } from "./parsering.ts";

/** Reserved alias for the local signatory habitat record. */
export const SIGNER = "__signatory__";

/** Arguments for constructing and reopening a `Habery`. */
export interface HaberyArgs {
  name: string;
  base?: string;
  temp?: boolean;
  headDirPath?: string;
  compat?: boolean;
  readonly?: boolean;
  cf?: Configer;
  skipConfig?: boolean;
  skipSignator?: boolean;
  bran?: string;
  seed?: string;
  aeid?: string;
  salt?: string;
  algo?: Algos;
  tier?: Tier;
  outboxer?: "disabled" | "open" | "create";
  cesrBodyMode?: CesrBodyMode;
}

/** Habitat inception options consumed by the local bootstrap `Hab.make()` flow. */
export interface MakeHabArgs {
  code?: string;
  transferable?: boolean;
  isith?: ThresholdSith;
  icount?: number;
  icode?: string;
  nsith?: ThresholdSith;
  ncount?: number;
  ncode?: string;
  toad?: number;
  wits?: string[];
  delpre?: string;
  estOnly?: boolean;
  DnD?: boolean;
  hidden?: boolean;
  data?: unknown[];
  algo?: Algos;
  salt?: string;
  tier?: Tier;
}

/**
 * Fixed KERI version tuple used when emitting bootstrap counters.
 *
 * Keeping this centralized avoids silently diverging counter headers across
 * locally generated reply and inception messages.
 */
const KERI_V1 = Object.freeze({ major: 1, minor: 0 } as const);

/**
 * Produce the default simple numeric signing threshold for a key count.
 *
 * This intentionally stays in simple-numeric territory for the current
 * bootstrap slice; weighted threshold expressions are deferred.
 */
function defaultThreshold(count: number, min: number): string {
  return `${Math.max(min, Math.ceil(count / 2)).toString(16)}`;
}

/**
 * Derive a KERI-style ample witness threshold.
 *
 * KERIpy correspondence:
 * - mirrors the intent of KERIpy's `ample()` helper used when witness
 *   membership changes and the operator did not pin an explicit `toad`
 */
function ample(count: number, faults?: number, weak = true): number {
  const n = Math.max(0, count);
  if (faults === undefined) {
    const f1 = Math.max(1, Math.floor(Math.max(0, n - 1) / 3));
    const f2 = Math.max(1, Math.ceil(Math.max(0, n - 1) / 3));
    if (weak) {
      return Math.min(
        n,
        Math.ceil((n + f1 + 1) / 2),
        Math.ceil((n + f2 + 1) / 2),
      );
    }
    return Math.min(
      n,
      Math.max(0, n - f1, Math.ceil((n + f1 + 1) / 2)),
    );
  }

  const f = Math.max(0, faults);
  const m1 = Math.ceil((n + f + 1) / 2);
  const m2 = Math.max(0, n - f);
  if (m2 < m1 && n > 0) {
    throw new ValidationError(`Invalid faults ${faults} for witness count ${count}.`);
  }
  return weak ? Math.min(n, m1, m2) : Math.min(n, Math.max(m1, m2));
}

function loadConfigUrls(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function requireConfigDatetime(alias: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError(`Config section '${alias}' is missing dt.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(
      `Config section '${alias}' has invalid dt '${value}'.`,
    );
  }
  const y = parsed.getUTCFullYear().toString().padStart(4, "0");
  const m = (parsed.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = parsed.getUTCDate().toString().padStart(2, "0");
  const hh = parsed.getUTCHours().toString().padStart(2, "0");
  const mm = parsed.getUTCMinutes().toString().padStart(2, "0");
  const ss = parsed.getUTCSeconds().toString().padStart(2, "0");
  const micros = (parsed.getUTCMilliseconds() * 1000).toString().padStart(
    6,
    "0",
  );
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}.${micros}+00:00`;
}

/** Shared zero-length message value used when a reply/resource has no payload. */
function emptyMessage(): Uint8Array {
  return new Uint8Array();
}

/** Concatenate a list of wire messages while preserving empty-list semantics. */
function concatMessages(messages: readonly Uint8Array[]): Uint8Array {
  return messages.length === 0 ? emptyMessage() : concatBytes(...messages);
}

/** Require verifier context on runtime non-transferable reply cigars. */
function requireCigarVerfer(cigar: Cigar): Verfer {
  if (!cigar.verfer) {
    throw new ValidationError("Reply cigar is missing verifier context.");
  }
  return cigar.verfer;
}

function hexToFixedBytes(hex: string, size: number): Uint8Array {
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`;
  if (!/^[0-9a-f]+$/i.test(normalized)) {
    throw new ValidationError(`Invalid hex ordinal ${hex}`);
  }
  if (normalized.length > size * 2) {
    throw new ValidationError(`Hex ordinal ${hex} exceeds ${size} bytes.`);
  }

  const raw = new Uint8Array(size);
  const padded = normalized.padStart(size * 2, "0");
  for (let i = 0; i < size; i++) {
    raw[i] = Number.parseInt(padded.slice(i * 2, (i * 2) + 2), 16);
  }
  return raw;
}

/**
 * KERIpy-compatible transferable seal ordinals must be emitted as fixed-width
 * `Seqner` primitives, even when the runtime currently holds a wider ordinal
 * abstraction like `NumberPrimitive`.
 */
function encodeSealSeqnerQb64b(tsg: TransIdxSigGroup): Uint8Array {
  return tsg.seqner instanceof Seqner
    ? tsg.seqner.qb64b
    : new Seqner({ code: "0A", raw: hexToFixedBytes(tsg.snh, 16) }).qb64b;
}

/**
 * Build one fully attached endorsed message from an arbitrary KERI body serder.
 *
 * Supported attachment shapes for the current bootstrap slice:
 * - transferable controller signature groups for reply-like messages
 * - transferable last-establishment signature groups for queries
 * - non-transferable reply cigars with attached verifier context
 *
 * KERIpy parity rule:
 * - runtime code handles non-transferable replies as hydrated `Cigar` objects
 *   with `.verfer`
 * - wire output still emits the CESR couple shape `verfer + cigar`
 */
function buildEndorsedMessage(args: {
  serder: SerderKERI;
  tsg?: TransIdxSigGroup;
  ssg?: TransLastIdxSigGroup;
  cigars?: readonly Cigar[];
  pipelined?: boolean;
}): Uint8Array {
  const attachments: Uint8Array[] = [];

  if (args.tsg && args.tsg.sigers.length > 0) {
    attachments.push(
      new Counter({
        code: CtrDexV1.TransIdxSigGroups,
        count: 1,
        version: KERI_V1,
      }).qb64b,
      args.tsg.prefixer.qb64b,
      encodeSealSeqnerQb64b(args.tsg),
      args.tsg.diger.qb64b,
      new Counter({
        code: CtrDexV1.ControllerIdxSigs,
        count: args.tsg.sigers.length,
        version: KERI_V1,
      }).qb64b,
      ...args.tsg.sigers.map((siger) => siger.qb64b),
    );
  } else if (args.ssg && args.ssg.sigers.length > 0) {
    attachments.push(
      new Counter({
        code: CtrDexV1.TransLastIdxSigGroups,
        count: 1,
        version: KERI_V1,
      }).qb64b,
      args.ssg.prefixer.qb64b,
      new Counter({
        code: CtrDexV1.ControllerIdxSigs,
        count: args.ssg.sigers.length,
        version: KERI_V1,
      }).qb64b,
      ...args.ssg.sigers.map((siger) => siger.qb64b),
    );
  } else if (args.cigars && args.cigars.length > 0) {
    attachments.push(
      new Counter({
        code: CtrDexV1.NonTransReceiptCouples,
        count: args.cigars.length,
        version: KERI_V1,
      }).qb64b,
      ...args.cigars.flatMap((cigar) => [
        requireCigarVerfer(cigar).qb64b,
        cigar.qb64b,
      ]),
    );
  }

  return concatMessageWithAttachmentGroup(
    args.serder.raw,
    attachments,
    args.pipelined ?? true,
  );
}

/**
 * Build one fully attached `rct` wire message.
 *
 * Supported receipt attachment shapes:
 * - `tsgs` for transferable validator receipt groups
 * - `wigers` for witness indexed signatures
 * - `cigars` for non-transferable non-witness receipts
 */
function buildReceiptMessage(args: {
  serder: SerderKERI;
  cigars?: readonly Cigar[];
  wigers?: readonly Siger[];
  tsgs?: readonly TransIdxSigGroup[];
}): Uint8Array {
  const attachments: Uint8Array[] = [];

  if (args.tsgs && args.tsgs.length > 0) {
    attachments.push(
      new Counter({
        code: CtrDexV1.TransIdxSigGroups,
        count: args.tsgs.length,
        version: KERI_V1,
      }).qb64b,
      ...args.tsgs.flatMap((tsg) => [
        tsg.prefixer.qb64b,
        encodeSealSeqnerQb64b(tsg),
        tsg.diger.qb64b,
        new Counter({
          code: CtrDexV1.ControllerIdxSigs,
          count: tsg.sigers.length,
          version: KERI_V1,
        }).qb64b,
        ...tsg.sigers.map((siger) => siger.qb64b),
      ]),
    );
  }

  if (args.wigers && args.wigers.length > 0) {
    attachments.push(
      new Counter({
        code: CtrDexV1.WitnessIdxSigs,
        count: args.wigers.length,
        version: KERI_V1,
      }).qb64b,
      ...args.wigers.map((wiger) => wiger.qb64b),
    );
  }

  if (args.cigars && args.cigars.length > 0) {
    attachments.push(
      new Counter({
        code: CtrDexV1.NonTransReceiptCouples,
        count: args.cigars.length,
        version: KERI_V1,
      }).qb64b,
      ...args.cigars.flatMap((cigar) => [
        requireCigarVerfer(cigar).qb64b,
        cigar.qb64b,
      ]),
    );
  }

  return concatMessageWithAttachmentGroup(args.serder.raw, attachments);
}

/** Build one fully attached KEL event wire message with indexed controller signatures. */
function buildEventMessage(
  serder: SerderKERI,
  sigers: readonly Siger[],
): Uint8Array {
  return concatMessageWithAttachmentGroup(
    serder.raw,
    sigers.length > 0
      ? [
        new Counter({
          code: CtrDexV1.ControllerIdxSigs,
          count: sigers.length,
          version: KERI_V1,
        }).qb64b,
        ...sigers.map((siger) => siger.qb64b),
      ]
      : [],
  );
}

/**
 * KERIpy emits reply/query/receipt attachments in one counted attachment group.
 *
 * Some consumers, especially KERIpy's parser stack, rely on that pipelined
 * framing to delimit attachments correctly when multiple messages are streamed.
 */
function concatMessageWithAttachmentGroup(
  body: Uint8Array,
  attachments: readonly Uint8Array[],
  pipelined = true,
): Uint8Array {
  if (attachments.length === 0) {
    return body;
  }

  const atc = concatBytes(...attachments);
  if (!pipelined) {
    return concatBytes(body, atc);
  }
  if (atc.length % 4 !== 0) {
    throw new ValidationError(
      `Invalid attachment quadlet size ${atc.length} for pipelined message.`,
    );
  }

  return concatBytes(
    body,
    new Counter({
      code: CtrDexV1.AttachmentGroup,
      count: atc.length / 4,
      version: KERI_V1,
    }).qb64b,
    atc,
  );
}

/**
 * Rebuild stored transferable reply signature groups from `ssgs.`.
 *
 * This helper is used when accepted replies are reloaded for OOBI/resource
 * dissemination and the caller needs a full wire message again.
 */
function fetchReplyTsgs(
  db: Baser,
  said: string,
): TransIdxSigGroup[] {
  const grouped = new Map<string, TransIdxSigGroup>();

  for (
    const [keys, siger] of db.ssgs.getTopItemIter([said], { topive: true })
  ) {
    const prefix = keys[1];
    const dig = keys[3];
    if (!prefix || !dig) {
      continue;
    }
    const estEvent = db.getEvtSerder(prefix, dig);
    const seqner = estEvent?.sner;
    if (!seqner) {
      continue;
    }
    const groupKey = `${prefix}.${seqner.qb64}.${dig}`;
    let group = grouped.get(groupKey);
    if (!group) {
      group = new TransIdxSigGroup(
        new Prefixer({ qb64: prefix }),
        seqner,
        new Diger({ qb64: dig }),
        [],
      );
      grouped.set(groupKey, group);
    }
    group.sigers.push(siger);
  }

  return [...grouped.values()].sort((a, b) => Number(b.sn - a.sn));
}

/** Rehydrate one stored verfer+cigar tuple into the KERIpy runtime cigar shape. */
function hydrateStoredCigar(tuple: VerferCigarCouple): Cigar {
  return new Cigar(tuple[1], tuple[0]);
}

/**
 * Reload one persisted reply plus all of its stored attachments by SAID.
 *
 * Returns an empty message when the reply SAID is not present in reply-state
 * storage.
 */
function loadReplyMessageBySaid(db: Baser, said: string): Uint8Array {
  const serder = db.rpys.get([said]);
  if (!serder) {
    return emptyMessage();
  }

  const tsgs = fetchReplyTsgs(db, said);
  if (tsgs.length > 0) {
    const lead = tsgs[0];
    return buildEndorsedMessage({
      serder,
      tsg: lead,
    });
  }

  const cigars = db.scgs.get([said]);
  if (cigars.length > 0) {
    return buildEndorsedMessage({
      serder,
      cigars: cigars.map((entry) => hydrateStoredCigar(entry)),
    });
  }

  return serder.raw;
}

/**
 * Build one inception/delgated-inception serder from generated keys and config.
 *
 * Current scope:
 * - supports local `icp` and delegated `dip` bootstrap events
 * - relies on simple numeric threshold defaults
 * - keeps SAID code resolution centralized for prefix derivation consistency
 */
function makeInceptRaw(
  keys: string[],
  ndigs: string[],
  args: {
    code: string;
    isith?: ThresholdSith;
    nsith?: ThresholdSith;
    toad: number;
    wits: string[];
    cnfg: string[];
    data: unknown[];
    delpre?: string;
  },
): SerderKERI {
  const ilk = args.delpre ? Ilks.dip : Ilks.icp;
  const kt = args.isith ?? defaultThreshold(keys.length, 1);
  const nt = args.nsith ?? defaultThreshold(ndigs.length, 0);

  const ked: Record<string, unknown> = {
    t: ilk,
    i: "",
    kt,
    k: keys,
    nt,
    n: ndigs,
    bt: `${args.toad.toString(16)}`,
    b: args.wits,
    c: args.cnfg,
    a: args.data,
  };

  if (args.delpre) ked.di = args.delpre;
  if (!args.delpre && !DIGEST_CODES.has(args.code) && keys.length === 1) {
    ked.i = keys[0];
  }

  const saids = resolveInceptiveSaidCodes(ked, args.code);
  return new SerderKERI({
    sad: ked,
    makify: true,
    saids,
  });
}

/**
 * Build one rotation/delegated-rotation serder from current and next key material.
 *
 * Validation stays aligned with KERIpy's rotation builder:
 * - current and next thresholds must fit the provided key counts
 * - witness cut/add math must be coherent against the current witness set
 * - default toad follows KERIpy's `ample()` rule only when witness membership changes
 */
function makeRotateRaw(
  pre: string,
  priorSaid: string,
  sn: number,
  keys: string[],
  ndigs: string[],
  args: {
    delegated?: boolean;
    currentWits: string[];
    isith?: ThresholdSith;
    nsith?: ThresholdSith;
    toad?: number;
    cuts?: string[];
    adds?: string[];
    data?: unknown[];
  },
): SerderKERI {
  if (sn < 1) {
    throw new ValidationError(`Invalid rotation sequence number ${sn}.`);
  }

  const tholder = new Tholder({
    sith: args.isith ?? defaultThreshold(keys.length, 1),
  });
  if (tholder.num !== null && tholder.num < 1n) {
    throw new ValidationError(`Invalid current threshold ${String(args.isith ?? "")}.`);
  }
  if (tholder.size > keys.length) {
    throw new ValidationError(`Invalid current threshold for ${keys.length} keys.`);
  }

  const ntholder = new Tholder({
    sith: args.nsith ?? defaultThreshold(ndigs.length, 0),
  });
  if (ntholder.num !== null && ntholder.num < 0n) {
    throw new ValidationError(`Invalid next threshold ${String(args.nsith ?? "")}.`);
  }
  if (ntholder.size > ndigs.length) {
    throw new ValidationError(`Invalid next threshold for ${ndigs.length} next keys.`);
  }

  const cuts = [...(args.cuts ?? [])];
  const adds = [...(args.adds ?? [])];
  const derived = deriveRotatedWitnessSet(args.currentWits, cuts, adds);
  if (derived.kind === "reject") {
    throw new ValidationError(
      `Invalid witness cut/add combination: ${derived.reason}.`,
    );
  }

  const toad = args.toad ?? (cuts.length === 0 && adds.length === 0
    ? parseInt(defaultThreshold(args.currentWits.length, 0), 16)
    : ample(derived.value.wits.length));
  if (derived.value.wits.length === 0 && toad !== 0) {
    throw new ValidationError(`Invalid toad ${toad} for empty witness set.`);
  }
  if (derived.value.wits.length > 0 && (toad < 1 || toad > derived.value.wits.length)) {
    throw new ValidationError(
      `Invalid toad ${toad} for witness count ${derived.value.wits.length}.`,
    );
  }

  return new SerderKERI({
    sad: {
      t: args.delegated ? Ilks.drt : Ilks.rot,
      d: "",
      i: pre,
      s: sn.toString(16),
      p: priorSaid,
      kt: tholder.sith,
      k: keys,
      nt: ntholder.sith,
      n: ndigs,
      bt: toad.toString(16),
      br: cuts,
      ba: adds,
      a: [...(args.data ?? [])],
    },
    makify: true,
  });
}

/**
 * Resolve SAID derivation codes for one inceptive event body.
 *
 * KERI substance:
 * - `d` always uses the event digest code
 * - `i` may use either an explicit prefix code or an already-populated prefix
 *   value when it is parseable as CESR matter
 */
function resolveInceptiveSaidCodes(
  ked: Record<string, unknown>,
  explicitPrefixCode?: string,
): Record<string, string> {
  const saids: Record<string, string> = {
    d: DigDex.Blake3_256,
    i: DigDex.Blake3_256,
  };

  if (explicitPrefixCode && PREFIX_CODES.has(explicitPrefixCode)) {
    saids.i = explicitPrefixCode;
    return saids;
  }

  if (typeof ked.i === "string" && ked.i.length > 0) {
    try {
      saids.i = parseMatter(b(ked.i), "txt").code;
    } catch {
      // Match KERIpy priority: invalid existing values do not override defaults.
    }
  }

  return saids;
}

/** Represents a local identifier habitat and its current key state. */
export class Hab {
  readonly name: string;
  readonly ns?: string;
  readonly db: Baser;
  readonly ks: Keeper;
  readonly mgr: Manager;
  readonly cf?: Configer;
  readonly rtr: Router;
  readonly rvy: Revery;
  readonly kvy: Kevery;
  pre = "";

  /** Create one habitat wrapper over shared DB/keeper/manager infrastructure. */
  constructor(
    name: string,
    db: Baser,
    ks: Keeper,
    mgr: Manager,
    cf: Configer | undefined,
    rtr: Router,
    rvy: Revery,
    kvy: Kevery,
    ns?: string,
    pre = "",
  ) {
    this.name = name;
    this.db = db;
    this.ks = ks;
    this.mgr = mgr;
    this.cf = cf;
    this.rtr = rtr;
    this.rvy = rvy;
    this.kvy = kvy;
    this.ns = ns;
    this.pre = pre;
  }

  /** Backward-compatible alias for the injected local `Kevery`. */
  get kevery(): Kevery {
    return this.kvy;
  }

  /** Return true when this habitat has accepted local key state. */
  get accepted(): boolean {
    return !!this.pre && this.db.getKever(this.pre) !== null;
  }

  /** Return the live accepted-state `Kever` for this habitat when available. */
  get kever(): Kever | null {
    return this.pre ? this.db.getKever(this.pre) : null;
  }

  /**
   * Accept one locally generated event through the same `Kevery`/`Kever` path
   * used by remote processing.
   *
   * This keeps local habitat inception and later state transitions aligned with
   * the main accepted-state machine instead of duplicating direct DB writes in
   * the habitat layer.
   */
  private acceptLocally(
    serder: SerderKERI,
    sigers: readonly Siger[],
  ): Kever {
    const decision = this.kvy.processEvent({
      serder,
      sigers: [...sigers],
      wigers: [],
      frcs: [],
      sscs: [],
      ssts: [],
      local: true,
    });
    if (decision.kind !== "accept") {
      throw new ValidationError(
        `Local event ${serder.said ?? "<unknown>"} was not accepted.`,
        { decision },
      );
    }
    const kever = this.db.getKever(this.pre);
    if (!kever) {
      throw new Error(
        `Local acceptance did not produce a Kever for ${this.pre}.`,
      );
    }
    return kever;
  }

  /**
   * Parse and dispatch locally generated CESR bytes through the real
   * `CesrParser` architecture.
   *
   * This mirrors the KERIpy shape where locally generated bootstrap replies may
   * still flow through the same parser-driven reply acceptance machinery as
   * remotely received wire messages.
   */
  private ingestLocalCesr(ims: Uint8Array): void {
    const parser = createParser({
      framed: false,
      attachmentDispatchMode: "compat",
    });
    for (const envelope of envelopesFromFrames(parser.feed(ims), true)) {
      dispatchEnvelope(envelope, this.rvy, this.kvy);
    }
  }

  /** Return the alias-scoped config section for this habitat when present. */
  configuredSection(): Record<string, unknown> | null {
    const conf = this.cf?.get<Record<string, unknown>>() ?? {};
    const section = conf[this.name];
    return section && typeof section === "object" && !Array.isArray(section)
      ? section as Record<string, unknown>
      : null;
  }

  /** Return true when this habitat has alias-scoped config preload material. */
  hasConfigSection(): boolean {
    return this.configuredSection() !== null;
  }

  /**
   * Apply alias-scoped controller endpoint config through the real CESR parser path.
   *
   * KERIpy correspondence:
   * - `Hab` owns per-alias config lookup and reply ingestion
   * - config remains immutable bootstrap input, not mutable database state
   */
  reconfigure(): boolean {
    const conf = this.configuredSection();
    if (!conf || !this.pre || !this.accepted) {
      return false;
    }

    const dt = requireConfigDatetime(this.name, conf.dt);
    const messages: Uint8Array[] = [
      this.makeEndRole(this.pre, Roles.controller, true, dt),
    ];
    for (const url of loadConfigUrls(conf.curls)) {
      const parsed = new URL(url);
      const scheme = parsed.protocol.length > 0
        ? parsed.protocol.slice(0, -1)
        : Schemes.http;
      messages.push(this.makeLocScheme(url, this.pre, scheme, dt));
    }
    this.ingestLocalCesr(concatMessages(messages));
    return true;
  }

  /**
   * Incept this habitat through the shared accepted-state path.
   *
   * KERIpy correspondence:
   * - mirrors the pattern where local inception is signed in the habitat layer
   *   and then fed through `Kevery.processEvent()` rather than hand-writing
   *   `states.`/`kels.` directly
   */
  make(args: MakeHabArgs = {}): void {
    const {
      code = "E",
      transferable = true,
      isith = undefined,
      icount = 1,
      icode = undefined,
      nsith = undefined,
      ncount = undefined,
      ncode = undefined,
      toad = 0,
      wits = [],
      delpre = undefined,
      estOnly = false,
      DnD = false,
      hidden = false,
      data = [],
      algo = undefined,
      salt = undefined,
      tier = undefined,
    } = args;

    let nextCount = ncount ?? icount;
    let nextSith = nsith ?? isith;
    let prefixCode = code;
    if (!transferable) {
      nextCount = 0;
      nextSith = "0";
    }

    const [verfers, digers] = this.mgr.incept({
      icount,
      ncount: nextCount,
      icode,
      ncode,
      stem: this.ns ? `${this.ns}${this.name}` : this.name,
      transferable,
      algo,
      salt,
      tier,
    });

    if (!transferable && verfers.length === 1) {
      prefixCode = verfers[0].code;
    }

    const keys = verfers.map((v) => v.qb64);
    const ndigs = digers.map((d) => d.qb64);
    const cnfg = [...(estOnly ? ["EO"] : []), ...(DnD ? ["DND"] : [])];

    const currentSith = isith ?? defaultThreshold(keys.length, 1);
    const nextThreshold = nextSith ?? defaultThreshold(ndigs.length, 0);
    const serder = makeInceptRaw(keys, ndigs, {
      code: prefixCode,
      isith: currentSith,
      nsith: nextThreshold,
      toad,
      wits,
      cnfg,
      data,
      delpre,
    });
    const pre = serder.pre;
    if (!pre || !serder.said) {
      throw new Error(
        "Expected inception serder to provide string pre and said.",
      );
    }

    const opre = verfers[0].qb64;
    this.mgr.move(opre, pre);
    this.pre = pre;

    if (!hidden) {
      const habord = new HabitatRecord({
        hid: pre,
        name: this.name,
        domain: this.ns,
      });
      this.db.pinHab(pre, habord);
      this.db.pinName(this.ns ?? "", this.name, pre);
      this.db.prefixes.add(pre);
    }

    const sigs = this.mgr.sign(serder.raw, keys, true);
    try {
      this.acceptLocally(serder, sigs);
    } catch (error) {
      if (!hidden) {
        this.db.prefixes.delete(pre);
      }
      throw error;
    }
  }

  /**
   * Rotate this habitat through the shared accepted-state path.
   *
   * KERIpy correspondence:
   * - advances keeper state first via `Manager.replay()` or `Manager.rotate()`
   * - rolls keeper state back if local `Kevery` acceptance rejects the event
   * - erases stale old private keys only after successful acceptance
   */
  rotate(args: {
    isith?: ThresholdSith;
    nsith?: ThresholdSith;
    ncount?: number;
    toad?: number;
    cuts?: string[];
    adds?: string[];
    data?: unknown[];
  } = {}): Uint8Array {
    if (!this.pre) {
      throw new ValidationError("Rotation requires a local habitat prefix.");
    }
    const kever = this.kever;
    if (!kever) {
      throw new ValidationError(`Missing accepted key state for ${this.pre}.`);
    }

    const priorSit = this.ks.getSits(this.pre);
    if (!priorSit) {
      throw new ValidationError(`Missing keeper state for ${this.pre}.`);
    }

    const defaultCount = args.ncount ?? kever.ndigers.length;
    let verfers: Verfer[];
    let digers: Diger[];
    try {
      // Prefer replayed pre-rotated material when keeper state already has it,
      // matching the operator expectation that an earlier pre-rotation is
      // consumed before brand-new next keys are generated.
      [verfers, digers] = this.mgr.replay({
        pre: this.pre,
        erase: false,
      });
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error;
      }
      [verfers, digers] = this.mgr.rotate({
        pre: this.pre,
        ncount: defaultCount,
        temp: this.ks.temp,
        erase: false,
      });
    }

    const currentSith = args.isith ?? kever.ntholder?.sith;
    const nextSith = args.nsith ?? currentSith;
    const preservedToad = args.toad
      ?? ((args.cuts?.length ?? 0) === 0 && (args.adds?.length ?? 0) === 0
        ? Number(kever.toader.num)
        : undefined);
    const keys = verfers.map((verfer) => verfer.qb64);
    const ndigs = digers.map((diger) => diger.qb64);

    try {
      const serder = makeRotateRaw(
        this.pre,
        kever.serder.said ?? kever.said,
        kever.sn + 1,
        keys,
        ndigs,
        {
          delegated: kever.delpre !== null,
          currentWits: [...kever.wits],
          isith: currentSith,
          nsith: nextSith,
          toad: preservedToad,
          cuts: args.cuts,
          adds: args.adds,
          data: args.data,
        },
      );
      const sigers = this.mgr.sign(serder.raw, keys, true) as Siger[];
      this.acceptLocally(serder, sigers);

      // Old private keys become stale only after local accepted state advances.
      // That ordering is what makes the interop "verify fails before query,
      // succeeds after query" story honest instead of a local-storage trick.
      for (const pub of new PreSit(priorSit).old.pubs) {
        this.ks.pris.rem(pub);
      }

      return buildEventMessage(serder, sigers);
    } catch (error) {
      // Roll keeper state back if the event was not accepted locally. The
      // accepted-state machine, not keeper progression alone, defines success.
      this.ks.pinSits(this.pre, new PreSit(priorSit));
      throw error;
    }
  }

  /** Produces signatures with this habitat's current signing keys. */
  sign(ser: Uint8Array, indexed: true): Siger[];
  sign(ser: Uint8Array, indexed?: false): Cigar[];
  sign(ser: Uint8Array, indexed = false): Siger[] | Cigar[] {
    if (!this.pre) {
      throw new ValidationError("Signing requires a local habitat prefix.");
    }
    const kever = this.kever;
    if (!kever) {
      throw new ValidationError(`Missing accepted key state for ${this.pre}.`);
    }
    const pubs = kever.verfers.map((verfer) => verfer.qb64);
    if (indexed) {
      return this.mgr.sign(ser, pubs, true);
    }
    return this.mgr.sign(ser, pubs, false);
  }

  /**
   * Endorse one already-built KERI message body with this habitat's current
   * establishment keys.
   *
   * Current supported endorsement shapes:
   * - transferable indexed signature groups anchored to the latest accepted
   *   establishment event
   * - non-transferable detached signature cigars with attached verifier
   *   context for local replay/reload flows
   *
   * Current `keri-ts` limitation:
   * - the Gate E bootstrap path only actively uses the transferable branch for
   *   locally generated replies and queries
   */
  endorse(
    serder: SerderKERI,
    options: {
      pipelined?: boolean;
    } = {},
  ): Uint8Array {
    if (!this.pre) {
      throw new Error("Cannot endorse a message before habitat inception.");
    }
    const kever = this.kever;
    if (!kever) {
      throw new Error(`Missing accepted key state for ${this.pre}.`);
    }
    const prefixer = kever.prefixer;
    const pipelined = options.pipelined ?? true;
    if (!kever.transferable) {
      return buildEndorsedMessage({
        serder,
        cigars: this.sign(serder.raw, false) as Cigar[],
        pipelined,
      });
    }

    const sigers = this.sign(serder.raw, true) as Siger[];
    if (serder.ilk === Ilks.qry) {
      return buildEndorsedMessage({
        serder,
        ssg: new TransLastIdxSigGroup(prefixer, sigers),
        pipelined,
      });
    }

    const estSaid = kever.lastEst.d || kever.said;
    if (!estSaid) {
      throw new Error(`Missing establishment event for ${this.pre}.`);
    }
    const estEvent = this.db.getEvtSerder(this.pre, estSaid);
    const seqner = estEvent?.sner;
    if (!seqner) {
      throw new Error(`Missing establishment sequence number for ${this.pre}.`);
    }
    return buildEndorsedMessage({
      serder,
      tsg: new TransIdxSigGroup(
        prefixer,
        seqner,
        new Diger({ qb64: estSaid }),
        sigers,
      ),
      pipelined,
    });
  }

  /**
   * Create and sign one reply event with this habitat's current establishment keys.
   *
   * The returned bytes are a complete wire message. Transferable reply
   * attachments are anchored to the habitat's latest accepted establishment
   * event, matching the KERI reply-endorsement model.
   */
  reply(
    route: string,
    data: Record<string, unknown>,
    stamp = makeNowIso8601(),
  ): Uint8Array {
    if (!this.pre) {
      throw new Error("Cannot build a reply before habitat inception.");
    }
    return this.endorse(makeReplySerder(route, data, stamp));
  }

  /**
   * Create and sign one query message from this habitat.
   *
   * This mirrors the intent of KERIpy's `BaseHab.query()` while staying within
   * the current Gate E bootstrap message surface.
   */
  query(
    pre: string,
    src: string,
    query: Record<string, unknown> = {},
    route = "",
    stamp = makeNowIso8601(),
  ): Uint8Array {
    return this.endorse(
      makeQuerySerder(route, { ...query, i: pre, src }, stamp),
    );
  }

  /**
   * Create and locally accept one controller receipt for `serder`.
   *
   * KERI semantics:
   * - receipt signatures cover the receipted event bytes, not the `rct`
   *   message body
   * - transferable receiptors emit transferable indexed-signature groups
   * - non-transferable receiptors emit receipt couples
   */
  receipt(serder: SerderKERI): Uint8Array {
    const pre = serder.pre;
    const sn = serder.sn;
    const said = serder.said;
    const kever = this.kever;
    if (!pre || sn === null || !said) {
      throw new ValidationError(
        "Receipted event must expose pre, sn, and said.",
      );
    }
    if (!kever) {
      throw new ValidationError(`Missing accepted key state for ${this.pre}.`);
    }

    const reserder = makeReceiptSerder(pre, sn, said);

    if (!kever.transferable) {
      const cigars = this.sign(serder.raw, false) as Cigar[];
      this.kvy.processReceipt({
        serder: reserder,
        cigars,
        wigers: [],
        tsgs: [],
        local: true,
      });
      return buildReceiptMessage({ serder: reserder, cigars });
    }

    const estSaid = kever.lastEst.d || kever.said;
    const estEvent = estSaid ? this.db.getEvtSerder(this.pre, estSaid) : null;
    const seqner = estEvent?.sner;
    if (!estSaid || !seqner) {
      throw new ValidationError(
        `Missing establishment event material for transferable receiptor ${this.pre}.`,
      );
    }
    const sigers = this.sign(serder.raw, true) as Siger[];
    const tsg = new TransIdxSigGroup(
      kever.prefixer,
      seqner,
      new Diger({ qb64: estSaid }),
      sigers,
    );
    this.kvy.processReceipt({
      serder: reserder,
      cigars: [],
      wigers: [],
      tsgs: [tsg],
      local: true,
    });
    return buildReceiptMessage({ serder: reserder, tsgs: [tsg] });
  }

  /**
   * Create and locally accept one witness receipt for `serder`.
   *
   * The current habitat must be a non-transferable witness listed on the
   * receipted event's witness state.
   */
  witness(serder: SerderKERI): Uint8Array {
    const pre = serder.pre;
    const sn = serder.sn;
    const said = serder.said;
    const kever = this.kever;
    if (!pre || sn === null || !said) {
      throw new ValidationError(
        "Receipted event must expose pre, sn, and said.",
      );
    }
    if (!kever) {
      throw new ValidationError(`Missing accepted key state for ${this.pre}.`);
    }
    if (kever.transferable) {
      throw new ValidationError(
        `Witness receipts require a non-transferable witness habitat, got ${this.pre}.`,
      );
    }

    const wits = this.receiptedWitnesses(serder);
    const index = wits.indexOf(this.pre);
    if (index < 0) {
      throw new ValidationError(
        `${this.pre} is not an authorized witness for ${pre}:${said}.`,
      );
    }

    const reserder = makeReceiptSerder(pre, sn, said);
    const wigers = this.mgr.sign(serder.raw, {
      pubs: [this.pre],
      indexed: true,
      indices: [index],
    }) as Siger[];
    this.kvy.processReceipt({
      serder: reserder,
      cigars: [],
      wigers,
      tsgs: [],
      local: true,
    });
    return buildReceiptMessage({ serder: reserder, wigers });
  }

  /**
   * Create one signed endpoint-role authorization reply for this habitat.
   *
   * This is the local helper behind `tufa ends add` and endpoint-role OOBI
   * dissemination.
   */
  makeEndRole(
    eid: string,
    role: Role | string = Roles.controller,
    allow = true,
    stamp = makeNowIso8601(),
  ): Uint8Array {
    return this.reply(
      allow ? "/end/role/add" : "/end/role/cut",
      { cid: this.pre, role, eid },
      stamp,
    );
  }

  /**
   * Create one signed endpoint-location reply for this habitat.
   *
   * The endpoint AID defaults to the habitat's own prefix because the most
   * common bootstrap case is self-advertised controller/agent/mailbox hosting.
   */
  makeLocScheme(
    url: string,
    eid = this.pre,
    scheme: Scheme | string = Schemes.http,
    stamp = makeNowIso8601(),
  ): Uint8Array {
    return this.reply("/loc/scheme", { eid, scheme, url }, stamp);
  }

  /**
   * Return stored non-empty location URLs keyed by scheme for one endpoint AID.
   *
   * This is a pure projection over `locs.`; it does not synthesize default
   * schemes or perform any lookup beyond local state.
   */
  fetchUrls(eid: string, scheme = ""): Record<string, string> {
    const urls: Record<string, string> = {};
    const keys = scheme ? [eid, scheme] : [eid];
    for (
      const [path, loc] of this.db.locs.getTopItemIter(keys, {
        topive: !scheme,
      })
    ) {
      const currentScheme = path[1];
      if (!currentScheme || !loc.url) {
        continue;
      }
      urls[currentScheme] = loc.url;
    }
    return urls;
  }

  /**
   * Project authorized endpoint URLs for one controller AID.
   *
   * Output shape:
   * - role -> endpoint AID -> scheme-keyed URL map
   *
   * Witnesses are derived from current key state as well as stored location
   * replies because witness membership is partly a KEL concern, not just an
   * endpoint-authorization concern.
   */
  endsFor(pre: string): Record<string, Record<string, Record<string, string>>> {
    const ends: Record<string, Record<string, Record<string, string>>> = {};

    for (
      const [keys, end] of this.db.ends.getTopItemIter([pre], { topive: true })
    ) {
      const role = keys[1];
      const eid = keys[2];
      if (!role || !eid || !(end.allowed || end.enabled)) {
        continue;
      }
      const urls = this.fetchUrls(eid);
      if (Object.keys(urls).length === 0) {
        continue;
      }
      ends[role] ??= {};
      ends[role][eid] = urls;
    }

    const kever = this.db.getKever(pre);
    if (kever?.wits && kever.wits.length > 0) {
      const witnessUrls: Record<string, Record<string, string>> = {};
      for (const eid of kever.wits) {
        const urls = this.fetchUrls(eid);
        if (Object.keys(urls).length === 0) {
          continue;
        }
        witnessUrls[eid] = urls;
      }
      if (Object.keys(witnessUrls).length > 0) {
        ends[Roles.witness] = witnessUrls;
      }
    }

    return ends;
  }

  /**
   * Reload one stored `/end/role/*` reply message from reply-state DBs.
   *
   * Returns an empty message when the requested authorization is not presently
   * enabled or allowed.
   */
  loadEndRole(
    cid: string,
    eid: string,
    role: Role | string = Roles.controller,
  ): Uint8Array {
    const end = this.db.ends.get([cid, role, eid]);
    if (!end || !(end.allowed || end.enabled)) {
      return emptyMessage();
    }
    const said = this.db.eans.get([cid, role, eid]);
    return said ? loadReplyMessageBySaid(this.db, said.qb64) : emptyMessage();
  }

  /**
   * Reload stored `/loc/scheme` reply messages for one endpoint and optional scheme.
   *
   * Without a scheme filter this may concatenate multiple stored scheme replies
   * into one outbound byte stream.
   */
  loadLocScheme(eid: string, scheme?: string): Uint8Array {
    const messages: Uint8Array[] = [];
    const keys = scheme ? [eid, scheme] : [eid];
    for (
      const [, said] of this.db.lans.getTopItemIter(keys, { topive: !scheme })
    ) {
      messages.push(loadReplyMessageBySaid(this.db, said.qb64));
    }
    return concatMessages(messages.filter((msg) => msg.length > 0));
  }

  /**
   * Generate fresh `/loc/scheme` replies from local location state.
   *
   * This is used when the local habitat is the authoritative speaker for the
   * endpoint, so a newly signed reply is preferred over replaying an older
   * stored reply.
   */
  replyLocScheme(eid: string, scheme = ""): Uint8Array {
    const messages: Uint8Array[] = [];
    for (
      const [currentScheme, url] of Object.entries(this.fetchUrls(eid, scheme))
    ) {
      messages.push(this.makeLocScheme(url, eid, currentScheme));
    }
    return concatMessages(messages);
  }

  /**
   * Generate the reply/message stream used for role-based OOBI discovery.
   *
   * Current composition order:
   * 1. cloned KEL messages for the controller AID
   * 2. witness location/auth material when serving witness OOBIs
   * 3. endpoint location/auth replies from `locs.` and `ends.`
   *
   * This mirrors the shape of KERIpy's `replyEndRole()` output while remaining
   * limited to the Gate E bootstrap role families.
   */
  replyEndRole(
    cid: string,
    role?: Role | string,
    eids: string[] = [],
    scheme = "",
  ): Uint8Array {
    const messages: Uint8Array[] = [];
    const cloned = new Set<string>();
    const appendClone = (pre: string) => {
      if (!pre || cloned.has(pre)) {
        return;
      }
      messages.push(...this.db.clonePreIter(pre));
      cloned.add(pre);
    };
    appendClone(cid);

    if (role === Roles.witness) {
      const kever = this.db.getKever(cid);
      for (const eid of kever?.wits ?? []) {
        if (eids.length > 0 && !eids.includes(eid)) {
          continue;
        }
        appendClone(eid);
        messages.push(
          eid === this.pre
            ? this.replyLocScheme(eid, scheme)
            : this.loadLocScheme(eid, scheme),
        );
        if (cid === this.pre) {
          messages.push(this.makeEndRole(eid, Roles.witness, true));
        }
      }
    }

    for (
      const [keys, end] of this.db.ends.getTopItemIter([cid], { topive: true })
    ) {
      const currentRole = keys[1];
      const eid = keys[2];
      if (!currentRole || !eid || !(end.allowed || end.enabled)) {
        continue;
      }
      if (role && currentRole !== role) {
        continue;
      }
      if (eids.length > 0 && !eids.includes(eid)) {
        continue;
      }
      appendClone(eid);
      messages.push(this.loadLocScheme(eid, scheme));
      messages.push(this.loadEndRole(cid, eid, currentRole));
    }

    return concatMessages(messages.filter((msg) => msg.length > 0));
  }

  /**
   * Entry point used by OOBI HTTP resource serving.
   *
   * The current bootstrap implementation delegates directly to `replyEndRole()`
   * so the recognizable KERIpy seam exists before broader discovery policy is
   * implemented.
   */
  replyToOobi(
    aid: string,
    role?: Role | string,
    eids: string[] = [],
  ): Uint8Array {
    return this.replyEndRole(aid, role, eids);
  }

  /**
   * Resolve the witness list that governs receipts for one event.
   *
   * Preference order:
   * - the durable event-level `wits.` projection when present
   * - the event body's own backer list for inception events
   * - the current accepted kever witness list as a last resort
   */
  private receiptedWitnesses(serder: SerderKERI): string[] {
    const pre = serder.pre;
    const said = serder.said;
    if (!pre || !said) {
      return [];
    }

    const stored = this.db.wits.get(dgKey(pre, said)).map((wit) => wit.qb64);
    if (stored.length > 0) {
      return stored;
    }

    if (serder.ilk === Ilks.icp || serder.ilk === Ilks.dip) {
      return [...serder.backs];
    }

    return [...(this.db.getKever(pre)?.wits ?? [])];
  }

  /**
   * Process KERI-style cues and yield structured runtime cue emissions.
   *
   * KERIpy correspondence:
   * - this is the `keri-ts` equivalent of `BaseHab.processCuesIter()`
   *
   * `keri-ts` difference:
   * - the cue identity is preserved in the yielded `CueEmission` instead of
   *   collapsing everything immediately to raw bytes
   *
   * Current support:
   * - `receipt`, `witness`, `replay`, `reply`, and complete `query` cues emit
   *   wire messages
   * - `stream` emits transport requests without flattening them into bytes
   * - observer/runtime cues remain visible as notify emissions
   */
  *processCuesIter(
    cues: Deck<AgentCue> | Iterable<AgentCue>,
  ): Generator<CueEmission> {
    const queue = cues instanceof Deck ? cues : new Deck(cues);
    while (!queue.empty) {
      const cue = queue.pull();
      if (!cue) {
        continue;
      }
      switch (cue.kin) {
        case "receipt":
          yield { cue, msgs: [this.receipt(cue.serder)], kind: "wire" };
          break;
        case "witness":
          yield { cue, msgs: [this.witness(cue.serder)], kind: "wire" };
          break;
        case "replay":
          yield { cue, msgs: [cue.msgs], kind: "wire" };
          break;
        case "reply":
          yield {
            cue,
            msgs: [
              cue.serder
                ? this.endorse(cue.serder)
                : this.reply(cue.route, cue.data ?? {}),
            ],
            kind: "wire",
          };
          break;
        case "query": {
          const query = cue.query ?? cue.q ?? {};
          if (cue.pre && cue.src) {
            yield {
              cue,
              msgs: [this.query(cue.pre, cue.src, query, cue.route ?? "")],
              kind: "wire",
            };
            break;
          }
          yield { cue, msgs: [], kind: "notify" };
          break;
        }
        case "stream":
          yield { cue, msgs: [], kind: "transport" };
          break;
        case "notice":
        case "noticeBadCloneFN":
        case "keyStateSaved":
        case "invalid":
        case "psUnescrow":
        case "remoteMemberedSig":
        case "oobiQueued":
        case "oobiResolved":
        case "oobiFailed":
          yield { cue, msgs: [], kind: "notify" };
          break;
        default:
          break;
      }
    }
  }
}

/**
 * Internal signatory habitat wrapper used for habery-scoped signatures.
 *
 * KERIpy correspondence:
 * - mirrors the idea of a persisted `__signatory__` habitat owned by the
 *   enclosing habery
 * - verifies through the live signatory habitat verifier instead of
 *   reconstructing one ad hoc from the prefix
 *
 * Current `keri-ts` differences:
 * - signing/verification are deterministic local-hab wrappers, not a full
 *   parity implementation of KERIpy signatory lifecycle and reopen logic
 */
export class Signator {
  readonly db: Baser;
  readonly hab: Hab;
  pre: string;

  /** Reopen or create the habery-owned `__signatory__` habitat wrapper. */
  constructor(args: {
    db: Baser;
    ks: Keeper;
    mgr: Manager;
    cf?: Configer;
    rtr: Router;
    rvy: Revery;
    kvy: Kevery;
  }) {
    const { db, ks, mgr, cf, rtr, rvy, kvy } = args;
    this.db = db;
    const spre = this.db.getHby(SIGNER);
    if (!spre) {
      const hab = new Hab(
        SIGNER,
        db,
        ks,
        mgr,
        cf,
        rtr,
        rvy,
        kvy,
      );
      hab.make({ transferable: false, hidden: true });
      this.hab = hab;
      this.pre = hab.pre;
      this.db.pinHby(SIGNER, this.pre);
    } else {
      const hab = new Hab(
        SIGNER,
        db,
        ks,
        mgr,
        cf,
        rtr,
        rvy,
        kvy,
        undefined,
        spre,
      );
      this.hab = hab;
      this.pre = spre;
    }
  }

  /**
   * Sign arbitrary serialized bytes with the habery-owned signatory habitat.
   *
   * KERIpy parity:
   * - delegates to the underlying hab with `indexed=false`
   * - returns the first hydrated detached `Cigar`
   */
  sign(ser: Uint8Array): Cigar {
    const sig = this.hab.sign(ser, false)[0];
    if (!sig) throw new Error("Unable to sign");
    return sig;
  }

  /** Return the current verifier from the signatory habitat's accepted key state. */
  get verfer(): Verfer {
    const verfer = this.hab.kever?.verfers[0];
    if (!verfer) {
      throw new Error("Signator has no accepted verifier.");
    }
    return verfer;
  }

  /** Verify one detached `Cigar` through the signatory habitat's live verifier. */
  verify(ser: Uint8Array, cigar: Cigar): boolean {
    return this.verfer.verify(cigar.raw, ser);
  }
}

/**
 * Top-level controller container for databases, key manager, config, and local
 * habitats.
 *
 * Responsibilities:
 * - compose `Baser`, `Keeper`, `Manager`, optional config, and loaded habitats
 * - own the habery-local `Kevery` used by `Hab` for local KEL/receipt
 *   acceptance outside the runtime host
 * - eagerly reconstruct persisted habitat visibility on open
 * - provide app-layer alias lookup and habitat creation boundaries
 *
 * State model:
 * - `habs` is an in-memory cache of reconstructed `Hab` instances
 * - durable habitat metadata lives in `habs.`
 * - durable current key state lives in `states.` with supporting `evts.`,
 *   `kels.`, `fels.`, and `dtss.` data in `Baser`
 * - accepted current key state is owned by live `Kever` instances reloaded into
 *   `Baser.kevers`
 * - `Hab.kever` resolves that accepted-state cache instead of reconstructing a
 *   thin projection ad hoc
 * - `Habery.kevery` owns a separate local cue deck from the runtime-owned cue
 *   deck created by `createAgentRuntime()`
 *
 * Current `keri-ts` differences:
 * - readonly compatibility opens may intentionally skip config processing and
 *   signator creation for visibility-only commands
 * - config-driven OOBI processing and broader KEL/state orchestration are not
 *   yet at KERIpy parity
 */
export class Habery {
  readonly name: string;
  readonly base: string;
  readonly temp: boolean;
  readonly headDirPath?: string;
  readonly compat: boolean;
  readonly readonly: boolean;
  readonly db: Baser;
  readonly ks: Keeper;
  readonly obx: OutboxerLike;
  readonly cesrBodyMode: CesrBodyMode;
  readonly mgr: Manager;
  readonly cf?: Configer;
  readonly habs = new Map<string, Hab>();
  readonly rtr: Router;
  readonly rvy: Revery;
  readonly kevery: Kevery;
  readonly replyRoutes: BasicReplyRouteHandler;
  readonly signator: Signator | null;

  /** Compose one habery from already-opened storage, manager, and config surfaces. */
  constructor(
    name: string,
    base: string,
    temp: boolean,
    headDirPath: string | undefined,
    compat: boolean,
    readonly: boolean,
    db: Baser,
    ks: Keeper,
    obx: OutboxerLike,
    cesrBodyMode: CesrBodyMode,
    mgr: Manager,
    cf?: Configer,
    skipSignator = false,
  ) {
    this.name = name;
    this.base = base;
    this.temp = temp;
    this.headDirPath = headDirPath;
    this.compat = compat;
    this.readonly = readonly;
    this.db = db;
    this.ks = ks;
    this.obx = obx;
    this.cesrBodyMode = cesrBodyMode;
    this.mgr = mgr;
    this.cf = cf;
    this.rtr = new Router();
    const localCues = new Deck<AgentCue>();
    this.rvy = new Revery(this.db, {
      rtr: this.rtr,
      cues: localCues,
      lax: false,
      local: true,
    });
    this.replyRoutes = new BasicReplyRouteHandler(this.db, this.rvy);
    this.replyRoutes.registerReplyRoutes(this.rtr);
    this.kevery = new Kevery(this.db, {
      cues: localCues,
      lax: false,
      local: true,
      rvy: this.rvy,
    });
    this.kevery.registerReplyRoutes(this.rtr);
    this.signator = skipSignator ? null : new Signator({
      db: this.db,
      ks: this.ks,
      mgr: this.mgr,
      cf: this.cf,
      rtr: this.rtr,
      rvy: this.rvy,
      kvy: this.kevery,
    });
    this.loadHabs();
  }

  /** Live config snapshot from the optional config file surface. */
  get config(): Record<string, unknown> {
    return this.cf?.get<Record<string, unknown>>() ?? {};
  }

  /**
   * Populate the in-memory habitat cache from durable `habs.` + `states.` data.
   *
   * Bare metadata records without corresponding accepted key state are skipped
   * so `Habery.habs` only contains reopenable local habitats.
   */
  private loadHabs(): void {
    this.reconfigure();
    this.habs.clear();

    for (const [pre, habord] of this.db.getHabItemIter()) {
      const hid = habord.hid || pre;
      if (!habord.name || this.habs.has(hid)) {
        continue;
      }
      const hab = new Hab(
        habord.name,
        this.db,
        this.ks,
        this.mgr,
        this.cf,
        this.rtr,
        this.rvy,
        this.kevery,
        habord.domain,
        hid,
      );
      if (!hab.accepted) {
        throw new ValidationError(
          `Problem loading Hab pre=${hid} name=${habord.name} from db.`,
        );
      }
      this.habs.set(hab.pre, hab);
    }
    for (const hab of this.habs.values()) {
      hab.reconfigure();
    }
  }

  /** Local AID prefixes currently managed by this habery. */
  get prefixes(): string[] {
    return [...this.db.prefixes];
  }

  /**
   * Seed OOBI queues from config-file preload material.
   *
   * Config is treated as immutable bootstrap input, matching KERIpy's
   * "preload the database, do not use config as a mutable database" rule.
   *
   * Stores touched:
   * - `oobis.` for controller/delegate bootstrap URLs
   * - `woobi.` for witness bootstrap URLs
   */
  reconfigure(): void {
    const conf = this.config;
    if (typeof conf.dt === "string") {
      const date = conf.dt;
      for (
        const url of [
          ...loadConfigUrls(conf.iurls),
          ...loadConfigUrls(conf.durls),
        ]
      ) {
        this.db.oobis.pin(url, { date, state: "queued" });
      }
      for (const url of loadConfigUrls(conf.wurls)) {
        this.db.woobi.pin(url, { date, state: "queued" });
      }
    }
  }

  /** Creates and caches a new habitat under this habery. */
  makeHab(name: string, ns?: string, args: MakeHabArgs = {}): Hab {
    const hab = new Hab(
      name,
      this.db,
      this.ks,
      this.mgr,
      this.cf,
      this.rtr,
      this.rvy,
      this.kevery,
      ns,
      "",
    );
    hab.make(args);
    if (!hab.pre) throw new Error("Hab creation failed");
    this.habs.set(hab.pre, hab);
    hab.reconfigure();
    return hab;
  }

  /**
   * Resolve a habitat by alias (and optional namespace) using DB-backed state.
   *
   * This uses `names.` for alias lookup, `habs.` for metadata, and accepted
   * `Kever` state for reopenable current state before materializing a cached
   * `Hab`.
   */
  habByName(name: string, ns?: string): Hab | null {
    const pre = this.db.getName(ns ?? "", name);
    if (!pre) return null;
    if (this.habs.has(pre)) return this.habs.get(pre)!;
    const rec = this.db.getHab(pre);
    if (!rec || !this.db.getKever(pre)) return null;
    const hab = new Hab(
      name,
      this.db,
      this.ks,
      this.mgr,
      this.cf,
      this.rtr,
      this.rvy,
      this.kevery,
      ns,
      pre,
    );
    hab.reconfigure();
    this.habs.set(pre, hab);
    return hab;
  }

  /** Closes backing databases and optionally clears temp storage. */
  *close(clear = false): Operation<void> {
    yield* this.db.close(clear);
    yield* this.ks.close(clear);
    yield* this.obx.close(clear);
    if (this.cf) {
      yield* this.cf.close(clear && this.temp);
    }
  }
}

/**
 * Derive deterministic seed/AEID material from one passcode string.
 *
 * KERIpy correspondence:
 * - mirrors the `bran` -> `seed`/`aeid` derivation used for encrypted habery
 *   reopen flows
 */
export function branToSeedAeid(bran: string): { seed: string; aeid: string } {
  const branSalt = branToSaltQb64(bran);
  const signer = saltySigner(branSalt, "", false, Tiers.low, false);
  return { seed: signer.signer.qb64, aeid: signer.verfer.qb64 };
}

/**
 * Create a `Habery` with reopened database/keystore surfaces and manager state.
 *
 * The returned `Habery` immediately reconstructs its local habitat cache from
 * durable DB state rather than depending on process-local creation history.
 */
export function* createHabery(args: HaberyArgs): Operation<Habery> {
  const {
    name,
    base = "",
    temp = false,
    headDirPath,
    compat = false,
    readonly = false,
    cf: providedCf,
    skipConfig = false,
    skipSignator = false,
    bran,
    seed,
    aeid,
    salt,
    algo,
    outboxer = "disabled",
    cesrBodyMode = DEFAULT_CESR_BODY_MODE,
  } = args;

  const db = yield* createBaser({
    name,
    base,
    temp,
    headDirPath,
    compat,
    reopen: true,
    readonly,
  });
  const ks = yield* createKeeper({
    name,
    base,
    temp,
    headDirPath,
    compat,
    reopen: true,
    readonly,
  });
  if (compat && outboxer !== "disabled") {
    throw new ValidationError(
      "Outboxer is a tufa-only sidecar and is unavailable in compat mode.",
    );
  }
  const obx = outboxer === "disabled"
    ? new DisabledOutboxer()
    : (yield* createOutboxer({
      name,
      base,
      temp,
      headDirPath,
      compat,
      reopen: true,
      readonly,
      mustExist: outboxer === "open",
    }));

  const cf = providedCf
    ?? (skipConfig ? undefined : (yield* createConfiger({
      name,
      base,
      temp,
      headDirPath,
      reopen: true,
      clear: false,
    })));

  let usedSeed = seed ?? "";
  let usedAeid = aeid ?? "";
  if (bran && !seed) {
    const derived = branToSeedAeid(bran);
    usedSeed = derived.seed;
    if (!usedAeid) usedAeid = derived.aeid;
  }

  // Keep the old startup seam for callers that were explicit about encrypted
  // keeper readiness, even though CESR primitives now own sodium readiness.
  ensureKeeperCryptoReady();
  const mgr = new Manager({
    ks,
    seed: usedSeed,
    aeid: usedAeid,
    algo,
    salt: normalizeSaltQb64(salt),
  });

  return new Habery(
    name,
    base,
    temp,
    headDirPath,
    compat,
    readonly,
    db,
    ks,
    obx,
    cesrBodyMode,
    mgr,
    cf,
    skipSignator,
  );
}
