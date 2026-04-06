/**
 * Selective LMDB domain and subdb inspection for maintainers.
 *
 * The mailbox subsystem is easiest to debug when the operator inspects the
 * domain that actually owns the state in question:
 * - `baser` for protocol truth such as `ends` and `tops`
 * - `mailboxer` for provider-side stored inbox traffic
 * - `outboxer` for the optional Tufa-only sender retry sidecar
 */
import { type Operation } from "npm:effection@^3.6.0";
import { displayStr } from "../../core/bytes.ts";
import { DatabaseOperationError, ValidationError } from "../../core/errors.ts";
import { RawRecord } from "../../core/records.ts";
import { Baser, type BaserOptions, createBaser } from "../../db/basing.ts";
import { createKeeper, Keeper, type KeeperOptions } from "../../db/keeping.ts";
import { createMailboxer, Mailboxer, type MailboxerOptions } from "../../db/mailboxing.ts";
import { createOutboxer, Outboxer, type OutboxerOptions } from "../../db/outboxing.ts";

type DomainName = "baser" | "keeper" | "mailboxer" | "outboxer";
type DumpDomain = Baser | Keeper | Mailboxer | Outboxer;

type DumpArgs = {
  name?: string;
  base?: string;
  headDirPath?: string;
  temp?: boolean;
  compat?: boolean;
  target?: string;
  prefix?: string;
  limit?: number;
};

type DumpRow = {
  keys: string[];
  on?: number;
  value: unknown;
};

type DumpableStore = {
  cnt?: () => number;
  cntAll?: () => number;
  getFullItemIter?: (keys?: string) => Iterable<unknown>;
  getTopItemIter?: (keys?: string) => Iterable<unknown>;
};

type DomainFactoryOptions =
  | BaserOptions
  | KeeperOptions
  | MailboxerOptions
  | OutboxerOptions;

type DomainFactory = {
  open: (options: DomainFactoryOptions) => Operation<DumpDomain>;
};

const DOMAIN_FACTORIES: Record<DomainName, DomainFactory> = {
  baser: {
    open: (options) => createBaser(options as BaserOptions),
  },
  keeper: {
    open: (options) => createKeeper(options as KeeperOptions),
  },
  mailboxer: {
    open: (options) => createMailboxer(options as MailboxerOptions),
  },
  outboxer: {
    open: (options) => createOutboxer(options as OutboxerOptions),
  },
};

const DEFAULT_TARGET = "baser.evts";
const DEFAULT_LIMIT = 50;
const MAX_STRING_LENGTH = 240;

function parseTarget(rawTarget: string | undefined): {
  domain: DomainName;
  storeName?: string;
} {
  const target = rawTarget?.trim() || DEFAULT_TARGET;
  const [domainRaw, storeName, extra] = target.split(".");
  if (extra !== undefined) {
    throw new ValidationError(
      `Invalid target "${target}". Use <domain> or <domain>.<subdb>.`,
    );
  }
  if (
    domainRaw !== "baser"
    && domainRaw !== "keeper"
    && domainRaw !== "mailboxer"
    && domainRaw !== "outboxer"
  ) {
    throw new ValidationError(
      `Unknown dump domain "${domainRaw}". Expected one of: baser, keeper, mailboxer, outboxer.`,
    );
  }
  return {
    domain: domainRaw,
    storeName,
  };
}

function isDumpableStore(value: unknown): value is DumpableStore {
  return typeof value === "object"
    && value !== null
    && (
      typeof (value as DumpableStore).getFullItemIter === "function"
      || typeof (value as DumpableStore).getTopItemIter === "function"
    );
}

function domainEntries(domain: DumpDomain): Array<[string, unknown]> {
  return Object.entries(domain as unknown as Record<string, unknown>);
}

function collectStores(domain: DumpDomain): Array<[string, DumpableStore]> {
  return domainEntries(domain)
    .filter(([, value]) => isDumpableStore(value))
    .map(([name, value]) => [name, value] as [string, DumpableStore])
    .sort(([left], [right]) => left.localeCompare(right));
}

function resolveStore(
  domain: DumpDomain,
  domainName: DomainName,
  storeName: string,
): DumpableStore {
  const value = (domain as unknown as Record<string, unknown>)[storeName];
  if (!isDumpableStore(value)) {
    const available = collectStores(domain).map(([name]) => `${domainName}.${name}`).join(", ");
    throw new ValidationError(
      `Unknown target "${domainName}.${storeName}". Available targets: ${available}`,
    );
  }
  return value;
}

function countStoreEntries(store: DumpableStore): number {
  if (typeof store.cnt === "function") {
    return store.cnt();
  }
  if (typeof store.cntAll === "function") {
    return store.cntAll();
  }
  let count = 0;
  for (const _ of iterateStore(store)) {
    count += 1;
  }
  return count;
}

function* iterateStore(
  store: DumpableStore,
  prefix = "",
): Generator<DumpRow> {
  const iterator = typeof store.getFullItemIter === "function"
    ? store.getFullItemIter(prefix)
    : store.getTopItemIter?.(prefix);
  if (!iterator) {
    return;
  }

  for (const item of iterator) {
    if (!Array.isArray(item)) {
      continue;
    }
    if (item.length === 2) {
      const [keys, value] = item;
      yield {
        keys: Array.isArray(keys) ? keys.map(String) : [String(keys)],
        value,
      };
      continue;
    }
    if (item.length === 3) {
      const [keys, on, value] = item;
      yield {
        keys: Array.isArray(keys) ? keys.map(String) : [String(keys)],
        on: typeof on === "number" ? on : Number(on),
        value,
      };
    }
  }
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_STRING_LENGTH - 3)}...`;
}

function normalizeDumpValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return truncateString(value);
  }
  if (
    typeof value === "number"
    || typeof value === "boolean"
    || typeof value === "bigint"
  ) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return {
      utf8: displayStr(value, MAX_STRING_LENGTH),
      hex: truncateString(
        Array.from(value)
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(""),
      ),
    };
  }
  if (value instanceof RawRecord) {
    return normalizeDumpValue(value.asDict());
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDumpValue(item));
  }
  if (typeof value === "object") {
    if ("qb64" in value && typeof (value as { qb64?: unknown }).qb64 === "string") {
      return (value as { qb64: string }).qb64;
    }
    if ("sad" in value && typeof (value as { sad?: unknown }).sad === "object") {
      return normalizeDumpValue((value as { sad: unknown }).sad);
    }
    if ("ked" in value && typeof (value as { ked?: unknown }).ked === "object") {
      return normalizeDumpValue((value as { ked: unknown }).ked);
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, normalizeDumpValue(entryValue)]),
    );
  }
  return String(value);
}

function summarizeStoreCount(store: DumpableStore): string {
  try {
    return `${countStoreEntries(store)}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `error: ${truncateString(message)}`;
  }
}

function printStoreSummary(domainName: DomainName, domain: DumpDomain): void {
  const stores = collectStores(domain);
  console.log(`Domain summary for ${domainName}`);
  console.log(`Resolved path: ${domain.path ?? "(closed)"}`);
  console.log("");
  console.log(`${"Target".padEnd(24)} ${"Type".padEnd(20)} Count`);
  console.log("-".repeat(64));
  for (const [name, store] of stores) {
    console.log(
      `${`${domainName}.${name}`.padEnd(24)} ${store.constructor.name.padEnd(20)} ${summarizeStoreCount(store)}`,
    );
  }
}

function printStoreEntries(
  domainName: DomainName,
  storeName: string,
  store: DumpableStore,
  prefix: string,
  limit: number,
): void {
  const rows: DumpRow[] = [];
  let total = 0;
  for (const row of iterateStore(store, prefix)) {
    total += 1;
    if (rows.length < limit) {
      rows.push(row);
    }
  }

  console.log(`Target: ${domainName}.${storeName}`);
  console.log(`Prefix: ${prefix || "(all)"}`);
  console.log(`Entries shown: ${rows.length}/${total}`);
  console.log("");

  if (rows.length === 0) {
    console.log("No matching entries.");
    return;
  }

  rows.forEach((row, index) => {
    console.log(
      JSON.stringify(
        {
          index: index + 1,
          keys: row.keys,
          ...(row.on !== undefined ? { on: row.on } : {}),
          value: normalizeDumpValue(row.value),
        },
        null,
        2,
      ),
    );
  });
}

function buildOptions(args: DumpArgs): DomainFactoryOptions {
  return {
    name: args.name,
    base: args.base,
    headDirPath: args.headDirPath,
    temp: args.temp,
    compat: args.compat,
    reopen: true,
    readonly: true,
    dupsort: false,
  };
}

function resolveLimit(rawLimit: number | undefined): number {
  if (rawLimit === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!Number.isInteger(rawLimit) || rawLimit <= 0) {
    throw new ValidationError("`--limit` must be a positive integer");
  }
  return rawLimit;
}

/**
 * Dump one LMDB domain summary or one specific subdb.
 *
 * Target examples:
 * - `baser`
 * - `baser.ends`
 * - `mailboxer`
 * - `mailboxer.tpcs`
 * - `outboxer.tgts`
 */
export function* dumpDatabase(args: Record<string, unknown>): Operation<void> {
  const name = args.name as string | undefined;
  const base = args.base as string | undefined;
  const headDirPath = args.headDirPath as string | undefined;
  const temp = args.temp as boolean | undefined;
  const compat = args.compat as boolean | undefined;
  const target = args.target as string | undefined;
  const prefix = args.prefix as string | undefined;
  const limit = resolveLimit(args.limit as number | undefined);

  if (!name) {
    throw new ValidationError("`--name` is required");
  }

  const parsedTarget = parseTarget(target);
  if (!parsedTarget.storeName && prefix) {
    throw new ValidationError(
      "`--prefix` requires a specific target like baser.locs or mailboxer.tpcs",
    );
  }

  const domain = yield* DOMAIN_FACTORIES[parsedTarget.domain].open(
    buildOptions({
      name,
      base,
      headDirPath,
      temp,
      compat,
    }),
  );

  try {
    console.log(
      `Dumping ${
        parsedTarget.storeName ? `${parsedTarget.domain}.${parsedTarget.storeName}` : parsedTarget.domain
      } from ${domain.path ?? "(unknown path)"}`,
    );
    console.log(
      `Mode: readonly compat=${compat ? "true" : "false"} temp=${temp ? "true" : "false"}`,
    );
    console.log("");

    if (!parsedTarget.storeName) {
      printStoreSummary(parsedTarget.domain, domain);
      return;
    }

    const store = resolveStore(domain, parsedTarget.domain, parsedTarget.storeName);
    printStoreEntries(
      parsedTarget.domain,
      parsedTarget.storeName,
      store,
      prefix ?? "",
      limit,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DatabaseOperationError(`Error dumping database: ${message}`, {
      name,
      base,
      headDirPath,
      temp,
      compat,
      target: target ?? DEFAULT_TARGET,
      prefix: prefix ?? "",
    });
  } finally {
    yield* domain.close();
  }
}

// Legacy export name kept so existing imports and tests do not break while the
// command evolves past the original `evts`-only implementation.
export const dumpEvts = dumpDatabase;
