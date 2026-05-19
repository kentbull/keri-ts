import { action, type Operation } from "npm:effection@^3.6.0";

/** Shared encoder for mailbox SSE parsing. */
const textEncoder = new TextEncoder();
const DEFAULT_READ_IDLE_TIMEOUT_MS = 500;
const DEFAULT_MAX_READ_DURATION_MS = 30_000;

/** One parsed mailbox SSE payload with its ordered topic metadata. */
export interface MailboxSseMessage {
  idx: number;
  msg: Uint8Array;
  topic: string;
}

/**
 * Read one mailbox-style SSE response without waiting for remote EOF.
 *
 * KERIpy mailbox iterables keep the stream open for long-poll behavior, so
 * callers use an explicit read budget and idle timeout instead of waiting for
 * `response.text()` to resolve.
 */
export function* readMailboxSseBody(
  response: Response,
  controller: AbortController,
  {
    idleTimeoutMs = DEFAULT_READ_IDLE_TIMEOUT_MS,
    maxDurationMs = DEFAULT_MAX_READ_DURATION_MS,
  }: {
    idleTimeoutMs?: number;
    maxDurationMs?: number;
  } = {},
): Operation<string> {
  const body = response.body;
  if (!body) {
    return "";
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + maxDurationMs;
  const timedOut = Symbol("timedOut");

  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(
        1,
        Math.min(idleTimeoutMs, deadline - Date.now()),
      );
      const next = yield* action<
        ReadableStreamReadResult<Uint8Array> | typeof timedOut
      >((resolve, reject) => {
        let settled = false;
        const timeoutId = setTimeout(() => {
          settled = true;
          resolve(timedOut);
        }, remaining);

        reader.read().then((result) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeoutId);
          resolve(result);
        }).catch((error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeoutId);
          reject(error);
        });

        return () => {
          clearTimeout(timeoutId);
        };
      });

      if (next === timedOut) {
        if (
          parseMailboxSse(text).length > 0
          || Date.now() + idleTimeoutMs >= deadline
        ) {
          controller.abort();
          break;
        }
        continue;
      }

      const { value, done } = next as ReadableStreamReadResult<Uint8Array>;
      if (done) {
        break;
      }
      if (value && value.length > 0) {
        text += decoder.decode(value, { stream: true });
      }
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      throw error;
    }
  } finally {
    yield* action<void>((resolve) => {
      void reader.cancel().catch(() => {
        // Ignore cleanup failures from already-aborted SSE streams.
      }).finally(() => resolve(undefined));
      return () => {};
    });
  }

  text += decoder.decode();
  return text;
}

/** Parse mailbox SSE text into `(topic, idx, payload)` tuples. */
export function parseMailboxSse(text: string): MailboxSseMessage[] {
  const messages: MailboxSseMessage[] = [];

  for (const block of text.split("\n\n")) {
    if (block.trim().length === 0) {
      continue;
    }
    let idx = -1;
    let topic = "";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("id:")) {
        idx = Number(line.slice(3).trim());
      } else if (line.startsWith("event:")) {
        topic = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (idx < 0 || topic.length === 0 || dataLines.length === 0) {
      continue;
    }
    messages.push({
      idx,
      topic,
      msg: textEncoder.encode(dataLines.join("\n")),
    });
  }

  return messages;
}
