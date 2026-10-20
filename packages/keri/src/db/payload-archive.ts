import type { OwnedPayload, Payload } from "cesr-ts";
import { dirname, join, resolve } from "jsr:@std/path";
import { RawRecord } from "../core/records.ts";
import type { LMDBer } from "./core/lmdber.ts";
import { Komer } from "./koming.ts";
import { type FilePayload, PayloadStore } from "./payload-store.ts";

/** Identity and exact size of one promoted object. */
interface PayloadRecordShape {
  /** Scoped immutable owner basename, never an arbitrary path. */
  id: string;
  /** Exact byte length rechecked whenever the reference reopens. */
  size: number;
}

/** Private reference metadata; KERIpy wire tables keep their original contents. */
class PayloadRecord extends RawRecord<PayloadRecordShape> implements PayloadRecordShape {
  /** Persistent object identity. */
  declare id: string;
  /** Persistent exact byte length. */
  declare size: number;
}

/** Reverse ownership lookup bounds orphan recovery memory independently of archive size. */
class OwnerRecord extends RawRecord<{ key: string }> {
  /** Immutable application key owning this object. */
  declare key: string;
}

/** One flushed caller-owned candidate, with no reference-table or mutation internals in its public contract. */
export interface PreparedPayload extends OwnedPayload {
  /** Independent physical file identity for synchronous reference publication. */
  readonly id: string;
}

/** Private physical owner; disposal never removes a committed reference's file. */
class PreparedFile implements PreparedPayload {
  /** Idempotent cleanup also closes this handle to further publication. */
  private cleanup?: Promise<void>;
  /** A physical candidate belongs to at most one publication attempt, including a rolled-back attempt. */
  private submitted = false;

  /** Bind the actual file and reference owner; callers obtain candidates through the archive. */
  constructor(private readonly file: FilePayload, private readonly owners: Komer<OwnerRecord>) {}

  /** Independently prepared physical identity, unrelated to the application key. */
  get id(): string {
    return this.file.id;
  }
  /** Exact flushed byte length. */
  get size(): number {
    return this.file.size;
  }

  /** Reopen immutable bytes; borrowed readers retain their ordinary descriptor lifetime. */
  open(signal?: AbortSignal): AsyncIterable<Uint8Array> {
    return this.file.open(signal);
  }

  /** Require this live physical candidate to belong to the publishing reference table. */
  claim(owners: Komer<OwnerRecord>): void {
    if (this.owners !== owners || this.cleanup || this.submitted) {
      throw new Error("Payload candidate is submitted, disposed or belongs to another archive");
    }
    this.submitted = true;
  }

  /** Reclaim an unselected candidate; accepted ownership is decided by committed storage. */
  discard(): Promise<void> {
    return this.cleanup ??= (async () => {
      if (!this.owners.get([this.id])) await this.file.discard();
    })();
  }
}

/** Canonical directories owned by runtimes in this process. */
const activeRoots = new Set<string>();
/** Independently prepared files retain their UUID through promotion. */
const stageId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Private object IDs are safe basenames; application keys live only in the reference tables. */
const objectId = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

/** Flush directory entries before a durable database reference can name them. */
async function syncDirectory(path: string): Promise<void> {
  const directory = await Deno.open(path, { read: true });
  try {
    await directory.sync();
  } finally {
    directory.close();
  }
}

/** Create missing ancestors in order and flush each new parent entry before proceeding. */
async function makeRoot(path: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  try {
    await Deno.mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) return;
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    await makeRoot(dirname(path), signal);
    await Deno.mkdir(path, { mode: 0o700 });
  }
  await syncDirectory(dirname(path));
  signal?.throwIfAborted();
}

/** Compare differently chunked sources without collecting either payload. */
async function samePayload(left: Payload, right: Payload, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  if (left.size !== right.size) return false;
  const source = right.open(signal)[Symbol.asyncIterator]();
  let other: Uint8Array = new Uint8Array();
  let offset = 0;
  let size = 0;
  try {
    for await (const chunk of left.open(signal)) {
      for (const byte of chunk) {
        while (offset === other.length) {
          const next = await source.next();
          if (next.done) return false;
          other = next.value;
          offset = 0;
        }
        if (byte !== other[offset++]) return false;
        size++;
      }
    }
    if (size !== left.size || offset !== other.length) return false;
    for (;;) {
      const next = await source.next();
      if (next.done) return true;
      if (next.value.length) return false;
    }
  } finally {
    await source.return?.();
  }
}

/**
 * Immutable payload references in private LMDB tables, separate from wire evidence.
 *
 * The host must exclusively own this directory across processes. An in-process
 * guard rejects duplicate runtime owners; this is not a cross-process file lock.
 * Open finishes incremental recovery before admitting work. A file and its
 * directory entries reach disk before reference publication; reference deletion
 * reaches disk before file deletion. Preparations own independent immutable files;
 * synchronous transactions select references after any asynchronous comparison.
 */
export class PayloadArchive {
  /** Staging and transfer boundary for this private directory. */
  readonly files: PayloadStore;
  /** Forward immutable application key to object reference. */
  private readonly refs: Komer<PayloadRecord>;
  /** Reverse object ownership, used for bounded orphan recovery. */
  private readonly owners: Komer<OwnerRecord>;
  /** Stops new admission while close joins existing file operations. */
  private closed = false;
  /** Admitted I/O to join on close; this set imposes no execution ordering. */
  private readonly active = new Set<Promise<unknown>>();
  /** Shared idempotent shutdown result. */
  private closing: Promise<void> | null = null;

  /** Bind the private stores after the canonical directory has been reserved. */
  private constructor(private readonly db: LMDBer, private readonly root: string) {
    this.files = new PayloadStore(root);
    this.refs = new Komer(db, { subkey: "payload.refs.", recordClass: PayloadRecord });
    this.owners = new Komer(db, { subkey: "payload.owners.", recordClass: OwnerRecord });
  }

  /** Recover under exclusive startup ownership before returning a usable archive. */
  static async open(db: LMDBer, root: string, signal?: AbortSignal): Promise<PayloadArchive> {
    if (!db.env || db.readonly) throw new Error("Payload archive requires an open writable database");
    const path = resolve(root);
    await makeRoot(path, signal);
    const canonical = await Deno.realPath(path);
    signal?.throwIfAborted();
    if (activeRoots.has(canonical)) throw new Error("Payload archive already has an owner");
    activeRoots.add(canonical);
    let archive: PayloadArchive | undefined;
    try {
      archive = new PayloadArchive(db, canonical);
      for (const name of ["staging", "objects"]) {
        const directory = join(canonical, name);
        await Deno.mkdir(directory, { mode: 0o700, recursive: true });
        if (!(await Deno.lstat(directory)).isDirectory) {
          throw new Error("Payload archive directory must not be a symlink");
        }
      }
      await syncDirectory(canonical);
      await archive.recover(signal);
      signal?.throwIfAborted();
      return archive;
    } catch (error) {
      await archive?.files.close();
      activeRoots.delete(canonical);
      throw error;
    }
  }

  /** Prepare and flush one caller-owned file without deciding any protocol or reference state. */
  prepare(payload: Payload, signal?: AbortSignal): Promise<PreparedPayload> {
    return this.track(() => this.prepareCandidate(payload, signal));
  }

  /** Read the current immutable file identity for an admission's evidence snapshot. */
  referenceId(key: string): string | null {
    this.check();
    this.checkKey(key);
    return this.refs.get([key])?.id ?? null;
  }

  /** Publish a prepared file inside its domain owner's writer after current-state validation. */
  pin(key: string, candidate: PreparedPayload): Payload {
    this.check();
    this.checkKey(key);
    return this.pinPrepared(key, candidate);
  }

  /** Finish an already admitted publication even after close has stopped new work. */
  private pinPrepared(key: string, candidate: PreparedPayload): Payload {
    if (!this.db.inWriteTransaction) throw new Error("Prepared payload publication requires the owning writer");
    if (!(candidate instanceof PreparedFile)) throw new TypeError("Payload candidate was not prepared by an archive");
    if (this.refs.get([key]) || this.owners.get([candidate.id])) {
      throw new Error("Payload reference already has an owner");
    }
    candidate.claim(this.owners);
    this.refs.put([key], { id: candidate.id, size: candidate.size });
    this.owners.put([candidate.id], { key });
    return this.view(candidate);
  }

  /**
   * Prepare an independent immutable file, then select its reference in one writer.
   * Unclaimed local stages transfer ownership; borrowed/promoted files are copied.
   * Identical duplicates commit against the retained file, and conflicting bytes
   * never replace it. Every loser owns only its own candidate cleanup.
   * Cancellation stops preparation/comparison before the transaction; an admitted
   * commit finishes and flushes before returning. No transaction spans file I/O.
   */
  publish(key: string, payload: Payload, commit: () => void = () => {}, signal?: AbortSignal): Promise<Payload> {
    this.checkKey(key);
    return this.track(async () => {
      signal?.throwIfAborted();
      const owned = await this.prepareCandidate(payload, signal);
      let selected: Payload;
      try {
        for (;;) {
          signal?.throwIfAborted();
          const existing = await this.reference(key);
          if (existing) {
            let equal: boolean;
            try {
              equal = await samePayload(existing.payload, owned, signal);
            } catch (error) {
              // Removal may unlink a snapshot before its reader opens. Re-read current truth.
              if (error instanceof Deno.errors.NotFound && !this.isCurrent(key, existing.record)) continue;
              throw error;
            }
            signal?.throwIfAborted();
            if (!this.isCurrent(key, existing.record)) continue;
            if (!equal) throw new Error("Payload reference already contains different bytes");
            // No suspension between the current-reference check and this synchronous writer.
            this.environment().transactionSync(commit);
            await this.environment().flushed;
            selected = existing.payload;
            break;
          }
          signal?.throwIfAborted();
          const env = this.environment();
          // reference() suspended even for absence: select against current state in this turn.
          if (this.refs.get([key])) continue;
          env.transactionSync(() => {
            this.pinPrepared(key, owned);
            commit();
          });
          await env.flushed;
          selected = this.view(owned);
          break;
        }
      } catch (error) {
        try {
          await owned.discard();
        } catch (cleanup) {
          throw new AggregateError([error, cleanup], "Payload publication and candidate cleanup failed");
        }
        throw error;
      }
      await owned.discard();
      return selected;
    });
  }

  /** Reopen durable bytes without permission to delete their file. */
  async get(key: string, signal?: AbortSignal): Promise<Payload | null> {
    this.check();
    this.checkKey(key);
    signal?.throwIfAborted();
    const result = (await this.reference(key))?.payload ?? null;
    signal?.throwIfAborted();
    return result;
  }

  /** Unpublish durably before reclaiming the file; interrupted deletion is recoverable. */
  remove(key: string, commit: () => void = () => {}, signal?: AbortSignal): Promise<void> {
    this.checkKey(key);
    return this.track(async () => {
      signal?.throwIfAborted();
      const env = this.environment();
      const record = env.transactionSync(() => {
        const value = this.refs.get([key]);
        this.refs.rem([key]);
        if (value) this.owners.rem([value.id]);
        commit();
        return value;
      });
      await env.flushed;
      if (record) await (await this.files.open(record.id)).discard();
    });
  }

  /** Finish admitted publication before releasing the runtime owner. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      await Promise.allSettled(this.active);
      await this.files.close();
      activeRoots.delete(this.root);
    })();
    return this.closing;
  }

  /** Claim an unpromoted local stage; copy every other source into an independent file. */
  private async own(payload: Payload, signal?: AbortSignal): Promise<FilePayload> {
    signal?.throwIfAborted();
    const stage = this.files.claimStage(payload);
    if (stage) return stage;
    const sink = await this.files.stage(signal);
    try {
      let size = 0;
      for await (const chunk of payload.open(signal)) {
        await sink.write(chunk);
        size += chunk.length;
      }
      if (size !== payload.size) throw new Error("Payload size changed during publication");
      return await sink.finish();
    } finally {
      await sink.abort();
    }
  }

  /** Keep physical preparation cleanup independent from the later domain transaction. */
  private async prepareCandidate(payload: Payload, signal?: AbortSignal): Promise<PreparedPayload> {
    signal?.throwIfAborted();
    const owned = await this.own(payload, signal);
    try {
      await this.flushCandidate(owned, signal);
      return new PreparedFile(owned, this.owners);
    } catch (error) {
      try {
        await owned.discard();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "Payload preparation and file cleanup failed");
      }
      throw error;
    }
  }

  /** Flush one independently owned candidate before any database reference can name it. */
  private async flushCandidate(owned: FilePayload, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await owned.promote(owned.id);
    const reopened = await this.files.open(owned.id);
    if (reopened.size !== owned.size) throw new Error("Payload file size changed before publication");
    await syncDirectory(join(this.root, "objects"));
    await syncDirectory(join(this.root, "staging"));
    await syncDirectory(this.root);
    signal?.throwIfAborted();
  }

  /** Check a copied reference after a suspension without treating a replacement as corruption. */
  private isCurrent(key: string, record: PayloadRecordShape): boolean {
    const current = this.refs.get([key]);
    return current?.id === record.id && current.size === record.size;
  }

  /** Resolve both ownership directions and verify a current file's actual length. */
  private async reference(key: string): Promise<{ record: PayloadRecordShape; payload: Payload } | null> {
    for (;;) {
      this.environment();
      const record = this.refs.get([key]);
      if (!record) return null;
      let payload: FilePayload;
      try {
        payload = await this.files.open(record.id);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound && !this.isCurrent(key, record)) continue;
        throw error;
      }
      if (!this.isCurrent(key, record)) continue;
      if (payload.size !== record.size || this.owners.get([record.id])?.key !== key) {
        throw new Error("Payload archive reference is inconsistent");
      }
      return { record, payload: this.view(payload) };
    }
  }

  /** Sweep unreferenced files and validate every surviving reference before admission. */
  private async recover(signal?: AbortSignal): Promise<void> {
    // Iterate directory entries and rows individually; no aggregate list of payload IDs.
    for (const name of ["staging", "objects"]) {
      signal?.throwIfAborted();
      for await (const entry of Deno.readDir(join(this.root, name))) {
        signal?.throwIfAborted();
        const valid = name === "staging"
          ? stageId.test(entry.name)
          : entry.name.length <= 240 && objectId.test(entry.name);
        if (!entry.isFile || !valid) {
          throw new Error("Unexpected entry in private payload archive");
        }
        const owner = name === "objects" ? this.owners.get([entry.name]) : null;
        if (!owner) await Deno.remove(join(this.root, name, entry.name));
        else if (this.refs.get([owner.key])?.id !== entry.name) {
          throw new Error("Payload owner has no matching reference");
        }
      }
      await syncDirectory(join(this.root, name));
    }
    for (const [keys] of this.refs.getTopItemIter()) {
      signal?.throwIfAborted();
      await this.reference(keys[0]);
    }
    for (const [keys, owner] of this.owners.getTopItemIter()) {
      signal?.throwIfAborted();
      if (this.refs.get([owner.key])?.id !== keys.join(".")) throw new Error("Payload owner has no matching reference");
    }
  }

  /** Track actual admitted I/O for joined shutdown without excluding independent work. */
  private track<T>(operation: () => Promise<T>): Promise<T> {
    this.check();
    if (this.db.inWriteTransaction) throw new Error("Payload archive must own the transaction");
    const active = Promise.resolve().then(operation);
    this.active.add(active);
    return active.finally(() => {
      this.active.delete(active);
    });
  }

  /** Hide mutable file ownership behind the public read-only payload contract. */
  private view(payload: Payload): Payload {
    return { size: payload.size, open: (signal) => payload.open(signal) };
  }

  /** Require a live archive and database before accepting a public operation. */
  private check(): void {
    if (this.closed) throw new Error("Payload archive is closed");
    this.environment();
  }

  /** Require the backing LMDB environment to remain open. */
  private environment() {
    if (!this.db.env) throw new Error("Payload archive database is closed");
    return this.db.env;
  }

  /** Keep application keys unambiguous and within the existing LMDB key range. */
  private checkKey(key: string): void {
    if (key.length > 240 || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(key)) {
      throw new TypeError("Invalid payload reference key");
    }
  }
}
