import { Cigar, Dater, Diger, Prefixer, Seqner, SerderKERI, Siger, Verfer } from "cesr-ts";
import { TransIdxSigGroup } from "../core/dispatch.ts";
import { ValidationError } from "../core/errors.ts";
import { dropEscrow, type EscrowProcessDecision } from "../core/kever-decisions.ts";
import { consoleLogger } from "../core/logger.ts";
import type { VerferCigarCouple } from "../core/records.ts";
import { makeNowIso8601, timestampMicros } from "../time/mod.ts";
import { LMDBer } from "./core/lmdber.ts";
import { CatCesrIoSetSuber, CesrIoSetSuber, CesrSuber, SerderSuber } from "./subing.ts";

function hexToFixedBytes(hex: string, size: number): Uint8Array {
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`;
  if (!/^[0-9a-f]+$/i.test(normalized)) {
    throw new Error(`Invalid hex ordinal ${hex}`);
  }
  if (normalized.length > size * 2) {
    throw new Error(`Hex ordinal ${hex} exceeds ${size} bytes.`);
  }

  const raw = new Uint8Array(size);
  const padded = normalized.padStart(size * 2, "0");
  for (let i = 0; i < size; i++) {
    raw[i] = Number.parseInt(padded.slice(i * 2, (i * 2) + 2), 16);
  }
  return raw;
}

function seqnerFromSnh(snh: string): Seqner {
  return new Seqner({ code: "0A", raw: hexToFixedBytes(snh, 16) });
}

/** Callback shape used when `Broker` retries one escrowed state notice. */
export interface BrokerProcessReplyArgs {
  serder: SerderKERI;
  diger: Diger;
  route: string;
  cigars: Cigar[];
  tsgs: TransIdxSigGroup[];
  aid: string;
}

/** Constructor options for one escrow `Broker`. */
export interface BrokerOptions {
  timeout?: number;
}

/**
 * Collection of databases for transaction state notices (TSNs) and TSN escrow
 * handling.
 *
 * KERIpy correspondence:
 * - mirrors `keri.db.escrowing.Broker`
 *
 * Current `keri-ts` difference:
 * - Reger owns this store; registry and credential receivers return typed
 *   retry outcomes rather than signaling ordinary pending state by exceptions
 *
 * Escrow model:
 * - `escrowStateNotice()` stores one reply body plus its detached endorsement
 *   artifacts
 * - `retryStateNotices()` replays one finite family horizon with `accept/keep/drop`
 * - semantic receivers own accepted-state updates; successful or terminal replay
 *   removes only its family index, retaining artifacts other families may use
 * - storage/corruption failures propagate without discarding retryable evidence
 */
export class Broker {
  readonly db: LMDBer;
  readonly timeout: number;
  readonly daterdb: CesrSuber<Dater>;
  readonly serderdb: SerderSuber<SerderKERI>;
  readonly tigerdb: CesrIoSetSuber<Siger>;
  readonly cigardb: CatCesrIoSetSuber<VerferCigarCouple>;
  readonly escrowdb: CesrIoSetSuber<Diger>;
  readonly saiderdb: CesrSuber<Diger>;
  private readonly retryScans = new Map<string, { start: Uint8Array; end: Uint8Array }>();

  constructor(
    db: LMDBer,
    subkey: string,
    { timeout = 3600 }: BrokerOptions = {},
  ) {
    this.db = db;
    this.timeout = timeout;

    this.daterdb = new CesrSuber(db, {
      subkey: `${subkey}-dts.`,
      ctor: Dater,
    });
    this.serderdb = new SerderSuber(db, { subkey: `${subkey}-sns.` });
    this.tigerdb = new CesrIoSetSuber(db, {
      subkey: `${subkey}-sgs.`,
      ctor: Siger,
    });
    this.cigardb = new CatCesrIoSetSuber(db, {
      subkey: `${subkey}-cgs.`,
      ctor: [Verfer, Cigar],
    });
    this.escrowdb = new CesrIoSetSuber(db, {
      subkey: `${subkey}-nes`,
      ctor: Diger,
    });
    this.saiderdb = new CesrSuber(db, {
      subkey: `${subkey}-nas.`,
      ctor: Diger,
    });
  }

  /** Return the currently saved transaction-state SAID for `(prefix, aid)`. */
  current(keys: [string, string]): Diger | null {
    return this.saiderdb.get(keys);
  }

  /** Test one exact family/prefix/attester bucket without materializing its members. */
  hasStateNotice(typ: string, pre: string, aid: string, diger: Diger): boolean {
    for (const member of this.escrowdb.getIter([typ, pre, aid])) {
      if (member.qb64 === diger.qb64) return true;
    }
    return false;
  }

  /** Retry a finite captured family horizon with typed outcomes and no exception adapter.
   * Release key cursors before hydration, callbacks or index writes. Failures
   * propagate and reset this family's checkpoint, so a later sweep revisits
   * earlier rows unblocked before the failure. Kept rows and insertions behind
   * the checkpoint return next pass; new rows beyond the horizon cannot extend it.
   * Removing an index retains artifacts that another dependency family may own.
   * Terminal drops are reported only after the index removal succeeds; dependency
   * migration must return accept for the relinquished family, rather than drop.
   * @param typ Escrow family whose existing finite key horizon is traversed.
   * @param processReply Synchronous semantic owner; reports its decision and actual
   * retained evidence changes, including insertions outside this page or horizon.
   * @param maxRows Maximum rows materialized in this page, from 1 through 1024.
   * @param now ISO timestamp used to compare the notice age against timeout seconds.
   * @returns Page position and whether callback writes or completed index removals
   * changed evidence. Merely visiting a kept row does not count as progress.
   */
  retryStateNotices(
    typ: string,
    processReply: (args: BrokerProcessReplyArgs) => { decision: EscrowProcessDecision; changed: boolean },
    { maxRows = 64, now = makeNowIso8601() }: { maxRows?: number; now?: string } = {},
  ): { processed: number; done: boolean; changed: boolean } {
    if (!/^[a-z-]+$/.test(typ) || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 1024) {
      throw new Error("Invalid Broker retry family or row ceiling.");
    }
    const when = timestampMicros(now), ttl = this.timeout * 1_000_000;
    if (when === null || !Number.isSafeInteger(ttl) || ttl < 0) throw new Error("Invalid Broker retry time.");
    const encode = (value: string) => new TextEncoder().encode(value);
    const decode = (value: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(value);
    try {
      let scan = this.retryScans.get(typ);
      if (!scan) {
        const start = encode(`${typ}.`), ceiling = encode(`${typ}/`);
        let tail: Uint8Array | undefined;
        for (const key of this.escrowdb.sdb.getKeys({ start: ceiling, end: start, reverse: true, limit: 1 })) {
          tail = key.slice();
        }
        if (!tail) return { processed: 0, done: true, changed: false };
        scan = { start, end: encode(`${decode(tail)}\0`) };
        this.retryScans.set(typ, scan);
      }
      const rows: Uint8Array[] = [];
      for (const key of this.escrowdb.sdb.getKeys({ start: scan.start, end: scan.end, limit: maxRows })) {
        rows.push(key.slice());
      }
      let changed = false;
      for (const key of rows) {
        const parts = decode(key).split(".");
        if (
          parts.length !== 4 || parts[0] !== typ || !parts[1] || !parts[2]
          || parts.some((part) => part.includes("\0")) || !/^[0-9a-f]{32}$/.test(parts[3])
        ) {
          throw new Error("Corrupt Broker retry key.");
        }
        const raw = this.db.getVal(this.escrowdb.sdb, key);
        if (!raw || raw.length > 128) throw new Error("Corrupt Broker retry digest row.");
        const diger = new Diger({ qb64b: raw });
        const dater = this.daterdb.get([diger.qb64]), serder = this.serderdb.get([diger.qb64]);
        const tsgs = this.fetchTsgs(diger), couples = this.cigardb.get([diger.qb64]);
        if (!dater || !serder || (!tsgs.length && !couples.length) || !serder.route) {
          throw new Error("Corrupt Broker retry artifacts.");
        }
        const stamp = timestampMicros(dater.dts);
        if (stamp === null) throw new Error("Corrupt Broker retry timestamp.");
        const result = when - stamp > BigInt(ttl) ? { decision: dropEscrow("stale"), changed: false } : processReply({
          aid: parts[2],
          diger,
          serder,
          route: serder.route,
          tsgs,
          cigars: couples.map(([verfer, cigar]) => new Cigar(cigar, verfer)),
        });
        const { decision } = result;
        changed = result.changed || changed;
        if (decision.kind === "accept" || decision.kind === "drop") {
          const removed = this.escrowdb.rem(parts.slice(0, 3), diger);
          changed = removed || changed;
          if (removed && decision.kind === "drop") {
            consoleLogger.warn("Broker ejected transaction-state notice from escrow", {
              family: typ,
              said: diger.qb64,
              pre: parts[1],
              aid: parts[2],
              route: serder.route,
              reason: decision.reason,
              detail: decision.message,
            });
          }
        } else if (decision.kind !== "keep") throw new Error("Invalid Broker retry decision.");
        scan.start = encode(`${decode(key)}\0`);
      }
      const done = rows.length < maxRows;
      if (done) this.retryScans.delete(typ);
      return { processed: rows.length, done, changed };
    } catch (error) {
      // A failed sweep cannot resume behind earlier rows whose dependencies may now be ready.
      this.retryScans.delete(typ);
      throw error;
    }
  }

  /**
   * Persist one escrowed transaction-state notice and its attachments.
   *
   * This stores the escrow artifacts idempotently before indexing the escrow
   * route bucket.
   *
   * Stored artifacts:
   * - `daterdb` for timeout handling
   * - `serderdb` for the escrowed reply body
   * - `tigerdb` for transferable endorsement groups
   * - `cigardb` for non-transferable endorsement couples
   * - `escrowdb` for the broker-specific `(typ, pre, aid)` index
   *
   * The returned `added` describes only new family membership. `changed` also
   * includes new retained bodies, timestamps and signatures under an existing
   * member; identical retries return false for both fields.
   */
  escrowStateNotice(
    {
      typ,
      pre,
      aid,
      serder,
      diger,
      dater,
      cigars = [],
      tsgs = [],
    }: {
      typ: string;
      pre: string;
      aid: string;
      serder: SerderKERI;
      diger: Diger;
      dater: Dater;
      cigars?: readonly Cigar[];
      tsgs?: readonly TransIdxSigGroup[];
    },
  ): { added: boolean; changed: boolean } {
    const keys = [diger.qb64] as const;
    let changed = this.daterdb.put(keys, dater);
    changed = this.serderdb.put(keys, serder) || changed;

    for (const group of tsgs) {
      // KERIpy 71438328 and b8626e1d key proofs by numeric ordinal padded to 32 hex digits.
      // Primitive wrappers/codes do not identify genus; equivalent ordinals must share partial signatures.
      changed = this.tigerdb.put(
        [diger.qb64, group.pre, group.sn.toString(16).padStart(32, "0"), group.said],
        group.sigers,
      ) || changed;
    }

    for (const cigar of cigars) {
      if (!cigar.verfer) {
        throw new Error(
          `Escrowed cigar for ${diger.qb64} is missing verifier context.`,
        );
      }
      changed = this.cigardb.put(keys, [[cigar.verfer, cigar]]) || changed;
    }

    const added = this.escrowdb.put([typ, pre, aid], [diger]);
    return { added, changed: added || changed };
  }

  /**
   * Update the accepted reply record and current-state index for one TSN.
   *
   * Overwrites any existing accepted reply for the same SAID and current-state
   * pointer for the `(prefix, aid)` tuple.
   */
  updateReply(
    aid: string,
    serder: SerderKERI,
    diger: Diger,
    dater: Dater,
  ): void {
    const keys = [diger.qb64] as const;
    const state = serder.sad?.a;
    const prefix = state && typeof state === "object" && "i" in state && typeof state.i === "string" ? state.i : null;
    if (!prefix) {
      throw new Error(
        `Txn state reply ${diger.qb64} is missing state prefix at sad.a.i.`,
      );
    }

    this.daterdb.put(keys, dater);
    this.serderdb.pin(keys, serder);
    this.saiderdb.pin([prefix, aid], diger);
  }

  /** Remove all persisted state associated with one escrowed TSN SAID. */
  removeState(diger: Diger | null | undefined): void {
    if (!diger) {
      return;
    }

    const keys = [diger.qb64] as const;
    this.tigerdb.trim([diger.qb64, ""], { topive: false });
    this.cigardb.rem(keys);
    this.serderdb.rem(keys);
    this.daterdb.rem(keys);
  }

  /**
   * Rebuild transferable signature groups for one stored state notice.
   *
   * Private to the retry path; preserves KERIpy `fetchTsgs` grouping without a
   * second public reconstruction API.
   *
   * Reconstruction steps:
   * - walk the stored signer rows grouped under one reply SAID
   * - regroup them by `(pre, snh, dig)`
   * - rebuild `TransIdxSigGroup` values in insertion order per group
   */
  private fetchTsgs(diger: Diger): TransIdxSigGroup[] {
    const groups: TransIdxSigGroup[] = [];
    let currentKey: string[] | null = null;
    let currentSigers: Siger[] = [];

    const flush = () => {
      if (!currentKey || currentSigers.length === 0) {
        return;
      }
      groups.push(
        new TransIdxSigGroup(
          new Prefixer({ qb64: currentKey[0] }),
          seqnerFromSnh(currentKey[1]),
          new Diger({ qb64: currentKey[2] }),
          currentSigers,
        ),
      );
      currentSigers = [];
    };

    for (const [keys, siger] of this.tigerdb.getTopItemIter([diger.qb64, ""])) {
      const groupKey = keys.slice(1);
      const currentSnh = groupKey[1];
      if (!groupKey[0] || !currentSnh || !groupKey[2]) {
        continue;
      }
      if (
        currentKey === null
        || currentKey[0] !== groupKey[0]
        || currentKey[1] !== groupKey[1]
        || currentKey[2] !== groupKey[2]
      ) {
        flush();
        currentKey = [groupKey[0], groupKey[1], groupKey[2]];
      }
      currentSigers.push(siger);
    }

    flush();
    return groups;
  }
}
