# @keri-ts/tufa

## 0.12.0

### Minor Changes

- 047cd5f: Remove codec allocation estimates, decoded-body budgets, capacity callbacks and
  speculative CBOR extension refusals. Preserve exact body ownership, native codec
  semantics, malformed-wire provenance and actual CBOR decoder-state cleanup.
- c1b4392: Route cue records directly to query, mailbox and reply owners. Remove optional cue sink hooks and adapters; default queued queries now use concrete transport instead of silently retiring through a no-op sink.
- 5e26f8a: Process local endpoint and host startup records directly through protocol intake.
  Remove hollow per-Hab host seeding, the forwarding-only mailbox host wrapper and
  unused host context/no-HTTP configuration; retain explicit hosted-prefix selection.
- d733e52: Endpoint-role proposal results and CLI JSON now return `proposals: [{ recipient, said }]` identifying actual signed exchanges, replacing the misleading single `said` and `attachmentBytes` fields. Register each recipient-specific proposal before delivery and preserve separate durable retry routing.
- e850883: Remove AgentMode metadata and mode configuration. Hosts explicitly construct
  provider mailbox storage with enableMailboxStore or borrow an injected Mailboxer;
  ordinary command runtimes omit it. Use the same concrete components in every host.
- a4a4364: Separate IPEX group coordination from CLI timing and worker ownership. Timed
  completion and pending-proposal waits are private CLI orchestration.

  Use the ordinary host workers for IPEX waits and report fully settled mailbox
  batches/messages. Poll now uses `--timeout` seconds and join uses
  `--approval-timeout` seconds instead of polling turn counts and per-turn budgets.

- b57c2ec: Separate direct multisig approval from CLI scheduling. Timed waits and delegation
  completion belong to CLI orchestration; direct proposal approval does not start
  or drive background workers.

  Run each multisig command under one joined host lifetime. Multisig join now uses
  `--approval-timeout` in seconds instead of polling turn counts and per-turn budgets.

- 3c0386b: Remove nested exchange tree/copy budgets, stored ESSR byte/item caps and recipient
  crypto/concurrency quotas. Keep authentication, qualified framing, transactions,
  exact declared payload sizes and joined file/reader cleanup.
- d44aa3a: Remove cue-output reservations, combined preparation floors and prepared-emission ownership handles. Publish ordinary emission records after synchronous preparation, retain retryable wire and actual iterator/reader cleanup, and allow finite witness snapshots without application output quotas.
- 4b12067: Remove query-request byte reservations, preparation floors, metadata quotas and synthetic busy/refused admission. RuntimeDeliveries accepts concrete query records directly; signing and endpoint selection precede source removal, while failed transport and cancellation retain their existing retry and cleanup behavior.
- d097b1b: Remove parser cursor/tree/ESSR/input quotas, frame-credit ownership and intake
  source slots. Annotation, benchmark and byte collectors no longer accept input
  caps. Keep wire counts/extents, independent signatures, actual payload ownership,
  native backpressure, cooperative cancellation and joined source/file cleanup.
- 075f015: Remove payload collection and memory/file staging quotas and quota-bearing sink callbacks. Preserve exact declared lengths, owned byte/file lifetimes and joined cancellation cleanup.
- cd84470: Replace cue ownership and capacity accounting with ordinary Deck records across protocol producers, runtime consumers, query replies and mailbox correlation. Preserve post-commit publication, lazy replay and joined I/O cleanup; remove the former cue-credit and queue-limit APIs.
- bbe3eab: Remove OOBI, forwarding and KEL replay accounting limits and duplicate stored-reply size formulas. Preserve lazy replay horizons, proof ordering, framing and actual reader cleanup.
- c590d5c: Remove HTTP reply accounting and configured chunk copies. Keep pull-driven message streams and joined reader cleanup.
- 08bd4f4: Remove TEL replay limits, canonical pair inspection and native row size billing APIs. Preserve real wire settings, replay horizons, ordered iteration and owned native byte copies.
- 021cdbe: Remove Reactor's application callback gate. Dispatch returns processed evidence
  and its exact decision; protocol cues are correlated before application publication.
  Reply, query and request owners prepare and consume their own output directly.
- 3919b4f: Remove outbox sidecar acquisition, CLI flags, database selectors, and mailbox debug backlog output.
- e9eb1bf: Remove automatic durable outbox enqueue/retry and queued delivery results. Mailbox sends attempt each target and report any failure, including partial delivery, to the caller.
- 39a7ba1: Remove the shared ResourcePolicy, accounting errors and constructor options.
  Delete remaining client, Reactor queue/waiter, TCP listener and reply-proof work
  quotas. Preserve actual I/O cleanup, protocol state ordering and numeric guards.

### Patch Changes

- 5429fdb: Replace application error context bags with diagnostic messages and standard causes for actual underlying failures.
- ea8b5cc: Compose TCP receive/send tasks over actual socket resources in the application,
  remove TcpRead and the CESR Effection adapter/export, and delete TCP output quota
  formulas. Preserve half-close, native write backpressure, fixed deadlines and joined
  cleanup, including late source failures during cancellation.
- ae90b33: Replace progressive CESR traversal with one finite decoder that buffers complete
  counted enclosures before delivery. Carry ESSR as ordinary ordered Texters through
  dispatch, verification, persistence and replay; remove parser staging, Cursor,
  FrameIntake and ordinary-frame disposal. Preserve framing, padding, genus scopes,
  independent nested proofs and actual transport/storage cleanup.
- c5cd6c8: Run challenge verification over joined host workers so mailbox polling progresses
  independently of the command's response deadline.
- 34c2555: Compose admitted cue storage from owned handles and expose legal cue queue operations instead of inheriting destructive Deck methods.
- 018cea3: Own Reactor input cancellation and cleanup directly, decode finite receipts and
  approved legacy multisig children synchronously, and scan grant files without
  a frame-channel bridge while still requiring valid EOF.
- 46bf809: Run delegation approval under one joined host worker lifetime instead of serial
  runtime turns, preserving witness-backed commitment and authorizer seal ordering.
- eac30e2: Make did:keri resolution a synchronous accepted-state projection. CLI commands own
  finite introduction workers, and HTTP requests observe their existing host's work
  with an elapsed deadline instead of pumping the runtime for five turns.
- 3ed065b: Make DID document projection depend on accepted Habery and registry state instead
  of AgentRuntime. Active designated-alias queries now take their registry owner.
- 4596c98: Move HTTP, witness and multisig replay parsing into their concrete input scopes.
  Remove the HTTP parser-options bag and preserve foreign cleanup failures while
  joining cancellation, without an Effection frame-channel dependency.
- e58bbc4: Curate the runtime API with explicit operation and data exports, and remove npm deep-import patterns for implementation directories. Use the package root, runtime or db entrypoints; cli remains the separate Tufa command-helper boundary.
- 5f526b8: Separate demand-driven source/parser lifetime into the runtime FrameIntake owner and remove Reactor.frames; migrate HTTP, witness and TCP edges to the same owner.
- 948f254: Honor the caller HTTP signal through headers and response-body ownership, keeping
  external cancellation distinct from timeout. Report late foreign AbortError body
  failures from the Node host instead of mistaking them for its own cancellation.
- 24f2c1f: Remove HTTP request reservations, client Fetch/SSE and attachment-header size
  ceilings, and static-artifact allowances. Retain native backpressure, poll
  and request cancellation, file extent correctness and joined I/O cleanup.
- f772d43: Preserve the configured attachment genus across credential grant construction and stored artifact intake. Add `--gvrsn` to holder polling and verifier runs so legacy grant envelopes can carry genus-2 child proofs through verification.
- 433ced2: Preserve independent I/O failures reported while a cancelled operation joins its
  cleanup. Abort the concrete source before child teardown, join its pending work
  through the resource lifetime, and suppress only that operation's own abort reason.
- ae663a9: Bind external input cancellation to the consuming operation so waiting protocol
  turns and active HTTP response consumers stop and join cleanup. Separate dispatch
  choices from input lifetime and check cancellation at input consumption boundaries.

  Remove parser and finite annotation cancellation options. Benchmark and CLI
  consumers own cancellation directly; protocol decoding takes only its byte source.

## 0.11.0

### Minor Changes

- 2f238e9: Replace collected KEL replay cues with reopenable message sources and stream
  HTTP replies with bounded runtime-owned readers. Bound query requests and
  continuations, retaining failed deliveries for retry.
- aef51c0: Require Node 20.3 or later for generated npm packages. Node 18 is no longer supported; transport cancellation uses native AbortSignal.any.
- 96b197e: Initialize pinned sodium npm bindings with Node 18's native secure randomness when the global is absent.
  Declare Node 18.17 as the KERI/Tufa minimum required by their abort-signal composition.
- f515cf8: Use progressive parsing for asynchronous annotation, streaming CLI validation,
  and replay benchmarks. Bound finite annotation and benchmark input explicitly,
  preserve nested CESR/ESSR wire in annotation round trips, and own Tufa input and
  output through Effection scopes. Remove unused annotation hints and speculative
  parser-mode/partial-error benchmark flags.
- 4740ffe: Parse HTTP and file sources progressively within Effection scopes, serialize dispatch and cue consumption with bounded admission, and reserve direct query replies by query SAID. Cancel and join request readers and release staged frame payloads when their owning scope ends.
- c0e9445: Remove the synchronous CESR stream engine, feed/flush/reset API, parser event
  wrappers, unused KERI CESR re-export stubs, and atomic ESSR conversion adapter. Expose async finite parseBytes
  alongside progressive parse; use the same engine for complete KERI records and
  streamed grant-file inspection. Shorten benchmark API names to benchmarkParser,
  BenchmarkOptions, and BenchmarkResult; countFrames returns the single-run count
  directly. Preserve KERI/CESR/ACDC protocol versions.
- 17bff5b: Reject malformed attachment wrapper tails consistently. Replace the dispatch entrypoints with parseAttachmentGroup, remove parser recovery options and parser-related --compat flags, and migrate runtime callers. Opaque wire families and KERIpy filesystem compatibility remain supported.
- 8abb84a: Run dispatch and mailbox settlement as Effection operations before advancing ingress, pass the receiving mailbox identity explicitly, and cancel and join owned webhook I/O when its operation stops.

### Patch Changes

- d85fa42: Retain canonical Compactor descendants through compaction and expansion, and support path-directed disclosure closures. Add bounded Pather resolution for the IPEX disclosure prerequisite while keeping wire path construction independent of the traversal limit.
- 1692418: Resume bounded command-local mailbox polling across endpoints and habitats so an empty earlier long poll cannot starve queued proxy replay. Keep one absolute turn budget, sequential transport, durable cursor acceptance and joined cleanup.
- e97df52: Expose hosted DID JSON artifact construction independently and avoid generating discarded CESR replay for dynamic did.json requests.
- a1930f7: Atomically retain direct query replies through HTTP and queued target cleanup.
- 60fbf59: Separate ESSR admission refusal from verification rejection with typed recipient outcomes and explicit plaintext ownership transfer. Propagate unexpected I/O and key-store failures, classify raw sealed-box authentication narrowly, and dispose finished plaintext when handoff cleanup fails.
- 6019f5a: Preserve and independently verify exchange source seals and route-selected supplemental proofs through escrow, durable storage, and replay. Keep legacy v1 signature intake and nested IPEX guards while exposing typed route dependency escrow.
- 192ecff: Match frozen exchange proof admission and retry policy: require explicit evidence delivery, restrict new missing-state escrows, deduplicate queries, and preserve previously accepted authentication on incomplete redelivery. Clarify valid-factor results and selected supplemental ownership.
- c85823b: Preserve unexpected fetch/cleanup failures and close published replies on late request cancellation.
- e67d273: Transfer generic HTTP cues to the existing bounded delivery, mailbox correlation and pending-query owners before removing the source. Run network delivery outside Reactor and preserve each earlier query's exact authorization and request-local admission failure provenance.
- ab1821e: Serve OOBI replies through admitted lazy Hab message sources with bounded metadata and per-message preparation.
- e4e8b35: Raise the finite shared default stream ceiling to eight so KLI mailbox and witness long polls leave room for ingress and delivery. The 256 MiB byte ceiling, one decryption ceiling, configured-policy refusal and joined cleanup remain unchanged.
- a190518: Separate synchronous nested multisig body construction from byte parsing and wire preparation. Reuse parsed child frames without payload reads; retain bounded cancellable preparation and existing v1/v2 wire behavior.
- 9b1972f: Verify nested v2 IPEX disclosures and independent issuer evidence before durable exchange acceptance. Preserve dependency escrow and replay, add a verified observer registry store, and separate pure body construction from cancellable byte preparation. Presentation registries remain guarded pending receiver-owned KRAM intake.
- ef4491d: Support nested v2 multisig event and reply proposals with independent child commitments, durable local approval replay, and cursor-safe exchange escrow retry.
- 9a4c726: Use Node 18-compatible promises for transport drain and joined shutdown.
- 33b1921: Enable explicit optional KRAM runtime intake with scoped ready consumption, finite pruning and exact HTTP refusal handling.
- c8332a2: Parse enclosed nested messages as bounded parent-owned trees, preserving each child's body, signatures, genus, and payload resources. Dispose complete trees at ownership boundaries and reject nested runtime processing, serialization, and annotation explicitly until those consumers support their evidence.
- 2da7cc5: Defer query response parsing until guarded cue handling completes, stream mailbox SSE with owned readers and consumer backpressure, and bound finite document and admin response collection.
- d485e44: Make CESR frame completion independent of network chunk boundaries. Open
  attachment sets now wait for a following body, a complete enclosure, or explicit
  flush. Terminal partial attachments report shortage without emitting an
  incomplete frame; flush drains all complete frames in either emission mode.

  Remove the frameBoundaryPolicy option, policy exports, and deferred-frame
  wrapper. Update complete-record runtime consumers to finish parsing explicitly
  and keep multisig attachment sets open while appending peer signatures.

- 5ed6b87: Emit stored transferable receipts as indexed signature groups during KEL replay so current KERIpy can consume complete OOBI responses. Validate and escrow grouped replay receipts without imposing a controller signing threshold or losing following endpoint replies.
- 5e18dfa: Reserve shared runtime credit before HTTP frame preparation and retain it through joined transport cleanup, including the first asynchronous diagnostic cancellation.
- 1a3d433: Admit outgoing source parsers and query uploads through the runtime policy, retaining source and frame ownership through response consumption and joined cleanup.
- 894529a: Admit query wire preparation and queued request ownership through the shared runtime policy before acquiring lazy message sources.
- 4ed2f6a: Reserve shared runtime credit for lazy HTTP replay and distinguish temporary capacity refusal from configured size limits.
- 935952f: Retain shared ordinary-tree admission credit across parser delivery, nested ownership, consumer disposal and joined cleanup.
- a393238: Share runtime admission with witness delivery and join TCP socket cleanup before releasing its stream and byte credit.
- c3ff9d3: Serve static DID artifacts under shared admission with demand-driven file reads and joined response cleanup.
  Terminate and report streamed HTTP body failures after headers have been sent.
- 9d33d98: Process witness TCP input progressively under bounded connection admission, preserving refusal provenance and joined shutdown ownership.
- d8f19fc: Keep one deferred TCP query reply on its accepted connection through joined output or deadline.
- f171389: Return correlated immediate receipts and query replies on accepted TCP connections.
- 1d238bd: Serve ordered legacy TSN replies through their independently authenticated receiver routes and retain bounded HTTP response-pair ownership through source cleanup.
- 29f8143: Resolve advertised host kernel and protocol handler exports from actual generated npm output.
- 53b75a3: Apply sender allow/deny policy and proof prerequisites before v2 non-event dispatch. Preserve query requester identity and prevent refused requests from opening HTTP mailbox responses.
- 547c566: Verify supplied ACDC v2 registry chains, issuer anchors, and blinded state bindings
  with typed missing/reject outcomes and microsecond historical cutoff selection.
  Nested IPEX workflow integration remains guarded.
- 8108a95: Transfer witness cues to the existing delivery batch and consume borrowed emissions outside Reactor through joined cleanup. Finite wrappers return caller-owned wire snapshots capped at a local 8 MiB aggregate and captured cue-count limit; drains require the runtime source deck.
- 2a23a53: Return witness KEL query results as captured lazy messages and serve them with shared response admission, preserving selector order and per-event native preflight.

## 0.10.6

### Patch Changes

- 33645fd: Enter response-owner cleanup immediately when an operating-system signal requests HTTP shutdown, before waiting for active responses to drain.

## 0.10.5

### Patch Changes

- b407ed2: Close runtime-owned mailbox response streams before the Tufa HTTP host waits for active responses to drain.

## 0.10.4

### Patch Changes

- ce87fb3: Consume the KERI runtime release that closes active mailbox streams before LMDB shutdown.

## 0.10.3

### Patch Changes

- ea53199: Expose granular runtime module subpaths so Deno consumers can preserve least-privilege imports without eagerly initializing unrelated native and host modules.

## 0.10.2

### Patch Changes

- 2a2fa28: Resolve KERI runtime CESR imports through the published `cesr-ts` dependency so consumers receive one compatible set of nominal CESR classes and types.

## 0.10.1

### Patch Changes

- 8b4adce: Authenticate mailbox queries against the recipient's current signing threshold before streaming private messages. Reject foreign requester identities, forged signature material, insufficient or duplicate signature indices, and old-key queries after rotation while preserving public KEL query behavior.

  Recheck each exact HTTP mailbox request before correlating stream cues, returning 403 for invalid or currently unverifiable requests so an older cue cannot authorize different attachments.

- 16dbf0b: Publish the KERI database and protocol runtime surfaces and Tufa host embedding APIs required by downstream services.
- b1424e6: Keep HTTP shutdown signal handlers installed until the listener has finished draining, and join that drain when the host operation is cancelled. Repeated termination signals during cleanup no longer restore the default abrupt-exit behavior before HTTP ownership ends.
- 6b75316: Expose signed witness key-state replies at GET /ksn. Require the selected witness destination and fully witnessed accepted state before serving the existing KERI reply encoding.
- fdde61b: Add a `tufa db dump --map-size` override for inspecting large KERIpy LMDB environments.
- 3011934: Normalize structured weighted thresholds loaded from Tufa multisig inception files and prove the public nested-group workflow.

## 0.10.0

### Minor Changes

- 1c31b6e: Use new lifecycle context helpers for managing Habery, Regery, Hab, Runtime, and other objects CLI commands depend on'
- 85d5a53: Clean up mailbox and witness CLI and workflow architectural layering.

### Patch Changes

- d1ebfb6: Refactored the CLI layer to use a unified dispatch function, registerDispatchedCommand, for consistency of approach and style.
- 1f14f5c: Fixed the build process to use explicit public package boundaries and upgraded libsodium-wrappers to 0.8.4

## 0.9.1

### Patch Changes

- 961ddd7: Align did:webs keri.cesr generation with the Python did-webs-resolver artifact shape so controller KEL replay is emitted once before endpoint and designated-alias material.

## 0.9.0

### Minor Changes

- Add `tufa dws bind`, `tufa dws generate`, `tufa dws resolve`,
  `tufa dws resolver`, `tufa dkr resolve`, static/dynamic did:webs artifact
  hosting, and Universal Resolver `/1.0/identifiers` routing.
- 888bd90: Rename IPEX and multisig runtime CLI controls to `--approval-timeout`, `--poll-turns`, and `--poll-budget-ms`, and validate those values before command runtime startup.
- 888bd90: Add public multisig lifecycle commands plus multisig-aware VC and IPEX workflows, including group registry inception, credential issuance, grant approval, and counter profile selection.

### Patch Changes

- Add documentation for IPEX and VC features.
- 888bd90: Remove OOBI URL-derived endpoint hint persistence and reject missing Tufa startup endpoint config instead of synthesizing `/loc/scheme` or `/end/role/add` state.
- 888bd90: Add explicit multisig mailbox authorization support through `tufa mailbox add --multisig-mode` and share the group endpoint-role proposal path with `tufa ends add` and `tufa multisig rpy`.

## 0.8.0

### Minor Changes

- 6286759: Release the ACDC/TEL/IPEX implementation as v0.8.0 across Tufa, CESR, and
  KERI packages, including the end-to-end issuer, holder, verifier, KERIpy
  interop, credential-chain, revocation, and saidification workflows.

### Patch Changes

- b7fb4e0: Add registry-backed VC and IPEX CLI operations for schema import, registry
  management, credential create/list/export/import/revoke, and single-sig
  grant/admit artifact workflows.
- 9bd9030: Fix ACDC credential presentation proof serialization for KLI-issued
  credentials, add a separate Sally-style `tufa hook demo` webhook target, and
  cover KLI issuer -> Tufa holder -> Tufa verifier interop through the public
  CLI workflow.
- b0db7b1: Add KLI-holder and mixed KLI/Tufa credential-chain interop support, including
  bounded `tufa ipex poll` mailbox processing, KERIpy-compatible forwarded ACDC
  support payload handling, bidirectional revocation propagation, and I2I/NI2I
  mixed-chain verifier gates with a KERIpy IPEX message-length preflight for the
  known local `serializeMessage` quadlet-alignment bug.
- 1f82a5d: Add KERIpy-shaped multisig EXN coordination for registry inception, issue,
  revoke, replies, and wrapped IPEX proposals, including runtime registration,
  lead election, and `ipex join --auto` approval support.
- b9abf12: Add the ACDC/VDR foundation: credential mailbox routing, IPEX route handlers,
  schema data OOBI resolution and hosting, parser VDR dispatch seams, and the
  KERIpy-shaped Reger storage owner.
- 580bf65: Add a Sally-like verifier agent with durable verifier cue storage, grant-driven
  presentation processing, revocation webhook handling, schema-validator config
  support, and the `tufa verifier run` command.
- 205a9e9: Persist verifier revocation acknowledgements separately from issuance
  acknowledgements and rescan saved TEL state so `tufa verifier run --once`
  emits revocation webhooks correctly after credential imports in prior CLI
  processes.
- 9bd9030: Add a KLI-compatible `tufa saidify` command for in-place JSON SAD
  saidification, including schema `$id` support and KLI output parity coverage.

## 0.7.0

### Minor Changes

- Align KERI and Tufa with the 0.7.0 release train after the CESR CLI break so generated npm artifacts depend on the 0.7.0 package line.

### Patch Changes

- 87940ec: Move Tufa npm build, host health wait, version generation, and smoke-test
  helpers into checked shared scripts.
- 87940ec: Normalize the Tufa npm `bin.tufa` entry to a bare relative path so npm publish
  does not rewrite package metadata.
- 87940ec: Harden Tufa npm packaging by deriving module and CLI bin paths from DNT output
  and validating those targets in tarball and install smoke tests.

## 0.6.0

### Minor Changes

- Complete delegation communication support for interop release readiness, including notification-backed delegation flows, mailbox/reply processing fixes, and npm artifact build validation needed for staged publication.
