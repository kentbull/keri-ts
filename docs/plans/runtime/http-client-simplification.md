# Simplify HTTP requests and response ownership

Status: implementation in progress; phase 1 prepares bodies and removes upload
ownership. Phases 2 and 3 remain outstanding. Reviewed
against local `e5e78024309846bd26e5e4cd3880a5e1c53eb58e` on 2026-10-19. Verify
current master and applicable instructions before implementation. This follows
the completed [HTTP ownership refactor](http-request-ownership-refactor.md).

## Decision

Keep the composed HTTP boundary, Request validation before fetch, native failure
classification and actual cancellation. Narrow the contract to prepared request
bodies, completed finite responses and one small scoped streaming operation.
Delete asynchronous upload producers and general failure-reconciliation machinery.

The earlier refactor established the right owner. This plan reduces what that
owner promises; it does not move Fetch errors or native reader cleanup back into
CESR, SSE or application code. Its proposed contract supersedes the earlier plan's
streaming-upload requirement, prohibition on finite response collection and promise
to reconcile arbitrary combinations of injected cleanup failures. Current code and
active contracts remain authoritative until the corresponding phase lands.

Apply [ADR-0013](../../adr/adr-0013-simple-component-flows.md), SOLID and
`/Users/kbull/enc/enctx/adrs/ten-constraints.md`: preparation belongs to producers,
HTTP owns byte I/O, and consumers interpret status and content. Preserve the
existing composition dependency. No new service, superclass, registry, middleware,
policy bag, compatibility API, logging wrapper or generic stream framework.

## Evidence and limits

- GLEIF KERIpy `b8626e1d58770a4a480ea72a01acc5580278a9f2` pins
  `gleif_hio==0.6.21`, inspected at `b82287903879c0fe94554781d9390a8f18033d8e`.
  Ordinary CESR requests pass `serder.raw`. HTTPStreamMessenger passes `bytes(msg)`
  with Content-Length. HIO builds resident request bytes, detects incomplete
  response framing and publishes ordinary responses after body completion.
- Protocol correspondence remains pinned to KERIpy
  `7143832813cac6a394ab1faf9be83bb3372be87c`. HIO's API is not a template for new
  TypeScript classes; use its ownership and completion behavior.
- The actual asynchronous upload caller in `cesr-egress.ts` opens a finite
  `framePayload` for body mode. Header mode already prepares attachments and sends
  resident body bytes. Complete-frame preparation can precede network execution.
- [Undici](https://github.com/nodejs/undici#garbage-collection) requires deliberate
  response consumption/cancellation to avoid resource pressure. Unread-body
  cleanup remains necessary. The [Fetch abort contract](https://fetch.spec.whatwg.org/#abort-fetch)
  already connects cancellation to request and response streams.
- Existing unit fixtures simulate arbitrary Fetch implementations, upload producers
  and rejecting stream cleanup. They establish current guarantees, not production
  incidence. Native Node/Deno evidence must justify remaining state.
- Finite request preparation adds a complete body representation in CESR body
  mode; collecting finite responses adds allocation where success bytes were
  previously discarded. Accept this explicit simplicity tradeoff for current
  control messages. Do not buffer whole replay sequences or add memory budgets.
- SSE and incremental CESR response processing have real callers. Preserve these
  paths, including partial accepted state before a later transport failure.

## Target contract

Keep one concrete `FetchHttpClient` and the existing composition seam. Use two
explicit operations, with no mode flag or third headers-only API:

```ts
interface HttpClient {
  request(url: string, init?: HttpRequestInit): Operation<HttpResponse>;
  open(url: string, init?: HttpRequestInit): Operation<HttpStreamResponse>;
}

interface HttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  readonly body: Uint8Array;
}

interface HttpStreamResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  body(signal?: AbortSignal): AsyncIterable<Uint8Array>;
}
```

`HttpRequestInit` keeps actual method, headers, redirect and signal choices. Its
body accepts only existing prepared values: string, Uint8Array, ArrayBuffer or
null. Remove function bodies and native ReadableStream bodies; do not retain the
broader BodyInit union with another route into asynchronous uploads. The mailbox
admin multipart producer encodes its FormData into bytes and preserves the generated
Content-Type boundary before requesting. Producers
own serialization and any source/storage failure before requesting.

`request()` is an ordinary finite operation: construct, fetch, consume to EOF,
finish cleanup, return metadata and bytes. Implement it as a scoped use of
`open()` plus consumption, sharing the single native execution/read boundary.
Its returned bytes have no resource lifetime. JSON/CESR interpretation happens
outside native transport catches.

`open()` acquires headers and lends one body within the caller's scope. The HTTP
owner retains the native response and reader. Consumer cancellation must interrupt
a blocked native read before its consumer is joined. Keep `body(signal)` forwarding:
aborting only in the parent request finalizer can deadlock while child-first
teardown waits on that read. Returning early closes the attempt. Status-only
callers use an explicitly scoped `open()` and publish their result after scope
cleanup, without waiting for an unneeded body to reach EOF.

Native fetch/read failures become TransportError with the original cause;
construction, preparation, parser, storage and consumer failures remain original.
Non-2xx status is data for the caller. Preserve existing redirect selections and
CESR media negotiation; add no reconnect, retry or failure swallowing.

## Caller disposition

| Caller                                              | Final operation and retained behavior                                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary HTTPMessenger/Poster sends                 | Finite request; complete response before successful delivery. Prepare each frame separately. Preserve framing, refusal detail and 406 negotiation.                      |
| HTTPMessenger query                                 | Open response; select CESR or existing bounded SSE handling after headers. Keep protocol consumption inside the scope.                                                  |
| Mailbox poll/debug and header timeout helper        | Open response; preserve header acquisition timeout, SSE idle/window deadlines and cancellation.                                                                         |
| Oobiery                                             | Open response; inspect status/media type, consume JSON finitely or process CESR incrementally. Retain queued ownership through failure and cleanup.                     |
| DID webs artifacts                                  | Open response; retain header-only alternate-URL decisions. A body/parser failure must not restart at another URL. Keep CESR incremental intake and finite JSON parsing. |
| Authenticator and verifier webhook                  | Scoped open; status determines the existing outcome after unread-body cleanup. Do not change these to require body EOF.                                                 |
| Witness receipt POST                                | Open response because 202 currently permits early cancellation; read complete bytes for 200/refusal and preserve media negotiation.                                     |
| Witness receipt GET and mailbox admin JSON commands | Finite request; interpret returned bytes after cleanup.                                                                                                                 |
| Runtime exports, Tufa consumers and test HTTP peers | Adopt both explicit contracts atomically; remove the former streamed HttpResponse API without aliases.                                                                  |

Shared CESR framing remains a small preparation helper. Do not introduce callbacks
or a request executor solely to make finite and streaming callers look identical.
Retain source-sequence iteration separately from HTTP upload: an HTTPMessenger
source can still yield several messages, each prepared before its own request.

## Phase 0 — Confirm the deletion boundary

Before source edits, verify the baseline, all body types and the caller table.
Inspect current supported Node/Deno versions and reuse the existing native-server
tests. Add only missing native evidence needed for cancellation before headers,
cancellation during a blocked read, early body exit and truncated finite responses.
Use gates/events to control ordering rather than sleeps or retry loops.

Exit: each proposed retained state variable has an actual lifetime responsibility;
each proposed test protects caller behavior or a documented native contract. No
benchmark project or exhaustive fault Cartesian product is required.

## Phase 1 / PR 1 — Prepare bodies and delete upload ownership

1. Move CESR body-mode materialization to the producer before `http.request()`.
   Keep header-mode bytes and per-frame sequencing unchanged. Construction or
   preparation failure must perform no HTTP request and retain source ownership.
2. Narrow HttpRequestInit and remove HttpBodySource, uploadController, uploadSignal,
   upload/uploading/uploadClosing/uploadFailure, closeUpload, the custom upload
   ReadableStream and upload-driven duplex handling.
3. Keep response ownership and completion behavior intact in this cut. Remove
   upload fault restoration because producer failures now precede fetch.
4. Replace tests for lazy upload timing and simultaneous producer/platform failure
   with wire-equivalence and preparation-failure assertions at the real producer.

Exit: HTTP only receives prepared bodies; one frame's source work completes before
its network attempt. Header/body-mode wire output and cancellation remain correct.

## Phase 2 / PR 2 — Separate finite results from scoped streaming

1. Introduce `open()` as the explicit current response scope. Make `request()`
   perform finite consumption and cleanup before returning its byte result.
2. Migrate the caller table, exported types and injected HTTP peers in the same
   cohesive cut. Do not add compatibility aliases or temporary public adapters.
3. Use ordinary loops for finite bytes and preserve the small streaming body
   reader for actual streaming/status-only users. Keep native failures classified
   at the native call, with interpretation outside that catch.
4. Remove obsolete finite read helpers and closeResponseBody where scoped exit
   now expresses cleanup. Keep an explicit helper only if it still removes actual
   repeated lifetime policy; never rebuild another response owner at call sites.

Exit: finite results outlive the request safely, streaming results cannot escape
their scope, and existing header/status decisions occur at their original time.
No second fetch implementation or parallel cleanup pipeline exists.

## Phase 3 / PR 3 — Reduce response lifetime state

1. Rely on native Fetch abort to stop network/body work. Use one request
   cancellation owner, one optional reader and only the pending work needed to
   join actual operations. Centralize finalization in a straightforward finally.
2. Delete redundant cancel listeners, closing/closedResponse bookkeeping and the
   reported-error history where native contract/evidence makes them unnecessary.
   Do not rename the same state into a new class or lifecycle framework.
3. Preserve cancellation ordering across Effection children: signal interruption
   before joining pending reads, then release the reader before store teardown.
   Joining means application-owned I/O and consumer work have settled; Fetch owns
   connection pooling and does not promise physical socket closure per request.
4. Define a small failure rule: propagate the primary error; preserve a genuinely
   distinct cleanup error locally if one occurs. Ignore only the owned abort or
   the same already-observed native error. Do not use a blanket catch, suppress
   all failures after signal.aborted, or maintain a general error ledger.
5. Retire fixtures requiring arbitrary replacement Fetch behavior: resolving fresh
   headers because abort fired, exact aggregation of synthetic cleanup failures,
   and undefined cleanup rejection. Test clients implement the narrow contract;
   native behavior is qualified against native Fetch. An unusual native defect
   earns only a small local remedy backed by a real reproducer.

Exit: a maintainer can trace validate -> fetch -> consume -> cleanup in order.
Every remaining promise/controller/flag has a concrete cancellation or acquisition
race to own; reduced line count alone is not the acceptance criterion.

## Validation and delivery

Run focused HTTP, CESR egress, httping, HTTPMessenger/query and SSE tests first.
Cover successful EOF, delayed/truncated body, refusal text, existing media
negotiation, cancellation before headers and during reads, early status-only exit,
and cleanup before store closure. Preserve parser/storage errors as such.

Qualify the affected caller owners: witness/receipts, query/mailbox/KRAM,
OOBI/DID fallback and partial acceptance, authentication/webhooks, Tufa admin and
installed-package declarations. Keep the existing integration participant topology.
Use the maintained witness-main, DID and KRAM interop owners as applicable; do not
replace them with a new combined harness. Run native boundary cases on the minimum
supported Node and current supported Deno versions.

Each PR includes formatting, lint, quality and applicable package checks plus a
release-impacting changeset for removed/changed public APIs. Use
[scoped CI](../../reference/PR_TEST_SCOPE.md), crediting relevant local checks only
against their exact source revision. Organize cohesive commits and PRs in the
order above when implementation is authorized. Run the full maintained suite
after the final implementation PR is merged, then repair any regression before
claiming completion. Do not publish a release as part of this refactor.

Update ADR-0013, INGRESS_AND_EGRESS, runtime/DID learnings and plan status as their
claims change. Keep class, member, public/private function doc comments and flow
comments readable for maintainers; add no documentation tests or lint rules.
Run ENCTX index maintenance after final file/Git changes at each handoff and
require a healthy result. Record remaining risk honestly: finite allocations,
supported runtime versions and the retained streaming paths; no promised exact
final-wire retry, remote acceptance or exhaustive simultaneous-fault resilience.
