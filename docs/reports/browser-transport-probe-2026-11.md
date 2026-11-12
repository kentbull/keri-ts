# Browser transport probe, November 2026

Question: what happens when a browser wallet sends keri-ts's actual HTTP traffic with `fetch` to a KERIpy witness and to a Tufa-hosted mailbox? This is the evidence behind the `deno task test:browser:transport` lane. Nothing here was inferred unless a sentence says so.

## What ran

- **Page**: keri-ts's own browser bundle (`deno bundle --platform browser`, the same machinery as `test:browser`, now shared in `packages/keri/scripts/browser_lane.ts`), served at `http://localhost:<port>`. The servers are at `http://127.0.0.1:<port>`, so every request is cross-origin and CORS applies for real.
- **Client code under test**: `FetchHttpClient`, `HTTPMessenger` (`attemptPostCesr`), `HTTPStreamMessenger`, `sendWitnessMessage`, `Poster` (mailbox forwarding), `MailboxPoller` (SSE polling with cursors), and the two mailbox administration request shapes from `tufa mailbox add` (the library has no `mailbox-admin.ts` on this base, so the probe repeats those two request builders). Identifiers are real habitats in a real IndexedDB-backed `Habery` inside the page; sender and recipient are two identifiers in one browser store.
- **KERIpy witness**: `scripts/ci/keripy-witness-v1.py` (`setupWitness`, falcon `cors_enable=True`) on the `main` profile of `scripts/ci/keripy-reference.json` (WebOfTrust/keripy `c7e74adc3129ba36302db32e58056560b0927424`, Python 3.14.10, falcon 4.3.1), because that is the checkout cached in the interop volumes. The top-level pin `c5841f30` (the `candidate` profile) was not exercised.
- **Tufa mailbox**: `tufa mailbox start` from this working tree (hosting CORS policy `packages/hosting/src/http/policy.ts`).
- **Echo server**: the lane's own cross-origin server for browser mechanics a real witness cannot show on demand (redirect, header exposure, a slow event stream whose close it records).
- **Engines**: Chromium 141.0.7390.37 and WebKit 26.0 on the macOS host; Firefox 142.0.1 inside a Linux container (Debian 12, Playwright 1.56.1), because Firefox does not launch on this macOS host. The Firefox container reached the Docker-published servers through `host.docker.internal`; its Deno-side preflight probes therefore targeted that name.
- **Servers** ran in Docker with ports published on 127.0.0.1 and state in the named volume `keri-ts-browser-transport`. No LMDB store was opened on the macOS host.

The preflight rows are sent from Deno with the page's `Origin` and judged by the Fetch rules, so they record the exact response headers; the browsers' own outcomes are the other rows. All three engines produced identical results for every row.

## Results

Every row below is asserted by `packages/keri/test/browser-transport/expectations.ts`, per engine and server.

| Probe                             | Server | Chromium 141 / Firefox 142 / WebKit 26                 | Why                                                                                     |
| --------------------------------- | ------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| preflight POST detached CESR      | keripy | pass: allowed                                          | KERIpy's falcon CORS middleware echoes the requested headers and methods                |
| preflight POST detached CESR v2   | keripy | pass: allowed                                          | KERIpy's falcon CORS middleware echoes the requested headers and methods                |
| preflight PUT native CESR         | keripy | pass: allowed                                          | KERIpy's falcon CORS middleware echoes the requested headers and methods                |
| preflight POST with Authorization | keripy | pass: allowed                                          | KERIpy's falcon CORS middleware echoes the requested headers and methods                |
| preflight POST multipart admin    | keripy | fail: blocked: HTTP 404                                | KERIpy has no /mailboxes route; its 404 carries no CORS headers, so the preflight fails |
| preflight POST detached CESR      | tufa   | pass: allowed                                          | hosting policy lists Content-Type, CESR-ATTACHMENT, CESR-DESTINATION                    |
| preflight POST detached CESR v2   | tufa   | pass: allowed                                          | hosting policy lists CESR-Genus (added by this PR)                                      |
| preflight PUT native CESR         | tufa   | pass: allowed                                          | hosting policy allows PUT                                                               |
| preflight POST with Authorization | tufa   | pass: allowed                                          | hosting policy lists Authorization (added by this PR)                                   |
| preflight POST multipart admin    | tufa   | pass: allowed                                          | hosting policy lists CESR-DESTINATION; multipart/form-data is safelisted                |
| forbidden-content-length          | echo   | pass: server saw content-length 10                     | the page's Content-Length 5 is silently dropped; the true length is sent                |
| genus-header-sent                 | echo   | pass: server saw cesr-genus 2                          | CESR-Genus is not forbidden, so a v2 detached POST carries it                           |
| redirect-manual-post              | echo   | fail: refused HTTP 0                                   | redirect: manual yields an opaque redirect, status 0; keri-ts reports a refusal         |
| redirect-manual-put               | echo   | fail: HTTP 0                                           | redirect: manual yields an opaque redirect, status 0                                    |
| expose-headers                    | echo   | pass: readable keri-aid                                | only exposed and safelisted response headers are readable                               |
| sse-streams-incrementally         | echo   | pass: incremental                                      | fetch delivers event chunks as they arrive                                              |
| sse-abort                         | echo   | pass: server saw close: true                           | aborting the read closes the connection                                                 |
| oobi-get                          | keripy | pass: HTTP 200 readable content-type,content-length    | no Access-Control-Expose-Headers: Keri-Aid is present but unreadable                    |
| post-detached-event               | keripy | pass: delivered                                        | POST with CESR-ATTACHMENT and CESR-DESTINATION passes                                   |
| put-native-stream                 | keripy | pass: HTTP 204                                         | PUT with the browser-computed length passes                                             |
| witness-authorization-header      | keripy | pass: delivered                                        | KERIpy's falcon CORS middleware echoes the requested headers and methods                |
| mailbox-admin-cesr                | keripy | fail: blocked                                          | KERIpy has no /mailboxes route; its 404 carries no CORS headers, so the preflight fails |
| mailbox-admin-multipart           | keripy | fail: blocked                                          | KERIpy has no /mailboxes route; its 404 carries no CORS headers, so the preflight fails |
| mailbox-topic-reply               | keripy | pass: delivered                                        | a message posted for the recipient reaches its poll through fetch streaming             |
| mailbox-topic-receipt             | keripy | pass: delivered                                        | a message posted for the recipient reaches its poll through fetch streaming             |
| mailbox-topic-multisig            | keripy | pass: delivered                                        | a message posted for the recipient reaches its poll through fetch streaming             |
| mailbox-topic-credential          | keripy | pass: delivered                                        | a message posted for the recipient reaches its poll through fetch streaming             |
| mailbox-cursor-resume             | keripy | pass: resumed after the stored cursor                  | a fresh poller resumes from the stored cursor                                           |
| oobi-get                          | tufa   | pass: HTTP 200 readable content-type,keri-aid,oobi-aid | hosting exposes KERI-AID and Oobi-Aid                                                   |
| post-detached-event               | tufa   | pass: delivered                                        | v2 detached POST passes now that CESR-Genus is allowed                                  |
| put-native-stream                 | tufa   | pass: HTTP 204                                         | PUT with the browser-computed length passes                                             |
| witness-authorization-header      | tufa   | pass: delivered                                        | passes now that Authorization is allowed                                                |
| mailbox-admin-cesr                | tufa   | pass: HTTP 200                                         | CESR-body administration passes                                                         |
| mailbox-admin-multipart           | tufa   | pass: HTTP 200                                         | multipart administration passes                                                         |
| mailbox-topic-reply               | tufa   | pass: delivered                                        | a message posted for the recipient reaches its poll through fetch streaming             |
| mailbox-topic-receipt             | tufa   | pass: delivered                                        | a message posted for the recipient reaches its poll through fetch streaming             |
| mailbox-topic-multisig            | tufa   | pass: delivered                                        | a message posted for the recipient reaches its poll through fetch streaming             |
| mailbox-topic-credential          | tufa   | pass: delivered                                        | a message posted for the recipient reaches its poll through fetch streaming             |
| mailbox-cursor-resume             | tufa   | pass: resumed after the stored cursor                  | a fresh poller resumes from the stored cursor                                           |

Exact preflight responses (OPTIONS, `Origin: http://localhost:<port>`, requesting `content-type,cesr-attachment,cesr-destination,cesr-genus,authorization`):

- KERIpy witness, `/`: `200`, `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: POST, PUT`, `Access-Control-Allow-Headers:` the requested list echoed, `Access-Control-Max-Age: 86400`, no `Access-Control-Expose-Headers`. `OPTIONS /mailboxes` is `404` with only `Access-Control-Allow-Origin: *`.
- Tufa mailbox, after this PR: `204`, `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS`, `Access-Control-Allow-Headers: Content-Type, CESR-ATTACHMENT, CESR-DESTINATION, CESR-Genus, Authorization, Oobi-Aid`, `Access-Control-Expose-Headers: Content-Type, KERI-AID, Oobi-Aid`, no `Access-Control-Max-Age`. Before this PR the allow list lacked `CESR-Genus` and `Authorization`.

Mailbox topics `/reply`, `/receipt`, `/multisig` and `/credential` were each delivered end to end: a genuine signed message (`rpy /end/role/add`, `rct` of the recipient's inception, `exn /multisig/vcp`, `exn /ipex/offer`) posted by the sender through `Poster` and read by the recipient's `MailboxPoller`. Against KERIpy the recipient names the witness as its witness (the witness is its mailbox); against Tufa the recipient is authorized through the CESR-body administration POST first. The multipart administration form authorized a different identifier, so multipart-authorized delivery was not run.

## Gaps

1. **Tufa refused `CESR-Genus` and `Authorization` in the preflight.** Before the fix, in Chromium and WebKit: `post-detached-event`, `witness-authorization-header` and all four mailbox topics against Tufa failed with keri-ts `TransportError: HTTP request failed for http://127.0.0.1:55701/`, cause `TypeError: Failed to fetch` (Chromium) or `TypeError: Load failed` (WebKit, console: "due to access control checks"); the resume probe saw nothing. The preflight that Deno sent said `blocked: cesr-genus` and `blocked: authorization`. A v2 detached POST carries `CESR-Genus`, and a witness TOTP code travels in `Authorization`, so a browser wallet could neither forward to a mailbox nor authenticate to a witness. KERIpy echoes requested headers and was never affected. **Fixed here**: `packages/hosting/src/http/policy.ts` now allows both; `packages/hosting/test/http-app.test.ts` asserts the list; `@keri-ts/hosting` patch changeset. Firefox was run only after the fix; its pre-fix failure is inferred from the engine-independent preflight, not observed.
2. **KERIpy exposes no response headers.** Without `Access-Control-Expose-Headers`, `Keri-Aid` is present on `GET /oobi/<aid>/controller` but a page reads only `content-type` and `content-length` (both safelisted). keri-ts reads `content-type` on OOBI responses and `CESR-ATTACHMENT` only in the kf-boot client; neither witness nor mailbox responses need an exposed header today, so nothing breaks. **Needs a KERIpy-side change or a test-only proxy** if a wallet should read `Keri-Aid` or `CESR-ATTACHMENT`: the proxy (or falcon's CORS middleware) must add `Access-Control-Expose-Headers: Keri-Aid, CESR-ATTACHMENT`. Tufa exposes `Content-Type, KERI-AID, Oobi-Aid` but not `CESR-ATTACHMENT`; its hosted endpoints do not emit that header, so no change was made.
3. **KERIpy has no mailbox administration endpoint.** `POST /mailboxes` in both forms is blocked: the 404 for the preflight carries no `Access-Control-Allow-Methods` or `-Headers`. This is not a CORS defect; KERIpy serves a witness's mailbox implicitly for the identifiers that name it as witness, which the delivery rows cover. **KERIpy-side by design**; a wallet must not call administration on a KERIpy witness.
4. **`redirect: "manual"` yields status 0.** In all three engines `HTTPMessenger` (`cesr-egress.ts`) reports `CesrHttpRefusal ... failed with HTTP 0` and `HTTPStreamMessenger` returns `status 0, ok false`. No flow depends on seeing a redirect: neither KERIpy's `indirecting`/`ending` nor keri-ts, hosting or Tufa produce a 3xx (searched `Response.redirect`, `status: 30x`), and neither server redirected in any probe. A server that did redirect would be reported as an HTTP 0 refusal. **No change needed**; if a future server redirects, keri-ts should treat status 0 as a redirect rather than "HTTP 0".
5. **Forbidden request headers are dropped silently.** `Content-Length` set by `nativeFrameRequest` and `HTTPStreamMessenger` is ignored by the browser, which sends the true length: a page set 5 for a 10-byte body and the server saw 10. Nothing breaks. **No change needed.** `CESR-Genus` and `CESR-ATTACHMENT` are not forbidden and arrive intact.
6. **Streaming works in every engine.** Event chunks arrive incrementally (about 250 ms apart as sent), aborting the read closes the connection (the echo server saw the close), and a fresh `MailboxPoller` resumes from the cursor stored in `db.tops`. **No change needed.**
7. **WebKit only, unresolved**: halting a `MailboxPoller` whose poll had nothing to read sometimes did not complete (the probe exceeded 60 s, then 5 s more). It showed at the old `mailbox-cursor-resume` probe against KERIpy in 4 of 5 uninstrumented full WebKit runs, 1 of 3 runs of echo plus KERIpy probes, and 1 of 13 KERIpy-only runs; Chromium (4 full runs) and Firefox (2 full runs) never did. Native `fetch` aborts rejected correctly in WebKit in isolation (headers pending, read pending, preflighted). Tracing made the failure disappear (an instrumented full run passed), so the cause is not isolated. The probe was reshaped so every poll ends on a message, and the lane then passed in each of 3 consecutive full WebKit runs, but the hang class is **not covered by the table**; it is a candidate **keri-ts client change** (`FetchHttpClient` teardown awaits both the pending fetch and the pending read before releasing the lock), unconfirmed.
8. **Tufa sends no `Access-Control-Max-Age`.** Every cross-origin POST preflights again, including each mailbox poll. KERIpy sends 86400. Observed as header absence only; the added requests were not counted. Left unchanged.
9. **WebKit reports an unhandled rejection** ("... due to access control checks") for each blocked `fetch`; Chromium and Firefox do not. Inferred to come from the blocked request's promise chain; harmless to the lane.
10. **Mixed content, documented not tested.** An HTTPS page cannot `fetch` an `http://` witness or mailbox: browsers block it as mixed content (only `http://localhost`/loopback is treated as secure). A deployed wallet therefore needs HTTPS witnesses and mailboxes.

## Not probed

The hosted-witness backend (`tufa witness backend`: `/aids` registration, TOTP-gated `/receipts`) and the kf-boot service (which answers `OPTIONS` itself with `200` and, from reading `boot-service.ts`, no CORS headers: inferred) were not started; real TOTP codes were not generated (the probe sends a placeholder `Authorization` value, which KERIpy ignores). HTTPS and request bodies near any size limit were not tested. KERIpy `c5841f30` was not exercised.

## Reproducing

```sh
deno task test:browser:transport chromium webkit        # starts and removes both Docker servers itself
KERI_TRANSPORT_ONLY='mailbox-topic' deno task test:browser:transport webkit   # a subset; the table check then reports the rest as missing
```

Firefox from Linux (servers published on the host, reached by name from the container):

```sh
SERVERS=$(bash scripts/ci/browser-transport-servers.sh up | sed 's/127\.0\.0\.1/host.docker.internal/g')
git ls-files -co --exclude-standard | tar -cf - -T - | docker run --rm -i -v keri-ts-browser-transport:/work \
  -e DENO_DIR=/work/deno-cache -e KERI_TRANSPORT_SERVERS="$SERVERS" -w /work/repo local/keri-ts-test:latest bash -c \
  'tar xf - -C /work/repo && npx --yes playwright-core@1.56.1 install-deps firefox && npx --yes playwright-core@1.56.1 install firefox \
   && cd packages/keri && deno run -A scripts/run_browser_transport.ts firefox'
bash scripts/ci/browser-transport-servers.sh down
```

## CI

The lane is not in the `browser-tests` job. Its servers come from Docker volumes of the local interop harness, which CI does not have. A CI variant needs a native form of `scripts/ci/browser-transport-servers.sh`: the pinned KERIpy peer (`.github/actions/setup-keripy-main-peer`), the LMDB rebuild (`deno task setup:compat-lmdb`), and two background processes with a readiness wait, before several more minutes of probes in three engines inside the job's 25-minute budget. `docs/reference/PR_TEST_SCOPE.md` records this.
