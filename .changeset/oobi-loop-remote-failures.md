---
"keri-ts": patch
---

A remote party can no longer end the OOBI or well-known authentication loop, and with it the runtime. Before, an authenticated `/oobis` request naming a URL with credentials, an OOBI on a closed port, a host answering something that is not CESR, or a response frame whose fields do not decode threw out of the Oobiery's pass, and the queued row was kept, so the same throw repeated on every tick and every restart. The same happened for URLs from an `/introduce` reply or a multi-OOBI reply, in the Authenticator (an unreachable well-known URL, or on an edge any well-known URL the relay-only guard refuses), and in an edge's relay mode when the relay answered garbage.

Each of these now ends only that job as failed: the queued row is removed, the failure is recorded in `eoobi.` (or `rmfa.` for an authentication) with an `oobiFailed` cue, and the loop goes on to the next job. The recorded states are the new `OobiJobFailure` values `url-refused`, `egress-refused`, `transport-failed`, `unparseable-response` and `invalid-response-frame`; `oobiJobFailure` classifies an error into one of them or returns null for a fault (a store error, a programmer error), which still propagates. An edge's relay that cannot be reached is still a wait bounded by `RELAY_OOBI_TIMEOUT_MS`, not a failure.

What can never succeed is refused at intake: `OobiRequestHandler.verify` refuses an `oobi` that is not an HTTP(S) URL without credentials, an `/introduce` reply naming such a URL or a `cid` that is not a prefix is rejected, and a multi-OOBI reply naming such a child URL or an `aid` that is not a prefix fails the parent as `invalid-multi-oobi` before any child is queued (an unparseable child URL used to throw a `TypeError`).

The query sender treats an accepted location the HTTP client refuses (one with credentials) as no location, so a remote `/loc/scheme` reply can no longer make it throw a `ValidationError` that ended its loop.

New: `isRequestableHttpUrl`, which `FetchHttpClient.open` now uses; an unparseable URL passed to `open` now throws its `ValidationError` instead of a `TypeError`.
