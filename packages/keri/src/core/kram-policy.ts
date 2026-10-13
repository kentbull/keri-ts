/** KRAM cache selection and safe, receiver-clocked configuration transitions. */
import { intToB64, SerderKERI } from "cesr-ts";
import type { Baser } from "../db/basing.ts";
import { CacheTypeRecord, type CacheTypeRecordShape } from "./records.ts";

/** Millisecond drift, acceptance and pruning windows in frozen-reference order. */
export type KramWindows = readonly [number, number, number, number, number, number, number];
/** Version, optional message type and optional route prefix exempted from KRAM. */
export type KramExemption = readonly [readonly [number, number], string, string];
/** Explicit optional intake configuration; exemptions do not deny sender processing. */
export interface KramConfig {
  enabled?: boolean;
  denials?: readonly KramExemption[];
  caches?: Readonly<Record<string, KramWindows>>;
}
/** Checked cache values; transitional acceptance windows may temporarily be zero. */
export type KramCacheType = Required<CacheTypeRecordShape>;
/** Receiver-clocked acceptance expansion that survives a database reopen. */
interface PendingWindows {
  start: number;
  delta: number;
  windows: KramWindows;
}
/** Private policy metadata, distinct from interoperable ctyp. records. */
interface PolicyState {
  caches: Record<string, KramWindows>;
  pending: Record<string, PendingWindows>;
}
/** Only this key owns the policy transition metadata in the existing settings table. */
const policyKey = "kram-policy";

/** Validate caller configuration before any durable policy mutation. */
function windows(value: unknown, transitional = false): KramWindows {
  if (!Array.isArray(value) || value.length !== 7 || value.some((v) => !Number.isSafeInteger(v) || v < 0)) {
    throw new RangeError("KRAM windows must contain seven nonnegative safe integers");
  }
  const [d, sl, ll, xl, psl, pll, pxl] = value as number[];
  if ((!transitional && sl === 0) || sl > ll || ll > xl || psl < sl || pll < ll || pxl < xl) {
    throw new RangeError("Invalid KRAM acceptance/pruning windows");
  }
  return [d, sl, ll, xl, psl, pll, pxl];
}
/** Normalize one stored record without treating corrupt metadata as remote refusal. */
function values(record: CacheTypeRecord): KramWindows {
  try {
    return windows([record.d, record.sl, record.ll, record.xl, record.psl, record.pll, record.pxl], true);
  } catch (cause) {
    throw new Error("Corrupt KRAM cache type", { cause });
  }
}
/** Build a canonical interoperable cache-type record. */
function cacheRecord([d, sl, ll, xl, psl, pll, pxl]: KramWindows): CacheTypeRecord {
  return new CacheTypeRecord({ d, sl, ll, xl, psl, pll, pxl });
}
/** Project the exact/type/catchall semantic coverage used by the frozen reference. */
function pattern(key: string): readonly [string, string] {
  if (key === "~") return ["ANY", "ANY"];
  const separator = key.indexOf(".R.");
  return separator < 0 ? [key, "ANY"] : [key.slice(0, separator), key.slice(separator + 3)];
}
/** Determine whether one cache expression covers another semantic pattern. */
function covers(key: string, target: readonly [string, string]): boolean {
  const [type, route] = pattern(key);
  return (type === "ANY" || type === target[0]) && (route === "ANY" || route === target[1]);
}
/** Compare sets without relying on object insertion order. */
function sameKeys(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((key) => right.includes(key));
}
/** Validate the named cache expressions and copy caller-owned tuples. */
function configuration(caches: KramConfig["caches"]): Record<string, KramWindows> {
  const result: Record<string, KramWindows> = {};
  for (const [key, value] of Object.entries(caches ?? {})) {
    if (key !== "~" && !/^[a-z]{3}(?:\.R\..+)?$/.test(key)) throw new RangeError("Invalid KRAM cache expression");
    result[key] = windows(value);
  }
  return result;
}

/** Decode persisted transitions; corrupt local policy is never a remote refusal. */
function policyState(stored: string, db: Baser): PolicyState {
  try {
    const state = JSON.parse(stored) as PolicyState;
    state.caches = configuration(state.caches);
    if (!state.pending || typeof state.pending !== "object" || Array.isArray(state.pending)) {
      throw new Error("pending");
    }
    for (const [key, entry] of Object.entries(state.pending)) {
      if (
        !Object.hasOwn(state.caches, key) || !Number.isSafeInteger(entry.start)
        || !Number.isSafeInteger(entry.delta) || entry.delta < 0
      ) throw new Error("pending window");
      entry.windows = windows(entry.windows);
    }
    for (const key of Object.keys(state.caches)) {
      const record = db.ctyp.get(key);
      if (!record) throw new Error("Missing persisted KRAM cache type");
      values(record);
    }
    return state;
  } catch (cause) {
    throw new Error("Corrupt KRAM policy metadata", { cause });
  }
}

/**
 * Own finite cache configuration and exemption policy, reusing Baser.ctyp.
 * Persist staged acceptance expansions so restart cannot reopen an old window.
 * Reconfiguration uses active windows, including during an earlier expansion.
 */
export class KramPolicy {
  readonly db: Baser;
  readonly enabled: boolean;
  private readonly exemptions: readonly string[];
  private state: PolicyState;
  private storedState: string | null;
  private readonly now: () => number;

  constructor(db: Baser, config: KramConfig = {}, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
    this.enabled = config.enabled ?? false;
    const denials: readonly KramExemption[] = [
      ...(config.denials ?? []),
      ...(this.enabled
        ? [[[2, 0], "rpy", "/end/role"], [[2, 0], "rpy", "/loc/scheme"]] as KramExemption[]
        : []),
    ];
    this.exemptions = denials.map(([version, type, route]) => {
      if (
        version.length !== 2 || version.some((v) => !Number.isSafeInteger(v) || v < 0)
        || version[0] >= 64 || version[1] >= 4096 || typeof type !== "string" || typeof route !== "string"
      ) throw new RangeError("Invalid KRAM exemption");
      return [intToB64(version[0], 1) + intToB64(version[1], 2), ...(type ? [type] : []), ...(route ? [route] : [])]
        .join(".") + (route ? "" : ".");
    });
    const requested = configuration(config.caches);
    const stored = db.hbys.get(policyKey);
    this.storedState = stored;
    if (stored !== null) {
      this.state = policyState(stored, db);
      const identical = sameKeys(Object.keys(requested), Object.keys(this.state.caches))
        && Object.keys(requested).every((key) => requested[key].every((v, i) => v === this.state.caches[key][i]));
      if (config.caches !== undefined && !identical) this.change(requested);
    } else {
      this.state = { caches: requested, pending: {} };
      this.commit(() => {
        for (const [key, tuple] of Object.entries(requested)) db.ctyp.pin(key, cacheRecord(tuple));
      });
    }
  }

  /** Exemptions bypass only KRAM; sender policy and downstream verification still apply. */
  exempts(serder: SerderKERI): boolean {
    const vector = `${intToB64(serder.pvrsn.major, 1)}${intToB64(serder.pvrsn.minor, 2)}.${serder.ilk}.${serder.route}`;
    return !this.enabled || this.exemptions.some((denial) => vector.startsWith(denial));
  }

  /** Select exact route, message type, then catchall; absence is a configuration failure. */
  cacheType(ilk: string, route: string | null): KramCacheType {
    const record = (route ? this.db.ctyp.get(`${ilk}.R.${route}`) : null) ?? this.db.ctyp.get(ilk)
      ?? this.db.ctyp.get("~");
    if (!record) throw new Error("No KRAM cache type for message");
    const [d, sl, ll, xl, psl, pll, pxl] = values(record);
    return { d, sl, ll, xl, psl, pll, pxl };
  }

  /** Stage expansions and reject coverage holes before changing interoperable rows. */
  change(caches: KramConfig["caches"], override?: number): void {
    const next = configuration(caches);
    if (override !== undefined && (!Number.isSafeInteger(override) || override <= 0)) {
      throw new RangeError("Invalid KRAM transition delay");
    }
    this.reconcile();
    const oldKeys = Object.keys(this.state.caches), newKeys = Object.keys(next);
    for (const key of oldKeys) {
      if (!newKeys.some((candidate) => covers(candidate, pattern(key)))) {
        throw new RangeError("KRAM configuration creates a coverage hole");
      }
    }
    const active: Record<string, KramWindows> = {};
    for (const key of oldKeys) {
      const record = this.db.ctyp.get(key);
      if (!record) throw new Error("Missing KRAM cache type during reconfiguration");
      active[key] = values(record);
    }
    let coverageDelay = 0;
    for (const key of new Set([...oldKeys, ...newKeys])) {
      const target = pattern(key);
      const introduced = !oldKeys.some((candidate) =>
        pattern(candidate)[0] === target[0] && pattern(candidate)[1] === target[1]
      );
      const before = introduced ? [] : oldKeys.filter((candidate) => covers(candidate, target));
      const after = newKeys.filter((candidate) => covers(candidate, target));
      if (!sameKeys(before, after) && after.length) {
        const oldShort = before.length ? Math.min(...before.map((key) => active[key][1])) : 0;
        coverageDelay = Math.max(coverageDelay, Math.min(...after.map((key) => next[key][1])) - oldShort);
      }
    }
    const pending: Record<string, PendingWindows> = {};
    const rows: Record<string, KramWindows> = {};
    const start = this.now();
    if (!Number.isSafeInteger(start)) throw new Error("Invalid KRAM receiver clock");
    for (const [key, tuple] of Object.entries(next)) {
      const previous = active[key];
      const decreases = previous && tuple.slice(1).every((v, i) => v <= previous[i + 1]);
      if (decreases) rows[key] = [previous[0], ...tuple.slice(1)] as unknown as KramWindows;
      else {
        const delay = override
          ?? Math.max(coverageDelay, previous ? Math.max(0, ...[1, 2, 3].map((i) => tuple[i] - previous[i])) : 0);
        if (!delay) rows[key] = tuple;
        else {
          pending[key] = { start, delta: delay, windows: tuple };
          const sl = previous?.[1] ?? (oldKeys.length ? Math.min(...oldKeys.map((key) => active[key][1])) : 0);
          const ll = previous?.[2] ?? (oldKeys.length ? Math.min(...oldKeys.map((key) => active[key][2])) : 0);
          const xl = previous?.[3] ?? (oldKeys.length ? Math.min(...oldKeys.map((key) => active[key][3])) : 0);
          rows[key] = [
            previous?.[0] ?? tuple[0],
            sl,
            ll,
            xl,
            Math.max(tuple[4], tuple[1]),
            Math.max(tuple[5], tuple[2]),
            Math.max(tuple[6], tuple[3]),
          ];
        }
      }
    }
    const prior = this.state;
    this.state = { caches: next, pending };
    try {
      this.commit(() => {
        for (const key of oldKeys) if (!Object.hasOwn(next, key)) this.db.ctyp.rem(key);
        for (const [key, tuple] of Object.entries(rows)) this.db.ctyp.pin(key, cacheRecord(tuple));
      });
    } catch (error) {
      this.state = prior;
      throw error;
    }
  }

  /** Complete elapsed expansions without changing each cache's creation-time drift. */
  reconcile(): void {
    this.refresh();
    const ready = Object.entries(this.state.pending).filter(([, entry]) => this.now() - entry.start >= entry.delta);
    if (!ready.length) return;
    const prior = this.state;
    this.state = { caches: prior.caches, pending: { ...prior.pending } };
    for (const [key] of ready) delete this.state.pending[key];
    try {
      this.commit(() => {
        for (const [key, entry] of ready) {
          const current = this.db.ctyp.get(key);
          if (!current) throw new Error("Missing KRAM cache type during reconciliation");
          const tuple = values(current);
          this.db.ctyp.pin(
            key,
            cacheRecord([tuple[0], entry.windows[1], entry.windows[2], entry.windows[3], tuple[4], tuple[5], tuple[6]]),
          );
        }
      });
    } catch (error) {
      this.state = prior;
      throw error;
    }
  }

  /** Observe another policy owner's completed or superseding transition. */
  private refresh(): void {
    const stored = this.db.hbys.get(policyKey);
    if (stored === this.storedState) return;
    if (stored === null) throw new Error("Missing persisted KRAM policy metadata");
    this.state = policyState(stored, this.db);
    this.storedState = stored;
  }

  /** Publish policy rows and their restart-safe transition metadata atomically. */
  private commit(mutate: () => void): void {
    const env = this.db.env;
    if (!env) throw new Error("KRAM policy database is closed");
    const next = JSON.stringify(this.state);
    env.transactionSync(() => {
      if (this.db.hbys.get(policyKey) !== this.storedState) throw new Error("KRAM policy changed during transition");
      mutate();
      this.db.hbys.pin(policyKey, next);
    });
    this.storedState = next;
  }
}
