# HTTP request construction and transport ownership

Status: concrete owner merged in PR #539 at `03d2c5fa`; production adoption
and composed qualification are in progress. Planning
baseline: local HEAD and remote `master` both verified at
`ac5aa29ba2b22263a913863246e68fca92e97cbc` on 2026-10-19. Recheck the baseline before
implementation. This plan follows the completed [messenger refactor](messenger-protocol-refactor.md)
and the response-body simplification in PR #538.

## Decision and scope

Composition supplies the HTTP implementation. One concrete HTTP request owner
constructs and validates `Request` before invoking `fetch`, owns the upload and
native response reader, classifies their transport failures, and joins cleanup.
CESR egress supplies wire framing and consumes the resulting HTTP contract.

The request and its body reader must belong to the same implementation and scope.
Receiving headers does not transfer native transport ownership to a parser or
application component. Consumers interpret status, headers and bytes; they do not
recognize Fetch error shapes, compare client identities, or release native readers.

Logging is not a requirement, design driver, dependency, extension point, or reason
to add any component. No logging wrapper is part of this plan. The HTTP owner is
justified by request construction, actual I/O, failure provenance and resource lifetime.

Apply [ADR-0013](../../adr/adr-0013-simple-component-flows.md) and the workspace's
`enctx/adrs/ten-constraints.md`: establish ownership first, then migrate behavior
explicitly. Keep one narrow client contract and one production implementation;
no transport framework, inheritance hierarchy, dependency registry, middleware,
callback-bearing queue records, identity flags, compatibility aliases or retry hooks.
TCP ownership and the [deferred reliability roadmap](cue-reliability-roadmap.md)
are unchanged by this HTTP refactor.

## Source findings

| Current owner                   | Finding and required disposition                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/runtime-services.ts`       | `RuntimeHttpClient.fetch(url, init)` exposes raw Fetch. The production object merely forwards to global `fetch`; composition already selects it. Replace this contract with actual request ownership.                                                   |
| `app/cesr-egress.ts`            | Owns URL validation, upload adaptation, native fetch/body error classification and cleanup alongside CESR framing. Move HTTP mechanics into the concrete owner; retain CESR framing and refusal/media-negotiation policy.                               |
| `app/cesr-egress.ts`            | Two comparisons with `defaultRuntimeHttpClient` change exception handling by object identity. Delete both. Successful query-body readers currently bypass the plain-send body classification; qualify their adoption of the common contract explicitly. |
| `app/httping.ts`                | Already owns request scopes, late fetch completion, header timeouts and unread-body cleanup, but returns raw `Response`. Consolidate this substantive lifecycle work into the request owner.                                                            |
| `app/http-messenger.ts`         | Receives HTTP/clock/protocol dependencies explicitly. Keep this composition and its parser/Kevery responsibility; consume the new request contract.                                                                                                     |
| `did/webs/resolving.ts`         | Contains a third client identity check for artifact-URL fallback. Replace it with the explicit error contract while retaining the header-acquisition-only fallback boundary.                                                                            |
| `app/mailbox-sse.ts`            | SSE policy also contains native reader/cancel/unlock machinery. Keep event parsing and existing deadlines; move native I/O lifetime to the request owner.                                                                                               |
| `app/verifier-agent.ts`         | Calls raw fetch and cancels its unread body after inspecting status. Migrate to the same owner without changing webhook acceptance policy.                                                                                                              |
| `src/runtime/index.ts` and Tufa | HTTP dependency/handle types and request helpers are exported and used across packages. Migrate supported APIs and package consumers together; removal is release-impacting.                                                                            |

Reference implementations remain KERIpy
`7143832813cac6a394ab1faf9be83bb3372be87c` and GLEIF-IT KERIpy
`b8626e1d58770a4a480ea72a01acc5580278a9f2`. Their HTTPMessengers validate the scheme
and construct HIO clients from hostname/port. They do not check URL username/password;
their witness authentication is supplied through headers. Use their ownership and
completion lessons without pretending HIO and Fetch have identical APIs.

Node rejects credential-bearing Request URLs before network execution; the Deno
version inspected at this baseline accepts the same constructor input. The
[Fetch Request constructor contract](https://fetch.spec.whatwg.org/#dom-request)
requires rejection. Preserve the current CESR HTTP(S)/userinfo restriction in the
HTTP construction owner where needed for supported-runtime consistency. Do not
remove that restriction merely because a `Request` object now exists.

## Final component contract

### Composition and native request ownership

Use a concrete `FetchHttpClient` in the HTTP-owning module, supplied through the
existing narrow `RuntimeHttpClient` dependency. It contains the implementation
moved from current HTTP helpers; it is not a facade over a second request owner.
Defaults are selected at runtime/CLI/standalone entrypoints. Lower CESR helpers
receive the selected client explicitly and do not discover defaults.

The intended public shape is:

```ts
interface RuntimeHttpClient {
  request(url: string, init: HttpRequestInit): Operation<HttpResponse>;
}

interface HttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  body(signal?: AbortSignal): AsyncIterable<Uint8Array>;
}
```

`request` is an Effection resource: the returned value and its one-use body remain
valid only inside the enclosing request scope. `ok` is derived from status.
The body source accepts its consumer's signal so parser teardown can interrupt a
blocked native read before joining it; a bare iterable cannot forward that signal.
A bodyless response yields an empty source. Expose only metadata required by actual
callers; do not reproduce the full native Response API. Do not reconstruct or proxy
a native `Response` to disguise an adapted body as the original response.

`HttpRequestInit` covers the existing method, headers, redirect choice, signal and
resident-body usages, plus the cancellable byte source needed by current CESR uploads.
Finalize the exact fields from the caller inventory during implementation; do not
add unused Fetch options or a general body-adapter hierarchy. CESR supplies generic
bytes/source access, never a CESR `Payload` or frame object, to the HTTP layer.
The source's signal is the request owner's signal. Capture upload-source errors
where the source is read so a platform wrapper cannot erase their identity.
Create the upload stream lazily: retain its source opener, but do not open or pull
the source until fetch requests bytes. Request-construction failures then do not
start source work. Register ownership before any possible acquisition and join
partial work if opening the source itself fails.

For each attempt, the concrete owner:

1. Establishes cancellation ownership and performs cheap endpoint validation before
   opening an upload source. Retains the actual supported HTTP(S)/userinfo policy.
2. Adapts any streaming upload and constructs `new Request(url, init)` outside the
   catch that translates network execution failures. Invalid URL, method/header/body
   construction must not invoke the network. Cleanup still runs if construction fails.
3. Invokes `fetch(request)` only after successful construction. The same implementation
   handles native fetch failures and subsequent native response-reader failures.
4. Supplies metadata and a pull body. Reading a chunk is HTTP-owned I/O; parsing the
   resulting chunk happens outside the transport catch. No eager full-body collection.
5. On completion, early consumer exit, failure or cancellation, aborts and joins
   pending fetch/upload/read operations, including late responses, before releasing
   readers and upload iterators. A never-started body still has an owner.

Body reads must be interruptible even when a native `read()` is blocked. Iterator
return alone is not a substitute for aborting and joining the request: abort/cancel
the native read before awaiting generator return, which can queue behind a blocked
next operation. Keep only
the concrete pending-operation and cleanup state needed for this lifetime; add no
delivery cursor, completion queue, history or generic state-machine framework.

Deadline policy uses the already-injected clock and a caller-owned AbortController
passed through `HttpRequestInit.signal`. SSE idle/max-window expiration aborts that
signal even while a body read is pending; the HTTP owner interrupts and joins the
native read. The response record needs no separate controller or cancel API.

Keep the existing mailbox header timeout in a small request-policy helper: start
its timer before acquisition, clear it when headers settle, and return `null` only
for that helper's own timeout after cleanup succeeds. External cancellation and
foreign/cleanup failures propagate. Its request resource must remain in the caller's
enclosing scope while the successful body is consumed; do not return a body from an
already-closed nested scope. The helper owns timer policy, not another fetch/reader
lifecycle or detached request task. Body deadlines begin under their existing consumer
policy and do not reuse the completed header timer.

### Failure contract

| Origin                                                                   | Behavior                                                                                                                                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint or Request construction                                         | Propagate a construction/validation error before fetch. It is not a `TransportError`.                                                                                                  |
| Native fetch execution or native response read                           | Classify at that exact boundary as `TransportError`, retaining the original cause. The concrete implementation owns supported-runtime normalization.                                   |
| Upload source, CESR/parser, JSON/SSE interpretation, storage or consumer | Preserve the original failure. Never wrap the entire consumer operation in a transport catch.                                                                                          |
| Cancellation                                                             | Preserve the owner's actual reason; do not use `signal.aborted` or an error-name match to suppress a simultaneous foreign failure.                                                     |
| Cleanup                                                                  | Join it and preserve distinct failures, including rejection with `undefined`. Deduplicate only the same already-observed error; retain aggregates with distinct read/cleanup failures. |
| HTTP non-success status                                                  | Return status and body to its protocol/application owner. CESR retains `CesrHttpRefusal`; HTTP status is not itself a network error.                                                   |

Injected clients implement this same contract. A simulated transport failure is
explicitly a `TransportError`; an arbitrary injected `TypeError` or assertion remains
unexpected. Tests must not depend on production-singleton identity. Do not add a
`native`, `trusted`, or `classifyErrors` option as a replacement.

When translating a native read failure, retain its raw cause as well as the emitted
`TransportError`. Native reader cancellation can reject with that same raw cause;
do not mistake it for a new cleanup failure merely because the read was wrapped.
An actually different cancellation or lock-release failure must still survive.

Construction before fetch narrows classification; it does not prove that all later
failures are network failures. Keep upload provenance and abort handling. Classify
supported native failures at native call boundaries, not arbitrary exceptions by
name or an application-wide list of network error strings.

### Protocol and consumer responsibilities

- CESR egress retains frame/header construction, signed bytes, attachment selection,
  supported media negotiation and refusal-text interpretation. Its plain-send reader
  drains successful bodies to EOF and collects refusal text from the owned byte source;
  it no longer handles native readers or reports raw read failures back by callback.
- HTTPMessenger keeps its parser/Kevery and chooses ordinary draining, CESR processing,
  or the current finite SSE query behavior. All three use the same owned body.
- Mailbox SSE retains complete-event framing, cursor/publication rules, header-open,
  idle and maximum-window deadlines. Request/body aborts join the HTTP owner's I/O.
  Keep timeout-as-no-response separate from external cancellation and cleanup errors.
- OOBI and receipt consumers retain lazy parsing or their existing finite collection.
  Partial accepted protocol state does not mean a truncated response succeeded.
- DID-webs keeps its existing URL order and fallback policy. Catch recognized opening
  failures only while obtaining headers, then process the body outside that catch.
  Never retry an alternate URL after body/parser/storage failure. Finish refusal cleanup
  successfully before trying the next URL; a cleanup failure prevents fallback.
- Authentication, webhook and receipt-202 paths may continue to use status only and
  cancel the unread body. This refactor does not impose full-body completion where the
  current workflow deliberately requires only status and successful cleanup.
- Redirect policy stays explicit per current caller. CESR delivery remains manual/no
  hidden redirect or replay. Existing DID fallback and CESR media negotiation remain
  application/protocol policy; the HTTP client adds no automatic retry or fallback.

## Implementation sequence and PR boundaries

### Phase 1 — Implement and qualify the concrete HTTP owner

Prepare the production request owner and its minimal response/source contract by
extracting the substantive fetch/upload/reader/cleanup mechanics into one component.
Construct Request before execution classification. Keep existing production callers
on their current path until the replacement has passed its focused boundary tests;
this preparatory cut must not change runtime selection through flags or registries.
Leave the existing `RuntimeHttpClient.fetch` interface intact in this cut and test
the concrete implementation directly through its internal module. Do not delete the
old mechanics while their callers still run. Any temporary duplication is removed
by the immediately dependent atomic migration, with no new public compatibility API.

Prefer a focused first PR containing this concrete owner and qualification. Its
temporary lack of production adoption is a sequencing dependency, not an optional
second transport architecture. Do not export a speculative public API or publish a
release from this preparatory cut. If it cannot be reviewed independently without
inventing adapters, keep these commits with the atomic migration instead of adding shims.

Exit: actual native requests and request-owned bodies pass the construction,
completion and failure-origin scenarios below on supported Node and Deno runtimes.
The owner has no dependency on CESR, protocol processors, Poster, logging or runtime roots.

### Phase 2 — Adopt the owner and delete the old execution paths

Use one cohesive migration PR for the shared dependency switch and all of its
callers. Update composition and standalone entrypoints, HTTPMessenger, CESR egress,
HTTP helper users, mailbox SSE, OOBI, authentication, witnessing, DID-webs, verifier
webhooks, Tufa admin/debug and test clients. Keep intermediate commits runnable when
practical; do not manufacture compatibility APIs merely to divide the migration.

Delete all three identity checks, raw-response transport escapes, `readFailed`
classification callbacks, duplicated request-body/native-reader cleanup, and the
old `RuntimeHttpClient.fetch` contract. Consolidate `ownHttpResponse` and the old
response-handle machinery into the concrete owner. Retain small timeout or finite
collection helpers only where they express an actual caller policy, with no default
HTTP lookup or second request lifecycle underneath them.

Move DID asynchronous-source orchestration into the existing Effection request scope
where necessary; do not create an independently running request task to adapt the API.
Close each failed attempt before the next, and keep a successful response owned while
its consumer processes it. Retire raw Response signatures in public helpers and update
exports and package callers together.

Exit: composition is the sole implementation selector; every runtime HTTP request
uses the contract; production fetch/response-reader classification exists only in the
concrete HTTP boundary. Query bodies now receive the same transport-error contract as
plain sends. That correction is documented and tested, not claimed as unchanged behavior.

### Phase 3 — Composed qualification and handoff

Run applicable maintained workflow owners and installed KERI/Tufa checks. Update
runtime/DID contracts, ADR wording where necessary, learning routes, public examples
and the plan's status with the final claims. Add maintainer-oriented doc comments for
touched classes, members and functions, and inline comments at real ownership/error
boundaries; do not add documentation tests or lint rules.

Use scoped tests per PR and exact-commit local credit as described in
[PR test scope](../../reference/PR_TEST_SCOPE.md). Static/quality and changeset checks
remain mandatory. The public HTTP contract migration needs release-impacting changesets
for affected packages, not an empty readability changeset. Run the full suite after the
last implementation PR merges; fixes discovered then get focused follow-up PRs and
qualification on the resulting final tree. No artificial documentation-only PR is required.

After final file/Git mutations, run the prescribed ENCTX index-maintenance workflow
and require `ok: true`, healthy, and no stale sources before handoff.

## Required validation

Reuse and adapt `httping.test.ts`, `cesr-egress.test.ts`, `mailbox-sse.test.ts`,
query delivery, Poster queue, receipt/witness, OOBI, authentication, verifier and
`did/webs.test.ts` coverage. Add regressions at the new boundary only where existing
tests cannot express the contract; do not test incidental private structure.

- Invalid URL/scheme/userinfo and invalid Request method/header/body combinations
  never invoke fetch. Cover supported Node/Deno behavior and valid Authorization
  headers. Pre-abort and construction failure leave no opened upload work behind.
- Ordinary success waits for complete body EOF; delayed/truncated fixed-length and
  chunked bodies cannot become success after headers. Bodyless responses complete.
- Refusal text and existing 406 media negotiation work, each prior attempt closes,
  and CESR redirects/refusals do not introduce hidden replay.
- Upload-source failures retain identity through native fetch wrapping. Cancellation
  before headers, during upload/read, and after late headers joins all owned work.
- Raw response read failure is classified equally for ordinary delivery, CESR query,
  SSE and finite artifact readers. Parser/JSON/SSE/consumer/storage failures remain
  distinct. No raw native Response body bypass remains.
- Early break, never-read body, pending read and late response all clean up; genuine
  cleanup failures, foreign abort-shaped errors, undefined rejection and simultaneous
  transport/cleanup failures survive. The same failed read is not reported twice.
- DID fallback works for eligible opening failure/non-success status only. Body failure,
  accepted partial KEL, parser/storage failure and refusal-cleanup failure cannot start
  another artifact attempt. Arbitrary injected TypeError does not trigger fallback.
- Mailbox header timeout still returns no response; SSE event/deadline and query-window
  behavior remain distinct. Auth/webhook status-only publication waits for cleanup.
- Poster retains the failed event, handles recognized transport failures under its
  current contract, and does not disguise unexpected construction/cleanup failure.
- Relevant maintained witness/query, mailbox, OOBI, DID-webs, verifier, CLI and Tufa
  owners retain their participant topology. Installed-package NodeNext declarations,
  supported Node runtime and native package smokes validate the public API changes.

## Completion limits

No automatic retry, backoff, new deadlines, durable delivery, remote acknowledgement,
cross-event fairness, TCP redesign, telemetry architecture or generic HTTP framework
is part of this work. Protocol processors still own verification; a successful HTTP
exchange does not establish protocol acceptance. Planning approval is not a claim
that implementation or tests have been completed.
