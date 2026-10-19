/** Scoped CESR HTTP output with streamed payloads and joined cancellation. */
import {
  attachmentPayload,
  byteString,
  type CesrFrame,
  collectPayload,
  framePayload,
  parse,
  type Payload,
} from "cesr-ts";
import { call, ensure, on, type Operation, race, resource, scoped } from "npm:effection@^3.6.0";
import { ValidationError } from "../core/errors.ts";
import { abortable, rethrowCleanupFailure } from "./abortable.ts";
import {
  CESR_ATTACHMENT_HEADER,
  CESR_CONTENT_TYPE,
  CESR_DESTINATION_HEADER,
  type CesrBodyMode,
  KERIPY_CESR_JSON_CONTENT_TYPE,
} from "./cesr-http.ts";
import { ownHttpResponse } from "./httping.ts";
import { defaultRuntimeHttpClient, defaultRuntimeServices, type RuntimeServices } from "./runtime-services.ts";
import { TransportError } from "./transport-error.ts";

/** Positive remote HTTP refusal, distinct from source, transport, storage and cleanup failure. */
export class CesrHttpRefusal extends ValidationError {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Expected remote HTTP refusal; infrastructure and cleanup failures still throw. */
export type CesrPostResult = { kind: "complete" } | { kind: "refuse"; error: CesrHttpRefusal };
type FrameResponse = { kind: "response"; response: Response } | Extract<CesrPostResult, { kind: "refuse" }>;

/** Transport choices for one CESR frame. */
export interface EgressOptions {
  /** Header mode matches KERIpy; body mode streams the complete qualified frame. */
  bodyMode?: CesrBodyMode;
  /** Additional transport headers, such as witness Authorization; CESR framing is set by the sender. */
  headers?: HeadersInit;
  /** Optional endpoint AID carried in CESR-DESTINATION. */
  destination?: string;
  /** Upstream cancellation joins the same request lifetime as Effection cancellation. */
  signal?: AbortSignal;
  /** Injectable HTTP service for the owning runtime. */
  services?: RuntimeServices;
}

/** A request body pump has at most one outstanding payload read and no prefetch queue. */
interface RequestBody {
  /** Platform stream read only when fetch supplies transport credit. */
  stream: ReadableStream<Uint8Array>;
  /** A source failure must not become a native-fetch transport failure. */
  failure?: { error: unknown };
  /** Join the last read and iterator cleanup after its owning signal aborts. */
  close(): Promise<void>;
}
/** Adapt a payload to the platform fetch boundary without collecting it. */
function requestBody(payload: Payload, upstream: AbortSignal): RequestBody {
  // Fetch can cancel the upload independently of the surrounding response scope.
  const controller = new AbortController();
  const signal = AbortSignal.any([upstream, controller.signal]);
  // The iterator borrows the frame's payload owner until this request scope exits.
  const iterator = payload.open(signal)[Symbol.asyncIterator]();
  // Joining includes the source's active next(), even if fetch stops waiting for the upload.
  let pending: Promise<IteratorResult<Uint8Array>> | undefined;
  // Repeated transport/scope cancellation shares one cleanup operation.
  let closed: Promise<void> | undefined;
  /** Returning after the pending read prevents concurrent next/return calls into a sink reader. */
  function close(): Promise<void> {
    controller.abort();
    return closed ??= (async () => {
      await pending?.catch(() => undefined);
      await iterator.return?.();
    })();
  }
  const body: RequestBody = {
    stream: new ReadableStream<Uint8Array>({
      /** A zero high-water mark leaves demand entirely with fetch's reader. */
      async pull(controller) {
        signal.throwIfAborted();
        pending = iterator.next();
        try {
          // Fetch receives one bounded owned chunk, never a view pinning a whole envelope.
          const result = await pending;
          if (result.done) controller.close();
          else controller.enqueue(result.value);
        } catch (error) {
          body.failure = { error };
          throw error;
        } finally {
          pending = undefined;
        }
      },
      /** Fetch cancellation releases the source; scope cancellation also aborts its signal. */
      cancel: close,
    }, { highWaterMark: 0 }),
    close,
  };
  return body;
}
/** Reach response EOF before completion; collect refusal text, and preserve cleanup failures. */
async function readResponseBody(
  response: Response,
  signal: AbortSignal,
  readFailed?: (cause: unknown) => void,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  let closing: Promise<void> | undefined;
  /** Repeated cancel calls do not join the first underlying stream cancellation. */
  const close = () => closing ??= reader.cancel(signal.reason);
  /** Cancellation wakes a blocked read even for an injected response disconnected from fetch. */
  const cancel = () => {
    void close().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  // Successful bodies need draining only; refusal text supports reporting and media negotiation.
  const decoder = response.ok ? undefined : new TextDecoder();
  const text: string[] = [];
  let readFailure: { error: unknown } | undefined;
  const errors: unknown[] = [];
  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (cause) {
        readFailure = { error: cause };
        if (cause !== signal.reason) readFailed?.(cause);
        throw cause;
      }
      signal.throwIfAborted();
      if (result.done) break;
      if (decoder) text.push(decoder.decode(result.value, { stream: true }));
    }
    if (decoder) text.push(decoder.decode());
  } catch (error) {
    errors.push(error);
  } finally {
    signal.removeEventListener("abort", cancel);
    try {
      await close();
    } catch (error) {
      // An errored stream rejects cancel with its already-observed read failure.
      if (!(readFailure && error === readFailure.error) && !errors.includes(error)) errors.push(error);
    }
    try {
      reader.releaseLock();
    } catch (error) {
      if (!errors.includes(error)) errors.push(error);
    }
  }
  if (errors.length > 1) {
    const failure = new AggregateError(errors, "HTTP response read and cleanup failed");
    if (signal.aborted) rethrowCleanupFailure(failure, signal);
    throw failure;
  }
  if (errors.length) throw errors[0];
  return text.join("");
}
/**
 * Open one frame response as an Effection resource owned by the caller's scope.
 *
 * The caller supplies a complete frame tree. Body mode streams the frame; header mode qualifies
 * attachments as text. Scope exit aborts fetch and its body iterator, joins pending I/O,
 * and closes the response. The frame contains ordinary ESSR evidence.
 */
export function* requestFrame(url: string, frame: CesrFrame, options: EgressOptions = {}): Operation<Response> {
  const result = yield* openFrameResponse(url, frame, options);
  if (result.kind === "refuse") throw result.error;
  return result.response;
}
/** Each actual HTTP request owns its transport scope independently of source parsing. */
function openFrameResponse(
  url: string,
  frame: CesrFrame,
  options: EgressOptions,
  readFailed?: (cause: unknown) => void,
): Operation<FrameResponse> {
  return resource<FrameResponse>(function*(provide) {
    // One controller owns fetch, payload reads, and the response body until the resource closes.
    const controller = new AbortController();
    // External abort and structured cancellation share the same transport signal.
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    // The runtime chooses the HTTP implementation; the resource still owns its lifetime.
    const services = options.services ?? defaultRuntimeServices;
    const native = services.http === defaultRuntimeHttpClient;
    // Header mode is the KERIpy default, and bulk body mode is explicit.
    const mode = options.bodyMode ?? "header";
    // Each Promise leaf remains tracked until cancellation has joined its cleanup.
    let preparing: Promise<Uint8Array> | undefined;
    // Upload cleanup is independent of whether fetch has already returned response headers.
    let body: RequestBody | undefined;
    // The most recent response belongs to this resource until provide() completes.
    let response: Response | undefined;
    // Diagnostic reads are separate Promise leaves and must also finish before scope exit.
    let reading: Promise<string> | undefined;
    let deliveredFailure: { error: unknown } | undefined;
    try {
      signal.throwIfAborted();
      // Invalid request construction remains a caller failure, outside native network classification.
      const endpoint = new URL(url);
      if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
        throw new ValidationError("CESR HTTP output requires an HTTP(S) URL without credentials");
      }
      // Detached attachments are always legal text, even if the input frame was binary.
      // Counter context belongs to the selected frame genus, never the JSON body's protocol version.
      const attachments = mode === "header" ? attachmentPayload(frame, { domain: "txt" }) : undefined;
      preparing = attachments ? collectPayload(attachments, signal) : undefined;
      // Detached-header mode materializes text attachments; body mode streams them.
      const header = preparing ? byteString(yield* call(() => preparing!)) : undefined;
      // Retry only the established KERIpy media-type negotiation, using the same reopenable frame.
      const types = mode === "header" ? [CESR_CONTENT_TYPE, KERIPY_CESR_JSON_CONTENT_TYPE] : [CESR_CONTENT_TYPE];
      for (const contentType of types) {
        // Reopening supplies fresh request bytes for a media-type retry without retaining the first upload.
        const headers = new Headers(options.headers);
        headers.set("Content-Type", contentType);
        headers.delete(CESR_DESTINATION_HEADER);
        headers.delete(CESR_ATTACHMENT_HEADER);
        if (options.destination) headers.set(CESR_DESTINATION_HEADER, options.destination);
        if (header !== undefined) headers.set(CESR_ATTACHMENT_HEADER, header);
        if (mode === "body") body = requestBody(framePayload(frame), signal);
        // Node requires duplex for streaming uploads; Deno accepts the same standard fetch body.
        const init: RequestInit & { duplex?: "half" } = {
          method: "POST",
          redirect: "manual",
          headers,
          signal,
          body: body?.stream ?? frame.body.raw.slice().buffer as ArrayBuffer,
          ...(body ? { duplex: "half" as const } : {}),
        };
        const owner = yield* ownHttpResponse(async () => {
          try {
            return await services.http.fetch(url, init);
          } catch (cause) {
            if (body?.failure) throw body.failure.error;
            if (!native || cause === signal.reason) throw cause;
            throw new TransportError(`HTTP request failed for ${url}`, { cause });
          }
        }, controller);
        response = yield* owner.response();
        if (response.ok) {
          yield* provide({ kind: "response", response });
          return;
        }
        // Only failed response text is read here; successful bodies remain available to the caller.
        reading = readResponseBody(response, signal, readFailed);
        // The response detail determines whether the historical media-type retry applies.
        const detail = yield* call(() => reading!);
        if (
          mode === "header" && response.status === 406 && contentType === CESR_CONTENT_TYPE
          && detail.toLowerCase().includes("content type")
        ) continue;
        const refusal = new CesrHttpRefusal(
          `CESR delivery to ${url} failed with HTTP ${response.status}: ${detail}`,
          response.status,
        );
        yield* provide({ kind: "refuse", error: refusal });
        return;
      }
    } catch (error) {
      deliveredFailure = { error };
      throw error;
    } finally {
      // Shared response owners join fetches; this owner separately joins preparation, diagnostics, and upload.
      controller.abort();
      const join = async (pending: Promise<unknown> | undefined): Promise<void> => {
        try {
          await pending;
        } catch (error) {
          if (error !== controller.signal.reason && !(deliveredFailure && error === deliveredFailure.error)) {
            throw error;
          }
        }
      };
      try {
        if (preparing) yield* call(() => join(preparing));
      } finally {
        try {
          if (reading) yield* call(() => join(reading));
        } finally {
          if (body) yield* call(() => body!.close());
        }
      }
    }
  });
}
/** Strict source sender; callers wanting retry/refusal policy use the joined attempt result. */
export function* postCesr(
  url: string,
  source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
  options: EgressOptions = {},
  consume?: (response: Response) => Operation<void>,
): Operation<void> {
  const result = yield* attemptPostCesr(url, source, options, consume);
  if (result.kind === "refuse") throw result.error;
}
/** Post through the same lifetime owner, returning only this invocation's expected refusal after joined cleanup. */
export function attemptPostCesr(
  url: string,
  source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
  options: EgressOptions = {},
  consume?: (response: Response) => Operation<void>,
): Operation<CesrPostResult> {
  const services = options.services ?? defaultRuntimeServices;
  let bodyFailure: { error: unknown } | undefined;
  const readFailed = services.http === defaultRuntimeHttpClient
    ? (error: unknown) => {
      bodyFailure = { error };
    }
    : undefined;
  // Isolate joining cleanup so a halt cannot resume a delegated caller after payload disposal.
  const posting = call(function*(): Operation<CesrPostResult> {
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    let failure: { error: unknown } | undefined;
    try {
      signal.throwIfAborted();
      const frames = parse(source(signal));
      let pending: ReturnType<typeof frames.next> | undefined;
      // The earlier resource joins the read after processing children stop.
      yield* ensure(function*() {
        const cleanup: unknown[] = [];
        const noteCleanup = (error: unknown) => {
          try {
            rethrowCleanupFailure(error, signal);
          } catch (remaining) {
            if (!(failure && remaining === failure.error) && !cleanup.includes(remaining)) cleanup.push(remaining);
          }
        };
        if (pending) {
          try {
            yield* call(() => pending!);
          } catch (error) {
            noteCleanup(error);
          }
        }
        try {
          yield* call(() => frames.return());
        } catch (error) {
          noteCleanup(error);
        }
        if (cleanup.length) {
          const errors = failure && failure.error !== signal.reason ? [failure.error, ...cleanup] : cleanup;
          if (errors.length === 1) throw errors[0];
          throw new AggregateError(errors, "CESR delivery and source cleanup failed", { cause: errors[0] });
        }
      });
      while (true) {
        signal.throwIfAborted();
        pending = frames.next();
        let result: Awaited<typeof pending>;
        try {
          result = yield* call(() => pending!);
        } catch (error) {
          pending = undefined;
          throw error;
        }
        pending = undefined;
        signal.throwIfAborted();
        if (result.done) break;
        const frame = result.value;
        // Each request closes before the next input frame; it owns its separate HTTP cancellation.
        const posted = yield* scoped(function*(): Operation<CesrPostResult> {
          const response = yield* openFrameResponse(url, frame, { ...options, services }, readFailed);
          if (response.kind === "refuse") return response;
          if (consume) yield* consume(response.response);
          else {
            yield* abortable(
              (signal) => readResponseBody(response.response, signal, readFailed),
              signal,
            );
          }
          return { kind: "complete" };
        });
        if (posted.kind === "refuse") return posted;
      }
    } catch (error) {
      failure = { error };
      throw error;
    } finally {
      controller.abort();
    }
    return { kind: "complete" };
  });
  const signal = options.signal;
  const attempt = signal
    ? race([
      posting,
      call(function*(): Operation<never> {
        const abort = yield* on(signal, "abort");
        signal.throwIfAborted();
        yield* abort.next();
        throw signal.reason;
      }),
    ])
    : posting;
  return call(function*() {
    try {
      return yield* attempt;
    } catch (cause) {
      // Native cancel can repeat a body-read error; classify only after all owners have joined.
      if (bodyFailure && cause === bodyFailure.error) {
        throw new TransportError(`HTTP response body failed for ${url}`, { cause });
      }
      throw cause;
    }
  });
}
