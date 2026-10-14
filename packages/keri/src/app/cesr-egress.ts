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
import { defaultRuntimeServices, type RuntimeServices } from "./runtime-services.ts";

/** Transport choices and finite HTTP metadata limits for an admitted CESR frame. */
export interface EgressOptions {
  /** Header mode matches KERIpy; body mode streams the complete qualified frame. */
  bodyMode?: CesrBodyMode;
  /** Additional transport headers, such as witness Authorization; CESR framing is set by the sender. */
  headers?: HeadersInit;
  /** Optional endpoint AID carried in CESR-DESTINATION. */
  destination?: string;
  /** Header mode admits at most this many text-qualified attachment bytes; default 64 KiB. */
  maxHeaderBytes?: number;
  /** Failed responses retain at most this many diagnostic bytes; default 16 KiB. */
  maxErrorBytes?: number;
  /** Upstream cancellation joins the same request lifetime as Effection cancellation. */
  signal?: AbortSignal;
  /** Injectable HTTP service for the owning runtime. */
  services?: RuntimeServices;
}

/** Parser admission and HTTP output policy for a progressively consumed source. */
export interface PostOptions extends EgressOptions {
  /** Finite frame/payload budgets and optional durable sink selection for this source. */
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
 * The caller supplies an already admitted frame tree. Body mode streams a complete frame; header mode explicitly caps text-qualified
 * attachments. Scope exit aborts fetch and its body iterator, joins pending I/O,
 * and closes the response. The caller retains ownership of frame.essr.
 */
export function requestFrame(url: string, frame: CesrFrame, options: EgressOptions = {}): Operation<Response> {
  return openFrameResponse(url, frame, options, 1);
}

/** Source-driven output already owns its stream slot; direct frame requests acquire one here. */
function openFrameResponse(
  url: string,
  frame: CesrFrame,
  options: EgressOptions,
  streams: 0 | 1,
): Operation<Response> {
  return resource<Response>(function*(provide) {
    // One controller owns fetch, payload reads, and the response body until the resource closes.
    const controller = new AbortController();
    // External abort and structured cancellation share the same transport signal.
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    // The runtime chooses the HTTP implementation; the resource still owns its lifetime.
    const services = options.services ?? defaultRuntimeServices;
    // Header mode is the KERIpy default, and bulk body mode is explicit.
    const mode = options.bodyMode ?? "header";
    // Validate both finite metadata budgets before creating any network or payload reader.
    const headerLimit = byteLimit(options.maxHeaderBytes ?? 64 * 1024, "maxHeaderBytes");
    const errorLimit = byteLimit(options.maxErrorBytes ?? 16 * 1024, "maxErrorBytes");
    // Retain conservative qualification/header/diagnostic copies plus bounded serializer reader/output backing.
    const bytes = 8 * cesrOutputMetadataBytes(frame) + 6 * headerLimit + 4 * errorLimit + 2 * 1024 ** 2;
    const credit = services.resources.reserve({ streams, bytes });
    if (credit.kind === "refuse") {
      throw new ResourceAdmissionError(
        `HTTP output ${credit.resource} admission refused: ${credit.reason}`,
        credit.reason,
      );
    }
    // Each Promise leaf remains tracked until cancellation has joined its cleanup.
    let preparing: Promise<Uint8Array> | undefined;
    // Upload cleanup is independent of whether fetch has already returned response headers.
    let body: RequestBody | undefined;
    // The most recent response belongs to this resource until provide() completes.
    let response: Response | undefined;
    // Aborting fetch is followed by joining it, including a concurrently completed response.
    let fetching: Promise<Response> | undefined;
    // Diagnostic reads are separate Promise leaves and must also finish before scope exit.
    let reading: Promise<string> | undefined;
    try {
      signal.throwIfAborted();
      // Detached attachments are always legal text, even if the admitted frame was binary.
      const attachments = mode === "header"
        ? attachmentPayload(frame, {
          domain: "txt",
          enclosingGvrsn: frame.body.gvrsn ?? frame.body.pvrsn,
        })
        : undefined;
      preparing = attachments ? collectPayload(attachments, headerLimit, signal) : undefined;
      // Only detached-header mode collects attachments, under its explicit finite limit.
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
        fetching = services.http.fetch(url, init);
        response = yield* call(() => fetching!);
        if (response.ok) {
          yield* provide(response);
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
        throw new ValidationError(`CESR delivery to ${url} failed with HTTP ${response.status}: ${detail}`);
      }
    } finally {
      try {
        // Abort first so blocked fetch/payload reads can settle before their owners are joined.
        controller.abort();
        try {
          if (fetching) {
            yield* call(async () => {
              // A late successful response still has an owned body that must be closed.
              const completed = await fetching!.catch(() => undefined);
              if (completed?.body && !completed.body.locked) await completed.body.cancel();
            });
          }
        } finally {
          if (preparing) yield* call(() => preparing!.then(() => {}, () => {}));
          if (reading) yield* call(() => reading!.then(() => {}, () => {}));
          if (body) yield* call(() => body!.close());
        }
      } finally {
        credit.reservation.release();
      }
    }
  });
}

/** Post one complete frame at a time, joining its optional response consumer before advancing input. */
export function postCesr(
  url: string,
  source: (signal: AbortSignal) => AsyncIterable<Uint8Array>,
  options: PostOptions = {},
  consume?: (response: Response) => Operation<void>,
): Operation<void> {
  // Isolate joining cleanup so a halt cannot resume a delegated caller after payload disposal.
  return call(function*() {
    const services = options.services ?? defaultRuntimeServices;
    const limits = {
      ...options.parse,
      maxChunkBytes: options.parse?.maxChunkBytes ?? 1024 ** 2,
      maxBufferedBytes: options.parse?.maxBufferedBytes ?? 8 * 1024 ** 2,
    };
    for (const limit of [limits.maxChunkBytes, limits.maxBufferedBytes]) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Invalid output input limit");
    }
    if (limits.maxChunkBytes > limits.maxBufferedBytes) throw new RangeError("Chunk limit exceeds buffer limit");
    if (limits.resources && limits.resources !== services.resources) {
      throw new RangeError("Output parser must share its HTTP resource policy");
    }
    // Registered before parsing: its stream/cursor/producer credit outlives all parser and source cleanup.
    yield* resource<void>(function*(provide) {
      const credit = services.resources.reserve({
        streams: 1,
        bytes: limits.maxChunkBytes + limits.maxBufferedBytes,
      });
      if (credit.kind === "refuse") {
        throw new ResourceAdmissionError(`Output source admission refused: ${credit.reason}`, credit.reason);
      }
      try {
        yield* provide();
      } finally {
        credit.reservation.release();
      }
    });
    // Either caller-facing signal cancels both parsing and the request already consuming a frame.
    const signals = [options.signal, options.parse?.signal].filter((value): value is AbortSignal =>
      value !== undefined
    );
    const signal = signals.length ? AbortSignal.any(signals) : undefined;
    // The adapter owns input cancellation and leaves each delivered ESSR payload with this loop.
    const channel = yield* toEffectionFrames(source, {
      ...limits,
      resources: services.resources,
      signal,
    });
    for (const frame of yield* each(channel.frames)) {
      try {
        // Each request is closed before another frame or request can become resident.
        yield* scoped(function*() {
          const response = yield* openFrameResponse(url, frame, { ...options, services, signal }, 0);
          if (consume) yield* consume(response);
        });
      } finally {
        yield* call(() => discardFrame(frame));
      }
      yield* each.next();
    }
  });
}
