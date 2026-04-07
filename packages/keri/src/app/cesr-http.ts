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
 * - Tufa supports an optional `"body"` mode for mailbox operations where the
 *   full CESR payload is sent in the body instead of splitting attachments into
 *   the header
 */
import { SerderKERI } from "../../../cesr/mod.ts";
import { ValidationError } from "../core/errors.ts";

/** Mailbox HTTP framing modes supported by Tufa. */
export type CesrBodyMode = "header" | "body";

/** Default interop mode matching KERIpy mailbox behavior. */
export const DEFAULT_CESR_BODY_MODE: CesrBodyMode = "header";
/** CESR HTTP content type used by mailbox and exchange endpoints. */
export const CESR_CONTENT_TYPE = "application/cesr";
/** Header that carries detached CESR attachments in header mode. */
export const CESR_ATTACHMENT_HEADER = "CESR-ATTACHMENT";
/** Header naming the intended recipient endpoint AID when needed. */
export const CESR_DESTINATION_HEADER = "CESR-DESTINATION";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

  const parts: Uint8Array[] = [];
  let offset = 0;

  while (offset < message.length) {
    const current = message.slice(offset);
    const serder = new SerderKERI({ raw: current });
    let end = offset + serder.size;

    // Current mailbox/exchange HTTP traffic is JSON-framed, so the next event
    // begins at `{` and any intervening bytes belong to the current event's
    // attachment stream.
    while (end < message.length && message[end] !== 0x7b) {
      end += 1;
    }

    parts.push(message.slice(offset, end));
    offset = end;
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

/** Copy a byte view into a standalone `ArrayBuffer` for Fetch request bodies. */
function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}
