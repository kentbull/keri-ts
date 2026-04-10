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
import {
  concatBytes,
  type CesrMessage,
  createParser,
  parseSerder,
  SerderKERI,
  type Smellage,
} from "../../../cesr/mod.ts";
import { ValidationError } from "../core/errors.ts";

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
  {
    bodyMode = DEFAULT_CESR_BODY_MODE,
    destination,
  }: {
    bodyMode?: CesrBodyMode;
    destination?: string;
  } = {},
): { headers: Record<string, string>; body: ArrayBuffer } {
  const mode = normalizeCesrBodyMode(bodyMode);
  const headers: Record<string, string> = {
    "Content-Type": CESR_CONTENT_TYPE,
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

  const serder = new SerderKERI({ raw: message });
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
export function buildCesrStreamRequest(
  bytes: Uint8Array,
  {
    destination,
  }: {
    destination?: string;
  } = {},
): { headers: Record<string, string>; body: ArrayBuffer } {
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
 * Split one CESR JSON message stream into individual request-ready messages.
 *
 * KERIpy correspondence:
 * - mirrors `streamCESRRequests(...)`, which posts one message body plus its
 *   attachments per HTTP request instead of shoving a whole multi-message
 *   stream behind one `CESR-ATTACHMENT` header
 */
export function splitCesrStream(message: Uint8Array): Uint8Array[] {
  if (message.length === 0) {
    return [];
  }

  const parser = createParser({
    framed: false,
    attachmentDispatchMode: "compat",
  });
  const frames = [...parser.feed(message), ...parser.flush()];
  const parts: Uint8Array[] = [];

  for (const frame of frames) {
    if (frame.type === "error") {
      throw frame.error;
    }
    parts.push(
      concatBytes(
        frame.frame.body.raw,
        ...frame.frame.attachments.map((attachment) => attachment.raw),
      ),
    );
  }

  return parts;
}

/**
 * Reconstruct one logical CESR payload from an incoming HTTP request.
 *
 * In header mode this reattaches `CESR-ATTACHMENT` bytes to the parsed message
 * body so downstream parsing always sees the canonical CESR byte stream.
 */
export async function readCesrRequestBytes(req: Request): Promise<Uint8Array> {
  const body = new Uint8Array(await req.arrayBuffer());
  const contentType = req.headers.get("content-type")
    ?.split(";")[0]
    ?.trim()
    ?.toLowerCase();
  const attachment = req.headers.get(CESR_ATTACHMENT_HEADER);

  if (
    contentType === CESR_CONTENT_TYPE
    && attachment
    && attachment.length > 0
  ) {
    return new Uint8Array(
      [...body, ...textEncoder.encode(attachment)],
    );
  }

  return body;
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
      inspection: inspectMailboxAdminCesrStream(new Uint8Array(bytes)),
    };
  }

  if (isMultipartFormContentType(contentType)) {
    const form = await req.formData();
    const kel = readRequiredMailboxAdminField(form, "kel");
    const rpy = readRequiredMailboxAdminField(form, "rpy");
    const delkel = readOptionalMailboxAdminField(form, "delkel");

    const bytes = textEncoder.encode(`${delkel ?? ""}${kel}${rpy}`);
    return {
      bytes,
      inspection: inspectMailboxAdminReply(textEncoder.encode(rpy)),
    };
  }

  return null;
}

/** Parse and return the first CESR message in one request body. */
export function inspectCesrRequest(bytes: Uint8Array): SerderKERI | null {
  return inspectCesrStream(bytes).messages[0] ?? null;
}

/** Parse and return the final CESR message in one request body. */
export function inspectCesrTerminalMessage(
  bytes: Uint8Array,
): SerderKERI | null {
  return inspectCesrStream(bytes).terminal;
}

/** Parse one entire CESR request body and return every message plus the last. */
export function inspectCesrStream(bytes: Uint8Array): CesrStreamInspection {
  const parser = createParser({
    framed: false,
    attachmentDispatchMode: "compat",
  });
  const messages: SerderKERI[] = [];
  const frames = parser.feed(bytes);
  for (const frame of frames) {
    if (frame.type === "error") {
      throw frame.error;
    }
    messages.push(parseSerder(
      frame.frame.body.raw,
      smellageFromMessage(frame.frame),
    ) as SerderKERI);
  }
  return {
    messages,
    terminal: messages.at(-1) ?? null,
  };
}

/** Copy a byte view into a standalone `ArrayBuffer` for Fetch request bodies. */
function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function smellageFromMessage(
  message: CesrMessage,
): Smellage {
  return {
    proto: message.body.proto,
    pvrsn: message.body.pvrsn,
    kind: message.body.kind,
    size: message.body.size,
    gvrsn: message.body.gvrsn,
  };
}

function readRequiredMailboxAdminField(form: FormData, name: string): string {
  const value = readOptionalMailboxAdminField(form, name);
  if (!value) {
    throw new ValidationError(`Mailbox authorization request is missing ${name}`);
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
    throw new ValidationError(`Mailbox authorization field ${name} must be text`);
  }
  return value;
}

function inspectMailboxAdminCesrStream(
  bytes: Uint8Array,
): CesrStreamInspection {
  try {
    return inspectCesrStream(bytes);
  } catch (error) {
    throw new ValidationError(
      `Invalid mailbox authorization stream: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function inspectMailboxAdminReply(bytes: Uint8Array): CesrStreamInspection {
  try {
    const inspection = inspectCesrStream(bytes);
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
