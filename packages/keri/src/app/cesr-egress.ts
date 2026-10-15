/** Scoped CESR HTTP output: bounded metadata, streamed payloads, and joined cancellation. */
import {
  attachmentPayload,
  byteString,
  type CesrFrame,
  collectPayload,
  discardFrame,
  framePayload,
  type ParseOptions,
  type Payload,
  ResourceAdmissionError,
} from "cesr-ts";
import { toEffectionFrames } from "cesr-ts/effection";
import { call, each, type Operation, resource, scoped } from "npm:effection@^3.6.0";
import { ValidationError } from "../core/errors.ts";
import {
  CESR_ATTACHMENT_HEADER,
  CESR_CONTENT_TYPE,
  CESR_DESTINATION_HEADER,
  type CesrBodyMode,
  KERIPY_CESR_JSON_CONTENT_TYPE,
} from "./cesr-http.ts";
import { cesrOutputMetadataBytes } from "./cesr-output.ts";
import { ownHttpResponse } from "./httping.ts";
import { defaultRuntimeServices, type RuntimeServices } from "./runtime-services.ts";

/** Positive remote HTTP refusal, distinct from source, transport, storage and cleanup failure. */
export class CesrHttpRefusal extends ValidationError {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Expected local admission or remote HTTP refusal; infrastructure and cleanup failures still throw. */
type CesrPostResult = { kind: "complete" } | { kind: "refuse"; error: ResourceAdmissionError | CesrHttpRefusal };
type FrameResponse = { kind: "response"; response: Response } | Extract<CesrPostResult, { kind: "refuse" }>;

/** Transport choices and finite HTTP metadata limits for an admitted CESR frame. */
export interface EgressOptions {
  /** Header mode matches KERIpy; body mode streams the complete qualified frame. */
  bodyMode?: CesrBodyMode;
  /** Additional transport headers, such as witness Authorization; CESR framing is set by the sender. */
  headers?: HeadersInit;
  /** Optional endpoint AID carried in CESR-DESTINATION. */
  destination?: string;
  /** Failed responses retain at most this many diagnostic bytes; default 16 KiB. */
  maxErrorBytes?: number;
  /** Upstream cancellation joins the same request lifetime as Effection cancellation. */
  signal?: AbortSignal;
  /** Injectable HTTP service for the owning runtime. */
  services?: RuntimeServices;
}

/** Parser staging and HTTP transport options for a progressively consumed source. */
export interface PostOptions extends EgressOptions {
  /** Parser cancellation and optional payload staging for this source. */
  parse?: ParseOptions;
}

/** A request body pump has at most one outstanding payload read and no prefetch queue. */
interface RequestBody {
  /** Platform stream read only when fetch supplies transport credit. */
  stream: ReadableStream<Uint8Array>;
  /** Join the last read and iterator cleanup after its owning signal aborts. */
  close(): Promise<void>;
}

/** Adapt an already admitted payload to the platform fetch boundary without collecting it. */
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
  return {
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
        } finally {
          pending = undefined;
        }
      },
      /** Fetch cancellation releases the source; scope cancellation also aborts its signal. */
      cancel: close,
    }, { highWaterMark: 0 }),
    close,
  };
}

/** Read only a finite failed-response prefix and cancel any unread tail. */
async function errorText(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  if (!response.body) return "";
  // Diagnostics are metadata, not a reason to buffer an arbitrary peer response.
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
  // A finite byte budget applies before text decoding can expand the diagnostic representation.
  const bytes = new Uint8Array(limit);
  // Only the initialized prefix is decoded when the peer ends early.
  let size = 0;
  try {
    while (size < limit) {
      // A peer stream may end before the finite diagnostic budget is exhausted.
      const result = await reader.read();
      if (result.done) break;
      const part = result.value.subarray(0, limit - size);
      bytes.set(part, size);
      size += part.length;
    }
    return new TextDecoder().decode(bytes.subarray(0, size));
  } finally {
    signal.removeEventListener("abort", cancel);
    try {
      await close();
    } finally {
      reader.releaseLock();
    }
  }
}

/** Reject invalid budgets before allocating buffers or opening a remote connection. */
function byteLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
  return value;
}

/**
 * Open one frame response as an Effection resource owned by the caller's scope.
 *
 * The caller supplies a complete frame tree. Body mode streams the frame; header mode qualifies
 * attachments as text. Scope exit aborts fetch and its body iterator, joins pending I/O,
 * and closes the response. The caller retains ownership of frame.essr.
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
): Operation<FrameResponse> {
  return resource<FrameResponse>(function*(provide) {
    // One controller owns fetch, payload reads, and the response body until the resource closes.
    const controller = new AbortController();
    // External abort and structured cancellation share the same transport signal.
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    // The runtime chooses the HTTP implementation; the resource still owns its lifetime.
    const services = options.services ?? defaultRuntimeServices;
    // Header mode is the KERIpy default, and bulk body mode is explicit.
    const mode = options.bodyMode ?? "header";
    // Diagnostic output policy remains separate from attachment collection.
    const errorLimit = byteLimit(options.maxErrorBytes ?? 16 * 1024, "maxErrorBytes");
    // Retain conservative qualification/header/diagnostic copies plus bounded serializer reader/output backing.
    const bytes = 8 * cesrOutputMetadataBytes(frame) + 4 * errorLimit + 2 * 1024 ** 2;
    const credit = services.resources.reserve({ streams: 1, bytes });
    if (credit.kind === "refuse") {
      const refusal = new ResourceAdmissionError(
        `HTTP output ${credit.resource} admission refused: ${credit.reason}`,
        credit.reason,
      );
      yield* provide({ kind: "refuse", error: refusal });
      return;
    }
    // Register credit before response owners so cancellation joins their last use before release.
    yield* resource<void>(function*(provide) {
      try {
        yield* provide();
      } finally {
        credit.reservation.release();
      }
    });
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
      // Detached attachments are always legal text, even if the admitted frame was binary.
      const attachments = mode === "header"
        ? attachmentPayload(frame, {
          domain: "txt",
          enclosingGvrsn: frame.body.gvrsn ?? frame.body.pvrsn,
        })
        : undefined;
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
          headers,
          signal,
          body: body?.stream ?? frame.body.raw.slice().buffer as ArrayBuffer,
          ...(body ? { duplex: "half" as const } : {}),
        };
        const owner = yield* ownHttpResponse(() => services.http.fetch(url, init), controller);
        response = yield* owner.response();
        if (response.ok) {
          yield* provide({ kind: "response", response });
          return;
        }
        // Only failed response text is read here; successful bodies remain available to the caller.
        reading = errorText(response, errorLimit, signal);
        // The retained prefix determines whether the historical media-type retry applies.
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
          if (error !== controller.signal.reason && error !== deliveredFailure?.error) throw error;
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
  options: PostOptions = {},
  consume?: (response: Response) => Operation<void>,
): Operation<void> {
  const result = yield* attemptPostCesr(url, source, options, consume);
  if (result.kind === "refuse") throw result.error;
}

/** Post through the same lifetime owner, returning only this invocation's expected refusal after joined cleanup. */
export function attemptPostCesr(
  url: string,
  source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
  options: PostOptions = {},
  consume?: (response: Response) => Operation<void>,
): Operation<CesrPostResult> {
  // Isolate joining cleanup so a halt cannot resume a delegated caller after payload disposal.
  return call(function*(): Operation<CesrPostResult> {
    const services = options.services ?? defaultRuntimeServices;
    // Either caller-facing signal cancels both parsing and the request already consuming a frame.
    const signals = [options.signal, options.parse?.signal].filter((value): value is AbortSignal =>
      value !== undefined
    );
    const signal = signals.length ? AbortSignal.any(signals) : undefined;
    // The adapter owns input cancellation and leaves each delivered ESSR payload with this loop.
    const channel = yield* toEffectionFrames(source, {
      ...options.parse,
      signal,
    });
    for (const frame of yield* each(channel.frames)) {
      try {
        // Each request is closed before another frame or request can become resident.
        const result = yield* scoped(function*(): Operation<CesrPostResult> {
          const response = yield* openFrameResponse(url, frame, { ...options, services, signal });
          if (response.kind === "refuse") return response;
          if (consume) yield* consume(response.response);
          return { kind: "complete" };
        });
        if (result.kind === "refuse") return result;
      } finally {
        yield* call(() => discardFrame(frame));
      }
      yield* each.next();
    }
    return { kind: "complete" };
  });
}
