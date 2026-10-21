# keri-ts

## 2.0.0

### Major Changes

- fb981fa: Remove Reactor's unused complete-record queue and its runtime worker. Callers await
  process or processBytes directly; queued-ingress methods, ingestKeriBytes and the
  queue-only RuntimePendingState.ingress field are removed without compatibility shims.
- 3090e2e: Separate send-only messenger construction from HTTP query response ownership. Bind transport endpoints explicitly and use sendSource for ordinary message iteration; no old constructor or query-method compatibility shims remain.

  Construct ordinary or finite stream delivery explicitly with `messengerFrom` or
  `streamMessengerFrom`. Stream HTTP sends one opaque PUT and returns owned response
  bytes; stream TCP admits the full payload through the existing raw socket writer.

- d2ff334: Make EXN validation and commit synchronous after evidence preparation.
- 5d69134: Use pinned-main Baser's ordinary insertion-ordered Texter set for ESSR evidence.
  Remove `pinEssrs` and custom ordinal/first-representation rules. Duplicate values
  deduplicate and alternate fragmentations append, matching the reference's known
  reconstruction limitations; incoming digest and recipient authentication checks
  remain enforced. Legacy wire interoperability remains supported, while direct
  legacy LMDB interchange is deferred. See the 2.0 breaking-changes guide.
- 9b06d9e: Replace query key-state Channels with an explicitly supplied command-owned cue Deck and one KeyStateNoticer consumer. Remove AgentRuntime.keyStateUpdates and its subscription contract; pass queryCues to runAgentRuntime before I/O. A matching notice selects one accepted catch-up target without broadcast or moving-target task replacement.
- e9f6396: Make EXN escrow retry and retirement atomic before asynchronous cleanup.
- f5c88b0: Replace RuntimeHttpClient.fetch with scoped request ownership. The composed FetchHttpClient validates Request before fetch and owns upload, response-body transport failures and joined cleanup. HttpResponse exposes status, headers and a cancellable byte source instead of a native Response. CESR helpers require an explicit HTTP client, and obsolete raw response-handle APIs are removed without compatibility aliases. Migrate HTTPMessenger, mailbox/SSE, OOBI, receipt, DID-webs, webhook and Tufa callers to the shared error contract, eliminating client identity checks.
- 52f27ba: Remove the replaceable mailbox polling transport from MailboxPoller and runtime
  composition. Supply the HTTP client and clock directly; polling owns its concrete
  HTTP/SSE operation. Retire the exported transport types and adapter without aliases.
- e216314: Simplify finite credential import to dispatch each frame once and let protocol
  escrows recover local dependencies. Replace the public target/status taxonomy
  with saved, complete and unaccepted results; accepted state determines completion.
  Remove escrow progress tracking and bound ordinary recovery sweeps with the post-EOF deadline
  exposed through tufa vc import --settlement-timeout-ms, defaulting to 5000 milliseconds.
- b2d16d7: Use ordinary Baser ownership for OOBI cleanup and report completion only after shutdown.

  Remove `openOobiStore`, its options/store interface and the special existing-path
  selector. Use ordinary Baser ownership and `Baser.oobis` with the canonical `>`
  separator. Preview does not delete selected rows, but normal writable startup can
  initialize tables and reload/clean habitat records. A missing database still
  fails, although normal path preparation may create empty directories. CLI JSON
  now reports complete/failed status after closure and preserves actual deletion
  counts when shutdown fails. Generic LMDBer `openExisting` remains non-creating.

- ef148de: Simplify TCP send operations to return completion; remove unused result variants and counters while preserving reply processing and joined cleanup.
- 6c8e597: Pass concrete registry, transport, signing and contact-store dependencies into
  application operations. Remove the runtime registry lookup export and update
  credential/DID workflows, Notifier and Organizer constructors without compatibility
  shims. CLI and HTTP adapters validate required capabilities before protocol effects.
- 1ab1bd3: Require explicit HTTP, clock and mailbox transport collaborators in delivery owners and explicit clocks in TCP/SSE operations. Remove dependency-bearing options and mailbox request fields.
- 2c5d3d1: Require explicit HTTP and verifier dependencies instead of constructor services options. Replace the RuntimeHttpClient alias with HttpClient and export the standalone runtime clock contract.
- 54e7f3c: Require HTTP, clock and mailbox transport in createAgentRuntime. Remove RuntimeServices, defaultRuntimeServices, partial resolution and services options; expose the individually selected HTTP/clock references to application callers.
- 8a22aa7: Separate completed finite HTTP requests from scoped streaming responses. HttpClient.request now returns complete HttpResponse.body bytes after cleanup; HttpClient.open lends HttpStreamResponse.body(signal) for streaming and status-only consumers. Migrate CESR sends, queries, mailbox/OOBI/DID workflows, receipt endpoints, CLI callers and injected clients without compatibility aliases.
- a87d8eb: Introduce HTTPMessenger with explicit HTTP/clock/protocol dependencies and input-owned Kevery/parser lifetimes. Query and receipt owners depend directly on ProtocolProcessor rather than Reactor; finite/streamed sends share lower HTTP cleanup and framing. Remove the unused postCesrMessage wrapper and migrate constructor contracts without compatibility aliases.
- 0fba195: Use ordinary HTTP query acknowledgements and independently composed protocol receivers. Remove custom direct HTTP query replies, response policy options and the signed-packet retry backlog. Keep TCP reply processing and authorized mailbox SSE. Query commands fail their single deadline instead of falling back to OOBI and displaying stale state.
- 2171aaa: Remove the persisted CESR body preference and CLI flags. Select ordinary signed POSTs or finite opaque stream PUTs explicitly, retain raw TCP and query semantics, and qualify mixed-genus forwarding introductions without changing signed bodies.
- 3e19c78: Rename multisig send reporting to explicit message identities: `GroupSendResult`, `GroupMessageRef`, `messages`, `exnSaid` and `payloadSaid`. Delivery reports completed transport destinations rather than participant approval; `join --said` continues selecting the outer coordination EXN.

  Return one `RegistryResult` or `IssueResult` per credential operation, with optional group coordination facts, instead of `CredentialCreateResult.output`. Keep signed-message and per-message delivery helpers internal to the application module. Affected KERI CLI helpers return results, while Tufa adapters own final JSON and identifier presentation. Preserve protocol bytes, signing order, routing and acceptance behavior.

- 32acb96: Make HTTP query response ownership explicit and remove injected response consumers from send-only CESR egress, preserving cancellation and cleanup failures.
- c3655de: Use KERIpy ordinary Poster traversal and finite-stream first-role delivery with random relay selection. Initial IPEX workflows use the queued stream operation while joins retain ordinary sends. Remove auto/direct/indirect delivery selectors, CLI flags and obsolete endpoint projection APIs.
- 44cd60d: Give protocol inputs explicit owners and endpoint-role proposals narrow dependencies.
- 29cd6b2: Require explicit Poster constructor dependencies, name its mailbox store mbx, and rename assertOpen to ensureOpen. Remove redundant producer lifecycle checks while preserving admission and pre-production guards.
- bb65d89: Move reply delivery progress and joined transport cleanup from Respondant to Poster.
  Callers now drive Poster.process(), inspect Poster.hasPending, and close Poster;
  Respondant constructs and publishes replies without owning transport services.
  Existing reply ordering and retry behavior are preserved for this ownership step.
- 051e077: Require prepared HTTP request bodies and remove asynchronous upload-source support. CESR body-mode delivery now serializes each complete frame before starting its request, keeping source failures outside native transport classification and eliminating upload lifecycle machinery.
- dd3e7d2: Remove Poster.resolveBytesRoute and make route selection and target preparation
  private. Tests and callers use queued message admission and accepted endpoint state;
  route snapshots and prepared-target types are no longer exported contracts.
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

- d11497f: Match KERIpy query endpoint selection and poll both authorized mailbox providers and current witnesses. Remove the mailbox-only query fallback and the unused Habery argument from mailboxPollEndpoints.
- 20da8ba: Remove automatic consumption of locally stored mailbox messages by runtime hosts. MailboxPoller now retrieves messages only from mailbox endpoints over HTTP/SSE; MailboxPollBatch drops source and requires the provider eid. Use direct HTTP/TCP delivery or explicit protocol intake for immediate recipient processing. Provider storage, authorized forwarding, SSE serving and remote polling remain available.
- 10f1693: Remove Poster's unused failure backlog. Concrete completion outcomes retain errors and partial delivery; unobserved or abandoned failures are reported at Poster without keeping signed-message recovery history.
- ddc0ded: Use typed multisig proposal evidence and expose exact publication identities through explicit owners.

  Group publication helpers now take explicit owners and return proposal identities
  alongside deliveries. VCP/ISS construction requires route-specific named children;
  initiation and approval share signing/delivery records without a runtime bundle.
  Group CLI results expose each recipient wrapper SAID and the shared proposal index
  key. Transport completion remains distinct from group acceptance. Callers using
  internal publication helpers must consume the structured result instead of a URL
  array; no legacy signature adapter is provided.

- b1a51d8: Reserve keyStateSaved for validated and persisted remote KSN replies. Ordinary KEL acceptance no longer emits a remote-notice cue; query workflows wait for a genuine saved KSN before comparing its target with accepted local state.
- 4dc3939: Separate WitnessInquisitor query sending from scoped KeyStateNoticer, LogQuerier, SeqNoQuerier and AnchorQuerier operations. Await accepted-state completion instead of registering generic runtime continuations; composition routes live saved key-state facts through Effection's channel.

  Move query command composition and final display into Tufa. Remove queryCommand from keri-ts/cli and make HTTPQuery an internal transport operation. Preserve current wire/framing, signer/attester selection, finite anchor recovery and joined transport cleanup during this ownership refactor.

- 5c56360: Extract ProtocolProcessor from Reactor. Reactor owns byte input and an independent Kevery; protocol dispatch, cue publication, correlation and escrow scheduling belong to their actual shared owners. Require explicit shared protocol dependencies for Poster/TCP replies, expose composed exchange and reply owners, and remove Reactor dispatch/escrow/handler proxy APIs.
- 8e13f57: Allow independent payload preparation and select immutable file references under a synchronous writer.
- b2ae804: Yield raw wire from Hab.processCuesIter, rename ReplayCue.messages to msgs and runtime.poster to postman, and remove CueEmission and reply cursors. Respondant publishes complete local replay batches atomically. Poster delivers events FIFO, retains whole failed events with partial successful deliveries, and exposes explicit retry/discard instead of automatic exact-packet retries.

  Remove the unused immediate sendSignedExchangeMessage API and its ExchangeTransport endpoint policy. Standalone exchange sends use the queued sendExchangeMessage helper.

- c5cbca1: Return ordinary authenticated ESSR bytes from accepted LMDB evidence. Remove unused file staging, payload ownership/sink APIs and ESSR content-reader adapters while preserving shared framing and transport sources.

  Construct `EssrRecipient(hab)` and call synchronous `decrypt(said)`; consume the accepted message body as a caller-owned Uint8Array. Use ordinary Texter raw or qualified bytes instead of removed ESSR reader adapters. See `docs/reference/compatibility/MIGRATING_TO_2_0.md` for removed public APIs.

- aee2e28: Allow independent protocol inputs and escrow scans during EXN I/O while keeping synchronous commits, query authorization and correlated replies correct.
- 5dcc8b6: Propagate database close failures, prevent uncertain handle reuse, and preserve operation and cleanup errors.

  LMDBer no longer warns and reports success after an ordinary close failure.
  Shutdown starts disabling the binding before completion, so failed wrappers cannot
  be reused, reopened or cleared; `env` is now a getter exposing only a usable handle.
  Keep `openExisting` for non-creating access. Await owned closure before reporting
  success, and handle `AggregateError` when an operation and its cleanup both fail.

- 3cd3bd7: Persist ESSR evidence in pinned-main Baser's insertion-ordered LMDB set, including its documented deduplication limitation. Remove the payload archive, durable plaintext APIs and archive ownership machinery; getEssrs is now synchronous.

  Use synchronous `Baser.getEssrs(said)` for ordered qualified evidence; plaintext consumers retain their own ordinary data instead of calling Baser persistence methods. See `docs/reference/compatibility/MIGRATING_TO_2_0.md` for the removed APIs and storage boundary.

- 7f688e1: Introduce TCPMessenger with explicit protocol/clock dependencies, owned parsing and Kevery, and shared finite/streamed sending. Replace conversation and prepared-target application wrappers, migrate Poster/query/witness callers, and give delegation the actual protocol dependency instead of Reactor.
- 976b0f1: Move the verifier webhook application, its business policy and workflow database into Tufa. Import VerifierAgent and createVerifierCueBaser from @keri-ts/tufa/runtime. The keri-ts runtime application-agent and CLI verifier command exports are removed without aliases; protocol Verifier, IPEX and evidence APIs remain in keri-ts. Preserve the existing legacy-Reger application profile and workflow storage encoding.

  Verifier run --once now reports final success only after its cue store, runtime and Habery close. Unexpected shutdown failures propagate, preserving simultaneous operation/cleanup failures. HTTP success still requires joined response cleanup before a local delivered marker.

- bef1328: Separate TEL input policy from committed registry state and publish cache changes after commit.

### Minor Changes

- 2472a4d: Complete group NoBackers credential revocation through `/multisig/rev` approval and member fanout. Reuse the original REV/anchor across restart, validate credential/registry/issuance authority before signing, and deliver completed evidence from the elected historical anchor signer.

  Breaking: `revokeCredential` now takes Regery, Reactor, Poster and selection options; explicit recipient delivery uses `deliverCredentialRevocation` after publication. `vcRevokeCommand` returns typed data for Tufa to render after closure. CLI JSON distinguishes accepted REV, completed publication, member deliveries and business deliveries; pending revocation does not write a completed export.

- b82f698: Settle authenticated grant evidence in the local wallet before authoring admits by default. Admit and join commands keep one host alive through wallet/approval waits and delivery; group members independently check their wallet before a fresh admit contribution. Support bounded pending results, stable group approval resume and elected delivery to the accepted grant sender.

  Grant files must pass valid EOF and ordinary exchange authentication before a response is signed. `--no-wait` now reaches the command handler and skips only the saved-credential requirement, reporting `saved: false` when appropriate. Admit results expose nullable `admit`, credential/saved facts, completed deliveries and optional group completion; Tufa formats these after cleanup. New `--timeout`, `--approval-timeout` and `--gvrsn` admit options select the existing finite waits and attachment context.

- f4c6004: Support group apply, offer, agree and spurn authoring with member approval/fanout, exact wrapper selection and elected external delivery. A single command host owns progress and cleanup. Persist local single-sig conversation history before delivery, validate accepted predecessors and known counterparties before signing, and collect stored peer child proofs during explicit join. These four commands accept `--approval-timeout` (default 60 seconds; zero returns pending group state) and report group status and message identities separately from transport destinations. Grant/admit settlement remains a separate release cut.
- 492c1fb: Add scoped access to existing pending OOBI rows without path creation, table creation or protocol startup. Share Baser layout defaults; replace its former static layout constants with the owning storage helper.
- 6329e23: Route native RIP/BUP evidence through ordinary protocol intake and recover foreign registry escrows after reopen. Preserve pending IPEX grants while the first issuer update or source-referenced presentation update is missing. ProtocolProcessor now borrows RegistryObserver instead of the local Regery manager; AgentRuntime retains database ownership.
- 41011c7: Add offline tufa oobi clean with read-only preview, exact-key apply and honest partial-failure reports.

### Patch Changes

- 31d31c7: Require accepted historical registry coordinates for backed issuance and revocation. Retain and verify accumulated backer signatures across dependency retries and reopen, retry partial-backer escrows, and add valid late receipts only to the exact accepted event.
- ac932d7: Validate endpoint, signing, query, DID and witness command options before opening stores. Reject malformed option types and mixed-type repeated lists instead of casting or discarding values. Resolver ports must be decimal integers in the supported range; explicit empty query anchor paths fail instead of silently selecting a different query.
- 3ea5a31: Validate operator and publication command inputs before resource access. Reject mixed-type exchange/data lists, malformed storage flags, invalid notification counts and numeric option coercion. Preserve decimal input spelling through notification, database dump and demo webhook dispatch.
- 7e59f6e: Keep mailbox SSE consumers immediately awaited within their read owner, name query and cursor delivery responsibilities, and simplify cleanup failure filtering.
- aa8002a: Run registry inception and credential issuance under one command-owned host and observe actual local TEL publication, with a 60-second default wait and explicit zero-timeout pending output. Report publication independently from business acceptance and saved credentials; VCP/ISS join reports the exact TEL coordinates. Record credential proposers' exact local wrappers before peer delivery, and process independently counted local/peer proofs as complete messages during approval and resume. Credential workflow APIs now take a shared Reactor before Poster. Honor ordinary establishment-only anchoring and stored registry policy after reopen. Refuse registry-name replacement and issuance with an alias that does not control the registry.
- 737b816: Report terminal escrow ejections at their protocol owners with message identities
  and refusal details. Preserve reply escrow evidence when unexpected handler or
  infrastructure errors occur instead of treating those failures as peer rejection.
- 7b38173: Give credential import, presentation intake, and VerifierAgent explicit shared protocol dependencies and input-owned parsers.
- d8a0f26: Validate credential, IPEX and verifier options before storage. Reject malformed
  list members and coercible timeout values while preserving omitted defaults and
  supported zero/fractional waits. Validate credential JSON sections before effects.
- 505859b: Validate group VCP/ISS business evidence before member approval or signing: bind issuer, registry, credential, source triple and exact anchor; leave missing registry/schema/predecessor evidence pending and refuse conflicting aliases before KEL mutation. Establishment-only group credential workflows now author rotation anchors, using participants' prepared next keys. Reuse read-only TEL validation without constructing processors or writing escrow for preflight.
- c257d71: Select multisig approval by the accepted outer EXN SAID even after its notification is consumed. Enforce the requested group before prompting or signing, and use stored protocol evidence rather than notification attributes for route selection.
- 3abab08: Report input-scoped persisted acceptance and bounded local settlement for finite credential imports, including explicit unresolved and rejected outcomes.
- 9b2ed3e: Compose initialization and inception bootstrap from OOBI/authentication and minimal KEL/reply processing. Ordinary resolution reports response processing, while protocol owners retain unaccepted evidence in escrow and authentication requires current authorization. Complete selected current attempts, resume in-flight work and multi-OOBI children, ignore unrelated historical work, and join I/O before returning or reporting command success. Reconstruct reply signature groups from their stored ordinals so missing signer KEL evidence survives escrow retry.
- 0c37762: Reject uncoordinated group aliases in ordinary event, exchange, challenge, location, query and DID-binding commands before business signing or mutation. Direct interaction/rotation users to multisig commands, refuse occupied inception aliases, and label raw group signatures as partial member contributions.
- d2a0470: Elect the external sender of an accepted group EXN from its authenticated historical establishment proof and the local member's accepted key history. Member rotation and a changed current group index order no longer erase or transfer an existing approval's lead. Pending group evidence has no elected external sender; transport and acceptance semantics are unchanged.
- f1f9185: Preserve verified historical IPEX grant source seals after the anchorer rotates,
  matching the pinned KERIpy main reference. Keep current-key freshness for
  supplemental signatures and reject anchors that do not commit to the exact grant.
- dc01225: Validate host ports, schema paths, mailbox cursors and challenge options before
  effects. Preserve mailbox reset index -1 and distinguish omitted timing values
  from explicit zero or fractional challenge waits.
- 48922f9: Keep enabled diagnostics on stderr at every log level so CLI credential JSON and other command data remain valid stdout.
- 595b193: Register exact group IPEX wrappers locally before transmission, reuse their original outer EXNs on resume, and reuse cryptographically verified member contributions from accepted or partial-signature evidence after restart and rotation. Explicit selection repairs an interrupted wrapper index through ordinary replay. Preserve initial StreamPoster routing and ordinary approval sends. Group grant/join results now include `messages` with recipient, `exnSaid` and `payloadSaid`, allowing selection of the original outer EXN independently of business completion or completed transport destinations.
- 0c1088e: Return typed IPEX command snapshots after owned worker and database cleanup, and move their final JSON projection into Tufa. Send, grant, admit, poll and join helpers expose ordinary EXNs and concrete outcome data rather than printing success inside resource scopes. A close failure prevents final success output without implying that completed transmission rolled back. Poll-discovered join output includes the selected outer EXN SAID. Signing, wire, routing, acceptance, file output and existing worker composition are unchanged.
- 8d85fa5: Validate group IPEX conversation parties and predecessors before a fresh approval. Grant authoring/approval requires the local verified credential and checks supplied source proofs against its accepted issuance and issuer KEL. A presenting group need not be the issuer. Valid minimal legacy grants remain supported when their authority is already local; missing member evidence stays pending without signing or fanout.

  Preserve a stored grant's actual pathed proofs during delivery instead of replacing them with newly assembled artifacts. Join results and JSON now separate local `approved` state from child acceptance; `approval-pending` reports an unmet local preflight gate. Breaking-change guidance records the additional public approval result fact.

- 1c94381: Keep one command host running through grant intake, group approval and elected delivery. Validate selected agree predecessors before signing, retain local single-signature grant history before export or delivery, and expose actual completed transport destinations in grant results and CLI JSON. Pending group evidence does not produce a completed grant export. Credential holders can present a saved credential without being its original issuer.
- 6ee8acc: Give group IPEX approval and publication their explicit protocol, delivery and credential dependencies. Approval owns its local byte-input context, while the CLI continues to own workers and stores. Pending selection reads accepted Baser exchanges directly. Signing, evidence order, transmission and acceptance behavior are unchanged; this ownership refactor precedes the remaining group lifecycle features.
- 8daaee8: Use the habitat's accepted group contribution when creating IPEX endorsements, including when a member has rotated ahead of the group. Preserve recorded approvals on resume. Reconstruct stored grant path/proof material without duplicating CESR counters, so recipients can import the credential evidence after the sender reopens its database.
- cebca90: Validate inception and rotation options before opening stores. Preserve omitted flags through option-file merging, apply defaults afterward, and honor explicit false, zero and empty-list overrides. Reject malformed counts, thresholds and list entries instead of coercing or filtering them.
- 6846a69: Advance local mailbox cursors only after successful batch consumption so failed or cancelled batches remain available when polling restarts on the same instance.
- c2c4671: Simplify native HTTP response cleanup around Fetch cancellation, pending I/O joining and reader release. Remove redundant closing paths and error-history state. Status-only callers close ordinary request scopes before publishing results. Qualify native EOF, truncation, unread/blocked-body cancellation, early return and external abort reasons on Deno and Node 20.3; normalize Node 20 replacement body AbortErrors at the native boundary.
- 420d96c: Clamp positive mailbox polling timeout overrides to at least one millisecond so fractional values cannot create an immediate header deadline or an invalid SSE window.
- fa8c101: Validate multisig command options and every configured member before opening stores. Reject malformed member/witness lists and supplied approval timeouts, retain fractional-second waits, and preserve rotation-file data when flags are omitted. Explicit empty data remains an override.
- 8d339fa: Recover explicitly selected multisig evidence accepted before interrupted handler indexing. Apply group selection first, replay the original authenticated wrapper through normal protocol intake, and let Multiplexor rebuild its own indexes before approval. Recorded local approvals reuse their original signatures and recipient wrapper; fresh peer proposals still require approval. No direct index repair, background recovery queue or new persistence is added.
- bd3905c: Pin schema validation to Ajv 8.18.0, the patched release for GHSA-2g4f-4pwh-qvx6. Legacy and native schema owners keep their current validation options; neither enables the advisory's `$data` option.
- f63a697: Allow signed mailbox polling against legacy KERIpy HTTP media profiles. Reuse the signed query after closing the preprocessing refusal, and restrict media negotiation to the reference Falcon content-type error rather than unrelated diagnostic text.
- cf8942d: Preserve pending TEL inceptions and retain evidence when unexpected processing
  or storage failures propagate. Complete finite TSN family scans and use the
  numeric proof key shared by both recorded KERIpy references, combining equivalent
  ordinal encodings without duplicating partial signatures on retry.
- 4eb294f: Expose the existing credentialSaidFromGrant, storedGrantArtifacts and IPEX_GRANT_ROUTE through keri-ts/runtime for application consumers. Expose the existing strict parseGvrsn through keri-ts/cli. Protocol behavior is unchanged; the verifier application can use public package boundaries without private sibling imports.
- 18694a0: Require complete successful HTTP response bodies and refuse redirects without replay. Complete transmit-only TCP at local drain with joined cleanup, preserving duplex receive and half-close behavior. Retain native transport failures with their causes and let Poster continue other destinations and queued events without swallowing construction or cleanup errors.
- 85cf1f8: Remove autonomous legacy TEL signing, collection/hosting and backed-registry application authoring, including the private endorsement-choice table, runtime request flow/worker, hosting options, agent --backer-alias, registry --backers and Registry.rotate. Registry application options now express only NoBackers authoring and ordinary establishment policy.

  Retain external legacy backed evidence decoding, exact historical quorum verification, observer escrows/retries, replay and credential presentation. Issuer multisig and KEL witnessing remain separate supported responsibilities. ADR-0014 rejects reintroduction without a newly justified requirement; the reference report preserves the retired design, and the 2.0.0 breaking guide lists removed APIs. No compatibility wrappers or migration machinery are retained.

- 11b9ca8: Validate revocation authority before signing an issuer anchor. Repeated revocation reuses the original TEL event and anchor across reopen, including locally tracked pending publication, instead of constructing another event.
- 50e3196: Resume recorded multisig KEL, reply, registry-inception and issuance approvals from LMDB without prompting or signing the group contribution again. Reuse original recipient EXNs during explicit resend, keep pending thresholds honest, and preserve historical membership. Fix exchange replay's doubled pathed-material counters.
- 6f555aa: Share initialization and inception bootstrap ownership, move OOBI/authentication inspection to direct Baser dependencies, and consolidate primitive option shape validation. Keep initialization credential policy local and replace inception's unused result queue with a directly awaited command scope.
- 3bb53ec: Preserve the original rejection cause in transaction-state escrow ejection diagnostics after successful removal.
- 0d6780e: Validate init encryption choices before stores open, hide passcode input, and remove implicit temporary fallback.
- c4b0dd1: Commit AEID changes and all stored secret reencryption atomically before publishing live crypto state.
- 76f0359: Separate accepted legacy TEL evidence from completed publication. Regery's TelPublication owner persists anchor, witness and dissemination progress through the existing tmse/tpwe/tede tables, and ordinary host workers collect/fan out receipts before sending accepted TEL replay to the historical witness cohort. Interrupted work remains pending across reopen. Registry.complete and ctel now reflect completed local publication; ctel stores the issuer anchor SAID, matching KERIpy, without claiming remote observer acceptance. RegistryOptions now requires the shared publication owner.
- e142a57: Use parsed request attachment context for legacy TEL replay, serving v1-compatible source seals/counters without a v2 selector to unselected legacy requests while retaining explicit v2 framing. Preserve signed bodies and proof meaning.

  Replay APIs now honor the selected version exactly and expose UnsupportedTelReplayError instead of silently raising it. TCP confines this expected refusal to the requesting connection and reports unsupported-replay locally; whole-cue responders publish nothing from an incompatible cue. No remote refusal protocol is added. See the 2.0.0 breaking guide for iterator-prefix and callback result changes.

- 1844829: Reject malformed bootstrap URL collections before any OOBI or endpoint reply writes, while preserving exact accepted URL strings and empty-list semantics.
- 564e28c: Use VerifierAgent's injected wall clock for issuance and revocation workflow timestamps as well as webhook headers and expiry. Preserve credential/TEL source timestamps and the existing expiry boundary.

## 1.0.0

### Breaking API and architecture changes

- Restrict supported package entrypoints to explicit root/runtime/db and CLI
  helper surfaces; remove implementation deep-import patterns and unused exports.
- Use concrete KERIpy-shaped owners, data cues and Decks. Query records carry
  their required q body. Reactor handles protocol intake/escrows rather than
  arbitrary application callbacks; transport does not discover AgentRuntime.
- CLI and hosts share workers with elapsed completion and joined cancellation.
  Remove serial runtime pumps, finite mailbox turns, application budgets, outboxes
  and unsupported mailbox/KRAM business acknowledgements. Preserve protocol
  escrows, replay/timeliness caches, mailbox messages/cursors and real cleanup.

### Protocol and interoperability

- Support complete IPEX apply/offer-through-admit and legal spurn workflows,
  independently authenticated credential chains, nested edge operators and
  progressive multi-attribute disclosure without changing commitments or expanding
  earlier stored partial evidence.
- Support TS DI2I approved delegation chains and NOT over authenticated node
  validity and receiver-accepted issued/revoked facts. Missing, malformed, forged
  or unknown evidence cannot satisfy negation. These operators remain excluded
  from Python interop while the reference does not implement them.
- Correct v2 mailbox forwarding to carry a signed child-body digest and qualified
  nested evidence. Keep KRAM authentication distinct from downstream acceptance;
  preserve threshold-completion receipt time across dependency retry and replay.
- Derive historical witness cohorts/thresholds from accepted event ancestry.
  Keep node issuer/registry authentication independent of conversation policy,
  and publish registry state atomically through its concrete owner.
- Project DID documents from accepted state; keep actual OOBI convergence,
  complete artifact intake, transport-fallback rules and joined cleanup explicit.

### Packaging

- Preserve valid strict NodeNext declarations for LMDB 3.5.3 and the actual
  public manager, storage, host and ingress contracts.
- Installed-package qualification exercises native large-row read/reopen,
  cryptographic signing/refusal, TCP transmission/close and CLI/HTTP operation
  before installing compiler tools. The supported Node floor remains 20.3.

## 0.11.0

### Minor Changes

- 9bf68eb: Install the shared resource policy before Baser and Habery opening. Runtimes inherit the Baser policy and reject mismatched injections; pass custom policies when opening Habery. Accepted-cache accounting remains pending.
- 62218a0: Correct ACDC aggregate commitments and disclosure verification for CESR, JSON, CBOR, and MGPK. Credential issuee accessors now read the first disclosed aggregate member, so requested revocation delivery can include that recipient while compact commitments remain undisclosed.

  Aggor is now a standalone semantic primitive: kind names the serialization format, code names the digest, raw/qb64b contain the complete body, and CESR count includes its enclosure (other kinds use null). Replace Aggor.qb64g/qb2g with qb64/qb2 and serialized.length with size. Generic map/list parsing belongs to Structor or Mapper; projectStructors().aggor is replaced by projectStructors().generic containing Structors. Remove callers of parseAggor, Aggor.fromGroup, and isAggor\*Code instead of treating arbitrary generic groups as valid aggregate commitments.

- 876d24b: Expose borrowed nested-substream serialization and preserve v2 forwarding trees through exchange admission, atomic child-row replacement, escrow, durable reopen, and replay. Keep child signatures and original qualified ESSR evidence on their owning messages.
  Child serialization uses one body-and-attachment boundary, preserving admitted deep trees under the parser's default enclosure limit instead of doubling their depth.
- 6b81675: Bound transient notification signals with shared admission and prepared publication before notice writes. Signaler exposes a borrowed readonly queue of immutable pings, and injected notification services must share the Habery resource policy. Owned runtime and CLI producers release their signal credit on close.
- 5d4d21b: Serve legacy tels queries with finite, reopenable TEL replay and explicit attachment genus.
- aefb533: Name the parsed body-plus-attachments payload CesrFrame and the frame/error
  event union ParseEvent. Rename PrimitiveTuple and isPrimitiveTuple to GroupTuple
  and isGroupTuple. Update KERI reexports and consumers without changing parsing
  behavior. Consumers must migrate the old CesrFrame event type to ParseEvent;
  the CesrFrame name now denotes the payload, so no legacy alias is provided.
- 3cf3b58: Consume typed CESR attachment values directly in runtime envelopes instead of decoding their qb64 bytes again. Reuse hydrated Serders, retain role checks for caller-supplied frames, and project nonce descriptor views from existing primitive instances.

  Remove the four runtime dispatch `fromQb64bTuple` factories that existed for the duplicate decoding path. Callers can construct validated primitives and use `fromTuple`; CESR structing raw-input factories remain available.

- 294b2ae: Align typed seal fields with current KERIpy Noncer roles and add FirstSeen fixed-field records. Runtime dispatch uses the canonical FirstSeen record, and datetime consumers use Dater.dts for ISO datetime text.
- e97df52: Expose hosted DID JSON artifact construction independently and avoid generating discarded CESR replay for dynamic did.json requests.
- 29d4c4e: Move stream state directly into CesrParser and remove the unused public ParserState interface and KERI reexport. Buffering, offsets, reset, and frame completion retain their existing semantics.
- 8dac1ff: Persist immutable payload references after file and directory flushes, recover orphan files before admission, and transfer ownership without allowing stale request cleanup to delete published content.
- dc24870: Add primitive-owned raw sealed-box opening and an explicitly hosted ESSR recipient service. Accepted exchanges are checked for destination, sender, ciphertext digest, sealed-box authentication, and SCS framing before plaintext staging. Per-message and concurrency limits bound working memory; ciphertext replay evidence remains unchanged.
- 9f3b4c7: Carry reopenable ESSR payloads through exchange acceptance, escrow, and replay. Keep KERIpy-readable ciphertext evidence, publish separate authenticated plaintext references, and join cancellation cleanup through Effection operations.
- 1b232ab: Cap forwarding introduction convenience collection at a configurable 8 MiB and expose lazy introduction messages for subsequent transport adoption.
- ab1821e: Serve OOBI replies through admitted lazy Hab message sources with bounded metadata and per-message preparation.
- 2f238e9: Replace collected KEL replay cues with reopenable message sources and stream
  HTTP replies with bounded runtime-owned readers. Bound query requests and
  continuations, retaining failed deliveries for retry.
- aef51c0: Require Node 20.3 or later for generated npm packages. Node 18 is no longer supported; transport cancellation uses native AbortSignal.any.
- 96b197e: Initialize pinned sodium npm bindings with Node 18's native secure randomness when the global is absent.
  Declare Node 18.17 as the KERI/Tufa minimum required by their abort-signal composition.
- 33b1921: Enable explicit optional KRAM runtime intake with scoped ready consumption, finite pruning and exact HTTP refusal handling.
- 0e3cba8: Retain mailbox query correlations in a bounded owned CueDeck on the director's resource policy. Injected query decks must now be CueDeck instances on that same policy; selected correlations hold credit through joined reader cleanup.
- bb3ba1a: Admit pending query metadata on the Baser resource policy before normalization and witness-list copies. Keep ownership through active processing, retry and joined close; direct pending pull/push bypasses are no longer supported, while clear retains an active head.
- f515cf8: Use progressive parsing for asynchronous annotation, streaming CLI validation,
  and replay benchmarks. Bound finite annotation and benchmark input explicitly,
  preserve nested CESR/ESSR wire in annotation round trips, and own Tufa input and
  output through Effection scopes. Remove unused annotation hints and speculative
  parser-mode/partial-error benchmark flags.
- cbbca78: Add bounded payload sinks and reopenable payload references. CESR provides explicit limited collection and a bounded memory sink; KERI provides awaited file staging, promotion, reopening, and cancellation without changing existing database schemas.
- 2da7cc5: Defer query response parsing until guarded cue handling completes, stream mailbox SSE with owned readers and consumer backpressure, and bound finite document and admin response collection.
- 4740ffe: Parse HTTP and file sources progressively within Effection scopes, serialize dispatch and cue consumption with bounded admission, and reserve direct query replies by query SAID. Cancel and join request readers and release staged frame payloads when their owning scope ends.
- eb0f1f7: Route signed exchange and witness delivery through progressive CESR output.
  Preserve witness authorization headers and bound cancellable receipt reads,
  parsing each completed receipt with the progressive engine.

  Own fetched response bodies through finite Effection scopes, including late
  completion during cancellation, without accumulating completed responses in
  continuous runtime workers.

- f631dab: Add local v2 blinded registry updates with validated credential membership and a reopen-safe staged frontier.

  Repair raw/default salt initialization used by blind disclosure derivation.

- 91ad705: Receive authenticated legacy registry transaction-state notices with finite typed dependency retry.
- f0c61b9: Align the v2 registry verifier names with KERIpy: use vet and vetBinds in place of vetRegistry and vetRegistryBindings. Verification behavior and durable evidence are unchanged.
- 7c56151: Add admitted nonempty reply detection that retains its primed message through response cleanup without an extra stream or peek wrapper.
- c0e9445: Remove the synchronous CESR stream engine, feed/flush/reset API, parser event
  wrappers, unused KERI CESR re-export stubs, and atomic ESSR conversion adapter. Expose async finite parseBytes
  alongside progressive parse; use the same engine for complete KERI records and
  streamed grant-file inspection. Shorten benchmark API names to benchmarkParser,
  BenchmarkOptions, and BenchmarkResult; countFrames returns the single-run count
  directly. Preserve KERI/CESR/ACDC protocol versions.
- a581ca3: Serialize ordered transferable reply groups and reconstruct stored endpoint proofs using the actual 714 group/cigar rules.
- 634cb98: Serialize admitted frames and ESSR payload references incrementally with one explicit output genus and wire domain. Preserve transferable inner counters, reject unsafe opaque genus rewrites, and normalize detached HTTP attachments to bounded qualified text.

  Drive forwarding through Effection-owned per-frame requests with upload backpressure, finite header/error limits, and joined cancellation. Body mode streams each admitted frame and consumes no whole-stream message array.

- 17bff5b: Reject malformed attachment wrapper tails consistently. Replace the dispatch entrypoints with parseAttachmentGroup, remove parser recovery options and parser-related --compat flags, and migrate runtime callers. Opaque wire families and KERIpy filesystem compatibility remain supported.
- 8abb84a: Run dispatch and mailbox settlement as Effection operations before advancing ingress, pass the receiving mailbox identity explicitly, and cancel and join owned webhook I/O when its operation stops.
- 1d238bd: Serve ordered legacy TSN replies through their independently authenticated receiver routes and retain bounded HTTP response-pair ownership through source cleanup.
- 8108a95: Transfer witness cues to the existing delivery batch and consume borrowed emissions outside Reactor through joined cleanup. Finite wrappers return caller-owned wire snapshots capped at a local 8 MiB aggregate and captured cue-count limit; drains require the runtime source deck.
- 2a23a53: Return witness KEL query results as captured lazy messages and serve them with shared response admission, preserving selector order and per-event native preflight.

### Patch Changes

- 52c5fc9: Extract synchronous cue interpretation and admitted preparation for owned delivery handoff.
- 922fca0: Admit finite cue route metadata before endpoint capture and retain its independent owner.
- 32da1e9: Preflight bounded KEL replay bodies before materialization and reserve HTTP replay reconstruction copies.
- b48b6a2: Expose captured KEL replay metadata for retained cue admission without opening event readers.
- ac071e1: Expose canonical frozen TEL replay metadata and fixed management/credential composition to retained cue admission without opening event readers or inspecting the borrowed store. Normalize KEL capture containers so caller subclasses cannot hide retained owners.
- a315b39: Add internal atomic KRAM parent staging with scoped hydration and durable first-ready receipts.
- e159bf9: Publish mailbox bodies and ordered topic references atomically and require completed local publication before reporting stored delivery.
- 5c60ea9: Commit optional mailbox outbox publication and terminal pruning atomically.
- 2f60052: Reuse the TCP source writer for bounded output on caller-owned accepted sockets.
- 92dc56a: Bound prepared cue target wire and expose invocation-local HTTP refusal evidence for retained delivery.
- 3528804: Admit stored nested wire rows before owned native copies using the pinned NAPI binding and preserve writer or read-snapshot ownership.
- f68e650: Admit optional runtime outbox row and preparation copies before native materialization, retaining credit through joined delivery and iterator cleanup.
- ec24492: Bound stored endpoint reply bodies and retained proof rows before response reconstruction.
- 700e33c: Preflight TEL replay bodies before native copies and cap incremental stored signature retention within the existing reply owner.
- da097ae: Preserve verified JSON schema resource identities and bundled URI references across ACDC body formats, and reject stale explicit schema claims during verification.
- d85fa42: Retain canonical Compactor descendants through compaction and expansion, and support path-directed disclosure closures. Add bounded Pather resolution for the IPEX disclosure prerequisite while keeping wire path construction independent of the traversal limit.
- e326a6f: Preserve normal CESR HTTP request completion when its own teardown aborts an unread successful response.
- 1692418: Resume bounded command-local mailbox polling across endpoints and habitats so an empty earlier long poll cannot starve queued proxy replay. Keep one absolute turn budget, sequential transport, durable cursor acceptance and joined cleanup.
- 1a0bee0: Admit prospective credential state and dependency cues before proof and Broker writes.
- 649e3f9: Receive credential transaction-state notices with independent attester proof, accepted registry trust and current credential TEL/anchor correspondence; retain typed dependency retry and accepted proof ownership.
- 355b9d9: Align CESR tables with frozen KERIpy 927c0cb8: use nonce seals for v2 -N/--N,
  preserve current GramHead special metadata and widths, and read valid counter
  size rows with trailing commas. Keep historical v1 receipt and path-signature
  protocol handling explicit, without reusing their meanings in v2.

  Add qualified SealNonce records and bounded structing transport. Keep nonce
  groups out of top-level attachments and native event seals, matching the actual
  reference admission boundaries. Remove obsolete big receipt runtime dispatch.

- 1f6d190: Align Bexter and Labeler with current KERIpy text escaping so leading A and
  hyphen values survive encoding and decoding. Preserve Pather's separate path
  escape convention, and avoid expanded byte arrays when decoding large Bexters.
- d74f2ad: Retain custom runtime cue input and output through joined sink cleanup while preparing under short Reactor turns and awaiting delivery outside the guard.
- 0c3001d: Stream DID Webs CESR resolution through the shared runtime with EOF-gated document verification, bounded JSON ownership and transport-only URL fallback.
- a1930f7: Atomically retain direct query replies through HTTP and queued target cleanup.
- 0b8329a: Add bounded durable partial-factor staging and hydration while preserving sender and foreign proof ownership.
- 7ab41c1: Commit event escrow promotion and bucket changes under the same native writer as live event intake, before publishing accepted state and cues.
- 60fbf59: Separate ESSR admission refusal from verification rejection with typed recipient outcomes and explicit plaintext ownership transfer. Propagate unexpected I/O and key-store failures, classify raw sealed-box authentication narrowly, and dispose finished plaintext when handoff cleanup fails.
- 6019f5a: Preserve and independently verify exchange source seals and route-selected supplemental proofs through escrow, durable storage, and replay. Keep legacy v1 signature intake and nested IPEX guards while exposing typed route dependency escrow.
- 192ecff: Match frozen exchange proof admission and retry policy: require explicit evidence delivery, restrict new missing-state escrows, deduplicate queries, and preserve previously accepted authentication on incomplete redelivery. Clarify valid-factor results and selected supplemental ownership.
- 8ae2f98: Preserve authenticated exchange evidence across durable missing-schema escrow, absolute deadlines and scoped retries.
- 34b16fa: Admit ordered EXN missing-state query batches with CueDeck before awaited selection
  or later exchange effects. Charge metadata planning first and retain query owners
  independently of subsequent verification outcomes.
- 5d69744: Admit actual new EXN sender/proof/schema escrow cues before durable evidence and
  archive publication with CueDeck. Retain ownership through joined async cleanup
  and reject changed escrow membership before commit effects.
- 0445f70: Parse ESSR payloads as Texters using version-specific count rules, reject unsupported genus selectors without coercion, and require controller counters inside transferable signature groups. Pin generated-table verification to the KERIpy interop reference to prevent accidental codex drift.
- a885d30: Add internal finite KRAM cache pruning with atomic owned-state cleanup and safe last-participant opener removal.
- 982cbca: Hold the native writer through KEL decision and first-seen preparation, then publish accepted live state and admitted cues only after the owning commit succeeds.
- c85823b: Preserve unexpected fetch/cleanup failures and close published replies on late request cancellation.
- e67d273: Transfer generic HTTP cues to the existing bounded delivery, mailbox correlation and pending-query owners before removing the source. Run network delivery outside Reactor and preserve each earlier query's exact authorization and request-local admission failure provenance.
- 82cbfee: Select HTTP and HTTPS endpoints for mailbox SSE polling while preserving mailbox-role precedence and TCP fallback for delivery.
- 06a8ef5: Join explicit HTTP body cancellation through an earlier scope owner and propagate
  unacquired response/request cleanup failures.
- 8096e08: Prepare internal legacy TSN state replies while preserving runtime receiving guards.
- 4556201: Assemble bounded accepted registry chains inside IPEX using the shared RegistryStore facade.
- ba04ce2: Verify disclosed IPEX presentation registries against node-local proofs and the retained first KRAM receiver receipt across dependency retry.
- 805a2ae: Validate carried IPEX node and edge schemas after issuer authentication, preserving typed missing-schema dependencies.
- 7d3e95a: Add internal durable KRAM cache selection and exemption policy with safe staged reconfiguration. Intake integration remains pending.
- 75ce4b7: Retain the first trusted KRAM receiver receipt across exchange proof escrow, retry and reopen without accepting caller timestamp overrides.
- 2a14b6e: Borrow Baser's shared policy for KRAM intake and admit acknowledgement copies before allocation, retaining their credit through joined staging, consumption and acknowledgement cleanup.
- 2402367: Add internal KRAM sender normalization and signature decisions with frozen factor ordering and independent foreign evidence. Intake and threshold acceptance remain pending.
- 4ed57c9: Add guarded native pre-copy admission and explicitly scoped KRAM snapshot identity and publication facilities.
- bf17a56: Add internal KRAM source authentication decisions with last-source precedence and exact missing-state coordinates. Intake integration remains pending.
- 4708f49: Add internal KRAM replay and receiver-time plans with interoperable transaction receipts and shared exchange openers.
- d857a93: Prepare reply queries and concrete KSN key-state cues before accepted proof and state publication, preserving shared and distinct cue-deck ownership.
- 5fee3df: Admit actual legacy revocation cues before accepted TEL writes when CueDeck is injected.
- e4e8b35: Raise the finite shared default stream ceiling to eight so KLI mailbox and witness long polls leave room for ingress and delivery. The 256 MiB byte ceiling, one decryption ceiling, configured-policy refusal and joined cleanup remain unchanged.
- dcb26eb: Preserve joined mailbox SSE cleanup failures and release reader locks on every exit.
- a190518: Separate synchronous nested multisig body construction from byte parsing and wire preparation. Reuse parsed child frames without payload reads; retain bounded cancellable preparation and existing v1/v2 wire behavior.
- 7a4fe68: Add named local v2 registry creation, lookup and reopen with stored-issuer recovery, atomic alias staging and explicit backend ownership.
- 1826744: Rebuild LMDB compatibility addons with the supported NAPI path so large rows cannot invoke Node-specific V8 symbols under Deno.
- 1067f67: Allow bounded reads with the matching official native Node LMDB build while retaining Deno NAPI safety checks.
- 6455bdd: Preserve typed seal SADs in native KERI event construction and parsing, including homogeneous seal runs and current KERIpy numeric encoding. Share automatic numeric code selection through NumberPrimitive.fromNum across seal, Serder, and threshold projections. Restrict native seal lists to event fields and reject unsupported entries before they can be lost.
- 9b1972f: Verify nested v2 IPEX disclosures and independent issuer evidence before durable exchange acceptance. Preserve dependency escrow and replay, add a verified observer registry store, and separate pure body construction from cancellable byte preparation. Presentation registries remain guarded pending receiver-owned KRAM intake.
- ef4491d: Support nested v2 multisig event and reply proposals with independent child commitments, durable local approval replay, and cursor-safe exchange escrow retry.
- 9a4c726: Use Node 18-compatible promises for transport drain and joined shutdown.
- fd11844: Admit OOBI queue and multi-parent cue batches before durable fanout and completion effects.
- 7a753de: Admit prospective OOBI introduction queue cues before reply proof and durable queue writes.
- 9a86101: Admit OOBI response result cues before terminal effects and retain prospective CESR result ownership through joined stream cleanup.
- 0c5d711: Stream CESR OOBI responses through the progressive Reactor and retain durable retry ownership through joined cleanup.
- 558ed89: Add internally owned, finite designated-alias ID capture and preflight selected credential rows before copy and hydration.
- c8332a2: Parse enclosed nested messages as bounded parent-owned trees, preserving each child's body, signatures, genus, and payload resources. Dispose complete trees at ownership boundaries and reject nested runtime processing, serialization, and annotation explicitly until those consumers support their evidence.
- 7d22d5d: Select the shared TCP engine for prepared Poster targets while preserving endpoint priority, signed introductions and explicit runtime-owned reply intake.
- a9b8e3f: Separate raw CESR routing and guarded wire preparation from owned network delivery.
- 41f2961: Retain private partial-message trees with bounded wire snapshots and scoped, cancellation-safe payload hydration.
- a1fd6bb: Add a pull-based async `parse` generator that emits complete GenericGroup children before the enclosing payload finishes. Move async frame adapters to this parser, preserve selected genus and exact child bounds, and close input on cancellation or failure. Async adapters now take resource limits and cancellation instead of the obsolete framed emission option.

  Expose the scope-owned Effection adapter through the optional `cesr-ts/effection` entrypoint and optional peer dependency, keeping the CESR root import framework-neutral. Remove the obsolete KERI convenience reexport; Effection callers use the explicit integration entrypoint.

- 04d25f0: Stream ESSR Texters into bounded payload sinks with reopenable wire and decoded views, preserving v1/v2 count semantics and both encoding domains. Verify exchange payload digests incrementally before acceptance.
- c1082c4: Prepare concrete KEL clone, key-state and decision cue batches before accepted or escrow writes when shared cue admission is injected.
- 30fee1f: Add explicit public parsed registry intake with durable pre-inception escrow and independently anchored event acceptance.
- 804a053: Add a bounded, abortable TCP byte source shared by runtime transport operations.
- e38056e: Qualify invocation-local transport admission refusals and preserve foreign same-class failures through joined target attempts.
- a8b749e: Admit KEL query output before repairing delegated replay source seals.
- 4e64f9d: Add atomic queue-only query reply preparation without acquiring an HTTP response stream.
- d485e44: Make CESR frame completion independent of network chunk boundaries. Open
  attachment sets now wait for a following body, a complete enclosure, or explicit
  flush. Terminal partial attachments report shortage without emitting an
  incomplete frame; flush drains all complete frames in either emission mode.

  Remove the frameBoundaryPolicy option, policy exports, and deferred-frame
  wrapper. Update complete-record runtime consumers to finish parsing explicitly
  and keep multisig attachment sets open while appending peer signatures.

- 5ed6b87: Emit stored transferable receipts as indexed signature groups during KEL replay so current KERIpy can consume complete OOBI responses. Validate and escrow grouped replay receipts without imposing a controller signing threshold or losing following endpoint replies.
- 92aee07: Skip unrelated raw KEL data while discovering fully witnessed event tuple anchors.
- 70c5f22: Preserve exact binary pathed evidence in Baser.ptds with a byte-oriented insertion-ordered adapter.
- 1ee7ea7: Retry internal registry anchor escrows with deterministic verified sibling arbitration and stale candidate cleanup.
- 108e5fc: Expose RegBaser as the shared public registry database owner while preserving existing observer-store layout, readonly readback and verified import behavior.
- 323323d: Admit prospective registry state and dependency cues before proof and Broker writes.
- a2d0847: Add internal atomic registry inception acceptance with verified anchor discovery, durable missing-anchor staging and protected duplicate replay.
- 5efdcca: Add v2 registry presentation and vacuous updates with a borrowed Registrar facade.
- 35327b0: Advance anchored registry successors after acceptance and support validated explicit anchoring with earliest-source retention.
- 5a8fc8e: Add the public registry storage facade, local aliases, earliest anchor retention and ordered escrows while preserving old-layout readback without opening migration.
- 8fad0e9: Add internal registry update acceptance with durable ordering escrow, accepted-predecessor validation and protected replay/head state.
- b66b5c9: Share parsed registry field validation and provide the local full-seal, witnessed-KEL anchor check without changing observer verification behavior.
- 7fa2bbf: Transfer eligible Respondant source cues into retained delivery ownership before removal and run their network work outside Reactor guards.
- 4c45c77: Retain bounded cue cursors and exact failed target packets in the existing runtime delivery owner.
- c18a6a0: Replace the bespoke bulk registry import and reader API with explicit public observer intake and the existing registry store.
- a1f6a76: Retain ready KRAM delivery across failure and reopen with frozen receipt time and joined, checked acknowledgement.
- d2d6da7: Admit concrete Revery missing-signer query batches before reply proof and escrow effects, preserving ordered signature aggregation and external proof ownership.
- 42390f4: Group v2 registry services under runtime.acdc.rgy with explicit scoped ownership and real registry escrow progress.
- 50d3dc8: Activate shared byte and item admission for default runtime cues, retaining ownership through joined consumers and clearing queued owners before runtime stores close.
- 2cc6d9a: Name the existing runtime delivery owner consistently across query callers before retained cue adoption.
- 04e9923: Join runtime output cleanup before closing its backing registry stores on scope exit.
- 11ffdef: Add internal held AgentCue batch and reference admission for later producer/consumer integration.
- 705822e: Require shared ESSR decryption reservations and retain credit through joined cancellation and plaintext cleanup.
- 5e18dfa: Reserve shared runtime credit before HTTP frame preparation and retain it through joined transport cleanup, including the first asynchronous diagnostic cancellation.
- 151ee7d: Reserve shared byte credit before copying queued ingress and retain its lease through processing, retry and joined cleanup.
- d75b7ec: Share runtime copy admission across KRAM snapshot publication and scoped hydration.
- 576ccc0: Admit mailbox provider streams and native row copies with shared runtime credit; join shutdown before closing stores.
- 3021fd9: Share exact RFC3339 microsecond parsing with registry verification and allow injected clocks in UTC timestamp formatting.
- 4dce63b: Reserve shared nested exchange storage and hydration copy credit before allocation and retain it through joined cleanup.
- 1a3d433: Admit outgoing source parsers and query uploads through the runtime policy, retaining source and frame ownership through response consumption and joined cleanup.
- 894529a: Admit query wire preparation and queued request ownership through the shared runtime policy before acquiring lazy message sources.
- 4ed2f6a: Reserve shared runtime credit for lazy HTTP replay and distinguish temporary capacity refusal from configured size limits.
- e1ffd73: Share runtime stream and input-buffer admission before opening sources, retaining credit through joined cleanup.
- 95abe2f: Propagate shared transport reader cleanup failures after joined cancellation and lock release, preserving distinct primary failures.
- 935952f: Retain shared ordinary-tree admission credit across parser delivery, nested ownership, consumer disposal and joined cleanup.
- a393238: Share runtime admission with witness delivery and join TCP socket cleanup before releasing its stream and byte credit.
- e5b4705: Admit source queries and continuation signing before atomic transfer to bounded runtime delivery ownership, preserving busy heads and captured routing.
- 9d33d98: Process witness TCP input progressively under bounded connection admission, preserving refusal provenance and joined shutdown ownership.
- 06111bd: Add explicit concurrent TCP reply intake on the shared finite/source/frame writer, with directional admission and joined cancellation.
- d8f19fc: Keep one deferred TCP query reply on its accepted connection through joined output or deadline.
- db38071: Send admitted frame trees through the shared TCP writer with serializer admission and borrowed ownership.
- f171389: Return correlated immediate receipts and query replies on accepted TCP connections.
- 3013312: Route TCP-only witness inquiries through same-socket verified reply intake and lend the active runtime to Anchorer witness publication.
- 537005e: Share finite TCP witness output with a bounded pull-driven writer and joined cancellation.
- 05d7ea2: Gather and verify same-socket receipts from TCP-only witnesses, while allowing witness submission to borrow an active runtime through joined cleanup.
- 4ca288f: Join runtime-owned notification and mailbox store cleanup on acquisition failure, scope exit and explicit close, clearing temporary sidecar paths.
- 948e854: Preserve reply microseconds and add finite typed transaction-state retry batches.
- 53b75a3: Apply sender allow/deny policy and proof prerequisites before v2 non-event dispatch. Preserve query requester identity and prevent refused requests from opening HTTP mailbox responses.
- 4384ccc: Validate v2 local registry issuance against bounded, locally resolved static schemas before deriving commitments.
- 547c566: Verify supplied ACDC v2 registry chains, issuer anchors, and blinded state bindings
  with typed missing/reject outcomes and microsecond historical cutoff selection.
  Nested IPEX workflow integration remains guarded.
- 52ce32f: Admit actual legacy credential dependency and saved cues before proof, escrow or
  saved-index writes when using CueDeck. Preserve replay escrows on resource refusal
  and retain ordinary Deck capacity behavior.
- 5114c71: Transfer and preserve admitted revocation cue ownership through the verifier's existing guarded durable enqueue while leaving unrelated runtime cues available.
- a503ac8: Preserve qualified source ordinals through TEL storage and escrow, and emit TEL and credential evidence using the requested attachment genus and body version minimum.
- c71c021: Replay imported v2 JSON and native CESR events with matching attachment counters and qualified ordinals while preserving stored event bytes.
- 537485a: Make runtime registry evidence ownership explicit and close default registry/TEL stores on failed construction or scope cancellation. Injected stores remain caller-owned.
- 4318586: Admit well-known authentication HTTP lifetimes through the Habery policy before fetching. Occupied capacity preserves pending authorization; cancellation joins response cleanup before returning credit.
- 3e5bc45: Consume witness ingress progressively with per-frame emissions and shared finite input handling.

## 0.10.5

### Patch Changes

- b407ed2: Close runtime-owned mailbox response streams before the Tufa HTTP host waits for active responses to drain.

## 0.10.4

### Patch Changes

- 77561f4: Stop active mailbox stream timers before closing their backing LMDB store.

## 0.10.3

### Patch Changes

- ea53199: Expose granular runtime module subpaths so Deno consumers can preserve least-privilege imports without eagerly initializing unrelated native and host modules.

## 0.10.2

### Patch Changes

- 2a2fa28: Resolve KERI runtime CESR imports through the published `cesr-ts` dependency so consumers receive one compatible set of nominal CESR classes and types.

## 0.10.1

### Patch Changes

- e99beb0: Use pinned libsodium Argon2id for faster byte-compatible Salter derivation, wiping owned WASM buffers before release. Preserve KERIpy tier parameters and enforce its 16-byte minimum output; whole-process erasure is not claimed.
- 4a05016: Sign group endorsements with the designated local member's accepted historical contribution, preserving its current group index without asserting prior-next rotation authority. Group queries no longer request private keys belonging to remote members.
- 8f8cd83: Close Habery-owned stores when initialization fails, and close unreturned Baser,
  Keeper and Outboxer handles when their acquisition is cancelled or rejected.
  Preserve existing data and caller-provided configuration on failure.
- 9d0a824: Recognize replayed inception events after rotation using the accepted sequence-zero KEL digest. Preserve historical signature verification and conflicting-inception escrow behavior.
- 4c69e12: Add opt-in durable remote mailbox admission for managed SDK consumers. Store exact inbound bytes and source cursors atomically, replay retained batches after reopen, and require explicit durable disposition rather than interpreting parser return as application completion. Preserve legacy polling as the default and bound retained data with fail-closed capacity limits.
- 09848ec: Map group rotation signatures to their prior next-key commitments independently of current member order. Use current-only signatures for newly added keys and non-rotation events so threshold recovery can replace an unavailable member without weakening either acceptance threshold.
- fdde61b: Size LMDB mappings from explicit options, KERIpy-compatible environment variables, and existing database metadata.
- 8b4adce: Authenticate mailbox queries against the recipient's current signing threshold before streaming private messages. Reject foreign requester identities, forged signature material, insufficient or duplicate signature indices, and old-key queries after rotation while preserving public KEL query behavior.

  Recheck each exact HTTP mailbox request before correlating stream cues, returning 403 for invalid or currently unverifiable requests so an older cue cannot authorize different attachments.

- 7a16330: Project weighted DID Webs thresholds as recursive `ConditionalProof2022` verification methods.
- 29366fb: Load persisted remote key state before classifying incoming events as unknown. Observers can accept valid rotations immediately after restart without an unrelated query first warming their key-state cache.
- 16dbf0b: Publish the KERI database and protocol runtime surfaces and Tufa host embedding APIs required by downstream services.
- ea0d325: Close an unreturned Reger when opening fails or is cancelled, and await its cleanup before the factory settles. Successfully returned registries remain caller-owned.
- 6b75316: Expose signed witness key-state replies at GET /ksn. Require the selected witness destination and fully witnessed accepted state before serving the existing KERI reply encoding.

## 0.10.0

### Minor Changes

- 1c31b6e: Use new lifecycle context helpers for managing Habery, Regery, Hab, Runtime, and other objects CLI commands depend on'
- 85d5a53: Clean up mailbox and witness CLI and workflow architectural layering.

### Patch Changes

- de60f83: Pin the Deno LMDB import to `lmdb@3.5.3` so local and CI Deno runtimes use the cleanup-hook-safe native package.
- d1ebfb6: Refactored the CLI layer to use a unified dispatch function, registerDispatchedCommand, for consistency of approach and style.
- 1f14f5c: Fixed the build process to use explicit public package boundaries and upgraded libsodium-wrappers to 0.8.4

## 0.9.1

### Patch Changes

- 961ddd7: Align did:webs keri.cesr generation with the Python did-webs-resolver artifact shape so controller KEL replay is emitted once before endpoint and designated-alias material.

## 0.9.0

### Minor Changes

- Add did:webs and did:keri resolver support, DID Webs artifact generation,
  active designated-alias ACDC projection, and designated-alias binding.
- 888bd90: Rename IPEX and multisig runtime CLI controls to `--approval-timeout`, `--poll-turns`, and `--poll-budget-ms`, and validate those values before command runtime startup.
- 888bd90: Add KERIpy-compatible attachment counter profiles, group habitat lifecycle helpers, multisig-aware delegation and credential presentation support, and CESR HTTP/OOBI interop fixes.

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
- fd9dabd: Add registry and credential issuance orchestration for registry-backed ACDCs,
  including `Regery`, `Registry`, `Registrar`, `Credentialer`, credential
  serialization helpers, and a verifier-index-backed credential wallet surface.
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
- 053c1fa: Add KERIpy-parity ACDC v2 messaging builders for registry, map, attribute,
  aggregate, and section messages, and align CESR-native mapper/string and direct
  native-serder hydration behavior with KERIpy vectors.
- b9abf12: Add the ACDC/VDR foundation: credential mailbox routing, IPEX route handlers,
  schema data OOBI resolution and hosting, parser VDR dispatch seams, and the
  KERIpy-shaped Reger storage owner.
- 580bf65: Add a Sally-like verifier agent with durable verifier cue storage, grant-driven
  presentation processing, revocation webhook handling, schema-validator config
  support, and the `tufa verifier run` command.
- f52dd7e: Add the registry-backed TEL and ACDC verifier core with KERIpy-compatible TEL
  state transitions, verifier save indexes, missing registry/schema/chain
  escrows, chain operator defaults, and schema payload validation.
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

- 87940ec: Move KERI npm build, LMDB setup discovery, version generation, and
  installed-artifact checks into checked shared scripts.
- 87940ec: Harden the `keri-ts` npm artifact by deriving DNT export targets from the
  generated package output and smoke-checking packed and installed package paths.
- 87940ec: Honor temp keeper derivation during habitat inception and add KERI test lane
  timing output for easier test-speed regression tracking.
- 1c4fb92: Add injectable runtime clock, HTTP, and mailbox polling seams so runtime tests
  can exercise protocol behavior without repeated real sockets and sleeps. Convert
  mailbox poller, mailbox admin, and witness runtime coverage to cheaper
  fixtures while preserving representative live transport tests.

## 0.6.0

### Minor Changes

- Complete delegation communication support for interop release readiness, including notification-backed delegation flows, mailbox/reply processing fixes, and npm artifact build validation needed for staged publication.

## 0.5.0

### Minor Changes

- b5a93cb: Finished init and incept support

## 0.4.0

### Minor Changes

- DB layer impl buildout with tests and --loglevel for logs

## 0.3.1

### Patch Changes

- Colored CESR!

## 0.3.0

### Minor Changes

- Finish CESR 1.0/2.0 feature parity with KERIpy and add tests

## 0.2.3

### Patch Changes

- Added new version release strategy and drift check to keep it in sync with
  cesr-ts
