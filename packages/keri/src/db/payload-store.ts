import type { OwnedPayload, Payload, PayloadSink } from "cesr-ts";
import { join, resolve } from "jsr:@std/path";

/** A caller-owned file; promotion is separate from publishing a database reference. */
export interface FilePayload extends OwnedPayload {
  /** Temporary stage name, replaced by the caller-supplied identity on promotion. */
  readonly id: string;
  /** Publish under a SAID or scoped digest name without replacing an existing object. */
  promote(id: string): Promise<void>;
}

/** A file sink returns a staged file whose disposal belongs to its consumer. */
export interface FilePayloadSink extends PayloadSink {
  /** Sync and close the stage before handing its file lifetime to the caller. */
  finish(): Promise<FilePayload>;
}

/** Complete partial writes without retaining or queueing additional chunks. */
export async function writePayloadChunk(
  writer: {
    write(bytes: Uint8Array): Promise<number>;
  },
  chunk: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  let offset = 0;
  while (offset < chunk.length) {
    signal?.throwIfAborted();
    const bytesWritten = await writer.write(chunk.subarray(offset));
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
    await Deno.mkdir(join(this.root, "staging"), { recursive: true, mode: 0o700 });
    // The final content/owner identity is unavailable while the stream is incomplete.
    const id = crypto.randomUUID();
    const path = join(this.root, "staging", id);
    const file = await Deno.open(path, { write: true, createNew: true, mode: 0o600 });
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
    checkPayloadId(id);
    const file = await Deno.open(join(this.root, "objects", id), { read: true });
    try {
      const stat = await file.stat();
      if (!stat.isFile || !Number.isSafeInteger(stat.size)) throw new Error("Invalid payload file");
      return new FileValue(this.root, id, stat.size, this.chunkSize, false);
    } finally {
      file.close();
    }
  }

  /** Identify an owned local file without exposing filesystem paths. */
  owns(payload: Payload): payload is FilePayload {
    return payload instanceof FileValue && payload.belongsTo(this.root);
  }

  /** Transfer a local handle to a new owner while keeping existing read views usable. */
  adopt(payload: Payload): FilePayload {
    if (this.closed) throw new Error("Payload store is closed");
    if (!(payload instanceof FileValue) || !payload.belongsTo(this.root)) {
      throw new TypeError("Payload belongs to another store");
    }
    return payload.transfer();
  }

  /** Abort unfinished writes only; completed files have transferred to callers. */
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.sinks].map((sink) => sink.abort()));
  }
}

/** A finished stage or promoted object; each read owns its own file descriptor. */
class FileValue implements FilePayload {
  /** Revokes only mutation rights after another owner adopts this handle. */
  private transferred = false;
  /** Shared identity and location keep borrowed views valid after owner publication. */
  private readonly state: { id: string; staged: boolean; removed: boolean; busy: boolean };

  /** Represent one completed file without taking ownership of any reader descriptor. */
  constructor(
    private readonly root: string,
    id: string,
    readonly size: number,
    private readonly chunkSize: number,
    staged: boolean,
    state?: { id: string; staged: boolean; removed: boolean; busy: boolean },
  ) {
    this.state = state ?? { id, staged, removed: false, busy: false };
  }

  /** Resolve the current final identity through the shared owner state. */
  get id(): string {
    return this.state.id;
  }

  /** Test private store provenance without exposing filesystem paths. */
  belongsTo(root: string): boolean {
    return this.root === root;
  }

  /** Move mutation rights to a new handle sharing the same file lifetime. */
  transfer(): FilePayload {
    this.checkOwner();
    this.transferred = true;
    return new FileValue(this.root, this.id, this.size, this.chunkSize, this.state.staged, this.state);
  }

  /** Resolve the current stage/object location after any completed promotion. */
  private get path(): string {
    return join(this.root, this.state.staged ? "staging" : "objects", this.id);
  }

  /** Reopen from byte zero and release the descriptor on return, failure, or cancellation. */
  async *open(signal?: AbortSignal): AsyncIterable<Uint8Array> {
    this.check();
    signal?.throwIfAborted();
    const file = await Deno.open(this.path, { read: true });
    try {
      let offset = 0;
      while (offset < this.size) {
        signal?.throwIfAborted();
        const bytes = new Uint8Array(Math.min(this.chunkSize, this.size - offset));
        const bytesRead = await file.read(bytes);
        signal?.throwIfAborted();
        if (bytesRead === null || bytesRead === 0) throw new Error("Payload file is shorter than declared size");
        offset += bytesRead;
        yield bytes.subarray(0, bytesRead);
      }
    } finally {
      file.close();
    }
  }

  /** Publish a completed file under its final identity without overwriting another owner. */
  async promote(id: string): Promise<void> {
    this.checkOwner();
    checkPayloadId(id);
    if (!this.state.staged) {
      if (id !== this.id) throw new Error("Payload is already promoted under another ID");
      return;
    }
    this.state.busy = true;
    try {
      await Deno.mkdir(join(this.root, "objects"), { recursive: true, mode: 0o700 });
      const stage = this.path;
      // Linking publishes the complete file atomically and rejects an existing ID.
      await Deno.link(stage, join(this.root, "objects", id));
      this.state.id = id;
      this.state.staged = false;
      await Deno.remove(stage);
    } finally {
      this.state.busy = false;
    }
  }

  /** Remove this owned file once, rejecting concurrent ownership mutations. */
  async discard(): Promise<void> {
    if (this.transferred || this.state.removed) return;
    this.checkOwner();
    this.state.busy = true;
    try {
      await Deno.remove(this.path);
      this.state.removed = true;
    } finally {
      this.state.busy = false;
    }
  }

  /** Reject mutation by a stale transferred handle before inspecting file state. */
  private checkOwner(): void {
    if (this.transferred) throw new Error("Payload ownership was transferred");
    this.check();
  }

  /** Ensure this file remains readable and is not changing ownership. */
  private check(): void {
    if (this.state.removed || this.state.busy) throw new Error("Payload file is removed or changing ownership");
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
  /** Deno descriptors close synchronously and must not be closed twice. */
  private fileClosed = false;
  /** Reused abort completion prevents duplicate close/unlink operations. */
  private cleanup: Promise<void> | null = null;
  /** Begin cleanup on cancellation without throwing from the event listener. */
  private readonly cancel = () => {
    void this.abort().catch(() => undefined);
  };

  /** Own one exclusive stage descriptor and its completion/cleanup callbacks. */
  constructor(
    private readonly file: Deno.FsFile,
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
      this.closeFile();
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
        this.closeFile();
      } finally {
        try {
          await Deno.remove(this.path);
        } finally {
          this.removed();
        }
      }
    })();
    return this.cleanup;
  }

  /** Close exactly once, including cancellation racing a completed fsync. */
  private closeFile(): void {
    if (this.fileClosed) return;
    this.fileClosed = true;
    this.file.close();
  }

  /** Reject cancellation, overlapping operations, and closed stage access. */
  private check(): void {
    this.signal?.throwIfAborted();
    if (this.state !== "open" || this.active) throw new Error("Payload sink is closed or has an active operation");
  }
}

/** Accept a flat SAID/digest name, optionally scoped by dot-separated owner segments. */
function checkPayloadId(id: string): void {
  if (id.length > 240 || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(id)) {
    throw new TypeError("Invalid payload ID");
  }
}
