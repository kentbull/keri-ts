/**
 * CESR-over-HTTP request helpers.
 *
 * Mailbox and exchange interop depends on getting this boundary right.
 *
 * KERIpy correspondence:
 * - default behavior is one CESR message per HTTP request with the message body
 *   in the request body and attachments in `CESR-ATTACHMENT`
 *
 * Current `keri-ts` difference:
 * - `keri-ts` supports an optional `"body"` mode for mailbox operations where the
 *   full CESR payload is sent in the body instead of splitting attachments into
 *   the header
 */
import { parseBytes, parseSerder, requireFlatFrame, SerderKERI, smell } from "cesr-ts";
import { ValidationError } from "../core/errors.ts";
import { collectBytes, streamBytes } from "./byte-source.ts";

/** Mailbox HTTP framing modes supported by `keri-ts`. */
export type CesrBodyMode = "header" | "body";

/** Default interop mode matching KERIpy mailbox behavior. */
export const DEFAULT_CESR_BODY_MODE: CesrBodyMode = "header";
/** CESR HTTP content type used by mailbox and exchange endpoints. */
export const CESR_CONTENT_TYPE = "application/cesr";
/** KERIpy's legacy-but-authoritative CESR HTTP media type. */
export const KERIPY_CESR_JSON_CONTENT_TYPE = "application/cesr+json";
/** Multipart form content type retained for mailbox-admin compatibility. */
export const MULTIPART_CONTENT_TYPE = "multipart/form-data";
/** Header that carries detached CESR attachments in header mode. */
export const CESR_ATTACHMENT_HEADER = "CESR-ATTACHMENT";
/** Header naming the intended recipient endpoint AID when needed. */
export const CESR_DESTINATION_HEADER = "CESR-DESTINATION";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Return true when one HTTP content type names CESR payload framing. */
export function isCesrContentType(value: string | null | undefined): boolean {
  const normalized = value?.split(";")[0]?.trim()?.toLowerCase();
  return normalized === CESR_CONTENT_TYPE
    || normalized === KERIPY_CESR_JSON_CONTENT_TYPE;
}

/** Return true when one HTTP content type names multipart form media. */
export function isMultipartFormContentType(
  value: string | null | undefined,
): boolean {
  return value?.split(";")[0]?.trim()?.toLowerCase() === MULTIPART_CONTENT_TYPE;
}

/** Normalized mailbox-admin request after content-type-specific parsing. */
export interface MailboxAdminRequest {
  readonly bytes: Uint8Array;
  readonly inspection: CesrStreamInspection;
}

/** Parsed CESR stream plus its terminal message for callers that need both. */
export interface CesrStreamInspection {
  readonly messages: readonly SerderKERI[];
  readonly terminal: SerderKERI | null;
}

/** Normalize CLI or config input into one supported CESR body mode. */
export function normalizeCesrBodyMode(
  value: unknown,
  fallback: CesrBodyMode = DEFAULT_CESR_BODY_MODE,
): CesrBodyMode {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (value === "header" || value === "body") {
    return value;
  }
  throw new ValidationError(
    `Invalid cesr body mode "${String(value)}". Expected "header" or "body".`,
  );
}

/** Normalize a global config string into one supported CESR body mode. */
export function cesrBodyModeFromGlobal(
  value: string | null | undefined,
): CesrBodyMode {
  return normalizeCesrBodyMode(value ?? undefined);
}
/**
 * Build one HTTP request payload for a CESR message.
 *
 * Header mode:
 * - HTTP body carries the message body only
 * - `CESR-ATTACHMENT` carries the detached attachments
 *
 * Body mode:
 * - the full payload is sent in the HTTP body
 */
export function buildCesrRequest(
  message: Uint8Array,
  { bodyMode = DEFAULT_CESR_BODY_MODE, contentType = CESR_CONTENT_TYPE, destination }: {
    bodyMode?: CesrBodyMode;
    contentType?: string;
    destination?: string;
  } = {},
): { headers: Record<string, string>; body: ArrayBuffer } {
  const mode = normalizeCesrBodyMode(bodyMode);
  const headers: Record<string, string> = {
    "Content-Type": contentType,
  };
  if (destination) {
    headers[CESR_DESTINATION_HEADER] = destination;
  }

  if (mode === "body") {
    return {
      headers,
      body: arrayBufferFromBytes(message),
    };
  }

  const { smellage } = smell(message);
  const serder = parseSerder(message.slice(0, smellage.size), smellage);
  headers[CESR_ATTACHMENT_HEADER] = textDecoder.decode(
    message.slice(serder.size),
  );
  return {
    headers,
    body: arrayBufferFromBytes(message.slice(0, serder.size)),
  };
}
/**
 * Build one raw CESR-body HTTP request.
 *
 * This is the right helper for endpoints that accept an already assembled CESR
 * payload or a multi-message CESR stream in the body.
 */
export function buildCesrStreamRequest(bytes: Uint8Array, { destination }: {
  destination?: string;
} = {}): { headers: Record<string, string>; body: ArrayBuffer } {
  const headers: Record<string, string> = {
    "Content-Type": CESR_CONTENT_TYPE,
  };
  if (destination) {
    headers[CESR_DESTINATION_HEADER] = destination;
  }
  return {
    headers,
    body: arrayBufferFromBytes(bytes),
  };
}
/**
 * Reconstruct one logical CESR payload from an incoming HTTP request.
 *
 * In header mode this reattaches `CESR-ATTACHMENT` bytes to the parsed message
 * body so downstream parsing always sees the canonical CESR byte stream.
 */
export function requestBytes(
  req: Request,
  options: { signal?: AbortSignal } = {},
): AsyncIterable<Uint8Array> {
  return read();
  /** Acquire the body lazily, then append detached attachments in their original order. */
  async function* read(): AsyncGenerator<Uint8Array> {
    const attachment = req.headers.get(CESR_ATTACHMENT_HEADER);
    const tail = attachment && isCesrContentType(req.headers.get("content-type"))
      ? textEncoder.encode(attachment)
      : null;
    yield* streamBytes(req.body, { signal: req.signal, ...options });
    (options.signal ?? req.signal).throwIfAborted();
    if (tail?.length) yield tail;
  }
}

/** Collect a finite administrative/receipt request; generic ingress uses requestBytes directly. */
export async function readCesrRequestBytes(req: Request): Promise<Uint8Array> {
  let failed = false, failure: unknown;
  try {
    return await collectBytes(requestBytes(req));
  } catch (error) {
    failed = true;
    failure = error;
    throw error;
  } finally {
    if (req.body && !req.body.locked) {
      try {
        await req.body.cancel();
      } catch (error) {
        // deno-lint-ignore no-unsafe-finally -- Retain distinct intake/cleanup failures and original identity.
        throw failed && error !== failure
          ? new AggregateError([failure, error], "CESR request intake and cleanup failed")
          : error;
      }
    }
  }
}

/**
 * Read one direct signed-KERI ingress request.
 *
 * Endpoints that accept existing signed KERI material should use this helper
 * instead of hand-rolling JSON or form-data wrappers around CESR bytes.
 *
 * Returns `null` when the request is not CESR-framed at all.
 */
export async function readRequiredCesrRequestBytes(
  req: Request,
): Promise<Uint8Array | null> {
  if (!isCesrContentType(req.headers.get("content-type"))) {
    return null;
  }
  return await readCesrRequestBytes(req);
}

/**
 * Read one mailbox-admin request from either raw CESR or multipart fields.
 *
 * Multipart compatibility contract:
 * - `kel`: required controller replay
 * - `delkel`: optional delegation replay
 * - `rpy`: required mailbox authorization reply
 */
export async function readMailboxAdminRequest(
  req: Request,
): Promise<MailboxAdminRequest | null> {
  const contentType = req.headers.get("content-type");

  if (isCesrContentType(contentType)) {
    const bytes = new Uint8Array(await readCesrRequestBytes(req));
    return {
      bytes,
      inspection: await inspectMailboxAdminCesrStream(new Uint8Array(bytes)),
    };
  }

  if (isMultipartFormContentType(contentType)) {
    const bytes = await collectBytes(streamBytes(req.body, { signal: req.signal }));
    const form = await new Response(bytes, { headers: { "content-type": contentType! } }).formData();
    const kel = readRequiredMailboxAdminField(form, "kel");
    const rpy = readRequiredMailboxAdminField(form, "rpy");
    const delkel = readOptionalMailboxAdminField(form, "delkel");

    const message = textEncoder.encode(`${delkel ?? ""}${kel}${rpy}`);
    return {
      bytes: message,
      inspection: await inspectMailboxAdminReply(textEncoder.encode(rpy)),
    };
  }

  return null;
}

/** Parse and return the first CESR message in one request body. */
export function inspectCesrRequest(bytes: Uint8Array): SerderKERI | null {
  try {
    const { smellage } = smell(bytes);
    const serder = parseSerder(bytes.slice(0, smellage.size), smellage);
    return serder instanceof SerderKERI ? serder : null;
  } catch {
    return null;
  }
}

/** Parse and return the final CESR message in one request body. */
export async function inspectCesrTerminalMessage(
  bytes: Uint8Array,
): Promise<SerderKERI | null> {
  return (await inspectCesrStream(bytes)).terminal;
}
/** Parse one entire CESR request body and return every message plus the last. */
export async function inspectCesrStream(bytes: Uint8Array): Promise<CesrStreamInspection> {
  const frames = await parseBytes(bytes);
  {
    const messages = frames.map((frame) => {
      requireFlatFrame(frame, "HTTP message inspection");
      const { body } = frame;
      if (!(body instanceof SerderKERI)) throw new ValidationError("Expected a KERI message in the CESR request");
      return body;
    });
    return { messages, terminal: messages.at(-1) ?? null };
  }
}

/** Copy a byte view into a standalone `ArrayBuffer` for Fetch request bodies. */
function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function readRequiredMailboxAdminField(form: FormData, name: string): string {
  const value = readOptionalMailboxAdminField(form, name);
  if (!value) {
    throw new ValidationError(
      `Mailbox authorization request is missing ${name}`,
    );
  }
  return value;
}

function readOptionalMailboxAdminField(
  form: FormData,
  name: string,
): string | undefined {
  const value = form.get(name);
  if (value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ValidationError(
      `Mailbox authorization field ${name} must be text`,
    );
  }
  return value;
}

async function inspectMailboxAdminCesrStream(
  bytes: Uint8Array,
): Promise<CesrStreamInspection> {
  try {
    return await inspectCesrStream(bytes);
  } catch (error) {
    throw new ValidationError(
      `Invalid mailbox authorization stream: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function inspectMailboxAdminReply(bytes: Uint8Array): Promise<CesrStreamInspection> {
  try {
    const inspection = await inspectCesrStream(bytes);
    if (inspection.messages.length !== 1) {
      throw new ValidationError(
        "Mailbox authorization reply field must contain exactly one CESR message",
      );
    }
    return inspection;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(
      `Invalid mailbox authorization reply: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
