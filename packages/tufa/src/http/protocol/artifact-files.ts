/** Demand-driven static artifact responses; the host owns open files through joined response cleanup. */
import { ResourceAdmissionError, ResourceLimitError, type ResourcePolicy } from "cesr-ts";
import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";

const CHUNK = 64 * 1024;
const ALLOWANCE = 1024 ** 2 + 2 * CHUNK;

/** One host's file responses share its runtime policy; shutdown also closes unconsumed bodies. */
export class ArtifactFiles {
  private readonly owners = new Set<(reason?: unknown) => Promise<void>>();
  private stopping = false;
  private closing?: Promise<void>;

  constructor(private readonly resources: ResourcePolicy) {}

  /** Admit before opening; capture the extent without reading data. JSON may additionally have a finite ceiling. */
  async response(path: string, contentType: string, signal: AbortSignal, maxBytes?: number): Promise<Response> {
    signal.throwIfAborted();
    if (this.stopping) throw new DOMException("Artifact host closed", "AbortError");
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) {
      throw new RangeError("Artifact ceiling must be a positive safe integer");
    }
    if (path.length > CHUNK) throw new ResourceLimitError("Artifact path exceeds metadata ceiling");
    const admission = this.resources.reserve({ streams: 1, bytes: ALLOWANCE });
    if (admission.kind === "refuse") {
      throw new ResourceAdmissionError("Artifact response admission refused", admission.reason);
    }
    let file: FileHandle | undefined, reading: Promise<{ bytesRead: number }> | undefined;
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let ended = false, closing: Promise<void> | undefined;
    // Nonblocking open lets the regular-file check reject pipes without hanging acquisition/shutdown.
    const opening = Promise.resolve().then(() => open(path, constants.O_RDONLY | constants.O_NONBLOCK));
    /** Stop new reads and join acquisition/current read/close before returning shared credit. */
    const close = (reason?: unknown): Promise<void> => {
      if (closing) return closing;
      ended = true;
      closing = (async () => {
        const failures: unknown[] = [];
        try {
          try {
            if (reason !== undefined) controller?.error(reason);
          } catch (error) {
            failures.push(error);
          }
          const acquired = await opening.catch(() => undefined);
          try {
            await reading;
          } catch (error) {
            failures.push(error);
          }
          try {
            await acquired?.close();
          } catch (error) {
            if (!failures.includes(error)) failures.push(error);
          }
        } finally {
          this.owners.delete(close);
          admission.reservation.release();
        }
        if (failures.length === 1) throw failures[0];
        if (failures.length) throw new AggregateError(failures, "Artifact read and cleanup failed");
      })();
      return closing;
    };
    this.owners.add(close);
    try {
      file = await opening;
      const stat = await file.stat();
      signal.throwIfAborted(); // The request signal owns acquisition, never the returned response lifetime.
      if (ended) throw new DOMException("Artifact host closed", "AbortError");
      if (!stat.isFile()) {
        await close();
        return new Response("Not Found", { status: 404 });
      }
      if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new ResourceLimitError("Invalid artifact extent");
      if (maxBytes !== undefined && stat.size > maxBytes) throw new ResourceLimitError("Artifact exceeds byte ceiling");
      if (stat.size === 0) {
        await close();
        return new Response(null, { headers: { "Content-Type": contentType, "Content-Length": "0" } });
      }
      let remaining = stat.size;
      const body = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
        pull: async (output) => {
          if (ended) return;
          try {
            if (remaining === 0) {
              await close();
              output.close();
              return;
            }
            const chunk = new Uint8Array(Math.min(CHUNK, remaining));
            reading = file!.read(chunk);
            const { bytesRead } = await reading;
            reading = undefined;
            if (ended) return;
            if (bytesRead === 0) throw new Error("Artifact truncated during response");
            remaining -= bytesRead;
            output.enqueue(chunk.subarray(0, bytesRead));
          } catch (error) {
            reading = undefined; // This read has settled; close must still join any concurrently started cleanup.
            let failure = error;
            try {
              await close();
            } catch (cleanup) {
              const failures = cleanup instanceof AggregateError ? cleanup.errors : [cleanup];
              failure = failures.includes(error)
                ? cleanup
                : new AggregateError([error, ...failures], "Artifact read and cleanup failed");
            }
            output.error(failure);
          }
        },
        cancel: () => close(),
      }, { highWaterMark: 0 });
      return new Response(body, {
        headers: { "Content-Type": contentType, "Content-Length": String(stat.size) },
      });
    } catch (error) {
      try {
        await close();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "Artifact acquisition and cleanup failed");
      }
      throw error;
    }
  }

  /** Close every file, including pending acquisitions, before the HTTP host finishes shutdown. */
  close(): Promise<void> {
    this.stopping = true;
    return this.closing ??= (async () => {
      const reason = new DOMException("Artifact host closed", "AbortError");
      const results = await Promise.allSettled([...this.owners].map(async (close) => await close(reason)));
      const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, "Artifact host cleanup failed");
    })();
  }
}
