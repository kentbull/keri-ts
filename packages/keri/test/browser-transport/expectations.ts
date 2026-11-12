/**
 * The expected result of every probe, per server and engine. The lane is green exactly when the
 * observation matches this table. `reason` says why the result is what it is, so a change in
 * either direction (a fix or a regression) is a deliberate edit here.
 */

export type Engine = "chromium" | "firefox" | "webkit";
export interface Expected {
  ok: boolean;
  observed: string;
  reason: string;
}
/** `all` applies to every engine; an engine entry overrides it. */
export type Row = { all: Expected } | Partial<Record<Engine, Expected>>;

/** One expectation that holds in every engine. */
const all = (ok: boolean, observed: string, reason: string): Row => ({ all: { ok, observed, reason } });

const DELIVERED = "delivered";
const KERIPY_ECHOES = "KERIpy's falcon CORS middleware echoes the requested headers and methods";
const KERIPY_NO_ADMIN = "KERIpy has no /mailboxes route; its 404 carries no CORS headers, so the preflight fails";
const MAILBOX = "a message posted for the recipient reaches its poll through fetch streaming";

/** Keyed by `probe|server`. Chromium 141, Firefox 142 and WebKit 26 agree on every row. */
export const EXPECTED: Record<string, Row> = {
  // Preflights, sent from Deno with the page's Origin (engine independent).
  "preflight POST detached CESR|keripy": all(true, "allowed", KERIPY_ECHOES),
  "preflight POST detached CESR v2|keripy": all(true, "allowed", KERIPY_ECHOES),
  "preflight PUT native CESR|keripy": all(true, "allowed", KERIPY_ECHOES),
  "preflight POST with Authorization|keripy": all(true, "allowed", KERIPY_ECHOES),
  "preflight POST multipart admin|keripy": all(false, "blocked: HTTP 404", KERIPY_NO_ADMIN),
  "preflight POST detached CESR|tufa": all(
    true,
    "allowed",
    "hosting policy lists Content-Type, CESR-ATTACHMENT, CESR-DESTINATION",
  ),
  "preflight POST detached CESR v2|tufa": all(true, "allowed", "hosting policy lists CESR-Genus (added by this PR)"),
  "preflight PUT native CESR|tufa": all(true, "allowed", "hosting policy allows PUT"),
  "preflight POST with Authorization|tufa": all(
    true,
    "allowed",
    "hosting policy lists Authorization (added by this PR)",
  ),
  "preflight POST multipart admin|tufa": all(
    true,
    "allowed",
    "hosting policy lists CESR-DESTINATION; multipart/form-data is safelisted",
  ),
  // Browser mechanics, against the lane's echo server.
  "forbidden-content-length|echo": all(
    true,
    "server saw content-length 10",
    "the page's Content-Length 5 is silently dropped; the true length is sent",
  ),
  "genus-header-sent|echo": all(
    true,
    "server saw cesr-genus 2",
    "CESR-Genus is not forbidden, so a v2 detached POST carries it",
  ),
  "redirect-manual-post|echo": all(
    false,
    "refused HTTP 0",
    "redirect: manual yields an opaque redirect, status 0; keri-ts reports a refusal",
  ),
  "redirect-manual-put|echo": all(false, "HTTP 0", "redirect: manual yields an opaque redirect, status 0"),
  "expose-headers|echo": all(true, "readable keri-aid", "only exposed and safelisted response headers are readable"),
  "sse-streams-incrementally|echo": all(true, "incremental", "fetch delivers event chunks as they arrive"),
  "sse-abort|echo": all(true, "server saw close: true", "aborting the read closes the connection"),
  // KERIpy witness.
  "oobi-get|keripy": all(
    true,
    "HTTP 200 readable content-type,content-length",
    "no Access-Control-Expose-Headers: Keri-Aid is present but unreadable",
  ),
  "post-detached-event|keripy": all(true, DELIVERED, "POST with CESR-ATTACHMENT and CESR-DESTINATION passes"),
  "put-native-stream|keripy": all(true, "HTTP 204", "PUT with the browser-computed length passes"),
  "witness-authorization-header|keripy": all(true, DELIVERED, KERIPY_ECHOES),
  "mailbox-admin-cesr|keripy": all(false, "blocked", KERIPY_NO_ADMIN),
  "mailbox-admin-multipart|keripy": all(false, "blocked", KERIPY_NO_ADMIN),
  "mailbox-topic-reply|keripy": all(true, DELIVERED, MAILBOX),
  "mailbox-topic-receipt|keripy": all(true, DELIVERED, MAILBOX),
  "mailbox-topic-multisig|keripy": all(true, DELIVERED, MAILBOX),
  "mailbox-topic-credential|keripy": all(true, DELIVERED, MAILBOX),
  "mailbox-cursor-resume|keripy": all(
    true,
    "replayed 0, new 1",
    "a fresh poller resumes from the stored cursor",
  ),
  // Tufa mailbox host.
  "oobi-get|tufa": all(
    true,
    "HTTP 200 readable content-type,keri-aid,oobi-aid",
    "hosting exposes KERI-AID and Oobi-Aid",
  ),
  "post-detached-event|tufa": all(true, DELIVERED, "v2 detached POST passes now that CESR-Genus is allowed"),
  "put-native-stream|tufa": all(true, "HTTP 204", "PUT with the browser-computed length passes"),
  "witness-authorization-header|tufa": all(true, DELIVERED, "passes now that Authorization is allowed"),
  "mailbox-admin-cesr|tufa": all(true, "HTTP 200", "CESR-body administration passes"),
  "mailbox-admin-multipart|tufa": all(true, "HTTP 200", "multipart administration passes"),
  "mailbox-delivery-multipart-authorized|tufa": all(
    true,
    DELIVERED,
    "an identifier authorized through the multipart form receives mail",
  ),
  "mailbox-topic-reply|tufa": all(true, DELIVERED, MAILBOX),
  "mailbox-topic-receipt|tufa": all(true, DELIVERED, MAILBOX),
  "mailbox-topic-multisig|tufa": all(true, DELIVERED, MAILBOX),
  "mailbox-topic-credential|tufa": all(true, DELIVERED, MAILBOX),
  "mailbox-cursor-resume|tufa": all(
    true,
    "replayed 0, new 1",
    "a fresh poller resumes from the stored cursor",
  ),
};

/** Look up the expectation for one engine, or undefined when the table has no row. */
export function expectedFor(probe: string, server: string, engine: Engine): Expected | undefined {
  const row = EXPECTED[`${probe}|${server}`];
  return row && ("all" in row ? row.all : row[engine]);
}
