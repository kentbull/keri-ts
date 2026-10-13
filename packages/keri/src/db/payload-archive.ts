import type { Payload } from "cesr-ts";
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

/** Canonical directories owned by runtimes in this process. */
const activeRoots = new Set<string>();
/** Random UUIDs identify only unfinished staging files. */
const stageId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Final objects use safe dot-separated immutable owner keys, such as essr.SAID. */
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
 * reaches disk before file deletion. Mutations reject concurrent admission.
 */
export class PayloadArchive {
  /** Staging and transfer boundary for this private directory. */
  readonly files: PayloadStore;
  /** Forward immutable application key to object reference. */
  private readonly refs: Komer<PayloadRecord>;
  /** Reverse object ownership, used for bounded orphan recovery. */
  private readonly owners: Komer<OwnerRecord>;
  /** Stops new admission while close waits for an existing mutation. */
  private closed = false;
  /** At most one admitted mutation; no internal wait queue. */
  private active: Promise<unknown> | null = null;
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

  /**
   * Publish immutable bytes and related synchronous state in one LMDB transaction.
   * An unclaimed local file transfers ownership on admission; referenced files
   * are borrowed and copied like external sources. Failed publication leaves any
   * promoted orphan for recovery.
   * Cancellation reaches source reads and staging until the durability transaction
   * begins; an admitted transaction finishes and flushes before returning.
   * Final names map key segments to dots (essr/SAID → essr.SAID); these are
   * immutable owner identities, not independent hashes of the stored bytes.
   * An identical duplicate runs commit against the existing reference, then drops
   * its redundant file; conflicting bytes never replace an existing reference.
   */
  publish(key: string, payload: Payload, commit: () => void = () => {}, signal?: AbortSignal): Promise<Payload> {
    this.checkKey(key);
    return this.mutate(async () => {
      signal?.throwIfAborted();
      const existing = await this.lookup(key);
      if (existing) {
        if (!await samePayload(existing, payload, signal)) {
          throw new Error("Payload reference already contains different bytes");
        }
        signal?.throwIfAborted();
        this.environment().transactionSync(commit);
        await this.environment().flushed;
        if (this.files.owns(payload) && !this.owners.get([payload.id])) {
          await this.files.adopt(payload).discard();
        }
        return existing;
      }

      const owned = await this.own(payload, signal);
      try {
        signal?.throwIfAborted();
        const id = key.replaceAll("/", ".");
        if (owned.id !== id) await this.removeOrphan(id);
        signal?.throwIfAborted();
        await owned.promote(id);
      } catch (error) {
        await owned.discard();
        throw error;
      }
      // Reopen from this archive to verify identity/size before publishing any reference.
      const reopened = await this.files.open(owned.id);
      if (reopened.size !== owned.size) throw new Error("Payload file size changed before publication");
      await syncDirectory(join(this.root, "objects"));
      await syncDirectory(join(this.root, "staging"));
      await syncDirectory(this.root);
      const env = this.environment();
      signal?.throwIfAborted();
      env.transactionSync(() => {
        if (this.refs.get([key]) || this.owners.get([owned.id])) {
          throw new Error("Payload publication conflicts with existing ownership");
        }
        this.refs.put([key], { id: owned.id, size: owned.size });
        this.owners.put([owned.id], { key });
        commit();
      });
      await env.flushed;
      return this.view(owned);
    });
  }

  /** Reopen durable bytes without permission to delete their file. */
  async get(key: string, signal?: AbortSignal): Promise<Payload | null> {
    this.check();
    this.checkKey(key);
    signal?.throwIfAborted();
    const result = await this.lookup(key);
    signal?.throwIfAborted();
    return result;
  }

  /** Unpublish durably before reclaiming the file; interrupted deletion is recoverable. */
  remove(key: string, commit: () => void = () => {}, signal?: AbortSignal): Promise<void> {
    this.checkKey(key);
    return this.mutate(async () => {
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
      await this.active?.catch(() => undefined);
      await this.files.close();
      activeRoots.delete(this.root);
    })();
    return this.closing;
  }

  /** Adopt an unclaimed local file; copy borrowed archive files and external sources. */
  private async own(payload: Payload, signal?: AbortSignal): Promise<FilePayload> {
    signal?.throwIfAborted();
    if (this.files.owns(payload) && !this.owners.get([payload.id])) return this.files.adopt(payload);
    const sink = await this.files.stage(payload.size, signal);
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

  /** Allow retry after a rolled-back publication without touching any referenced object. */
  private async removeOrphan(id: string): Promise<void> {
    if (this.owners.get([id])) throw new Error("Payload publication conflicts with existing ownership");
    const path = join(this.root, "objects", id);
    try {
      if (!(await Deno.lstat(path)).isFile) throw new Error("Unexpected entry in private payload archive");
      await Deno.remove(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }

  /** Resolve both ownership directions and verify the stored file length. */
  private async lookup(key: string): Promise<Payload | null> {
    this.environment();
    const record = this.refs.get([key]);
    if (!record) return null;
    const payload = await this.files.open(record.id);
    if (
      record.id !== key.replaceAll("/", ".") || payload.size !== record.size
      || this.owners.get([record.id])?.key !== key
    ) {
      throw new Error("Payload archive reference is inconsistent");
    }
    return this.view(payload);
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
      await this.lookup(keys[0]);
    }
    for (const [keys, owner] of this.owners.getTopItemIter()) {
      signal?.throwIfAborted();
      if (this.refs.get([owner.key])?.id !== keys.join(".")) throw new Error("Payload owner has no matching reference");
    }
  }

  /** Reject overlapping mutations and release admission state on either outcome. */
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    this.check();
    if (this.active) return Promise.reject(new Error("Payload archive has an active mutation"));
    // Reserve admission before any synchronous transaction callback can reenter.
    const active = Promise.resolve().then(operation);
    this.active = active;
    return active.finally(() => {
      this.active = null;
    });
  }

  /** Hide mutable file ownership behind the public read-only payload contract. */
  private view(payload: FilePayload): Payload {
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

  /** Keep the key-to-filename mapping injective and within filesystem/LMDB limits. */
  private checkKey(key: string): void {
    if (key.length > 240 || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(key)) {
      throw new TypeError("Invalid payload reference key");
    }
  }
}
