import { type Operation } from "npm:effection@^3.6.0";
import {
  Cigar,
  concatBytes,
  Counter,
  CtrDexV1,
  Dater,
  DigDex,
  Diger,
  DIGEST_CODES,
  NumberPrimitive,
  parseMatter,
  PREFIX_CODES,
  Prefixer,
  SerderKERI,
  Siger,
} from "../../../cesr/mod.ts";
import { b } from "../../../cesr/mod.ts";
import type { HabitatRecord, KeyStateRecord } from "../core/records.ts";
import type { AgentCue } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { CigarCouple, TransIdxSigGroup } from "../core/dispatch.ts";
import { type EndpointRole, EndpointRoles } from "../core/roles.ts";
import { Baser, createBaser } from "../db/basing.ts";
import { createKeeper, Keeper } from "../db/keeping.ts";
import { Configer, createConfiger } from "./configing.ts";
import {
  Algos,
  branToSaltQb64,
  encodeDateTimeToDater,
  ensureKeeperCryptoReady,
  Manager,
  normalizeSaltQb64,
  saltySigner,
} from "./keeping.ts";

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
}

/** Habitat inception options consumed by the local bootstrap `Hab.make()` flow. */
export interface MakeHabArgs {
  code?: string;
  transferable?: boolean;
  isith?: string;
  icount?: number;
  nsith?: string;
  ncount?: number;
  toad?: number;
  wits?: string[];
  delpre?: string;
  estOnly?: boolean;
  DnD?: boolean;
  hidden?: boolean;
  data?: unknown[];
  algo?: Algos;
  salt?: string;
  tier?: string;
}

/**
 * Minimal in-memory projection of current key state for one habitat.
 *
 * Current `keri-ts` difference:
 * - this is a derived cache rebuilt from `Baser.states` rather than an
 *   independently authoritative persisted object
 */
export interface KeverState {
  pre: string;
  verfers: string[];
  digers: string[];
  sn: number;
  delpre?: string;
  wits: string[];
}

/**
 * Fixed KERI version tuple used when emitting bootstrap counters.
 *
 * Keeping this centralized avoids silently diverging counter headers across
 * locally generated reply and inception messages.
 */
const KERI_V1 = Object.freeze({ major: 1, minor: 0 } as const);

/** Return the current UTC time in the KERI-friendly extended ISO-8601 form. */
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
 * Produce the default simple numeric signing threshold for a key count.
 *
 * This intentionally stays in simple-numeric territory for the current
 * bootstrap slice; weighted threshold expressions are deferred.
 */
function defaultThreshold(count: number, min: number): string {
  return `${Math.max(min, Math.ceil(count / 2)).toString(16)}`;
}

/** Shared zero-length message value used when a reply/resource has no payload. */
function emptyMessage(): Uint8Array {
  return new Uint8Array();
}

/** Concatenate a list of wire messages while preserving empty-list semantics. */
function concatMessages(messages: readonly Uint8Array[]): Uint8Array {
  return messages.length === 0 ? emptyMessage() : concatBytes(...messages);
}

/**
 * Build one canonical `rpy` serder from route, attributes, and timestamp.
 *
 * Keeping reply creation centralized prevents the local endpoint/OOBI helpers
 * from drifting in field ordering or reply-body structure.
 */
function makeReplySerder(
  route: string,
  data: Record<string, unknown>,
  stamp = makeNowIso8601(),
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: "rpy",
      dt: stamp,
      r: route,
      a: data,
    },
    makify: true,
  });
}

/**
 * Wrap one reply attachment payload in the outer `AttachmentGroup`.
 *
 * The group count is expressed in quadlets, matching the same wire rule used
 * by event replay/export helpers elsewhere in the app layer.
 */
function makeReplyAttachmentGroup(attachments: Uint8Array[]): Uint8Array {
  if (attachments.length === 0) {
    return emptyMessage();
  }
  const raw = concatBytes(...attachments);
  if (raw.length % 4 !== 0) {
    throw new Error(
      "Reply attachments must occupy an integral number of quadlets.",
    );
  }
  const group = new Counter({
    code: CtrDexV1.AttachmentGroup,
    count: raw.length / 4,
    version: KERI_V1,
  });
  return concatBytes(group.qb64b, raw);
}

/**
 * Build one full reply message including any attached signature material.
 *
 * Supported attachment shapes for the Gate E bootstrap slice:
 * - transferable controller signature groups
 * - non-transferable receipt couples when replaying stored replies
 */
function buildReplyMessage(args: {
  serder: SerderKERI;
  tsg?: TransIdxSigGroup;
  cigars?: readonly CigarCouple[];
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
      args.tsg.seqner.qb64b,
      args.tsg.diger.qb64b,
      new Counter({
        code: CtrDexV1.ControllerIdxSigs,
        count: args.tsg.sigers.length,
        version: KERI_V1,
      }).qb64b,
      ...args.tsg.sigers.map((siger) => siger.qb64b),
    );
  } else if (args.cigars && args.cigars.length > 0) {
    attachments.push(
      new Counter({
        code: CtrDexV1.NonTransReceiptCouples,
        count: args.cigars.length,
        version: KERI_V1,
      }).qb64b,
      ...args.cigars.flatMap((cigarCouple) => [
        cigarCouple.verfer.qb64b,
        cigarCouple.cigar.qb64b,
      ]),
    );
  }

  return concatBytes(
    args.serder.raw,
    makeReplyAttachmentGroup(attachments),
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
    return buildReplyMessage({
      serder,
      tsg: lead,
    });
  }

  const cigars = db.scgs.get([said]);
  if (cigars.length > 0) {
    return buildReplyMessage({
      serder,
      cigars: cigars.map((entry) => CigarCouple.fromTuple(entry)),
    });
  }

  return serder.raw;
}

/**
 * Convert one persisted key-state record into the lightweight in-memory cache shape.
 *
 * `Hab.kever` uses this projection so callers can inspect current verification
 * keys without depending directly on DB record layout.
 */
function keverStateFromRecord(record: KeyStateRecord): KeverState {
  return {
    pre: record.i ?? "",
    verfers: record.k ?? [],
    digers: record.n ?? [],
    sn: Number.parseInt(record.s ?? "0", 16),
    delpre: record.di || undefined,
    wits: record.b ?? [],
  };
}

/**
 * Build the durable key-state record persisted for a newly incepted habitat.
 *
 * This captures the bootstrap subset of current-state fields needed by reopen,
 * OOBI reply generation, and event verification.
 */
function makeKeyStateRecord(args: {
  pre: string;
  said: string;
  dt: string;
  ilk: string;
  fn: number;
  isith: string;
  nsith: string;
  keys: string[];
  ndigs: string[];
  toad: number;
  wits: string[];
  cnfg: string[];
  delpre?: string;
}): KeyStateRecord {
  return {
    vn: [1, 0],
    i: args.pre,
    s: "0",
    p: "",
    d: args.said,
    f: args.fn.toString(16),
    dt: args.dt,
    et: args.ilk,
    kt: args.isith,
    k: args.keys,
    nt: args.nsith,
    n: args.ndigs,
    bt: args.toad.toString(16),
    b: args.wits,
    c: args.cnfg,
    ee: {
      s: "0",
      d: args.said,
      br: [],
      ba: [],
    },
    di: args.delpre ?? "",
  };
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
    isith?: string;
    nsith?: string;
    toad: number;
    wits: string[];
    cnfg: string[];
    data: unknown[];
    delpre?: string;
  },
): SerderKERI {
  const ilk = args.delpre ? "dip" : "icp";
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
  pre = "";
  kever: KeverState | null = null;

  /** Create one habitat wrapper over shared DB/keeper/manager infrastructure. */
  constructor(
    name: string,
    db: Baser,
    ks: Keeper,
    mgr: Manager,
    ns?: string,
    pre = "",
  ) {
    this.name = name;
    this.db = db;
    this.ks = ks;
    this.mgr = mgr;
    this.ns = ns;
    this.pre = pre;
    if (this.pre) {
      this.refreshKever();
    }
  }

  /** Refresh the cached `kever` projection from durable `Baser.states` content. */
  private refreshKever(): void {
    if (!this.pre) {
      this.kever = null;
      return;
    }
    const state = this.db.getState(this.pre);
    this.kever = state ? keverStateFromRecord(state) : null;
  }

  /**
   * Incept this habitat and persist the local bootstrap state backbone.
   *
   * Durable writes performed here include `evts.`, `kels.`, `fels.`, `dtss.`,
   * `sigs.`, `esrs.`, `states.`, and, when visible, `habs.` plus `names.`.
   */
  make(args: MakeHabArgs = {}): void {
    const {
      code = "E",
      transferable = true,
      isith = undefined,
      icount = 1,
      nsith = undefined,
      ncount = undefined,
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
      prefixCode = "B";
    }

    const [verfers, digers] = this.mgr.incept({
      icount,
      ncount: nextCount,
      stem: this.ns ? `${this.ns}${this.name}` : this.name,
      transferable,
      algo,
      salt,
      tier,
    });

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
    const said = serder.said;
    if (!pre || !said) {
      throw new Error(
        "Expected inception serder to provide string pre and said.",
      );
    }
    const raw = serder.raw;

    const opre = verfers[0].qb64;
    this.mgr.move(opre, pre);
    this.pre = pre;

    const sigs = this.mgr.sign(raw, keys, true);
    const now = makeNowIso8601();
    const ilk = delpre ? "dip" : "icp";
    this.db.putEvtSerder(pre, said, raw);
    this.db.putKel(pre, 0, said);
    const fn = this.db.appendFel(pre, said);
    this.db.putDts(pre, said, encodeDateTimeToDater(now));
    this.db.pinSigs(pre, said, sigs);
    this.db.pinEsr(pre, said, { local: true });
    const state = makeKeyStateRecord({
      pre,
      said,
      dt: now,
      ilk,
      fn,
      isith: currentSith,
      nsith: nextThreshold,
      keys,
      ndigs,
      toad,
      wits,
      cnfg,
      delpre,
    });
    this.db.pinState(pre, state);
    this.kever = keverStateFromRecord(state);

    if (!hidden) {
      const habord: HabitatRecord = {
        hid: pre,
        name: this.name,
        domain: this.ns,
      };
      this.db.pinHab(pre, habord);
      this.db.pinName(this.ns ?? "", this.name, pre);
    }
  }

  /** Produces signatures with this habitat's current signing keys. */
  sign(ser: Uint8Array, indexed: true): Siger[];
  sign(ser: Uint8Array, indexed?: false): Cigar[];
  sign(ser: Uint8Array, indexed = false): Siger[] | Cigar[] {
    if (!this.kever && this.pre) {
      this.refreshKever();
    }
    const pubs = this.kever?.verfers ?? [];
    if (indexed) {
      return this.mgr.sign(ser, pubs, true);
    }
    return this.mgr.sign(ser, pubs, false);
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
    const serder = makeReplySerder(route, data, stamp);
    const sigers = this.sign(serder.raw, true) as Siger[];
    const state = this.db.getState(this.pre);
    const estSaid = state?.ee?.d || state?.d;
    if (!estSaid) {
      throw new Error(`Missing establishment event for ${this.pre}.`);
    }
    const estEvent = this.db.getEvtSerder(this.pre, estSaid);
    const seqner = estEvent?.sner;
    if (!seqner) {
      throw new Error(`Missing establishment sequence number for ${this.pre}.`);
    }

    return buildReplyMessage({
      serder,
      tsg: new TransIdxSigGroup(
        new Prefixer({ qb64: this.pre }),
        seqner,
        new Diger({ qb64: estSaid }),
        sigers,
      ),
    });
  }

  /**
   * Create one signed endpoint-role authorization reply for this habitat.
   *
   * This is the local helper behind `tufa ends add` and endpoint-role OOBI
   * dissemination.
   */
  makeEndRole(
    eid: string,
    role: EndpointRole | string = EndpointRoles.controller,
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
    scheme = "http",
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

    const state = this.db.getState(pre);
    if (state?.b && state.b.length > 0) {
      const witnessUrls: Record<string, Record<string, string>> = {};
      for (const eid of state.b) {
        const urls = this.fetchUrls(eid);
        if (Object.keys(urls).length === 0) {
          continue;
        }
        witnessUrls[eid] = urls;
      }
      if (Object.keys(witnessUrls).length > 0) {
        ends[EndpointRoles.witness] = witnessUrls;
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
    role: EndpointRole | string = EndpointRoles.controller,
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
    role?: EndpointRole | string,
    eids: string[] = [],
    scheme = "",
  ): Uint8Array {
    const messages: Uint8Array[] = [];
    messages.push(...this.db.clonePreIter(cid));

    if (role === EndpointRoles.witness) {
      const state = this.db.getState(cid);
      for (const eid of state?.b ?? []) {
        if (eids.length > 0 && !eids.includes(eid)) {
          continue;
        }
        messages.push(
          eid === this.pre
            ? this.replyLocScheme(eid, scheme)
            : this.loadLocScheme(eid, scheme),
        );
        if (cid === this.pre) {
          messages.push(this.makeEndRole(eid, EndpointRoles.witness, true));
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
    role: EndpointRole | string,
    eids: string[] = [],
  ): Uint8Array {
    return this.replyEndRole(aid, role, eids);
  }

  /**
   * Process KERI-style cues and emit any message bytes requested by those cues.
   *
   * This intentionally mirrors the recognisable KERIpy cue loop shape even
   * though only the Gate E cue families are active today.
   *
   * Current handled cues:
   * - `replay` emits a prebuilt message stream
   * - `reply` builds and emits one fresh local reply
   *
   * All other cue kinds are currently ignored until their producers and
   * consumers exist in the surrounding runtime.
   */
  *processCuesIter(
    cues: Deck<AgentCue> | Iterable<AgentCue>,
  ): Generator<Uint8Array> {
    const queue = cues instanceof Deck ? cues : new Deck(cues);
    while (!queue.empty) {
      const cue = queue.pull();
      if (!cue) {
        continue;
      }
      switch (cue.kin) {
        case "replay":
          yield cue.msgs;
          break;
        case "reply":
          yield this.reply(cue.route, cue.data);
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
 *
 * Current `keri-ts` differences:
 * - signing/verification are currently deterministic local-hab wrappers, not a
 *   full parity implementation of KERIpy signatory lifecycle and reopen logic
 */
export class Signator {
  readonly db: Baser;
  readonly hab: Hab;
  pre: string;

  /** Reopen or create the habery-owned `__signatory__` habitat wrapper. */
  constructor(db: Baser, habery: Habery) {
    this.db = db;
    const spre = this.db.getHby(SIGNER);
    if (!spre) {
      const hab = new Hab(SIGNER, habery.db, habery.ks, habery.mgr);
      hab.make({ transferable: false, hidden: true });
      this.hab = hab;
      this.pre = hab.pre;
      this.db.pinHby(SIGNER, this.pre);
    } else {
      const hab = new Hab(
        SIGNER,
        habery.db,
        habery.ks,
        habery.mgr,
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
   * Current `keri-ts` difference:
   * - this is a deterministic local wrapper, not the full KERIpy signatory
   *   lifecycle and endorsement surface
   */
  sign(ser: Uint8Array): string {
    const sig = this.hab.sign(ser, false)[0];
    if (!sig) throw new Error("Unable to sign");
    return sig.qb64;
  }

  /**
   * Verify one detached signature by recomputing the expected local signator output.
   *
   * This narrow verification rule is only valid for the current deterministic
   * local signatory model.
   */
  verify(ser: Uint8Array, cigar: string): boolean {
    const expected = this.sign(ser);
    return expected === cigar;
  }
}

/**
 * Top-level controller container for databases, key manager, config, and local
 * habitats.
 *
 * Responsibilities:
 * - compose `Baser`, `Keeper`, `Manager`, optional config, and loaded habitats
 * - eagerly reconstruct persisted habitat visibility on open
 * - provide app-layer alias lookup and habitat creation boundaries
 *
 * State model:
 * - `habs` is an in-memory cache of reconstructed `Hab` instances
 * - durable habitat metadata lives in `habs.`
 * - durable current key state lives in `states.` with supporting `evts.`,
 *   `kels.`, `fels.`, and `dtss.` data in `Baser`
 * - `Hab.kever` is a derived cache rebuilt from DB state, not the sole source
 *   of truth
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
  readonly db: Baser;
  readonly ks: Keeper;
  readonly mgr: Manager;
  readonly cf?: Configer;
  readonly config: Record<string, unknown>;
  readonly habs = new Map<string, Hab>();
  readonly signator: Signator | null;

  /** Compose one habery from already-opened storage, manager, and config surfaces. */
  constructor(
    name: string,
    base: string,
    temp: boolean,
    db: Baser,
    ks: Keeper,
    mgr: Manager,
    cf?: Configer,
    config: Record<string, unknown> = {},
    skipSignator = false,
  ) {
    this.name = name;
    this.base = base;
    this.temp = temp;
    this.db = db;
    this.ks = ks;
    this.mgr = mgr;
    this.cf = cf;
    this.config = config;
    this.signator = skipSignator ? null : new Signator(this.db, this);
    this.loadHabs();
    this.reconfigure();
  }

  /**
   * Populate the in-memory habitat cache from durable `habs.` + `states.` data.
   *
   * Bare metadata records without corresponding current state are skipped so
   * `Habery.habs` only contains reopenable local habitats.
   */
  private loadHabs(): void {
    for (const [pre, habord] of this.db.getHabItemIter()) {
      const hid = habord.hid || pre;
      if (!habord.name || this.habs.has(hid) || !this.db.getState(hid)) {
        continue;
      }
      const hab = new Hab(
        habord.name,
        this.db,
        this.ks,
        this.mgr,
        habord.domain,
        hid,
      );
      this.habs.set(hid, hab);
    }
  }

  /** Local AID prefixes currently managed by this habery. */
  get prefixes(): string[] {
    return [...this.habs.keys()];
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
    if (typeof conf.dt !== "string") {
      return;
    }

    const date = conf.dt;
    const loadUrls = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string")
        : [];

    for (const url of [...loadUrls(conf.iurls), ...loadUrls(conf.durls)]) {
      this.db.oobis.pin(url, { date, state: "queued" });
    }
    for (const url of loadUrls(conf.wurls)) {
      this.db.woobi.pin(url, { date, state: "queued" });
    }
  }

  /** Creates and caches a new habitat under this habery. */
  makeHab(name: string, ns?: string, args: MakeHabArgs = {}): Hab {
    const hab = new Hab(name, this.db, this.ks, this.mgr, ns);
    hab.make(args);
    if (!hab.pre) throw new Error("Hab creation failed");
    this.habs.set(hab.pre, hab);
    return hab;
  }

  /**
   * Resolve a habitat by alias (and optional namespace) using DB-backed state.
   *
   * This uses `names.` for alias lookup, `habs.` for metadata, and `states.`
   * for reopenable current state before materializing a cached `Hab`.
   */
  habByName(name: string, ns?: string): Hab | null {
    const pre = this.db.getName(ns ?? "", name);
    if (!pre) return null;
    if (this.habs.has(pre)) return this.habs.get(pre)!;
    const rec = this.db.getHab(pre);
    if (!rec || !this.db.getState(pre)) return null;
    const hab = new Hab(name, this.db, this.ks, this.mgr, ns, pre);
    this.habs.set(pre, hab);
    return hab;
  }

  /** Closes backing databases and optionally clears temp storage. */
  *close(clear = false): Operation<void> {
    yield* this.db.close(clear);
    yield* this.ks.close(clear);
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
  const signer = saltySigner(branSalt, "", false, "low", false);
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

  const cf = providedCf ??
    (skipConfig ? undefined : (yield* createConfiger({
      name,
      base,
      temp,
      headDirPath,
      reopen: true,
      clear: false,
    })));
  const config = cf ? cf.get<Record<string, unknown>>() : {};

  let usedSeed = seed ?? "";
  let usedAeid = aeid ?? "";
  if (bran && !seed) {
    const derived = branToSeedAeid(bran);
    usedSeed = derived.seed;
    if (!usedAeid) usedAeid = derived.aeid;
  }

  // Encrypted keeper opens are sync at the `Manager` surface, so habery
  // creation explicitly establishes the sodium readiness boundary here before
  // manager construction. That keeps reopen/init paths honest without pushing
  // libsodium concerns into CESR imports.
  ensureKeeperCryptoReady();
  const mgr = new Manager({
    ks,
    seed: usedSeed,
    aeid: usedAeid,
    algo,
    salt: normalizeSaltQb64(salt),
  });

  return new Habery(name, base, temp, db, ks, mgr, cf, config, skipSignator);
}
