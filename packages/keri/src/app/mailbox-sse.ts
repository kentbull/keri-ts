import { call, type Operation, resource } from "npm:effection@^3.6.0";
import { abortable } from "./abortable.ts";
import { defaultRuntimeServices, type RuntimeServices } from "./runtime-services.ts";

/** Shared encoder for complete mailbox event payloads. */
const textEncoder = new TextEncoder();

/** One parsed mailbox SSE payload with its ordered topic metadata. */
export interface MailboxSseMessage {
  idx: number;
  msg: Uint8Array;
  topic: string;
}

/** Poll timing and cancellation; complete events are delivered to the awaited consumer. */
export interface MailboxSseOptions {
  /** End an idle poll after its first complete event; default 500 ms. */
  idleTimeoutMs?: number;
  /** Absolute lifetime of one long poll, including its first event; default 30 seconds. */
  maxDurationMs?: number;
  services?: RuntimeServices;
  /** External cancellation remains separate from a successful poll timeout. */
  signal?: AbortSignal;
}

/** Decode one complete SSE block; an unterminated block is never delivered. */
function eventMessage(lines: string[]): MailboxSseMessage | undefined {
  let idx = -1;
  let topic = "";
  const data: string[] = [];
  for (const line of lines) {
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    // SSE removes exactly one optional space, not meaningful payload whitespace.
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "id") idx = /^\d+$/.test(value) ? Number(value) : -1;
    else if (field === "event") topic = value;
    else if (field === "data") data.push(value);
  }
  if (!Number.isSafeInteger(idx) || idx < 0 || !topic || !data.length) return;
  return { idx, topic, msg: textEncoder.encode(data.join("\n")) };
}

/** Geometric byte growth keeps fragmentation from creating one retained metadata entry per chunk. */
function appendBytes(
  bytes: Uint8Array<ArrayBuffer>,
  size: number,
  chunk: Uint8Array,
): Uint8Array<ArrayBuffer> {
  if (size + chunk.length > bytes.length) {
    const grown = new Uint8Array(Math.max(size + chunk.length, 1024, bytes.length * 2));
    grown.set(bytes.subarray(0, size));
    bytes = grown;
  }
  bytes.set(chunk, size);
  return bytes;
}

/**
 * Consume complete mailbox events with backpressure from the awaited consumer.
 * Returning false stops the poll without acknowledging an unread event. Timeout,
 * EOF, and cancellation discard an incomplete final event so its cursor can retry.
 */
export function consumeMailboxSse(
  response: Response,
  controller: AbortController,
  consume: (message: MailboxSseMessage) => Operation<boolean | void>,
  options: MailboxSseOptions = {},
): Operation<void> {
  return call(function*() {
    let lines: string[] = [];
    let lineBytes = new Uint8Array(0);
    let lineSize = 0;
    const decoder = new TextDecoder();
    let completed = false;
    yield* consumeChunks(
      response,
      controller,
      function*(chunk) {
        let start = 0;
        for (let index = 0; index < chunk.length; index++) {
          if (chunk[index] !== 10) continue;
          lineBytes = appendBytes(lineBytes, lineSize, chunk.subarray(start, index));
          lineSize += index - start;
          let line = decoder.decode(lineBytes.subarray(0, lineSize));
          if (line.endsWith("\r")) line = line.slice(0, -1);
          lineSize = 0;
          start = index + 1;
          if (line) {
            lines.push(line);
          } else {
            const message = eventMessage(lines);
            lines = [];
            if (message) {
              completed = true;
              if ((yield* consume(message)) === false) return false;
            }
          }
        }
        if (start < chunk.length) {
          lineBytes = appendBytes(lineBytes, lineSize, chunk.subarray(start));
          lineSize += chunk.length - start;
        }
      },
      options,
      () => completed,
    );
  });
}

/**
 * Collect a raw SSE diagnostic report for one poll window. Production polling
 * uses consumeMailboxSse to deliver complete events as they arrive.
 */
export function readMailboxSseBody(
  response: Response,
  controller: AbortController,
  options: MailboxSseOptions = {},
): Operation<string> {
  return call(function*() {
    const decoder = new TextDecoder();
    let bytes = new Uint8Array(0);
    let size = 0;
    let blockStart = 0;
    let completed = false;
    yield* consumeChunks(
      response,
      controller,
      function*(chunk) {
        bytes = appendBytes(bytes, size, chunk);
        const end = size + chunk.length;
        // Inspect each terminated block once. A retry/comment header alone must not start the idle deadline.
        for (let index = size; !completed && index < end; index++) {
          if (bytes[index] !== 10) continue;
          if (
            bytes[index - 1] === 10
            || (bytes[index - 1] === 13 && bytes[index - 2] === 10 && bytes[index - 3] === 13)
          ) {
            completed = parseMailboxSse(decoder.decode(bytes.subarray(blockStart, index + 1))).length > 0;
            blockStart = index + 1;
          }
        }
        size = end;
      },
      options,
      () => completed,
    );
    return new TextDecoder().decode(bytes.subarray(0, size));
  });
}

/** Parse only terminated events from an already finite diagnostic report. */
export function parseMailboxSse(text: string): MailboxSseMessage[] {
  return text.replaceAll("\r\n", "\n").split("\n\n").slice(0, -1)
    .map((block) => eventMessage(block.split("\n")))
    .filter((message): message is MailboxSseMessage => message !== undefined);
}

/** Own one reader; a timed-out read is canceled and joined before this operation exits. */
function* consumeChunks(
  response: Response,
  controller: AbortController,
  consume: (chunk: Uint8Array) => Operation<boolean | void>,
  options: MailboxSseOptions,
  hasEvent: () => boolean,
): Operation<void> {
  const {
    idleTimeoutMs = 500,
    maxDurationMs = 30_000,
    services = defaultRuntimeServices,
  } = options;
  for (const value of [idleTimeoutMs, maxDurationMs]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Invalid mailbox SSE timeout");
  }
  if (!response.body) return;
  const reader = response.body.getReader();
  let closing: Promise<void> | undefined;
  let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  let reportedFailure: { error: unknown } | undefined;
  let readAbort: { reason: unknown } | undefined;
  /** Repeated cancellation joins the original underlying source cleanup, including asynchronous cancel. */
  const close = (reason?: unknown) => closing ??= reader.cancel(reason);
  // This owner predates the cancellable read leaf, so teardown joins the read before releasing its lock.
  yield* resource<void>(function*(provide) {
    try {
      yield* provide();
    } finally {
      controller.abort();
      yield* call(async () => {
        const failures: unknown[] = [];
        const remember = (error: unknown) => {
          if (
            (reportedFailure && error === reportedFailure.error) || error === controller.signal.reason
            || (readAbort && error === readAbort.reason)
          ) {
            return;
          }
          if (!failures.includes(error)) failures.push(error);
        };
        try {
          // The read leaf joins this Promise too, but cancellation can discard its result.
          try {
            await pendingRead;
          } catch (error) {
            remember(error);
          }
          try {
            await close();
          } catch (error) {
            remember(error);
          }
        } finally {
          try {
            reader.releaseLock();
          } catch (error) {
            remember(error);
          }
        }
        if (failures.length && reportedFailure) failures.unshift(reportedFailure.error);
        if (failures.length === 1) throw failures[0];
        if (failures.length) throw new AggregateError(failures, "Mailbox SSE read and cleanup failed");
      });
    }
  });
  const deadline = services.clock.now() + maxDurationMs;
  try {
    while (services.clock.now() < deadline) {
      const wait = Math.max(1, Math.min(hasEvent() ? idleTimeoutMs : maxDurationMs, deadline - services.clock.now()));
      const next = yield* abortable(async (signal) => {
        // Keep exactly one read alive. A timeout ends the poll, never starts a competing reader.read().
        const pending = pendingRead = reader.read();
        readAbort = undefined;
        let timer: ReturnType<typeof services.clock.setTimeout> | undefined;
        const cancel = () => {
          readAbort = { reason: signal.reason };
          // Observe notification rejection; the earlier owner joins the original Promise.
          void close(signal.reason).catch(() => {});
        };
        signal.addEventListener("abort", cancel, { once: true });
        // abortable checks before entry; also cover synchronous abort inside the source read hook.
        if (signal.aborted) cancel();
        try {
          const result = await Promise.race([
            pending,
            new Promise<undefined>((resolve) => {
              timer = services.clock.setTimeout(() => resolve(undefined), wait);
            }),
          ]);
          if (!result) {
            controller.abort();
            try {
              await close();
            } catch (error) {
              // Native fetch errors its body with this exact timeout reason.
              if (error !== controller.signal.reason) throw error;
            }
          }
          return result;
        } finally {
          if (timer !== undefined) services.clock.clearTimeout(timer);
          signal.removeEventListener("abort", cancel);
          await pending.catch(() => undefined);
        }
      }, options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal);
      if (!next || next.done) return;
      if (next.value.length) {
        if ((yield* consume(next.value)) === false) return;
      }
    }
  } catch (error) {
    reportedFailure = { error };
    throw error;
  }
}
