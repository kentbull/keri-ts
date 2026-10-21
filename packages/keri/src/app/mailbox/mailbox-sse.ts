import { call, type Operation, resource } from "npm:effection@^3.6.0";
import { abortable, cleanupFailures } from "../runtime/abortable.ts";
import { type RuntimeClock } from "../runtime/runtime-clock.ts";
import type { HttpStreamResponse } from "../transport/http-client.ts";

/** Shared encoder for complete mailbox event payloads. */
const textEncoder = new TextEncoder();

/** One parsed mailbox SSE payload with its ordered topic metadata. */
export interface MailboxSseMessage {
  /**
   * Nonnegative insertion ordinal supplied by the provider SSE id.
   */
  idx: number;
  /**
   * UTF-8 bytes from the complete joined SSE data fields.
   */
  msg: Uint8Array;
  /**
   * Provider event/topic name associated with the ordinal.
   */
  topic: string;
}

/** Poll timing and cancellation; complete events are delivered to the awaited consumer. */
export interface MailboxSseOptions {
  /** End an idle poll after its first complete event; default 500 ms. */
  idleTimeoutMs?: number;
  /** Absolute lifetime of one long poll, including its first event; default 30 seconds. */
  maxDurationMs?: number;
  /** External cancellation remains separate from a successful poll timeout. */
  signal?: AbortSignal;
}

/**
 * Decode one complete SSE block; an unterminated block is never delivered.
 *
 * @param lines Lines of one blank-line-terminated SSE block, without line endings.
 * @returns Decoded ordinal/topic/message, or undefined for incomplete/invalid metadata.
 */
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

/**
 * Geometric byte growth keeps fragmentation from creating one retained metadata entry per chunk.
 *
 * @param bytes Current owned backing buffer.
 * @param size Number of populated bytes already retained.
 * @param chunk Next fragment to append.
 * @returns Original or grown buffer containing the appended bytes.
 */
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
 * The consumer is immediately awaited in this read owner, not scheduled or queued.
 * Keeping consumer failure inside this scope lets cleanup retain both failures;
 * a borrowed pull iterator alone cannot observe a later consumer exception.
 *
 * @param response Borrowed streaming HTTP response; caller keeps its scope open through this operation.
 * @param controller Body cancellation owner aborted when the poll window ends.
 * @param consume Awaited complete-event consumer; false stops the poll and errors propagate before remote cursor advancement.
 * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
 * @param options Positive idle/absolute windows in milliseconds and optional upstream signal; defaults 500 and 30000.
 * @throws External cancellation and genuine read/consumer/cleanup errors remain visible; owned window expiry ends the poll.
 */
export function consumeMailboxSse(
  response: HttpStreamResponse,
  controller: AbortController,
  consume: (message: MailboxSseMessage) => Operation<boolean | void>,
  clock: RuntimeClock,
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
      function* consumeCompleteEvents(chunk) {
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
      clock,
      options,
      () => completed,
    );
  });
}

/**
 * Collect a raw SSE diagnostic report for one poll window. Production polling
 * uses consumeMailboxSse to deliver complete events as they arrive.
 *
 * @param response Borrowed streaming HTTP response; caller keeps its scope open through this operation.
 * @param controller Body cancellation owner aborted when the poll window ends.
 * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
 * @param options Positive idle/absolute windows in milliseconds and optional upstream signal; defaults 500 and 30000.
 * @returns Collected text from this bounded diagnostic window.
 * @throws External cancellation and genuine read/consumer/cleanup errors remain visible; owned window expiry ends the poll.
 */
export function readMailboxSseBody(
  response: HttpStreamResponse,
  controller: AbortController,
  clock: RuntimeClock,
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
      function* collectDiagnosticChunk(chunk) {
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
      clock,
      options,
      () => completed,
    );
    return new TextDecoder().decode(bytes.subarray(0, size));
  });
}

/**
 * Parse only terminated events from an already finite diagnostic report.
 *
 * @param text Finite diagnostic response text; an unterminated final block is ignored.
 * @returns Complete valid mailbox events in received order.
 */
export function parseMailboxSse(text: string): MailboxSseMessage[] {
  return text.replaceAll("\r\n", "\n").split("\n\n").slice(0, -1)
    .map((block) => eventMessage(block.split("\n")))
    .filter((message): message is MailboxSseMessage => message !== undefined);
}

/**
 * Apply SSE deadlines to the owned byte source; the HTTP client retains native reader mechanics.
 *
 * @param response Borrowed streaming HTTP response; caller keeps its scope open through this operation.
 * @param controller Body cancellation owner aborted when the poll window ends.
 * @param consume Awaited byte-chunk consumer; false ends this window.
 * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
 * @param options Positive idle/absolute windows in milliseconds and optional upstream signal; defaults 500 and 30000.
 * @param hasEvent Reports whether a complete event has arrived, enabling the shorter idle deadline.
 * @throws External cancellation and genuine read/consumer/cleanup errors remain visible; owned window expiry ends the poll.
 */
function* consumeChunks(
  response: HttpStreamResponse,
  controller: AbortController,
  consume: (chunk: Uint8Array) => Operation<boolean | void>,
  clock: RuntimeClock,
  options: MailboxSseOptions,
  hasEvent: () => boolean,
): Operation<void> {
  const { idleTimeoutMs = 500, maxDurationMs = 30_000 } = options;
  for (const value of [idleTimeoutMs, maxDurationMs]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Invalid mailbox SSE timeout");
  }
  const iterator = response.body(controller.signal)[Symbol.asyncIterator]();
  let pending: Promise<IteratorResult<Uint8Array>> | undefined;
  let reported: { error: unknown } | undefined;
  // Deadline cancellation wakes a blocked source read before teardown joins its iterator.
  yield* resource<void>(function*(provide) {
    try {
      yield* provide();
    } finally {
      controller.abort();
      const errors: unknown[] = [];
      yield* call(async () => {
        /**
         * Preserve cleanup failures other than the owned abort and already reported read failure.
         * @param error Rejection from the pending read or iterator return.
         */
        const remember = (error: unknown) => {
          for (const remaining of cleanupFailures(error, controller.signal)) {
            if (!(reported && remaining === reported.error) && !errors.includes(remaining)) errors.push(remaining);
          }
        };
        try {
          await pending;
        } catch (error) {
          remember(error);
        }
        try {
          await iterator.return?.();
        } catch (error) {
          remember(error);
        }
      });
      if (errors.length && reported) errors.unshift(reported.error);
      // deno-lint-ignore no-unsafe-finally -- Keep actual source cleanup failure visible during cancellation.
      if (errors.length === 1) throw errors[0];
      // deno-lint-ignore no-unsafe-finally -- Preserve the source failure alongside distinct cleanup failures.
      if (errors.length) throw new AggregateError(errors, "Mailbox SSE source and cleanup failed");
    }
  });
  const deadline = clock.now() + maxDurationMs;
  try {
    while (clock.now() < deadline) {
      const wait = Math.max(1, Math.min(hasEvent() ? idleTimeoutMs : maxDurationMs, deadline - clock.now()));
      const next = yield* abortable(async (signal) => {
        // This is application window policy, not native HTTP failure classification.
        /** Wake the native body read before this child can be joined during cancellation. */
        const cancel = () => controller.abort(signal.reason);
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
        let timer: ReturnType<typeof clock.setTimeout> | undefined;
        pending = iterator.next();
        try {
          const result = await Promise.race([
            pending,
            new Promise<undefined>((resolve) => {
              timer = clock.setTimeout(() => resolve(undefined), wait);
            }),
          ]);
          if (!result) controller.abort();
          return result;
        } finally {
          if (timer !== undefined) clock.clearTimeout(timer);
          signal.removeEventListener("abort", cancel);
          await pending.catch(() => undefined);
        }
      }, options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal);
      if (!next || next.done) return;
      if (next.value.length && (yield* consume(next.value)) === false) return;
    }
  } catch (error) {
    reported = { error };
    throw error;
  }
}
