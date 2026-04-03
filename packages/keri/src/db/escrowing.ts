import { Cigar, Dater, Diger, Prefixer, Seqner, SerderKERI, Siger, Verfer } from "../../../cesr/mod.ts";
import { TransIdxSigGroup } from "../core/dispatch.ts";
import { ValidationError } from "../core/errors.ts";
import { consoleLogger, type Logger } from "../core/logger.ts";
import type { VerferCigarCouple } from "../core/records.ts";
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
  logger?: Logger;
}

/**
 * Collection of databases for transaction state notices (TSNs) and TSN escrow
 * handling.
 *
 * KERIpy correspondence:
 * - mirrors `keri.db.escrowing.Broker`
 *
 * Current `keri-ts` difference:
 * - this is a DB substrate only in the current phase; it is exported and
 *   tested, but not yet wired into a TEL runtime or `Reger` owner
 */
export class Broker {
  readonly db: LMDBer;
  readonly timeout: number;
  readonly logger: Logger;
  readonly daterdb: CesrSuber<Dater>;
  readonly serderdb: SerderSuber<SerderKERI>;
  readonly tigerdb: CesrIoSetSuber<Siger>;
  readonly cigardb: CatCesrIoSetSuber<VerferCigarCouple>;
  readonly escrowdb: CesrIoSetSuber<Diger>;
  readonly saiderdb: CesrSuber<Diger>;

  constructor(
    db: LMDBer,
    subkey: string,
    { timeout = 3600, logger = consoleLogger }: BrokerOptions = {},
  ) {
    this.db = db;
    this.timeout = timeout;
    this.logger = logger;

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

  /**
   * Process escrowed transaction-state notices for one escrow type.
   *
   * Recoverable errors of `extype` keep the escrow entry in place. Other
   * failures unescrow the entry and log diagnostics.
   */
  processEscrowState(
    typ: string,
    processReply: (args: BrokerProcessReplyArgs) => void,
    extype: new(...args: any[]) => Error,
  ): void {
    for (const [keys, diger] of this.escrowdb.getTopItemIter([typ, ""])) {
      const pre = keys[1];
      const aid = keys[2];
      if (!pre || !aid) {
        continue;
      }

      try {
        const tsgs = this.fetchTsgs(diger);
        const escrowKeys = [diger.qb64] as const;
        const dater = this.daterdb.get(escrowKeys);
        const serder = this.serderdb.get(escrowKeys);
        const vcigars = this.cigardb.get(escrowKeys);

        try {
          if (!dater || !serder || (tsgs.length === 0 && vcigars.length === 0)) {
            throw new Error(
              `Missing escrow artifacts at said=${diger.qb64} for pre=${pre}.`,
            );
          }

          const cigars = vcigars.map(([verfer, cigar]) => new Cigar(cigar, verfer));
          if (
            (Date.now() - new Date(dater.iso8601).getTime())
              > (this.timeout * 1000)
          ) {
            throw new ValidationError(
              `Stale txn state escrow at pre=${pre}`,
            );
          }

          const route = serder.route;
          if (!route) {
            throw new Error(
              `Escrowed txn state reply ${diger.qb64} is missing route data.`,
            );
          }

          processReply({
            serder,
            diger,
            route,
            cigars,
            tsgs,
            aid,
          });
        } catch (error) {
          if (error instanceof extype) {
            this.logger.info(
              `Broker ${typ}: recoverable escrow retry failure for ${diger.qb64}`,
              error,
            );
            continue;
          }

          this.escrowdb.rem([typ, pre, aid], diger);
          this.logger.error(
            `Broker ${typ}: unescrowed due to error for ${diger.qb64}`,
            error,
          );
          continue;
        }

        this.escrowdb.rem([typ, pre, aid], diger);
        this.logger.info(
          `Broker ${typ}: unescrow succeeded for txn state=${serder.said}`,
        );
      } catch (error) {
        this.escrowdb.rem([typ, pre, aid], diger);
        this.removeState(diger);
        this.logger.error(
          `Broker ${typ}: removed escrow/state due to outer error for ${diger.qb64}`,
          error,
        );
      }
    }
  }

  /**
   * Persist one escrowed transaction-state notice and its attachments.
   *
   * This stores the escrow artifacts idempotently before indexing the escrow
   * route bucket.
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
  ): boolean {
    const keys = [diger.qb64] as const;
    this.daterdb.put(keys, dater);
    this.serderdb.put(keys, serder);

    for (const group of tsgs) {
      this.tigerdb.put(
        [diger.qb64, group.pre, group.snh, group.said],
        group.sigers,
      );
    }

    for (const cigar of cigars) {
      if (!cigar.verfer) {
        throw new Error(
          `Escrowed cigar for ${diger.qb64} is missing verifier context.`,
        );
      }
      this.cigardb.put(keys, [[cigar.verfer, cigar]]);
    }

    return this.escrowdb.put([typ, pre, aid], [diger]);
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
    const state = serder.sad?.a as Record<string, unknown> | undefined;
    const prefix = state && typeof state.i === "string" ? state.i : null;
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
   * This intentionally stays private to `Broker` for now so the generic
   * `fetchTsgs` parity row can remain tracked separately.
   */
  private fetchTsgs(diger: Diger, snh?: string): TransIdxSigGroup[] {
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
      if (snh !== undefined && currentSnh > snh) {
        break;
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
