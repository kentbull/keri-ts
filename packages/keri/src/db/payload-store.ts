import type { OwnedPayload, PayloadSink } from "cesr-ts";
import { type FileHandle, mkdir, open, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

/** A caller-owned file; promotion is separate from publishing a database reference. */
export interface FilePayload extends OwnedPayload {
  /** Opaque store-local identity, validated before reopening a file. */
  readonly id: string;
  /** Move staged bytes to object storage without publishing a database reference. */
  promote(): Promise<void>;
}

/** A file sink returns a staged file whose disposal belongs to its consumer. */
export interface FilePayloadSink extends PayloadSink {
  /** Sync and close the stage before handing its file lifetime to the caller. */
  finish(): Promise<FilePayload>;
}

/** Complete partial writes without retaining or queueing additional chunks. */
export async function writePayloadChunk(
  writer: {
    write(bytes: Uint8Array, offset: number, length: number, position: null): Promise<{ bytesWritten: number }>;
  },
  chunk: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  let offset = 0;
  while (offset < chunk.length) {
    signal?.throwIfAborted();
    const { bytesWritten } = await writer.write(chunk, offset, chunk.length - offset, null);
    if (bytesWritten <= 0 || bytesWritten > chunk.length - offset) throw new Error("Invalid payload write progress");
    offset += bytesWritten;
  }
  signal?.throwIfAborted();
}

/** Private staged files and explicitly promoted objects, with no database policy. */
export class PayloadStore {
  /** Canonical store root used for all private staging and object paths. */
  private readonly root: string;
  /** Only unfinished stages remain store-owned and are aborted on close. */
  private readonly sinks = new Set<FileSink>();
  /** Prevent new stages or opens after shutdown begins. */
  private closed = false;

  /** Bind a store directory and bounded reader allocation size. */
  constructor(root: string, private readonly chunkSize = 65536) {
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) throw new RangeError("Invalid payload read chunk size");
    this.root = resolve(root);
  }

  /** Open one bounded, exclusively created stage. Await every write. */
  async stage(maxBytes: number, signal?: AbortSignal): Promise<FilePayloadSink> {
    if (this.closed) throw new Error("Payload store is closed");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("Invalid payload limit");
    signal?.throwIfAborted();
    await mkdir(join(this.root, "staging"), { recursive: true, mode: 0o700 });
    const id = crypto.randomUUID();
    const path = join(this.root, "staging", id);
    const file = await open(path, "wx", 0o600);
    const sink = new FileSink(file, path, maxBytes, signal, (size) => {
      this.sinks.delete(sink);
      return new FileValue(this.root, id, size, this.chunkSize, true);
    }, () => {
      this.sinks.delete(sink);
    });
    this.sinks.add(sink);
    if (this.closed || signal?.aborted) {
      await sink.abort();
      signal?.throwIfAborted();
      throw new Error("Payload store is closed");
    }
    return sink;
  }

  /** Reopen one promoted file; untrusted IDs cannot address arbitrary paths. */
  async open(id: string): Promise<FilePayload> {
    if (this.closed) throw new Error("Payload store is closed");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      throw new TypeError("Invalid payload ID");
    }
    const file = await open(join(this.root, "objects", id), "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile() || !Number.isSafeInteger(stat.size)) throw new Error("Invalid payload file");
      return new FileValue(this.root, id, stat.size, this.chunkSize, false);
    } finally {
      await file.close();
    }
  }

  /** Abort unfinished writes only; completed files have transferred to callers. */
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.sinks].map((sink) => sink.abort()));
  }
}

/** A finished stage or promoted object; each read owns its own file descriptor. */
class FileValue implements FilePayload {
  /** Discard is terminal and idempotent for this owner. */
  private removed = false;
  /** Reject overlapping promotion/discard instead of queueing ownership changes. */
  private busy = false;

  /** Represent one completed file without taking ownership of any reader descriptor. */
  constructor(
    private readonly root: string,
    readonly id: string,
    readonly size: number,
    private readonly chunkSize: number,
    private staged: boolean,
  ) {}

  /** Resolve the current stage/object location from immutable identity. */
  private get path(): string {
    return join(this.root, this.staged ? "staging" : "objects", this.id);
  }

  /** Reopen from byte zero and release the descriptor on return, failure, or cancellation. */
  async *open(signal?: AbortSignal): AsyncIterable<Uint8Array> {
    this.check();
    signal?.throwIfAborted();
    const file = await open(this.path, "r");
    try {
      let offset = 0;
      while (offset < this.size) {
        signal?.throwIfAborted();
        const bytes = new Uint8Array(Math.min(this.chunkSize, this.size - offset));
        const { bytesRead } = await file.read(bytes, 0, bytes.length, offset);
        signal?.throwIfAborted();
        if (bytesRead === 0) throw new Error("Payload file is shorter than declared size");
        offset += bytesRead;
        yield bytes.subarray(0, bytesRead);
      }
    } finally {
      await file.close();
    }
  }

  /** Atomically move a completed stage into object storage. */
  async promote(): Promise<void> {
    this.check();
    if (!this.staged) return;
    this.busy = true;
    try {
      await mkdir(join(this.root, "objects"), { recursive: true, mode: 0o700 });
      await rename(this.path, join(this.root, "objects", this.id));
      this.staged = false;
    } finally {
      this.busy = false;
    }
  }

  /** Remove this owned file once, rejecting concurrent ownership mutations. */
  async discard(): Promise<void> {
    if (this.removed) return;
    this.check();
    this.busy = true;
    try {
      await unlink(this.path);
      this.removed = true;
    } finally {
      this.busy = false;
    }
  }

  /** Ensure this file remains readable and is not changing ownership. */
  private check(): void {
    if (this.removed || this.busy) throw new Error("Payload file is removed or changing ownership");
  }
}

/** One writer with no internal queue; abort waits for its active write to settle. */
class FileSink implements FilePayloadSink {
  /** Successfully written bytes, excluding a currently pending write. */
  private size = 0;
  /** Stage ownership moves exactly once to finished or aborted. */
  private state: "open" | "finished" | "aborted" = "open";
  /** Single in-flight file operation; no unbounded internal write queue. */
  private active: Promise<unknown> | null = null;
  /** Reused abort completion prevents duplicate close/unlink operations. */
  private cleanup: Promise<void> | null = null;
  /** Begin cleanup on cancellation without throwing from the event listener. */
  private readonly cancel = () => {
    void this.abort().catch(() => undefined);
  };

  /** Own one exclusive stage descriptor and its completion/cleanup callbacks. */
  constructor(
    private readonly file: FileHandle,
    private readonly path: string,
    private readonly maxBytes: number,
    private readonly signal: AbortSignal | undefined,
    private readonly completed: (size: number) => FilePayload,
    private readonly removed: () => void,
  ) {
    signal?.addEventListener("abort", this.cancel, { once: true });
  }

  /** Await every partial write before accepting another chunk or finalizing. */
  async write(chunk: Uint8Array): Promise<void> {
    this.check();
    if (chunk.length > this.maxBytes - this.size) throw new RangeError("Payload exceeds sink limit");
    const writing = writePayloadChunk(this.file, chunk, this.signal);
    this.active = writing;
    try {
      await writing;
      if (this.state !== "open") throw new Error("Payload sink is aborted");
      this.size += chunk.length;
    } catch (error) {
      this.active = null;
      await this.abort();
      throw error;
    } finally {
      this.active = null;
    }
  }

  /** Sync and close bytes, then transfer the completed file to its new owner. */
  async finish(): Promise<FilePayload> {
    this.check();
    const finishing = (async () => {
      await this.file.sync();
      await this.file.close();
    })();
    this.active = finishing;
    try {
      await finishing;
      this.signal?.throwIfAborted();
      if (this.state !== "open") throw new Error("Payload sink is aborted");
      this.state = "finished";
      this.signal?.removeEventListener("abort", this.cancel);
      return this.completed(this.size);
    } catch (error) {
      this.active = null;
      await this.abort();
      throw error;
    } finally {
      this.active = null;
    }
  }

  /** Wait for active I/O before removing an unfinished stage exactly once. */
  abort(): Promise<void> {
    if (this.state === "finished") return Promise.resolve();
    if (this.cleanup) return this.cleanup;
    this.state = "aborted";
    this.signal?.removeEventListener("abort", this.cancel);
    const active = this.active;
    this.cleanup = (async () => {
      try {
        await active?.catch(() => undefined);
        await this.file.close();
      } finally {
        try {
          await unlink(this.path);
        } finally {
          this.removed();
        }
      }
    })();
    return this.cleanup;
  }

  /** Reject cancellation, overlapping operations, and closed stage access. */
  private check(): void {
    this.signal?.throwIfAborted();
    if (this.state !== "open" || this.active) throw new Error("Payload sink is closed or has an active operation");
  }
}
