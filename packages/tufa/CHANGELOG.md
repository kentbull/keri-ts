# @keri-ts/tufa

## 2.0.0

### Major Changes

- fb981fa: Remove Reactor's unused complete-record queue and its runtime worker. Callers await
  process or processBytes directly; queued-ingress methods, ingestKeriBytes and the
  queue-only RuntimePendingState.ingress field are removed without compatibility shims.
- 9b06d9e: Replace query key-state Channels with an explicitly supplied command-owned cue Deck and one KeyStateNoticer consumer. Remove AgentRuntime.keyStateUpdates and its subscription contract; pass queryCues to runAgentRuntime before I/O. A matching notice selects one accepted catch-up target without broadcast or moving-target task replacement.
- f5c88b0: Replace RuntimeHttpClient.fetch with scoped request ownership. The composed FetchHttpClient validates Request before fetch and owns upload, response-body transport failures and joined cleanup. HttpResponse exposes status, headers and a cancellable byte source instead of a native Response. CESR helpers require an explicit HTTP client, and obsolete raw response-handle APIs are removed without compatibility aliases. Migrate HTTPMessenger, mailbox/SSE, OOBI, receipt, DID-webs, webhook and Tufa callers to the shared error contract, eliminating client identity checks.
- 52f27ba: Remove the replaceable mailbox polling transport from MailboxPoller and runtime
  composition. Supply the HTTP client and clock directly; polling owns its concrete
  HTTP/SSE operation. Retire the exported transport types and adapter without aliases.
- b2d16d7: Use ordinary Baser ownership for OOBI cleanup and report completion only after shutdown.

  Remove `openOobiStore`, its options/store interface and the special existing-path
  selector. Use ordinary Baser ownership and `Baser.oobis` with the canonical `>`
  separator. Preview does not delete selected rows, but normal writable startup can
  initialize tables and reload/clean habitat records. A missing database still
  fails, although normal path preparation may create empty directories. CLI JSON
  now reports complete/failed status after closure and preserves actual deletion
  counts when shutdown fails. Generic LMDBer `openExisting` remains non-creating.

- 8a22aa7: Separate completed finite HTTP requests from scoped streaming responses. HttpClient.request now returns complete HttpResponse.body bytes after cleanup; HttpClient.open lends HttpStreamResponse.body(signal) for streaming and status-only consumers. Migrate CESR sends, queries, mailbox/OOBI/DID workflows, receipt endpoints, CLI callers and injected clients without compatibility aliases.
- a87d8eb: Introduce HTTPMessenger with explicit HTTP/clock/protocol dependencies and input-owned Kevery/parser lifetimes. Query and receipt owners depend directly on ProtocolProcessor rather than Reactor; finite/streamed sends share lower HTTP cleanup and framing. Remove the unused postCesrMessage wrapper and migrate constructor contracts without compatibility aliases.
- 0fba195: Use ordinary HTTP query acknowledgements and independently composed protocol receivers. Remove custom direct HTTP query replies, response policy options and the signed-packet retry backlog. Keep TCP reply processing and authorized mailbox SSE. Query commands fail their single deadline instead of falling back to OOBI and displaying stale state.
- 2171aaa: Remove the persisted CESR body preference and CLI flags. Select ordinary signed POSTs or finite opaque stream PUTs explicitly, retain raw TCP and query semantics, and qualify mixed-genus forwarding introductions without changing signed bodies.
- 3e19c78: Rename multisig send reporting to explicit message identities: `GroupSendResult`, `GroupMessageRef`, `messages`, `exnSaid` and `payloadSaid`. Delivery reports completed transport destinations rather than participant approval; `join --said` continues selecting the outer coordination EXN.

  Return one `RegistryResult` or `IssueResult` per credential operation, with optional group coordination facts, instead of `CredentialCreateResult.output`. Keep signed-message and per-message delivery helpers internal to the application module. Affected KERI CLI helpers return results, while Tufa adapters own final JSON and identifier presentation. Preserve protocol bytes, signing order, routing and acceptance behavior.

- c3655de: Use KERIpy ordinary Poster traversal and finite-stream first-role delivery with random relay selection. Initial IPEX workflows use the queued stream operation while joins retain ordinary sends. Remove auto/direct/indirect delivery selectors, CLI flags and obsolete endpoint projection APIs.
- bb65d89: Move reply delivery progress and joined transport cleanup from Respondant to Poster.
  Callers now drive Poster.process(), inspect Poster.hasPending, and close Poster;
  Respondant constructs and publishes replies without owning transport services.
  Existing reply ordering and retry behavior are preserved for this ownership step.
- f1bbeb2: Move recipient alias resolution from Poster to Organizer at the producer boundary.
  Remove Poster.organizer, resolveRecipient, retry and discard without aliases.
  Concrete delivery outcomes and retained terminal failures remain available.
- 27fdd28: Route all Poster sends through its queue and independent deliverDo worker. Producers
  publish signed source messages with send({ src, dest, topic, msg }) and optionally
  request notification, then wait for the returned event's concrete sent/failed outcome.
  HTTP and witness ingress publish delivery work without running the Poster worker.

  Remove Poster.sendBytes, Poster.sendExchange, Poster.sendPreparedExchange,
  ExchangeSendResult and RawCesrSendResult. Exchange construction moves to
  createExchangeMessage in exchange-messaging; sendExchangeMessage uses the queued
  worker and accepts dest instead of recipient. Standalone callers must run a Poster
  worker when awaiting queued delivery. Existing cue cursor scheduling and exact-packet
  retry remain unchanged until the next simplifying refactor.

- 20da8ba: Remove automatic consumption of locally stored mailbox messages by runtime hosts. MailboxPoller now retrieves messages only from mailbox endpoints over HTTP/SSE; MailboxPollBatch drops source and requires the provider eid. Use direct HTTP/TCP delivery or explicit protocol intake for immediate recipient processing. Provider storage, authorized forwarding, SSE serving and remote polling remain available.
- 4dc3939: Separate WitnessInquisitor query sending from scoped KeyStateNoticer, LogQuerier, SeqNoQuerier and AnchorQuerier operations. Await accepted-state completion instead of registering generic runtime continuations; composition routes live saved key-state facts through Effection's channel.

  Move query command composition and final display into Tufa. Remove queryCommand from keri-ts/cli and make HTTPQuery an internal transport operation. Preserve current wire/framing, signer/attester selection, finite anchor recovery and joined transport cleanup during this ownership refactor.

- 5c56360: Extract ProtocolProcessor from Reactor. Reactor owns byte input and an independent Kevery; protocol dispatch, cue publication, correlation and escrow scheduling belong to their actual shared owners. Require explicit shared protocol dependencies for Poster/TCP replies, expose composed exchange and reply owners, and remove Reactor dispatch/escrow/handler proxy APIs.
- b2ae804: Yield raw wire from Hab.processCuesIter, rename ReplayCue.messages to msgs and runtime.poster to postman, and remove CueEmission and reply cursors. Respondant publishes complete local replay batches atomically. Poster delivers events FIFO, retains whole failed events with partial successful deliveries, and exposes explicit retry/discard instead of automatic exact-packet retries.

  Remove the unused immediate sendSignedExchangeMessage API and its ExchangeTransport endpoint policy. Standalone exchange sends use the queued sendExchangeMessage helper.

### Minor Changes

- e216314: Simplify finite credential import to dispatch each frame once and let protocol
  escrows recover local dependencies. Replace the public target/status taxonomy
  with saved, complete and unaccepted results; accepted state determines completion.
  Remove escrow progress tracking and bound ordinary recovery sweeps with the post-EOF deadline
  exposed through tufa vc import --settlement-timeout-ms, defaulting to 5000 milliseconds.
- 2472a4d: Complete group NoBackers credential revocation through `/multisig/rev` approval and member fanout. Reuse the original REV/anchor across restart, validate credential/registry/issuance authority before signing, and deliver completed evidence from the elected historical anchor signer.

  Breaking: `revokeCredential` now takes Regery, Reactor, Poster and selection options; explicit recipient delivery uses `deliverCredentialRevocation` after publication. `vcRevokeCommand` returns typed data for Tufa to render after closure. CLI JSON distinguishes accepted REV, completed publication, member deliveries and business deliveries; pending revocation does not write a completed export.

- b82f698: Settle authenticated grant evidence in the local wallet before authoring admits by default. Admit and join commands keep one host alive through wallet/approval waits and delivery; group members independently check their wallet before a fresh admit contribution. Support bounded pending results, stable group approval resume and elected delivery to the accepted grant sender.

  Grant files must pass valid EOF and ordinary exchange authentication before a response is signed. `--no-wait` now reaches the command handler and skips only the saved-credential requirement, reporting `saved: false` when appropriate. Admit results expose nullable `admit`, credential/saved facts, completed deliveries and optional group completion; Tufa formats these after cleanup. New `--timeout`, `--approval-timeout` and `--gvrsn` admit options select the existing finite waits and attachment context.

- f4c6004: Support group apply, offer, agree and spurn authoring with member approval/fanout, exact wrapper selection and elected external delivery. A single command host owns progress and cleanup. Persist local single-sig conversation history before delivery, validate accepted predecessors and known counterparties before signing, and collect stored peer child proofs during explicit join. These four commands accept `--approval-timeout` (default 60 seconds; zero returns pending group state) and report group status and message identities separately from transport destinations. Grant/admit settlement remains a separate release cut.
- 41011c7: Add offline tufa oobi clean with read-only preview, exact-key apply and honest partial-failure reports.
- 976b0f1: Move the verifier webhook application, its business policy and workflow database into Tufa. Import VerifierAgent and createVerifierCueBaser from @keri-ts/tufa/runtime. The keri-ts runtime application-agent and CLI verifier command exports are removed without aliases; protocol Verifier, IPEX and evidence APIs remain in keri-ts. Preserve the existing legacy-Reger application profile and workflow storage encoding.

  Verifier run --once now reports final success only after its cue store, runtime and Habery close. Unexpected shutdown failures propagate, preserving simultaneous operation/cleanup failures. HTTP success still requires joined response cleanup before a local delivered marker.

### Patch Changes

- ac932d7: Validate endpoint, signing, query, DID and witness command options before opening stores. Reject malformed option types and mixed-type repeated lists instead of casting or discarding values. Resolver ports must be decimal integers in the supported range; explicit empty query anchor paths fail instead of silently selecting a different query.
- 3ea5a31: Validate operator and publication command inputs before resource access. Reject mixed-type exchange/data lists, malformed storage flags, invalid notification counts and numeric option coercion. Preserve decimal input spelling through notification, database dump and demo webhook dispatch.
- aa8002a: Run registry inception and credential issuance under one command-owned host and observe actual local TEL publication, with a 60-second default wait and explicit zero-timeout pending output. Report publication independently from business acceptance and saved credentials; VCP/ISS join reports the exact TEL coordinates. Record credential proposers' exact local wrappers before peer delivery, and process independently counted local/peer proofs as complete messages during approval and resume. Credential workflow APIs now take a shared Reactor before Poster. Honor ordinary establishment-only anchoring and stored registry policy after reopen. Refuse registry-name replacement and issuance with an alias that does not control the registry.
- d8a0f26: Validate credential, IPEX and verifier options before storage. Reject malformed
  list members and coercible timeout values while preserving omitted defaults and
  supported zero/fractional waits. Validate credential JSON sections before effects.
- 505859b: Validate group VCP/ISS business evidence before member approval or signing: bind issuer, registry, credential, source triple and exact anchor; leave missing registry/schema/predecessor evidence pending and refuse conflicting aliases before KEL mutation. Establishment-only group credential workflows now author rotation anchors, using participants' prepared next keys. Reuse read-only TEL validation without constructing processors or writing escrow for preflight.
- c257d71: Select multisig approval by the accepted outer EXN SAID even after its notification is consumed. Enforce the requested group before prompting or signing, and use stored protocol evidence rather than notification attributes for route selection.
- 6c8e597: Pass concrete registry, transport, signing and contact-store dependencies into
  application operations. Remove the runtime registry lookup export and update
  credential/DID workflows, Notifier and Organizer constructors without compatibility
  shims. CLI and HTTP adapters validate required capabilities before protocol effects.
- 9b2ed3e: Compose initialization and inception bootstrap from OOBI/authentication and minimal KEL/reply processing. Ordinary resolution reports response processing, while protocol owners retain unaccepted evidence in escrow and authentication requires current authorization. Complete selected current attempts, resume in-flight work and multi-OOBI children, ignore unrelated historical work, and join I/O before returning or reporting command success. Reconstruct reply signature groups from their stored ordinals so missing signer KEL evidence survives escrow retry.
- 0c37762: Reject uncoordinated group aliases in ordinary event, exchange, challenge, location, query and DID-binding commands before business signing or mutation. Direct interaction/rotation users to multisig commands, refuse occupied inception aliases, and label raw group signatures as partial member contributions.
- dc01225: Validate host ports, schema paths, mailbox cursors and challenge options before
  effects. Preserve mailbox reset index -1 and distinguish omitted timing values
  from explicit zero or fractional challenge waits.
- 595b193: Register exact group IPEX wrappers locally before transmission, reuse their original outer EXNs on resume, and reuse cryptographically verified member contributions from accepted or partial-signature evidence after restart and rotation. Explicit selection repairs an interrupted wrapper index through ordinary replay. Preserve initial StreamPoster routing and ordinary approval sends. Group grant/join results now include `messages` with recipient, `exnSaid` and `payloadSaid`, allowing selection of the original outer EXN independently of business completion or completed transport destinations.
- 0c1088e: Return typed IPEX command snapshots after owned worker and database cleanup, and move their final JSON projection into Tufa. Send, grant, admit, poll and join helpers expose ordinary EXNs and concrete outcome data rather than printing success inside resource scopes. A close failure prevents final success output without implying that completed transmission rolled back. Poll-discovered join output includes the selected outer EXN SAID. Signing, wire, routing, acceptance, file output and existing worker composition are unchanged.
- 8d85fa5: Validate group IPEX conversation parties and predecessors before a fresh approval. Grant authoring/approval requires the local verified credential and checks supplied source proofs against its accepted issuance and issuer KEL. A presenting group need not be the issuer. Valid minimal legacy grants remain supported when their authority is already local; missing member evidence stays pending without signing or fanout.

  Preserve a stored grant's actual pathed proofs during delivery instead of replacing them with newly assembled artifacts. Join results and JSON now separate local `approved` state from child acceptance; `approval-pending` reports an unmet local preflight gate. Breaking-change guidance records the additional public approval result fact.

- 1c94381: Keep one command host running through grant intake, group approval and elected delivery. Validate selected agree predecessors before signing, retain local single-signature grant history before export or delivery, and expose actual completed transport destinations in grant results and CLI JSON. Pending group evidence does not produce a completed grant export. Credential holders can present a saved credential without being its original issuer.
- 8daaee8: Use the habitat's accepted group contribution when creating IPEX endorsements, including when a member has rotated ahead of the group. Preserve recorded approvals on resume. Reconstruct stored grant path/proof material without duplicating CESR counters, so recipients can import the credential evidence after the sender reopens its database.
- cebca90: Validate inception and rotation options before opening stores. Preserve omitted flags through option-file merging, apply defaults afterward, and honor explicit false, zero and empty-list overrides. Reject malformed counts, thresholds and list entries instead of coercing or filtering them.
- fa8c101: Validate multisig command options and every configured member before opening stores. Reject malformed member/witness lists and supplied approval timeouts, retain fractional-second waits, and preserve rotation-file data when flags are omitted. Explicit empty data remains an override.
- 6329e23: Route native RIP/BUP evidence through ordinary protocol intake and recover foreign registry escrows after reopen. Preserve pending IPEX grants while the first issuer update or source-referenced presentation update is missing. ProtocolProcessor now borrows RegistryObserver instead of the local Regery manager; AgentRuntime retains database ownership.
- 051e077: Require prepared HTTP request bodies and remove asynchronous upload-source support. CESR body-mode delivery now serializes each complete frame before starting its request, keeping source failures outside native transport classification and eliminating upload lifecycle machinery.
- 18694a0: Require complete successful HTTP response bodies and refuse redirects without replay. Complete transmit-only TCP at local drain with joined cleanup, preserving duplex receive and half-close behavior. Retain native transport failures with their causes and let Poster continue other destinations and queued events without swallowing construction or cleanup errors.
- d11497f: Match KERIpy query endpoint selection and poll both authorized mailbox providers and current witnesses. Remove the mailbox-only query fallback and the unused Habery argument from mailboxPollEndpoints.
- b2e1543: Serve OOBI streams with the media label recognized by pinned KERIpy v1 and main. Qualify bidirectional stale-state query recovery through public Tufa/Python commands and independent mailbox receivers across all three release peers.
- 85cf1f8: Remove autonomous legacy TEL signing, collection/hosting and backed-registry application authoring, including the private endorsement-choice table, runtime request flow/worker, hosting options, agent --backer-alias, registry --backers and Registry.rotate. Registry application options now express only NoBackers authoring and ordinary establishment policy.

  Retain external legacy backed evidence decoding, exact historical quorum verification, observer escrows/retries, replay and credential presentation. Issuer multisig and KEL witnessing remain separate supported responsibilities. ADR-0014 rejects reintroduction without a newly justified requirement; the reference report preserves the retired design, and the 2.0.0 breaking guide lists removed APIs. No compatibility wrappers or migration machinery are retained.

- 50e3196: Resume recorded multisig KEL, reply, registry-inception and issuance approvals from LMDB without prompting or signing the group contribution again. Reuse original recipient EXNs during explicit resend, keep pending thresholds honest, and preserve historical membership. Fix exchange replay's doubled pathed-material counters.
- b1a51d8: Reserve keyStateSaved for validated and persisted remote KSN replies. Ordinary KEL acceptance no longer emits a remote-notice cue; query workflows wait for a genuine saved KSN before comparing its target with accepted local state.
- 6f555aa: Share initialization and inception bootstrap ownership, move OOBI/authentication inspection to direct Baser dependencies, and consolidate primitive option shape validation. Keep initialization credential policy local and replace inception's unused result queue with a directly awaited command scope.
- 0d6780e: Validate init encryption choices before stores open, hide passcode input, and remove implicit temporary fallback.
- e142a57: Use parsed request attachment context for legacy TEL replay, serving v1-compatible source seals/counters without a v2 selector to unselected legacy requests while retaining explicit v2 framing. Preserve signed bodies and proof meaning.

  Replay APIs now honor the selected version exactly and expose UnsupportedTelReplayError instead of silently raising it. TCP confines this expected refusal to the requesting connection and reports unsupported-replay locally; whole-cue responders publish nothing from an incompatible cue. No remote refusal protocol is added. See the 2.0.0 breaking guide for iterator-prefix and callback result changes.

- ee6a54a: Report actual per-pass verifier business-policy refusals in the existing rejected result field. A refusal still sends no webhook and does not invalidate or remove accepted protocol credential evidence; workflow expiry and notification behavior are unchanged.

## 1.0.0

### Breaking CLI and host changes

- Use the same concrete host workers for finite commands and long-lived agents;
  replace polling-turn controls with elapsed timeout options and joined shutdown.
- Return endpoint-role proposals as recipient/SAID records instead of a misleading
  single message identifier. Select actual member signers and hosted identities
  explicitly; do not expose internal signatory/keeper identities by default.
- Remove budgeting flags, duplicate runtime drivers and unsupported delivery
  acknowledgements. Preserve signed endpoint authorization, mailbox routing,
  protocol caches and actual request/response ownership.

### Correctness and packaging

- Preserve explicit host/runtime/protocol-handler package boundaries, generated
  export/bin targets and strict installed declarations.
- Keep DID artifact generation/resolution, witnessed/group workflows and mailbox
  IPEX on the supported KERI runtime operations. Final dependencies advance to
  cesr-ts 1.0.0 and keri-ts 1.0.0.

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
