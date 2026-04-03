import { type Operation } from "npm:effection@^3.6.0";
import {
  Cigar,
  concatBytes,
  Counter,
  CtrDexV1,
  DigDex,
  Diger,
  DIGEST_CODES,
  Ilks,
  parseMatter,
  PREFIX_CODES,
  Prefixer,
  SerderKERI,
  Siger,
  type ThresholdSith,
  type Tier,
  Tiers,
  Verfer,
} from "../../../cesr/mod.ts";
import { b } from "../../../cesr/mod.ts";
import type { AgentCue, CueEmission } from "../core/cues.ts";
import { Deck } from "../core/deck.ts";
import { TransIdxSigGroup } from "../core/dispatch.ts";
import { ValidationError } from "../core/errors.ts";
import { Kevery } from "../core/eventing.ts";
import { Kever } from "../core/kever.ts";
import type { HabitatRecord, VerferCigarCouple } from "../core/records.ts";
import { type Role, Roles } from "../core/roles.ts";
import { type Scheme, Schemes } from "../core/schemes.ts";
import { Baser, createBaser } from "../db/basing.ts";
import { createKeeper, Keeper } from "../db/keeping.ts";
import { makeNowIso8601 } from "../time/mod.ts";
import { Configer, createConfiger } from "./configing.ts";
import { Algos, branToSaltQb64, ensureKeeperCryptoReady, Manager, normalizeSaltQb64, saltySigner } from "./keeping.ts";

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
      t: Ilks.rpy,
      dt: stamp,
      r: route,
      a: data,
    },
    makify: true,
  });
}

/**
 * Build one canonical `qry` serder from route, query body, and timestamp.
 *
 * Current `keri-ts` scope:
 * - follows the KERIpy version-1 message shape used by `BaseHab.query()`
 * - keeps `src` inside `q` rather than relying on a version-2 outer `i` field
 */
function makeQuerySerder(
  route: string,
  query: Record<string, unknown>,
  stamp = makeNowIso8601(),
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: Ilks.qry,
      dt: stamp,
      r: route,
      rr: "",
      q: query,
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
 * Build one fully attached endorsed message from an arbitrary KERI body serder.
 *
 * Supported attachment shapes for the current bootstrap slice:
 * - transferable controller signature groups
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
  cigars?: readonly Cigar[];
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
      ...args.cigars.flatMap((cigar) => [
        requireCigarVerfer(cigar).qb64b,
        cigar.qb64b,
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
    const kvy = new Kevery(this.db, {
      cues: new Deck<AgentCue>(),
      local: true,
    });
    const decision = kvy.processEvent({
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
      const habord: HabitatRecord = {
        hid: pre,
        name: this.name,
        domain: this.ns,
      };
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

  /** Produces signatures with this habitat's current signing keys. */
  sign(ser: Uint8Array, indexed: true): Siger[];
  sign(ser: Uint8Array, indexed?: false): Cigar[];
  sign(ser: Uint8Array, indexed = false): Siger[] | Cigar[] {
    const pubs = this.kever?.verfers.map((verfer) => verfer.qb64) ?? [];
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
  endorse(serder: SerderKERI): Uint8Array {
    if (!this.pre) {
      throw new Error("Cannot endorse a message before habitat inception.");
    }
    const kever = this.kever;
    if (!kever) {
      throw new Error(`Missing accepted key state for ${this.pre}.`);
    }
    const prefixer = kever.prefixer;
    if (!kever.transferable) {
      return buildEndorsedMessage({
        serder,
        cigars: this.sign(serder.raw, false) as Cigar[],
      });
    }

    const sigers = this.sign(serder.raw, true) as Siger[];
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
    role: Role | string,
    eids: string[] = [],
  ): Uint8Array {
    return this.replyEndRole(aid, role, eids);
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
   * - `replay`, `reply`, and complete `query` cues emit wire messages
   * - `stream` emits transport requests without flattening them into bytes
   * - observer/runtime cues remain visible as notify emissions
   * - `receipt` and `witness` are surfaced as notify emissions until the
   *   receipt/witness message builders land in the broader KEL port
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
        case "witness":
          yield { cue, msgs: [], kind: "notify" };
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
   * Bare metadata records without corresponding accepted key state are skipped
   * so `Habery.habs` only contains reopenable local habitats.
   */
  private loadHabs(): void {
    for (const [pre, habord] of this.db.getHabItemIter()) {
      const hid = habord.hid || pre;
      if (!habord.name || this.habs.has(hid) || !this.db.getKever(hid)) {
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

  const cf = providedCf
    ?? (skipConfig ? undefined : (yield* createConfiger({
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

  return new Habery(name, base, temp, db, ks, mgr, cf, config, skipSignator);
}
