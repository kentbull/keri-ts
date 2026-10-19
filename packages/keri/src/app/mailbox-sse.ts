import { call, type Operation, resource } from "npm:effection@^3.6.0";
import { abortable, rethrowCleanupFailure } from "./abortable.ts";
import type { HttpStreamResponse } from "./http-client.ts";
import { defaultRuntimeClock, type RuntimeClock } from "./runtime-services.ts";

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
  /** Clock supplied by the consuming owner; SSE has no HTTP implementation dependency. */
  clock?: RuntimeClock;
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
  response: HttpStreamResponse,
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
  response: HttpStreamResponse,
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

/** Apply SSE deadlines to the owned byte source; the HTTP client retains native reader mechanics. */
function* consumeChunks(
  response: HttpStreamResponse,
  controller: AbortController,
  consume: (chunk: Uint8Array) => Operation<boolean | void>,
  options: MailboxSseOptions,
  hasEvent: () => boolean,
): Operation<void> {
  const { idleTimeoutMs = 500, maxDurationMs = 30_000, clock = defaultRuntimeClock } = options;
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
        const remember = (error: unknown) => {
          try {
            rethrowCleanupFailure(error, controller.signal);
          } catch (remaining) {
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
