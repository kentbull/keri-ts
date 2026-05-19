/** KERI event-log databaser built on `LMDBer` composition. */

import { action, type Operation } from "npm:effection@^3.6.0";
import type { Database } from "npm:lmdb";
import {
  b,
  Cigar,
  concatBytes,
  Counter,
  CtrDexV1,
  Dater,
  Diger,
  Labeler,
  Noncer,
  NumberPrimitive,
  NumDex,
  Prefixer,
  Saider,
  SealEvent,
  SerderKERI,
  Siger,
  t,
  Texter,
  Verfer,
  Verser,
} from "../../../cesr/mod.ts";
import { DatabaseNotOpenError, DatabaseOperationError } from "../core/errors.ts";
import { Kever } from "../core/kever.ts";
import { consoleLogger, type Logger } from "../core/logger.ts";
import {
  BlindedImageTuple,
  BlindedStateQuadrupleTuple,
  BoundStateSextuple,
  CacheTypeRecord,
  type CacheTypeRecordShape,
  EndpointRecord,
  type EndpointRecordShape,
  EscrowedValidatorReceiptQuintuple,
  EventSealTuple,
  EventSourceRecord,
  type EventSourceRecordShape,
  FirstSeenReplayCouple,
  HabitatRecord,
  type HabitatRecordShape,
  KeyStateRecord,
  type KeyStateRecordShape,
  LocationRecord,
  type LocationRecordShape,
  MsgCacheRecord,
  type MsgCacheRecordShape,
  ObservedRecord,
  type ObservedRecordShape,
  OobiRecord,
  type OobiRecordShape,
  ReceiptCouple,
  SourceSealTriple,
  TopicsRecord,
  type TopicsRecordShape,
  TxnMsgCacheRecord,
  type TxnMsgCacheRecordShape,
  TypedDigestSealCouple,
  TypedMediaQuadrupleTuple,
  UnverifiedReceiptTriple,
  ValidatorReceiptQuadruple,
  VerferCigarCouple,
  WellKnownAuthN,
  type WellKnownAuthNShape,
} from "../core/records.ts";
import { dgKey } from "./core/keys.ts";
import { BinKey, BinVal, LMDBer, LMDBerOptions } from "./core/lmdber.ts";
import { IoSetKomer, Komer } from "./koming.ts";
import {
  B64OnIoDupSuber,
  CatCesrIoSetSuber,
  CatCesrSuber,
  CesrIoSetSuber,
  CesrOnSuber,
  CesrSuber,
  IoSetSuber,
  OnIoDupSuber,
  OnSuber,
  SchemerSuber,
  SerderSuber,
  Suber,
} from "./subing.ts";

const KERI_V1 = Object.freeze({ major: 1, minor: 0 } as const);

function isMissingReloadEventError(error: unknown): boolean {
  return error instanceof Error
    && error.message.startsWith("Missing accepted event for reloaded Kever state ");
}

type EventSealRecord = ReturnType<typeof SealEvent.fromSad>;

function isEventSealRecord(value: unknown): value is EventSealRecord {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && "i" in value
    && "s" in value
    && "d" in value
    && (value as { i: unknown }).i instanceof Prefixer
    && (value as { s: unknown }).s instanceof NumberPrimitive
    && (value as { d: unknown }).d instanceof Diger;
}

function normalizeEventSeal(value: unknown): EventSealRecord | null {
  if (isEventSealRecord(value)) {
    return value;
  }
  if (!SealEvent.isSad(value)) {
    return null;
  }
  try {
    return SealEvent.fromSad(value);
  } catch {
    return null;
  }
}

function eventSealsEqual(left: EventSealRecord, right: EventSealRecord): boolean {
  return left.i.qb64 === right.i.qb64
    && left.s.numh === right.s.numh
    && left.d.qb64 === right.d.qb64;
}

/** Encode a replay/first-seen ordinal using the huge CESR number code family. */
function encodeHugeOrdinal(num: number): NumberPrimitive {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new NumberPrimitive({ code: NumDex.Huge, raw });
}

/** Options for opening a `Baser` LMDB environment and its named subdb surface. */
export interface BaserOptions extends LMDBerOptions {
  compat?: boolean;
}

/**
 * High-level event-log databaser for KERI application state.
 *
 * Responsibilities:
 * - own the LMDB environment used for KEL/event-adjacent state
 * - bind the KERIpy-style named subdb surface through `Suber`/`Komer`
 * - expose a small set of runtime helpers for local habitat state bootstrap
 *
 * Bound store categories:
 * - event/state backbone (`evts.`, `kels.`, `fels.`, `dtss.`, `states.`)
 * - signatures/receipts and escrow families
 * - reply/endpoint/OOBI and exchange/challenge/contact families
 * - habitat/application metadata and KRAM cache records
 *
 * KERIpy correspondence:
 * - mirrors the named-subdb inventory of `keri.db.basing.Baser`
 *
 * Current `keri-ts` difference:
 * - the full store surface is now bound, but only the local habitat/runtime
 *   subset is actively driven by `Habery`/CLI in this arc
 */
export class Baser {
  private lmdber: LMDBer;
  private readonly logger: Logger;
  private evtsRaw!: Database<BinVal, BinKey>;
  readonly kevers = new Map<string, Kever>();
  readonly prefixes = new Set<string>();
  readonly groups = new Set<string>();

  public evts!: SerderSuber<SerderKERI>; // Serialized KEL events keyed by event digest.
  public fels!: OnSuber<string>; // First-seen event log entries keyed by prefix and ordinal.
  public kels!: OnIoDupSuber<string>; // Key-event log sequence buckets keyed by prefix and sequence number.
  public dtss!: CesrSuber<Dater>; // Event escrow/seen timestamps used for timeout handling.
  public aess!: CatCesrSuber<EventSealTuple>; // Authorizing event source seal couples keyed by event digest.
  public sigs!: CesrIoSetSuber<Siger>; // Indexed controller signatures for one event.
  public wigs!: CesrIoSetSuber<Siger>; // Indexed witness signatures for one event.
  public rcts!: CatCesrIoSetSuber<ReceiptCouple>; // Non-transferable receipt couples for one event.
  public ures!: CatCesrIoSetSuber<UnverifiedReceiptTriple>; // Unverified non-transferable receipt escrows.
  public vrcs!: CatCesrIoSetSuber<ValidatorReceiptQuadruple>; // Transferable validator receipt quadruples.
  public vres!: CatCesrIoSetSuber<EscrowedValidatorReceiptQuintuple>; // Unverified transferable validator receipt escrows.
  public pses!: OnIoDupSuber<string>; // Partially signed key-event escrows.
  public pwes!: OnIoDupSuber<string>; // Partially witnessed key-event escrows.
  public pdes!: OnIoDupSuber<string>; // Partially delegated key-event escrows.
  public udes!: CatCesrSuber<EventSealTuple>; // Unverified delegation seal source couples.
  public uwes!: B64OnIoDupSuber<string[]>; // Unverified witness escrow couples.
  public ooes!: OnIoDupSuber<string>; // Out-of-order escrowed event digests.
  public dels!: OnIoDupSuber<string>; // Duplicitous event-log digests.
  public ldes!: OnIoDupSuber<string>; // Likely-duplicitous escrowed event digests.
  public qnfs!: IoSetSuber<string>; // Query-not-found escrows keyed by requester + query SAID.
  public fons!: CesrSuber<NumberPrimitive>; // First-seen ordinals for recovery and superseding.
  public migs!: CesrSuber<Dater>; // Database migration datetimes.
  public vers!: Suber; // Database version table.
  public esrs!: Komer<EventSourceRecord>; // Event source records describing local vs remote provenance.
  public misfits!: IoSetSuber<string>; // Misfit escrows for remote events pending authentication.
  public delegables!: IoSetSuber<string>; // Delegable event escrows awaiting local delegator approval.
  public states!: Komer<KeyStateRecord>; // Latest key-state record for each identifier prefix.
  public wits!: CesrIoSetSuber<Prefixer>; // Witness lists for one event digest.
  public habs!: Komer<HabitatRecord>; // Habitat application records for controller databases.
  public names!: Suber; // Habitat name-to-prefix index keyed by namespace and name.
  public sdts!: CesrSuber<Dater>; // SAD datetime stamps keyed by SAID.
  public ssgs!: CesrIoSetSuber<Siger>; // SAD indexed signatures keyed by SAD quadkey.
  public scgs!: CatCesrIoSetSuber<VerferCigarCouple>; // SAD non-indexed signature couples keyed by SAID.
  public rpys!: SerderSuber<SerderKERI>; // Reply messages stored by reply SAID.
  public rpes!: CesrIoSetSuber<Diger>; // Partially signed reply escrow indices keyed by route.
  public eans!: CesrSuber<Diger>; // Controller-to-endpoint AuthN/AuthZ reply references.
  public lans!: CesrSuber<Diger>; // Endpoint-to-location AuthN/AuthZ reply references.
  public ends!: Komer<EndpointRecord>; // Service endpoint authorization records.
  public locs!: Komer<LocationRecord>; // Service endpoint locations keyed by endpoint and scheme.
  public obvs!: Komer<ObservedRecord>; // Observed identifier records keyed by controller, watcher, and observed ID.
  public tops!: Komer<TopicsRecord>; // Witness mailbox retrieval cursors.
  public gpse!: CatCesrIoSetSuber<EventSealTuple>; // Group partial signature escrows.
  public gdee!: CatCesrIoSetSuber<EventSealTuple>; // Group delegate escrows.
  public gpwe!: CatCesrIoSetSuber<EventSealTuple>; // Group partial witness escrows.
  public cgms!: CesrSuber<Diger>; // Completed group multisig references.
  public epse!: SerderSuber<SerderKERI>; // Exchange-message partial signature escrow messages.
  public epsd!: CesrSuber<Dater>; // Exchange-message partial signature escrow datetimes.
  public exns!: SerderSuber<SerderKERI>; // Exchange messages keyed by their digest.
  public erpy!: CesrSuber<Saider>; // Forward pointers to provided reply messages.
  public esigs!: CesrIoSetSuber<Siger>; // Exchange-message indexed signatures.
  public ecigs!: CatCesrIoSetSuber<VerferCigarCouple>; // Exchange-message non-indexed signature couples.
  public epath!: IoSetSuber<string>; // Exchange-message pathed attachments.
  public essrs!: CesrIoSetSuber<Texter>; // ESSR payloads keyed by exchange digest.
  public chas!: CesrIoSetSuber<Diger>; // Accepted signed challenge-response exchange SAIDs.
  public reps!: CesrIoSetSuber<Diger>; // Successful signed challenge-response exchange SAIDs.
  public wkas!: IoSetKomer<WellKnownAuthN>; // Authorized well-known OOBI records.
  public kdts!: CesrSuber<Dater>; // Key-state notice datetime stamps.
  public ksns!: Komer<KeyStateRecord>; // Key-state messages keyed by key-state SAID.
  public knas!: CesrSuber<Diger>; // Successful key-state notice SAID index.
  public wwas!: CesrSuber<Diger>; // Watcher-to-watched-AID reply SAID index.
  public oobis!: Komer<OobiRecord>; // Config-loaded OOBIs to process asynchronously.
  public eoobi!: Komer<OobiRecord>; // Retriable OOBIs that failed to load.
  public coobi!: Komer<OobiRecord>; // OOBIs with outstanding client requests.
  public roobi!: Komer<OobiRecord>; // Successfully resolved OOBIs.
  public woobi!: Komer<OobiRecord>; // Well-known OOBIs used for MFA against resolved OOBIs.
  public moobi!: Komer<OobiRecord>; // Multi-OOBI associations for one AID.
  public mfa!: Komer<OobiRecord>; // Multifactor OOBI auth records awaiting processing.
  public rmfa!: Komer<OobiRecord>; // Resolved multifactor OOBI auth records.
  public schema!: SchemerSuber<SerderKERI>; // JSON Schema SADs keyed by schema SAID.
  public cfld!: Suber; // Contact field values for remote identifiers.
  public hbys!: Suber; // Habery-global settings.
  public cons!: Suber; // Signed contact data keyed by identifier prefix.
  public ccigs!: CesrSuber<Cigar>; // Contact-data signature cigars.
  public imgs!: CatCesrSuber<BlindedImageTuple>; // Blinded media tuples for remote contact data.
  public ifld!: Suber; // Identifier field values for local identifiers.
  public sids!: Suber; // Signed local identifier data keyed by prefix.
  public icigs!: CesrSuber<Cigar>; // Local identifier-data signature cigars.
  public iimgs!: CatCesrSuber<BlindedImageTuple>; // Blinded media tuples for local identifier data.
  public dpwe!: SerderSuber<SerderKERI>; // Delegated partial-witness escrow messages.
  public dune!: SerderSuber<SerderKERI>; // Delegated unanchored escrow messages.
  public dpub!: SerderSuber<SerderKERI>; // Delegate publication escrow messages.
  public cdel!: CesrOnSuber<Diger>; // Completed group delegated AIDs keyed by ordinal.
  public meids!: CesrIoSetSuber<Diger>; // Multisig embed payload SAIDs to containing exchange-message SAIDs.
  public maids!: CesrIoSetSuber<Prefixer>; // Multisig embed payload SAIDs to participant AIDs.
  public ctyp!: Komer<CacheTypeRecord>; // KRAM cache-type records.
  public msgc!: Komer<MsgCacheRecord>; // KRAM message-cache records.
  public tmsc!: Komer<TxnMsgCacheRecord>; // KRAM transactioned message-cache records.
  public pmkm!: SerderSuber<SerderKERI>; // KRAM partially signed multi-key messages.
  public pmks!: CesrIoSetSuber<Siger>; // KRAM partially signed multi-key signatures.
  public pmsk!: CatCesrSuber<EventSealTuple>; // KRAM partially signed multi-key sender key-state seals.
  public trqs!: CatCesrIoSetSuber<ValidatorReceiptQuadruple>; // KRAM transferable receipt quadruples.
  public tsgs!: CatCesrIoSetSuber<ValidatorReceiptQuadruple>; // KRAM transferable last-signature groups.
  public sscs!: CatCesrIoSetSuber<EventSealTuple>; // First-seen seal couples.
  public ssts!: CatCesrIoSetSuber<SourceSealTriple>; // Source seal triples.
  public frcs!: CatCesrIoSetSuber<FirstSeenReplayCouple>; // First-seen replay couples.
  public tdcs!: CatCesrIoSetSuber<TypedDigestSealCouple>; // Typed digest seal couples.
  public ptds!: IoSetSuber<string>; // Pathed streams stored as raw bytes.
  public bsqs!: CatCesrIoSetSuber<BlindedStateQuadrupleTuple>; // Blind state quadruples.
  public bsss!: CatCesrIoSetSuber<BoundStateSextuple>; // Bound state sextuples.
  public tmqs!: CatCesrIoSetSuber<TypedMediaQuadrupleTuple>; // Type-media quadruples.

  static readonly TailDirPath = "keri/db";
  static readonly AltTailDirPath = ".tufa/db";
  static readonly CompatAltTailDirPath = ".keri/db";
  static readonly TempPrefix = "keri_db_";
  static readonly MaxNamedDBs = 128;

  constructor(options: BaserOptions = {}) {
    this.logger = options.logger ?? consoleLogger;
    const compat = options.compat ?? false;
    this.lmdber = new LMDBer(options, {
      tailDirPath: Baser.TailDirPath,
      cleanTailDirPath: "keri/clean/db",
      altTailDirPath: compat
        ? Baser.CompatAltTailDirPath
        : Baser.AltTailDirPath,
      altCleanTailDirPath: compat ? ".keri/clean/db" : ".tufa/clean/db",
      tempPrefix: Baser.TempPrefix,
      maxNamedDBs: Baser.MaxNamedDBs,
    });
  }

  /** Expose the resolved logical database name delegated from the root LMDBer. */
  get name(): string {
    return this.lmdber.name;
  }

  /** Expose the resolved database base prefix delegated from the root LMDBer. */
  get base(): string {
    return this.lmdber.base;
  }

  /** Report whether the root LMDB environment and typed subdb bindings are open. */
  get opened(): boolean {
    return this.lmdber.opened;
  }

  /** Report whether this `Baser` uses a temporary backing directory. */
  get temp(): boolean {
    return this.lmdber.temp;
  }

  /** Expose the resolved filesystem path of the active backing environment. */
  get path(): string | null {
    return this.lmdber.path;
  }

  /** Expose the raw LMDB environment for low-level tests and debugging only. */
  get env() {
    return this.lmdber.env;
  }

  /**
   * Reopen the root LMDB environment and bind the KERIpy-style named subdbs.
   *
   * This keeps the `Baser` layer thin: the constructor owns path/lifecycle
   * defaults, `reopen()` binds the family-specific storage adapters, and
   * higher-layer runtime code interacts through those typed wrappers rather
   * than hand-rolled raw LMDB handles.
   */
  *reopen(options: Partial<BaserOptions> = {}): Operation<boolean> {
    const opened = yield* this.lmdber.reopen(options);
    if (!opened) {
      return false;
    }

    try {
      // Serialized KEL events keyed by `(pre, said)` digest keys.
      this.evts = new SerderSuber<SerderKERI>(this.lmdber, { subkey: "evts." });
      this.evtsRaw = this.evts.sdb;

      // First-seen event logs map `(pre, fn)` ordinals to event digests.
      this.fels = new OnSuber(this.lmdber, { subkey: "fels." });

      // Key-event logs map `(pre, sn)` sequence numbers to event digests.
      this.kels = new OnIoDupSuber(this.lmdber, { subkey: "kels." });

      // Event timestamps keyed by digest, used when escrowing and timeout logic
      // needs the first-seen datetime.
      this.dtss = new CesrSuber<Dater>(this.lmdber, {
        subkey: "dtss.",
        ctor: Dater,
      });

      // Authorizing event source seal couples keyed by event digest.
      this.aess = new CatCesrSuber<EventSealTuple>(this.lmdber, {
        subkey: "aess.",
        ctor: [NumberPrimitive, Diger],
      });

      // Fully qualified indexed controller signatures for one event digest.
      this.sigs = new CesrIoSetSuber<Siger>(this.lmdber, {
        subkey: "sigs.",
        ctor: Siger,
      });

      // Indexed witness signatures for one event digest.
      this.wigs = new CesrIoSetSuber<Siger>(this.lmdber, {
        subkey: "wigs.",
        ctor: Siger,
      });

      // Event receipt couples from non-transferable signers that are not
      // witnesses, such as watchers or jurors.
      this.rcts = new CatCesrIoSetSuber<ReceiptCouple>(this.lmdber, {
        subkey: "rcts.",
        ctor: [Prefixer, Cigar],
      });

      // Unverified event receipt escrow triples from non-transferable signers.
      this.ures = new CatCesrIoSetSuber<UnverifiedReceiptTriple>(this.lmdber, {
        subkey: "ures.",
        ctor: [Diger, Prefixer, Cigar],
      });

      // Event validator receipt quadruples from transferable signers.
      this.vrcs = new CatCesrIoSetSuber<ValidatorReceiptQuadruple>(
        this.lmdber,
        {
          subkey: "vrcs.",
          ctor: [Prefixer, NumberPrimitive, Diger, Siger],
        },
      );

      // Unverified event validator receipt escrow tuples from transferable
      // signers.
      this.vres = new CatCesrIoSetSuber<EscrowedValidatorReceiptQuintuple>(
        this.lmdber,
        {
          subkey: "vres.",
          ctor: [Diger, Prefixer, NumberPrimitive, Diger, Siger],
        },
      );

      // Partially signed key-event escrows mapping `(pre, sn)` to event digests.
      this.pses = new OnIoDupSuber(this.lmdber, { subkey: "pses." });

      // Partially witnessed key-event escrows mapping `(pre, sn)` to event
      // digests.
      this.pwes = new OnIoDupSuber(this.lmdber, { subkey: "pwes." });

      // Partially delegated key-event escrows mapping `(pre, sn)` to event
      // digests.
      this.pdes = new OnIoDupSuber(this.lmdber, { subkey: "pdes." });

      // Unverified delegation seal source couples keyed by delegated event
      // digest.
      this.udes = new CatCesrSuber<EventSealTuple>(this.lmdber, {
        subkey: "udes.",
        ctor: [NumberPrimitive, Diger],
      });

      // Unverified witness escrow couples from witness signers.
      this.uwes = new B64OnIoDupSuber(this.lmdber, { subkey: "uwes." });

      // Out-of-order escrowed event tables mapping `(pre, sn)` to event digests.
      this.ooes = new OnIoDupSuber(this.lmdber, { subkey: "ooes." });

      // Duplicitous event log tables mapping `(pre, sn)` to conflicting digests.
      this.dels = new OnIoDupSuber(this.lmdber, { subkey: "dels." });

      // Likely-duplicitous escrowed event tables keyed by `(pre, sn)`.
      this.ldes = new OnIoDupSuber(this.lmdber, { subkey: "ldes." });

      // Query-not-found escrows keyed by queried event digest.
      this.qnfs = new IoSetSuber<string>(this.lmdber, { subkey: "qnfs." });

      // First-seen ordinal numbers for events, used in superseding and recovery
      // rotation logic.
      this.fons = new CesrSuber<NumberPrimitive>(this.lmdber, {
        subkey: "fons.",
        ctor: NumberPrimitive,
      });

      // Database migration datetimes keyed by migration name.
      this.migs = new CesrSuber<Dater>(this.lmdber, {
        subkey: "migs.",
        ctor: Dater,
      });

      // Database version table retained for parity even though it is currently
      // unused.
      this.vers = new Suber(this.lmdber, { subkey: "vers." });

      // Event source records describing whether an event is local/protected or
      // remote/not protected.
      this.esrs = new Komer<EventSourceRecord>(
        this.lmdber,
        {
          subkey: "esrs.",
          recordClass: EventSourceRecord,
        },
      );

      // Misfit escrows for remote events that should be dropped unless they
      // become authenticated.
      this.misfits = new IoSetSuber<string>(this.lmdber, { subkey: "mfes." });

      // Delegable event escrows for KEL events whose local delegator still
      // needs to approve them.
      this.delegables = new IoSetSuber<string>(this.lmdber, {
        subkey: "dees.",
      });

      // Latest key-state record for each identifier prefix.
      this.states = new Komer<KeyStateRecord>(
        this.lmdber,
        {
          subkey: "stts.",
          recordClass: KeyStateRecord,
        },
      );
      // Witness lists for a given event digest.
      this.wits = new CesrIoSetSuber<Prefixer>(this.lmdber, {
        subkey: "wits.",
        ctor: Prefixer,
      });

      // Habitat application records keyed by habitat name and namespace.
      this.habs = new Komer<HabitatRecord>(this.lmdber, {
        subkey: "habs.",
        recordClass: HabitatRecord,
      });

      // Habitat name database mapping `(domain, name)` to identifier prefixes.
      this.names = new Suber(this.lmdber, { subkey: "names.", sep: "^" });

      // SAD datetime stamps keyed by SAID.
      this.sdts = new CesrSuber<Dater>(this.lmdber, {
        subkey: "sdts.",
        ctor: Dater,
      });

      // SAD indexed signatures keyed by the reply/event quadkey.
      this.ssgs = new CesrIoSetSuber<Siger>(this.lmdber, {
        subkey: "ssgs.",
        ctor: Siger,
      });

      // SAD non-indexed signature couples keyed by SAD SAID.
      this.scgs = new CatCesrIoSetSuber<VerferCigarCouple>(
        this.lmdber,
        {
          subkey: "scgs.",
          ctor: [Verfer, Cigar],
        },
      );

      // Reply messages keyed by reply SAID.
      // Datetimes and signatures live in the companion `sdts.`, `ssgs.`, and
      // `scgs.` stores.
      this.rpys = new SerderSuber<SerderKERI>(this.lmdber, { subkey: "rpys." });

      // Reply escrow indices of partially signed reply messages, mapping reply
      // routes such as `/end/role` or `/loc/schema` to reply SAIDs.
      this.rpes = new CesrIoSetSuber<Diger>(this.lmdber, {
        subkey: "rpes.",
        ctor: Diger,
      });

      // AuthN/AuthZ by local controller at `cid` of endpoint provider at `eid`.
      // Maps `cid.role.eid` to the SAID of the relevant `/end/role` reply.
      this.eans = new CesrSuber<Diger>(this.lmdber, {
        subkey: "eans.",
        ctor: Diger,
      });

      // AuthN/AuthZ by endpoint provider at `eid` of a location at URL scheme.
      // Maps `cid.role.eid` to the SAID of the relevant `/loc` reply.
      this.lans = new CesrSuber<Diger>(this.lmdber, {
        subkey: "lans.",
        ctor: Diger,
      });

      // Service endpoint identifier auth records extracted from `/end/role`
      // replies.
      this.ends = new Komer<EndpointRecord>(this.lmdber, {
        subkey: "ends.",
        recordClass: EndpointRecord,
      });

      // Service endpoint locations keyed by endpoint identifier and URL scheme.
      this.locs = new Komer<LocationRecord>(this.lmdber, {
        subkey: "locs.",
        recordClass: LocationRecord,
      });

      // Observed identifier records keyed by controller, watcher, and observed
      // identifier.
      this.obvs = new Komer<ObservedRecord>(this.lmdber, {
        subkey: "obvs.",
        recordClass: ObservedRecord,
      });

      // Index of the last retrieved message from a witness mailbox.
      this.tops = new Komer<TopicsRecord>(this.lmdber, {
        subkey: "witm.",
        recordClass: TopicsRecord,
      });

      // Group partial signature escrow entries.
      this.gpse = new CatCesrIoSetSuber<EventSealTuple>(this.lmdber, {
        subkey: "gpse.",
        ctor: [NumberPrimitive, Diger],
      });

      // Group delegate escrow entries.
      this.gdee = new CatCesrIoSetSuber<EventSealTuple>(this.lmdber, {
        subkey: "gdee.",
        ctor: [NumberPrimitive, Diger],
      });

      // Group partial witness escrow entries.
      this.gpwe = new CatCesrIoSetSuber<EventSealTuple>(this.lmdber, {
        subkey: "gdwe.",
        ctor: [NumberPrimitive, Diger],
      });

      // Completed group multisig references.
      this.cgms = new CesrSuber<Diger>(this.lmdber, {
        subkey: "cgms.",
        ctor: Diger,
      });

      // Exchange-message partial signature escrow messages.
      this.epse = new SerderSuber<SerderKERI>(this.lmdber, { subkey: "epse." });

      // Exchange-message partial signature escrow datetimes.
      this.epsd = new CesrSuber<Dater>(this.lmdber, {
        subkey: "epsd.",
        ctor: Dater,
      });

      // Exchange messages keyed by digest.
      this.exns = new SerderSuber<SerderKERI>(this.lmdber, { subkey: "exns." });

      // Forward pointers to provided reply messages.
      this.erpy = new CesrSuber<Saider>(this.lmdber, {
        subkey: "erpy.",
        ctor: Saider,
      });

      // Exchange-message indexed signatures.
      this.esigs = new CesrIoSetSuber<Siger>(this.lmdber, {
        subkey: "esigs.",
        ctor: Siger,
      });

      // Exchange-message non-indexed signature couples.
      this.ecigs = new CatCesrIoSetSuber<VerferCigarCouple>(
        this.lmdber,
        {
          subkey: "ecigs.",
          ctor: [Verfer, Cigar],
        },
      );

      // Exchange-message pathed attachments.
      this.epath = new IoSetSuber<string>(this.lmdber, { subkey: ".epath" });

      // Encrypt-Sender-Sign-Receiver payloads keyed by exchange digest.
      this.essrs = new CesrIoSetSuber<Texter>(this.lmdber, {
        subkey: ".essrs",
        ctor: Texter,
      });

      // Accepted signed challenge-response exchange-message SAIDs keyed by the
      // signer prefix.
      this.chas = new CesrIoSetSuber<Diger>(this.lmdber, {
        subkey: "chas.",
        ctor: Diger,
      });

      // Successful signed challenge-response exchange-message SAIDs keyed by
      // the signer prefix.
      this.reps = new CesrIoSetSuber<Diger>(this.lmdber, {
        subkey: "reps.",
        ctor: Diger,
      });

      // Authorized well-known OOBI records.
      this.wkas = new IoSetKomer<WellKnownAuthN>(
        this.lmdber,
        {
          subkey: "wkas.",
          recordClass: WellKnownAuthN,
        },
      );
      // Key-state notice datetime stamps keyed by key-state SAID.
      this.kdts = new CesrSuber<Dater>(this.lmdber, {
        subkey: "kdts.",
        ctor: Dater,
      });

      // Key-state messages keyed by key-state SAID.
      // Datetimes and signatures are held in the companion key-state stores.
      this.ksns = new Komer<KeyStateRecord>(this.lmdber, {
        subkey: "ksns.",
        recordClass: KeyStateRecord,
      });

      // Successful key-state notice SAID index mapping `(controller, aid)` to
      // saved key-state SAIDs.
      this.knas = new CesrSuber<Diger>(this.lmdber, {
        subkey: "knas.",
        ctor: Diger,
      });

      // Watcher watched-SAID index mapping `(cid, aid, oid)` to the saved reply
      // message SAID for a watched identifier.
      this.wwas = new CesrSuber<Diger>(this.lmdber, {
        subkey: "wwas.",
        ctor: Diger,
      });

      // Config-loaded OOBIs to be processed asynchronously.
      this.oobis = new Komer<OobiRecord>(this.lmdber, {
        subkey: "oobis.",
        sep: ">",
        recordClass: OobiRecord,
      });

      // Retriable OOBIs that failed to load.
      this.eoobi = new Komer<OobiRecord>(this.lmdber, {
        subkey: "eoobi.",
        sep: ">",
        recordClass: OobiRecord,
      });

      // OOBIs with outstanding client requests.
      this.coobi = new Komer<OobiRecord>(this.lmdber, {
        subkey: "coobi.",
        sep: ">",
        recordClass: OobiRecord,
      });

      // Successfully resolved OOBIs.
      this.roobi = new Komer<OobiRecord>(this.lmdber, {
        subkey: "roobi.",
        sep: ">",
        recordClass: OobiRecord,
      });

      // Well-known OOBIs used for multifactor authentication against resolved
      // OOBIs.
      this.woobi = new Komer<OobiRecord>(this.lmdber, {
        subkey: "woobi.",
        sep: ">",
        recordClass: OobiRecord,
      });

      // Multi-OOBI associations where one AID is tied to multiple OOBIs.
      this.moobi = new Komer<OobiRecord>(this.lmdber, {
        subkey: "moobi.",
        sep: ">",
        recordClass: OobiRecord,
      });

      // Multifactor well-known OOBI auth records awaiting processing, keyed by
      // controller URL.
      this.mfa = new Komer<OobiRecord>(this.lmdber, {
        subkey: "mfa.",
        sep: ">",
        recordClass: OobiRecord,
      });

      // Resolved multifactor well-known OOBI auth records keyed by controller
      // URL.
      this.rmfa = new Komer<OobiRecord>(this.lmdber, {
        subkey: "rmfa.",
        sep: ">",
        recordClass: OobiRecord,
      });

      // JSON Schema SADs keyed by schema SAID.
      this.schema = new SchemerSuber<SerderKERI>(this.lmdber, {
        subkey: "schema.",
      });

      // Field values for contact information for remote identifiers.
      this.cfld = new Suber(this.lmdber, { subkey: "cfld." });

      // Global settings for the Habery environment.
      this.hbys = new Suber(this.lmdber, { subkey: "hbys." });

      // Signed contact data keyed by identifier prefix.
      this.cons = new Suber(this.lmdber, { subkey: "cons." });

      // Signature cigars for signed contact data.
      this.ccigs = new CesrSuber<Cigar>(this.lmdber, {
        subkey: "ccigs.",
        ctor: Cigar,
      });

      // Blinded media tuples for remote contact information.
      this.imgs = new CatCesrSuber<BlindedImageTuple>(this.lmdber, {
        subkey: "imgs.",
        ctor: [Noncer, Noncer, Labeler, Texter],
      });

      // Field values for local identifier information.
      this.ifld = new Suber(this.lmdber, { subkey: "ifld." });

      // Signed local identifier data keyed by prefix.
      this.sids = new Suber(this.lmdber, { subkey: "sids." });

      // Signature cigars for signed local identifier data.
      this.icigs = new CesrSuber<Cigar>(this.lmdber, {
        subkey: "icigs.",
        ctor: Cigar,
      });

      // Blinded media tuples for local identifier information.
      this.iimgs = new CatCesrSuber<BlindedImageTuple>(this.lmdber, {
        subkey: "iimgs.",
        ctor: [Noncer, Noncer, Labeler, Texter],
      });

      // Delegated partial-witness escrow messages.
      this.dpwe = new SerderSuber<SerderKERI>(this.lmdber, { subkey: "dpwe." });

      // Delegated unanchored escrow messages.
      this.dune = new SerderSuber<SerderKERI>(this.lmdber, { subkey: "dune." });

      // Delegate publication escrow messages for sending delegator information
      // to local witnesses.
      this.dpub = new SerderSuber<SerderKERI>(this.lmdber, { subkey: "dpub." });

      // Completed group delegated AIDs keyed by ordinal.
      this.cdel = new CesrOnSuber<Diger>(this.lmdber, {
        subkey: "cdel.",
        ctor: Diger,
      });

      // Multisig embed payload SAIDs mapped to containing exchange-message
      // SAIDs across group multisig participants.
      this.meids = new CesrIoSetSuber<Diger>(this.lmdber, {
        subkey: "meids.",
        ctor: Diger,
      });

      // Multisig embed payload SAIDs mapped to group multisig participant AIDs.
      this.maids = new CesrIoSetSuber<Prefixer>(this.lmdber, {
        subkey: "maids.",
        ctor: Prefixer,
      });
      // KRAM cache-type records keyed by expression string.
      this.ctyp = new Komer<CacheTypeRecord>(
        this.lmdber,
        {
          subkey: "ctyp.",
          recordClass: CacheTypeRecord,
        },
      );

      // KRAM message-cache records keyed by `(AID, MID)`.
      this.msgc = new Komer<MsgCacheRecord>(this.lmdber, {
        subkey: "msgc.",
        recordClass: MsgCacheRecord,
      });

      // KRAM transactioned message-cache records keyed by `(AID, XID, MID)`.
      this.tmsc = new Komer<TxnMsgCacheRecord>(
        this.lmdber,
        {
          subkey: "tmsc.",
          recordClass: TxnMsgCacheRecord,
        },
      );

      // KRAM partially signed multi-key messages keyed by `(AID, MID)`.
      this.pmkm = new SerderSuber<SerderKERI>(this.lmdber, { subkey: "pmkm." });

      // KRAM partially signed multi-key signatures keyed by `(AID, MID)`.
      this.pmks = new CesrIoSetSuber<Siger>(this.lmdber, {
        subkey: "pmks.",
        ctor: Siger,
      });

      // KRAM partially signed multi-key sender key-state seals keyed by
      // `(AID, MID)`.
      this.pmsk = new CatCesrSuber<EventSealTuple>(this.lmdber, {
        subkey: "pmsk.",
        ctor: [NumberPrimitive, Diger],
      });

      // Transferable receipt quadruples used by the KRAM attachment path.
      this.trqs = new CatCesrIoSetSuber<ValidatorReceiptQuadruple>(
        this.lmdber,
        {
          subkey: "trqs.",
          ctor: [Prefixer, NumberPrimitive, Diger, Siger],
        },
      );

      // Transferable last-signature groups used by the KRAM attachment path.
      this.tsgs = new CatCesrIoSetSuber<ValidatorReceiptQuadruple>(
        this.lmdber,
        {
          subkey: "tsgs.",
          ctor: [Prefixer, NumberPrimitive, Diger, Siger],
        },
      );

      // First-seen seal couples for issuing or delegating events.
      this.sscs = new CatCesrIoSetSuber<EventSealTuple>(this.lmdber, {
        subkey: "sscs.",
        ctor: [NumberPrimitive, Diger],
      });

      // Source seal triples for issued or delegated events.
      this.ssts = new CatCesrIoSetSuber<SourceSealTriple>(this.lmdber, {
        subkey: "ssts.",
        ctor: [Prefixer, NumberPrimitive, Diger],
      });

      // First-seen replay couples storing ordinal and datetime pairs.
      this.frcs = new CatCesrIoSetSuber<FirstSeenReplayCouple>(this.lmdber, {
        subkey: "frcs.",
        ctor: [NumberPrimitive, Dater],
      });

      // Typed digest seal couples.
      this.tdcs = new CatCesrIoSetSuber<TypedDigestSealCouple>(this.lmdber, {
        subkey: "tdcs.",
        ctor: [Verser, Diger],
      });

      // Pathed streams stored as raw bytes.
      this.ptds = new IoSetSuber<string>(this.lmdber, { subkey: "ptds." });

      // Blind state quadruples.
      this.bsqs = new CatCesrIoSetSuber<BlindedStateQuadrupleTuple>(
        this.lmdber,
        {
          subkey: "bsqs.",
          ctor: [Diger, Noncer, Noncer, Labeler],
        },
      );

      // Bound state sextuples.
      this.bsss = new CatCesrIoSetSuber<BoundStateSextuple>(this.lmdber, {
        subkey: "bsss.",
        ctor: [Diger, Noncer, Noncer, Labeler, NumberPrimitive, Noncer],
      });

      // Type-media quadruples.
      this.tmqs = new CatCesrIoSetSuber<TypedMediaQuadrupleTuple>(this.lmdber, {
        subkey: "tmqs.",
        ctor: [Diger, Noncer, Labeler, Texter],
      });

      this.reloadKevers();
      return this.opened;
    } catch (error) {
      this.logger.error(`Failed to open Baser sub-databases: ${error}`);
      throw new DatabaseOperationError(
        "Failed to open Baser sub-databases",
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /** Close the underlying LMDB resources. */
  *close(clear = false): Operation<boolean> {
    this.kevers.clear();
    this.prefixes.clear();
    this.groups.clear();
    return yield* this.lmdber.close(clear);
  }

  /** Read the root LMDB version marker through the shared lifecycle owner. */
  getVer(): string | null {
    return this.lmdber.getVer();
  }

  /** Write the root LMDB version marker through the shared lifecycle owner. */
  setVer(val: string): void {
    this.lmdber.setVer(val);
  }

  /** Count raw physical entries in `evts.` for test/debug visibility. */
  cntEvts(): number {
    return this.lmdber.cnt(this.evtsRaw);
  }

  /** Raw insert helper kept for tests/debug tooling. */
  putEvt(key: Uint8Array, val: Uint8Array): boolean {
    return this.lmdber.putVal(this.evtsRaw, key, val);
  }

  /** Raw upsert helper kept for tests/debug tooling. */
  setEvt(key: Uint8Array, val: Uint8Array): boolean {
    return this.lmdber.setVal(this.evtsRaw, key, val);
  }

  /** Raw fetch helper kept for tests/debug tooling. */
  getEvt(key: Uint8Array): Uint8Array | null {
    return this.lmdber.getVal(this.evtsRaw, key);
  }

  /** Raw delete helper kept for tests/debug tooling. */
  delEvt(key: Uint8Array): boolean {
    return this.lmdber.delVal(this.evtsRaw, key);
  }

  /** Iterate `evts.` entries with optional byte-prefix filter. */
  *getAllEvtsIter(
    top: Uint8Array = new Uint8Array(0),
  ): Generator<[Uint8Array, Uint8Array]> {
    yield* this.lmdber.getTopItemIter(this.evtsRaw, top);
  }

  /**
   * Persist one serialized event body in `evts.` under its digest key.
   *
   * Runtime code should prefer this helper over the raw `putEvt()` form so the
   * KERIpy `dgKey(pre, said)` event-key contract stays explicit.
   */
  putEvtSerder(pre: string, said: string, raw: Uint8Array): boolean {
    return this.setEvt(dgKey(pre, said), raw);
  }

  /** Read one serialized event from `evts.` through the typed serder wrapper. */
  getEvtSerder(pre: string, said: string): SerderKERI | null {
    return this.evts.get(dgKey(pre, said));
  }

  /** Iterate the latest digest per sequence number for one identifier's KEL. */
  *getKelItemIter(pre: string): Generator<[number, string]> {
    for (const [, sn, said] of this.kels.getOnLastItemIter(pre)) {
      yield [sn, said];
    }
  }

  /**
   * Iterate every stored KEL event for `pre` from sequence `sn` onward.
   *
   * KERIpy correspondence:
   * - mirrors `Baser.getEvtPreIter(...)`
   *
   * Unlike `getKelItemIter()`, this includes disputed or superseded events
   * still present in `kels.` buckets.
   */
  *getEvtPreIter(pre: string, sn = 0): Generator<SerderKERI> {
    for (const [, , said] of this.kels.getAllItemIter(pre, sn)) {
      const serder = this.getEvtSerder(pre, said);
      if (serder) {
        yield serder;
      }
    }
  }

  /**
   * Return true when `serder` currently satisfies the stored witness threshold.
   *
   * KERIpy correspondence:
   * - mirrors `Baser.fullyWitnessed(...)`
   */
  fullyWitnessed(serder: SerderKERI): boolean {
    const pre = serder.pre;
    const said = serder.said;
    if (!pre || !said) {
      return false;
    }
    const kever = this.getKever(pre);
    if (!kever) {
      return false;
    }
    return BigInt(this.wigs.get(dgKey(pre, said)).length) >= kever.toader.num;
  }

  /**
   * Find the first fully witnessed event in `pre`'s KEL that carries `seal`.
   *
   * KERIpy correspondence:
   * - mirrors `Baser.fetchAllSealingEventByEventSeal(...)`
   */
  fetchAllSealingEventByEventSeal(
    pre: string,
    seal: unknown,
    sn = 0,
  ): SerderKERI | null {
    const target = normalizeEventSeal(seal);
    if (!target) {
      return null;
    }

    for (const serder of this.getEvtPreIter(pre, sn)) {
      for (const current of serder.eventSeals) {
        if (eventSealsEqual(current, target) && this.fullyWitnessed(serder)) {
          return serder;
        }
      }
    }
    return null;
  }

  /**
   * Find the first fully witnessed last-accepted event in `pre`'s KEL that carries `seal`.
   *
   * KERIpy correspondence:
   * - mirrors `Baser.fetchLastSealingEventByEventSeal(...)`
   * - only searches the last accepted event at each sequence number, excluding
   *   superseded/disputed alternatives still retained in `kels.`
   */
  fetchLastSealingEventByEventSeal(
    pre: string,
    seal: unknown,
    sn = 0,
  ): SerderKERI | null {
    const target = normalizeEventSeal(seal);
    if (!target) {
      return null;
    }

    for (const [ordinal, said] of this.getKelItemIter(pre)) {
      if (ordinal < sn) {
        continue;
      }
      const serder = this.getEvtSerder(pre, said);
      if (!serder) {
        continue;
      }
      for (const current of serder.eventSeals) {
        if (eventSealsEqual(current, target) && this.fullyWitnessed(serder)) {
          return serder;
        }
      }
    }
    return null;
  }

  /** Append one digest to the first-seen event log for a prefix and return the assigned ordinal. */
  appendFel(pre: string, said: string): number {
    return this.fels.appendOn(pre, said);
  }

  /** Read one first-seen digest by `(pre, fn)` from `fels.`. */
  getFel(pre: string, fn: number): string | null {
    return this.fels.getOn(pre, fn);
  }

  /** Resolve the first-seen ordinal for one previously stored event digest. */
  getFelFn(pre: string, said: string): number | null {
    for (const [, fn, current] of this.fels.getAllItemIter(pre)) {
      if (current === said) {
        return fn;
      }
    }
    return null;
  }

  /** Upsert the datetime stamp for one event digest in `dtss.`. */
  putDts(pre: string, said: string, qb64: string): boolean {
    return this.dtss.pin(dgKey(pre, said), new Dater({ qb64 }));
  }

  /** Read the stored datetime stamp for one event digest from `dtss.`. */
  getDts(pre: string, said: string): string | null {
    return this.dtss.get(dgKey(pre, said))?.qb64 ?? null;
  }

  /** Insert one event-source record in `esrs.` if absent. */
  putEsr(pre: string, said: string, record: EventSourceRecordShape): boolean {
    return this.esrs.put(dgKey(pre, said), record);
  }

  /** Upsert one event-source record in `esrs.`. */
  pinEsr(pre: string, said: string, record: EventSourceRecordShape): boolean {
    return this.esrs.pin(dgKey(pre, said), record);
  }

  /** Read one event-source record from `esrs.`. */
  getEsr(pre: string, said: string): EventSourceRecord | null {
    return this.esrs.get(dgKey(pre, said));
  }

  /** Insert one current key-state record in `states.` if absent. */
  putState(pre: string, record: KeyStateRecordShape): boolean {
    return this.states.put(pre, record);
  }

  /** Upsert one current key-state record in `states.`. */
  pinState(pre: string, record: KeyStateRecordShape): boolean {
    return this.states.pin(pre, record);
  }

  /** Read one current key-state record from `states.`. */
  getState(pre: string): KeyStateRecord | null {
    return this.states.get(pre);
  }

  /**
   * Rebuild accepted local-hab kevers from durable `habs.` and `states.`.
   *
   * KERIpy correspondence:
   * - mirrors `keri.db.basing.Baser.reload()`
   *
   * Current `keri-ts` difference:
   * - hidden non-hab accepted state such as the signator is still rehydrated
   *   lazily through `getKever()` instead of living in a Python-style
   *   read-through mapping
   */
  reloadKevers(): void {
    this.kevers.clear();
    this.prefixes.clear();
    this.groups.clear();
    const removes: string[] = [];

    for (const [pre, habord] of this.getHabItemIter()) {
      const hid = habord.hid || pre;
      const state = this.getState(hid);
      if (!state) {
        if (!habord.mid) {
          removes.push(pre);
        }
        continue;
      }

      try {
        const kever = Kever.fromState({ state, db: this });
        this.kevers.set(kever.pre, kever);
        this.prefixes.add(kever.pre);
        if (habord.mid) {
          this.groups.add(hid);
        }
      } catch (error) {
        if (!habord.mid && isMissingReloadEventError(error)) {
          removes.push(pre);
          continue;
        }
        throw error;
      }
    }

    for (const pre of removes) {
      this.habs.rem(pre);
    }
  }

  /**
   * Return one live `Kever`, rehydrating it from `states.` when needed.
   *
   * This is the TypeScript-native replacement for KERIpy's read-through
   * `db.kevers` dict behavior.
   */
  getKever(pre: string): Kever | null {
    const current = this.kevers.get(pre);
    if (current) {
      return current;
    }

    const state = this.getState(pre);
    if (!state) {
      return null;
    }

    const kever = Kever.fromState({ state, db: this });
    this.kevers.set(pre, kever);
    return kever;
  }

  /** Iterate raw serialized events in KEL order for one identifier prefix. */
  *getKelRawIter(pre: string): Generator<Uint8Array> {
    for (const [, said] of this.getKelItemIter(pre)) {
      const raw = this.getEvt(dgKey(pre, said));
      if (raw !== null) {
        yield raw;
      }
    }
  }

  /**
   * Rebuild one CESR event message with its attached foot from DB state.
   *
   * KERIpy correspondence:
   * - mirrors `keri.db.basing.Baser.cloneEvtMsg`
   *
   * This is the durable export/replay seam for locally stored events. The
   * event body comes from `evts.`, while the attached foot is reconstructed
   * from the companion stores that hold controller signatures, witness
   * signatures, source seals, receipts, and first-seen replay metadata.
   */
  cloneEvtMsg(pre: string, fn: number, said: string): Uint8Array {
    const dgkey = dgKey(pre, said);
    const serder = this.evts.get(dgkey);
    if (serder === null) {
      throw new DatabaseOperationError(
        `Missing event body for ${pre}:${said}`,
      );
    }

    const sigers = this.sigs.get(dgkey);
    if (sigers.length === 0) {
      throw new DatabaseOperationError(
        `Missing indexed signatures for ${pre}:${said}`,
      );
    }

    const attachments: Uint8Array[] = [
      new Counter({
        code: CtrDexV1.ControllerIdxSigs,
        count: sigers.length,
        version: KERI_V1,
      }).qb64b,
      ...sigers.map((siger) => siger.qb64b),
    ];

    const wigers = this.wigs.get(dgkey);
    if (wigers.length > 0) {
      attachments.push(
        new Counter({
          code: CtrDexV1.WitnessIdxSigs,
          count: wigers.length,
          version: KERI_V1,
        }).qb64b,
        ...wigers.map((wiger) => wiger.qb64b),
      );
    }

    const seal = this.aess.get(dgkey);
    if (seal !== null) {
      const [number, diger] = seal;
      attachments.push(
        new Counter({
          code: CtrDexV1.SealSourceCouples,
          count: 1,
          version: KERI_V1,
        }).qb64b,
        number.qb64b,
        diger.qb64b,
      );
    }

    const vrcs = this.vrcs.get(dgkey);
    if (vrcs.length > 0) {
      attachments.push(
        new Counter({
          code: CtrDexV1.TransReceiptQuadruples,
          count: vrcs.length,
          version: KERI_V1,
        }).qb64b,
        ...vrcs.flatMap(([prefixer, snu, diger, siger]) => [
          prefixer.qb64b,
          snu.qb64b,
          diger.qb64b,
          siger.qb64b,
        ]),
      );
    }

    const rcts = this.rcts.get(dgkey);
    if (rcts.length > 0) {
      attachments.push(
        new Counter({
          code: CtrDexV1.NonTransReceiptCouples,
          count: rcts.length,
          version: KERI_V1,
        }).qb64b,
        ...rcts.flatMap(([prefixer, cigar]) => [
          prefixer.qb64b,
          cigar.qb64b,
        ]),
      );
    }

    const dater = this.dtss.get(dgkey);
    if (dater === null) {
      throw new DatabaseOperationError(
        `Missing datetime stamp for ${pre}:${said}`,
      );
    }
    attachments.push(
      new Counter({
        code: CtrDexV1.FirstSeenReplayCouples,
        count: 1,
        version: KERI_V1,
      }).qb64b,
      encodeHugeOrdinal(fn).qb64b,
      dater.qb64b,
    );

    const atc = concatBytes(...attachments);
    if (atc.length % 4 !== 0) {
      throw new DatabaseOperationError(
        `Invalid attachment quadlet size for ${pre}:${said}`,
      );
    }

    const group = new Counter({
      code: CtrDexV1.AttachmentGroup,
      count: atc.length / 4,
      version: KERI_V1,
    });
    return concatBytes(serder.raw, group.qb64b, atc);
  }

  /**
   * Replay one identifier's events in first-seen order as full CESR messages.
   *
   * KERIpy correspondence:
   * - mirrors `keri.db.basing.Baser.clonePreIter`
   *
   * Errors rebuilding individual events are skipped so export/replay callers
   * can continue streaming later entries, matching KERIpy's clone behavior.
   */
  *clonePreIter(pre: string, fn = 0): Generator<Uint8Array> {
    for (const [, currentFn, said] of this.fels.getAllItemIter(pre, fn)) {
      try {
        yield this.cloneEvtMsg(pre, currentFn, said);
      } catch {
        continue;
      }
    }
  }

  /**
   * Recursively replay the delegator chain for one delegated `Kever`.
   *
   * KERIpy correspondence:
   * - mirrors `Baser.cloneDelegation(...)`
   */
  *cloneDelegation(kever: Kever): Generator<Uint8Array> {
    if (!kever.delegated || !kever.delpre) {
      return;
    }
    const delegator = this.getKever(kever.delpre);
    if (!delegator) {
      return;
    }
    yield* this.cloneDelegation(delegator);
    yield* this.clonePreIter(kever.delpre, 0);
  }

  /** Insert one habitat metadata record in `habs.` if absent. */
  putHab(pre: string, record: HabitatRecordShape): boolean {
    return this.habs.put(pre, record);
  }

  /** Upsert one habitat metadata record in `habs.`. */
  pinHab(pre: string, record: HabitatRecordShape): boolean {
    return this.habs.pin(pre, record);
  }

  /** Read one habitat metadata record from `habs.`. */
  getHab(pre: string): HabitatRecord | null {
    return this.habs.get(pre);
  }

  /** Iterate persisted habitat metadata records keyed by identifier prefix. */
  *getHabItemIter(
    top = "",
  ): Generator<[string, HabitatRecord]> {
    for (const [keys, record] of this.habs.getTopItemIter(top)) {
      const pre = keys[0];
      if (!pre) {
        continue;
      }
      yield [pre, record];
    }
  }

  /** Insert indexed signatures for one event in `sigs.` if absent. */
  putSigs(
    pre: string,
    said: string,
    sigs: readonly (Siger | string)[],
  ): boolean {
    const dgkey = dgKey(pre, said);
    return this.sigs.put(
      dgkey,
      sigs.map((sig) => typeof sig === "string" ? new Siger({ qb64: sig }) : sig),
    );
  }

  /** Upsert indexed signatures for one event in `sigs.`. */
  pinSigs(
    pre: string,
    said: string,
    sigs: readonly (Siger | string)[],
  ): boolean {
    const dgkey = dgKey(pre, said);
    return this.sigs.pin(
      dgkey,
      sigs.map((sig) => typeof sig === "string" ? new Siger({ qb64: sig }) : sig),
    );
  }

  /** Read indexed signatures for one event from `sigs.` as qb64 text. */
  getSigs(pre: string, said: string): string[] {
    return this.sigs.get(dgKey(pre, said)).map((sig) => sig.qb64);
  }

  /** Insert one namespace/name to prefix mapping in `names.` if absent. */
  putName(ns: string, name: string, pre: string): boolean {
    return this.names.put([ns, name], pre);
  }

  /** Upsert one namespace/name to prefix mapping in `names.`. */
  pinName(ns: string, name: string, pre: string): boolean {
    return this.names.pin([ns, name], pre);
  }

  /** Read one namespace/name to prefix mapping from `names.`. */
  getName(ns: string, name: string): string | null {
    return this.names.get([ns, name]);
  }

  /** Upsert one habery-scoped string setting in `hbys.`. */
  pinHby(name: string, value: string): boolean {
    return this.hbys.pin(name, value);
  }

  /** Read one habery-scoped string setting from `hbys.`. */
  getHby(name: string): string | null {
    return this.hbys.get(name);
  }
}

/**
 * Thin Effection-native lifecycle host for one `Baser`.
 *
 * KERIpy correspondence:
 * - mirrors `keri.db.basing.BaserDoer`
 *
 * Current `keri-ts` difference:
 * - exposes explicit generator operations instead of HIO `Doer` callbacks, but
 *   keeps the same ownership rule: reopen on enter, close on exit
 */
export class BaserDoer {
  readonly baser: Baser;

  constructor(baser: Baser) {
    this.baser = baser;
  }

  /** Reopen the bound `Baser` if it is not already opened. */
  *enter(options: Partial<BaserOptions> = {}): Operation<void> {
    if (!this.baser.opened) {
      yield* this.baser.reopen(options);
    }
  }

  /** Close the bound `Baser`, clearing temp stores the same way KERIpy does. */
  *exit(): Operation<void> {
    yield* this.baser.close(this.baser.temp);
  }

  /**
   * Hold the `Baser` open for the surrounding Effection scope.
   *
   * This is the direct replacement for the Python doer staying alive between
   * `enter()` and `exit()` calls.
   */
  *run(options: Partial<BaserOptions> = {}): Operation<never> {
    yield* this.enter(options);
    try {
      while (true) {
        yield* action((resolve) => {
          const timeoutId = setTimeout(() => resolve(undefined), 0);
          return () => clearTimeout(timeoutId);
        });
      }
    } finally {
      yield* this.exit();
    }
  }
}

/** Constructor-safe async factory for a fully reopened `Baser`. */
export function* createBaser(options: BaserOptions = {}): Operation<Baser> {
  const baser = new Baser(options);
  const opened = yield* baser.reopen(options);
  if (!opened) {
    throw new DatabaseNotOpenError("Failed to open Baser");
  }
  return baser;
}
