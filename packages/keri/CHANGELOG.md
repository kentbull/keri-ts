# keri-ts

## 0.12.0

### Minor Changes

- 8c93bac: Remove duplicate metadata inspection and reservations from cue interpretation and direct reply preparation. Keep real source ownership, prepared-wire limits, and fanout cleanup.
- ae90b33: Replace progressive CESR traversal with one finite decoder that buffers complete
  counted enclosures before delivery. Carry ESSR as ordinary ordered Texters through
  dispatch, verification, persistence and replay; remove parser staging, Cursor,
  FrameIntake and ordinary-frame disposal. Preserve framing, padding, genus scopes,
  independent nested proofs and actual transport/storage cleanup.
- ad45310: Use one required KERIpy-shaped q field for query cues and pending requests, remove the query alias and redundant copying helpers, and give TEL recovery cues concrete registry and credential fields. Update callers from query to q; wire query bodies and deferred signer/attester selection are unchanged.
- 047cd5f: Remove codec allocation estimates, decoded-body budgets, capacity callbacks and
  speculative CBOR extension refusals. Preserve exact body ownership, native codec
  semantics, malformed-wire provenance and actual CBOR decoder-state cleanup.
- 34c2555: Compose admitted cue storage from owned handles and expose legal cue queue operations instead of inheriting destructive Deck methods.
- 7b5f2f7: Compose pending query ownership around a private queue and remove inherited operations that bypass admission or completion.
- c1b4392: Route cue records directly to query, mailbox and reply owners. Remove optional cue sink hooks and adapters; default queued queries now use concrete transport instead of silently retiring through a no-op sink.
- b6680be: Require route-specific query instructions through cues, pending requests and Hab signing, with one authoritative target. Hab.query now accepts an instruction object instead of separate arbitrary body and route arguments.

  Keep unresolved schema and credential recovery notices notify-only instead of falling back to KEL queries, and emit canonical sequence filters without redundant route or digest hints.

- c83a00a: Replace placeholder runtime VDR/ACDC service bags with the existing concrete registry owners. Reactor and dispatch borrow actual processors; caller-injected registry storage remains caller-owned, and readonly runtimes retain explicit registry absence.
- 107fd21: Remove the unused generic cue-byte admission API and copy/floor options. CueDeck owns its existing inspection and retention checks directly.
- 9daa55c: Return cue-byte and runtime query-delivery admission outcomes directly, preserving strict protocol producers and plain pending-query records.
- 6525359: Return cue interpretation, route, and delivery admission outcomes directly while restoring source ownership on expected refusal and preserving foreign failures.
- 6e73cca: Pass the actual cue source to sink admission and compose responder delivery in respondantCueSink at the runtime root. Replace Respondant.forHab callers with the root composition function. QueryCoordinator prepares pending queries without a parent runtime or Reactor callback scheduling; its processPending and queryDo methods take no runtime argument.
- 39c1ad6: Separate cue target preparation from queued transmission and outcome application; preserve exact retry packets and joined cleanup.
- 055d170: Keep delegation hint repairs in event decisions and apply them through Kevery after queue admission. Remove the internal delegation lookup from Kever's public API.
- c34df00: Delete the unused sender outbox store, disabled implementation, records, and exports.
- 0951bd9: Support DI2I issuer relationships using approved delegated inception chains, with retryable missing KEL evidence and inception-based DND checks. Apply targeted-edge defaults and ordered identity-operator precedence.
- eac30e2: Make did:keri resolution a synchronous accepted-state projection. CLI commands own
  finite introduction workers, and HTTP requests observe their existing host's work
  with an elapsed deadline instead of pumping the runtime for five turns.
- 3ed065b: Make DID document projection depend on accepted Habery and registry state instead
  of AgentRuntime. Active designated-alias queries now take their registry owner.
- 5e26f8a: Process local endpoint and host startup records directly through protocol intake.
  Remove hollow per-Hab host seeding, the forwarding-only mailbox host wrapper and
  unused host context/no-HTTP configuration; retain explicit hosted-prefix selection.
- 857101c: Remove the generic cue-publication helper and callback-based QueryReply.admit. Concrete consumers
  prepare/publish directly before removing source records; query correspondence
  exposes its ordered data through peekAll/takeAll. Preserve failure retention,
  paired replies and lazy replay without publication lifecycle callbacks.
- bea8455: Keep cue sources and routes with their actual queue or reply-batch owners; remove fake borrowed owners and queued cleanup wrappers.
- d733e52: Endpoint-role proposal results and CLI JSON now return `proposals: [{ recipient, said }]` identifying actual signed exchanges, replacing the misleading single `said` and `attachmentBytes` fields. Register each recipient-specific proposal before delivery and preserve separate durable retry routing.
- bc28782: Replace branded KRAM receipt tokens with explicit local receiver-time data through intake and dispatch.
- e850883: Remove AgentMode metadata and mode configuration. Hosts explicitly construct
  provider mailbox storage with enableMailboxStore or borrow an injected Mailboxer;
  ordinary command runtimes omit it. Use the same concrete components in every host.
- 0362bcb: Make reply cues disjoint: prebuilt replies carry only their authoritative serder, while TSN replies carry the matching complete state record and destination. Serialize TSN records at Hab interpretation and preserve registry-first tuple types. Remove duplicate prebuilt route fields and optional empty-body fallbacks; update cue callers to the explicit forms.
- e58bbc4: Curate the runtime API with explicit operation and data exports, and remove npm deep-import patterns for implementation directories. Use the package root, runtime or db entrypoints; cli remains the separate Tufa command-helper boundary.
- 5f526b8: Separate demand-driven source/parser lifetime into the runtime FrameIntake owner and remove Reactor.frames; migrate HTTP, witness and TCP edges to the same owner.
- fdebe94: Resolve historical witness receipts and thresholds from the accepted event's governing establishment, preserving its proof requirements after witness rotation or recovery.
- a4a4364: Separate IPEX group coordination from CLI timing and worker ownership. Timed
  completion and pending-proposal waits are private CLI orchestration.

  Use the ordinary host workers for IPEX waits and report fully settled mailbox
  batches/messages. Poll now uses `--timeout` seconds and join uses
  `--approval-timeout` seconds instead of polling turn counts and per-turn budgets.

- d1b8b6e: Evaluate NOT edges over authenticated credential validity while retaining proof dependencies, schema checks and receiver-owned registry evidence.
- 2411980: Remove Kever's unused cue queue property and constructor/evaluation option; keep follow-up descriptions in typed decisions and publication in Kevery.
- 7fac347: Move accepted-event row and first-seen log preparation/persistence from Kever to Baser; keep clone notifications and publication sequencing in Kevery.
- b57c2ec: Separate direct multisig approval from CLI scheduling. Timed waits and delegation
  completion belong to CLI orchestration; direct proposal approval does not start
  or drive background workers.

  Run each multisig command under one joined host lifetime. Multisig join now uses
  `--approval-timeout` in seconds instead of polling turn counts and per-turn budgets.

- d2e39f6: Use a correlated MultisigEventProposal for the four multisig event routes across byte preparation and parsed-child body construction. Derive inception identity and child commitments from the child instead of accepting an open attributes record. Preserve existing v1/v2 encoding and frame lifetime.
- 3c0386b: Remove nested exchange tree/copy budgets, stored ESSR byte/item caps and recipient
  crypto/concurrency quotas. Keep authentication, qualified framing, transactions,
  exact declared payload sizes and joined file/reader cleanup.
- d44aa3a: Remove cue-output reservations, combined preparation floors and prepared-emission ownership handles. Publish ordinary emission records after synchronous preparation, retain retryable wire and actual iterator/reader cleanup, and allow finite witness snapshots without application output quotas.
- 4b12067: Remove query-request byte reservations, preparation floors, metadata quotas and synthetic busy/refused admission. RuntimeDeliveries accepts concrete query records directly; signing and endpoint selection precede source removal, while failed transport and cancellation retain their existing retry and cleanup behavior.
- 6216130: Require Kevery to own KEL transactions and publish only after commit. Remove the unused public applyDecision entrypoint and refuse nested writer calls before effects.
- d097b1b: Remove parser cursor/tree/ESSR/input quotas, frame-credit ownership and intake
  source slots. Annotation, benchmark and byte collectors no longer accept input
  caps. Keep wire counts/extents, independent signatures, actual payload ownership,
  native backpressure, cooperative cancellation and joined source/file cleanup.
- 075f015: Remove payload collection and memory/file staging quotas and quota-bearing sink callbacks. Preserve exact declared lengths, owned byte/file lifetimes and joined cancellation cleanup.
- cd84470: Replace cue ownership and capacity accounting with ordinary Deck records across protocol producers, runtime consumers, query replies and mailbox correlation. Preserve post-commit publication, lazy replay and joined I/O cleanup; remove the former cue-credit and queue-limit APIs.
- 791a9fa: Read plain cue Decks directly instead of manufacturing borrowed ownership handles; preserve actual admitted-source transfer and retry.
- bbe3eab: Remove OOBI, forwarding and KEL replay accounting limits and duplicate stored-reply size formulas. Preserve lazy replay horizons, proof ordering, framing and actual reader cleanup.
- ed0991a: Use a private ordinary Deck for pending QueryRequest records. Remove unused pending-query/continuation caps and metadata byte reservations while preserving failed-send retry, finite processing passes, signer deferral and joined shutdown. Keep actual wire and transport ownership separate.
- c590d5c: Remove HTTP reply accounting and configured chunk copies. Keep pull-driven message streams and joined reader cleanup.
- 08bd4f4: Remove TEL replay limits, canonical pair inspection and native row size billing APIs. Preserve real wire settings, replay horizons, ordered iteration and owned native byte copies.
- 021cdbe: Remove Reactor's application callback gate. Dispatch returns processed evidence
  and its exact decision; protocol cues are correlated before application publication.
  Reply, query and request owners prepare and consume their own output directly.
- c527351: Require the existing CESR event-seal shape for anchor queriers. Validate anchor-file JSON and CESR fields before opening controller state or scheduling queries; preserve valid supplied seal values and owned snapshots while emitting the i/s/d key order required by KERIpy anchor lookup.

  Ask each eligible anchor-query attester once through the existing queue, preserving unqueued alternatives on capacity refusal. A stale retired witness no longer strands anchor recovery; ordinary query selection is unchanged.

  Run command-local query and mailbox workers concurrently through the existing runtime runner, then halt and join before displaying state and closing stores. Empty mailbox polls no longer consume the query window before query transmission and other endpoints progress.

- e013d92: Delete RuntimeDeliveries and give QueryCoordinator ownership of signed query packets, route preparation and joined HTTP/TCP/SSE response I/O. Construct it with actual Reactor and clock/HTTP dependencies, include pending output in query convergence, and remove the runtime delivery field and unused delivery counters.
- 46ead95: Stop recursively charging borrowed query metadata during delivery admission. Preserve held source credit, prepared-wire limits, and exact-wire retry cleanup.
- e8e9458: Use signer AID identifiers in query requests and continuations instead of retained Hab references. Resolve explicitly selected local signers through Habery before signing, preserve selections through routed cues, and defer unavailable identities without substituting the ambient signer.

  Use the selected query signer for transport introductions. Poll every eligible witness mailbox when no explicit mailbox route exists, so an unresponsive or retired first witness cannot hide replies stored at other witnesses.

- 43701cd: Remove CuePublisher and its synthetic plain-Deck publication adapter. Protocol producers use ordinary Decks directly and retain preparation handles only for admitted queues.
- 18d6a5a: Remove prepared cue-route ownership, metadata estimates and target-count quotas. Pass ordinary routing records directly to delivery while preserving source cues on route failure and actual iterator cleanup.
- c08859e: Remove cue-target credit reservations, backing-size quotas and packet ownership wrappers. Pass ordinary prepared packets through delivery and preserve actual replay iterator cleanup.
- f98953b: Remove KRAM factor byte/item accounting and signature-pool quotas while preserving exact factor deduplication and authentication.
- 3887bea: Remove durable KRAM ready acknowledgements. Completed authentication retires partial state before downstream consumption while preserving replay protection.
- a12a40b: Remove private KRAM snapshots and asynchronous handoff ownership. Intake returns synchronous decisions and borrows child frames and ESSR from the current input while preserving persisted scalar proofs and replay rejection.
- e73aa86: Remove durable consumer inbox admission, acknowledgements, deadletters and quotas. Pollers hand off ordinary message bytes and record topic cursors.
- 3919b4f: Remove outbox sidecar acquisition, CLI flags, database selectors, and mailbox debug backlog output.
- e9eb1bf: Remove automatic durable outbox enqueue/retry and queued delivery results. Mailbox sends attempt each target and report any failure, including partial delivery, to the caller.
- a0e10d1: Remove the unused legacy and v2 Registrar forwarding facades. Call Regery for registry creation and escrow processing, and Registry for issuance, presentation, revocation and completion operations.
- d4eedda: Remove RegistryObserver and IPEX event-count quotas. Preserve accepted-chain proof checks, transactions and exact ordinal representation at the database boundary.
- 22cee38: Open current registry anchor and escrow tables directly, removing old-layout fallbacks and lazy initialization. Preserve readonly duplicate replay and reject writes at transaction boundaries.
- 39a7ba1: Remove the shared ResourcePolicy, accounting errors and constructor options.
  Delete remaining client, Reactor queue/waiter, TCP listener and reply-proof work
  quotas. Preserve actual I/O cleanup, protocol state ordering and numeric guards.
- dc5795c: Remove ACDC schema byte, depth, value, reference and resource-count quotas. Preserve SAID verification, local static reference resolution and Draft 2020-12 validation.
- 281e1d5: Replace prepared signal reservations and JSON/queue quotas with ordinary transient collapse/expiry signals. Publish notification hints after successful durable notice changes, without coupling Signaler to runtime resource policy.
- bee6567: Remove transport refusal observer hooks after delivery attempts adopt direct outcomes; keep internal attempt helpers out of the runtime package exports.
- 8dee897: Delete unused alias metadata accounting and callback-only credential hydration. Designated aliases continue to use ordinary wallet selection and credential reads.
- efae49a: Move queued reply interpretation, atomic correlation publication, live replay cursors and exact retry packets into Respondant. Remove the generic cue/direct-reply delivery classes and their callbacks; runtime construction and hosts drive the concrete reply owner and join its output before stores close.
- 3c3f81b: Remove serial whole-runtime and finite mailbox polling APIs. Commands and hosts use the same component workers, while mailbox retrieval retains endpoint concurrency, real I/O deadlines and cursor updates after consumer completion.
- 5c33e8c: Run finite CLI convergence through the same concurrent component workers as hosts.
  Use explicit elapsed deadlines instead of serial runtime turn counts, join workers
  before returning, and suspend the supervisor while its children progress.
- def36e3: Move TCP reply parsing and dispatch into an application conversation flow. The TCP engine now exposes a bounded byte stream instead of depending on AgentRuntime. Use converseCesrTcp or streamCesrTcpConversation for parsed same-socket replies; lower send adapters retain transmit-only results.
- 43ec20d: Give witness receipt, delegation and raw transport owners their actual Reactor
  and transport dependencies. Remove parent-runtime injection and standalone
  receipting's construction of unrelated stores and workers.
- e57e2f1: Forward complete v2 CESR messages through authenticated mailboxes using a signed nested envelope, preserving the recipient's independent IPEX and credential proof checks.

### Patch Changes

- 5429fdb: Replace application error context bags with diagnostic messages and standard causes for actual underlying failures.
- ea8b5cc: Compose TCP receive/send tasks over actual socket resources in the application,
  remove TcpRead and the CESR Effection adapter/export, and delete TCP output quota
  formulas. Preserve half-close, native write backpressure, fixed deadlines and joined
  cleanup, including late source failures during cancellation.
- 819b027: Preserve canonical partial attribute, edge and rule commitments when rebuilding
  compactable ACDC credentials. Compute the credential commitment separately so
  serialization does not silently rewrite negotiated disclosure evidence.
- 77708da: Use the shared HTTP response owner for CESR delivery, preserving unexpected late fetch and diagnostic cleanup failures while retaining admission credit through joined cleanup.
- c5cd6c8: Run challenge verification over joined host workers so mailbox polling progresses
  independently of the command's response deadline.
- 3c8f7b3: Share the known challenge word-list contract between response production, decoded EXN validation and verifier lookup. Validate unknown decoded attributes without open-record casts while preserving the authenticated EXN sender and existing wire projection.
- 018cea3: Own Reactor input cancellation and cleanup directly, decode finite receipts and
  approved legacy multisig children synchronously, and scan grant files without
  a frame-channel bridge while still requiring valid EOF.
- 3d0de4d: Carry the concrete integer-sequence KEL anchor through credential state records and builders.
- dd99e26: Carry known registry seal fields through raw credential state without open metadata maps.
- 72ef73f: Use an explicit cue reader contract for interpretation and query delivery, preserving queue credit through transfer and retry.
- da25894: Route KEL and reply cue production through a narrow publication contract while preserving ordinary and owned queue admission behavior.
- 5340711: Decode required multisig issuance credentials before prompting, signing or accepting the KEL anchor. Incomplete proposals return without partially applying approval.
- dfa9052: Re-publish KEL approvals from the decoded route-specific proposal instead of copying arbitrary peer attributes. Preserve the local child attachment genus when building the new signed wrapper.
- 46bf809: Run delegation approval under one joined host worker lifetime instead of serial
  runtime turns, preserving witness-backed commitment and authorizer seal ordering.
- ebd9768: Narrow DID schema, registry and artifact-fetching helpers to their concrete store and HTTP dependencies. Preserve application workflows, alias replacement and transport fallback behavior.
- 4596c98: Move HTTP, witness and multisig replay parsing into their concrete input scopes.
  Remove the HTTP parser-options bag and preserve foreign cleanup failures while
  joining cancellation, without an Effection frame-channel dependency.
- f8fbd32: Remove open escrow diagnostic metadata and retain useful replay details in messages.
- b3881f0: Propagate unexpected ESSR payload read failures so escrow retry retains pending evidence instead of deleting it as invalid remote input.
- c6f86f5: Separate ESSR commitment construction from asynchronous payload verification while preserving current rejection outcomes.
- ac4278d: Replace executable KEL decision wrappers with plain metadata and explicit Kevery persistence and publication.
- 5ccedc6: Keep finite nested/ESSR hydration and wire formatting independent of cancellation.
  Payload readers and replay operations own cancellation before publishing bytes;
  archive/file readers retain their actual I/O signals.
- 266bc16: Decode ACDC children during approved multisig issuance replay instead of requiring every child to be a KERI event.
- 9087eaa: Resolve accepted-event receipt witnesses from the preceding establishment event,
  including an empty cohort. Do not authorize historical receipts with a later
  witness list, and keep receipt POSTs for unaccepted events in escrow.
- 948f254: Honor the caller HTTP signal through headers and response-body ownership, keeping
  external cancellation distinct from timeout. Report late foreign AbortError body
  failures from the Node host instead of mistaking them for its own cancellation.
- 891bbe5: Return joined expected HTTP/admission refusals directly to prepared delivery attempts while preserving strict send APIs and foreign cleanup failures.
- 3519b55: Preserve the selected frame genus in detached HTTP attachment framing instead of
  inferring it from the message body protocol version. Remove the unused separate
  outer-genus override from attachment serialization.
- 24f2c1f: Remove HTTP request reservations, client Fetch/SSE and attachment-header size
  ceilings, and static-artifact allowances. Retain native backpressure, poll
  and request cancellation, file extent correctness and joined I/O cleanup.
- 085fb07: Fix strict installed TypeScript NodeNext consumers by selecting LMDB's valid CommonJS type declarations while retaining the ESM runtime binding. Preserve Baser's environment type through its concrete LMDBer owner.
- f2c2c20: Preserve the embedded attachment genus through multisig IPEX approval, partial signatures, and outgoing proposals, including CLI group grants.
- f772d43: Preserve the configured attachment genus across credential grant construction and stored artifact intake. Add `--gvrsn` to holder polling and verifier runs so legacy grant envelopes can carry genus-2 child proofs through verification.
- 7dc80c5: Separate IPEX issuer authentication and accepted registry evidence from conversation policy, preserving current proof precedence and retry behavior.
- 433ced2: Preserve independent I/O failures reported while a cancelled operation joins its
  cleanup. Abort the concrete source before child teardown, join its pending work
  through the resource lifetime, and suppress only that operation's own abort reason.
- a6dff7c: Decode multisig KEL approval inputs before local member selection, joining and signing, preserving existing event and publication behavior.
- 648ec57: Remove unused attachment and KEL decision metadata contracts; preserve invalid-prefix failure detail in the decision message.
- 5afedd3: Move local blind/present/vacate construction and staged-frontier selection into Registry while retaining shared observer/local acceptance in RegistryEventer.
- 34a9255: Honor signed child attachment versions when approving multisig KEL events and endpoint replies, keeping local signatures and peer proofs in the same CESR genus.
- 1831205: Reject multisig KEL and VDR proposals whose selected group differs from the embedded KEL event or anchor before prompting or signing. Groups sharing participants must not be interchangeable during approval.
- 1cf589b: Emit the canonical KERIpy cgvrsn hint when a v1 multisig wrapper carries a legacy child body with a different explicit attachment genus. Derive the hint from child framing instead of caller metadata, preserving supplemental bytes and omitting unnecessary hints.
- 490415a: Decode multisig membership attributes into concrete requests before applying local group policy, preserving existing membership and route behavior.
- 72975ce: Use the existing route-correlated multisig builder for local KEL publication. Derive child labels and inception identity from the proposal and child, preserving recipient-specific registration and delivery.
- 95463bd: Preserve the signed attachment genus when approving multisig registry and credential anchors, so local and peer signatures can combine correctly.
- 2eedce8: Keep group endpoint-role publication at its workflow owner and validate decoded reply attributes without open-record assertions.
- 9197016: Consolidate structural nested exchange route/version support while preserving handler opt-in and independent child verification.
- d8a96a7: Publish OOBI cues directly to ordinary Decks without synthetic resource handles; preserve admitted queue reservations and durable retry ordering.
- ae663a9: Bind external input cancellation to the consuming operation so waiting protocol
  turns and active HTTP response consumers stop and join cleanup. Separate dispatch
  choices from input lifetime and check cancellation at input consumption boundaries.

  Remove parser and finite annotation cancellation options. Benchmark and CLI
  consumers own cancellation directly; protocol decoding takes only its byte source.

- 74f852e: Pin audited MessagePack 3.1.3 and cbor-x 1.6.0 dependencies in source and emitted npm packages without changing the resolved decoder implementations.
- 6338964: Replace executable reply preparations with plain proof plans and caller-owned cue batches.
- 132fad7: Prepare signed multisig exchanges at the workflow owner and deliver the exact wire through Poster, preserving delivery and durable retry behavior.
- f0b799e: Reject new direct mailbox streams after their owning director has closed. Remove
  provider stream reservations and message/topic/metadata quotas while preserving
  demand-driven output, query correlation, exact cursors and joined reader cleanup.
- e424a7c: Register the signed local multisig proposal before delivery so subsequent peer proofs can complete approved group events without another approval prompt.
- 9ae2297: Use the cue publication contract across exchange, OOBI, credential, and TEL producers without changing their retained-admission or standalone queue behavior.
- c4fb6f6: Use the ownership reader for direct-reply capture and revocation scans while preserving existing queue order and held-credit behavior.
- e93f557: Commit endpoint authorization/location projections with their authenticating reply proofs, and publish queries only after commit. Refuse caller-owned writers and confine native writer inspection to storage.
- 6c878b6: Make pending reply proofs and TSN escrow dependencies explicit typed outcomes instead of diagnostic metadata.
- a1ebe55: Consolidate cue delivery byte allowances and use explicit admitted charges while preserving current capacity boundaries.
- 7dee8d8: Extract the shared pending-fetch and response owner while preserving generic HTTP timeout and cancellation behavior.
- 77dedf6: Use one v2 IPEX predecessor table for construction and verification while preserving the distinct v1 conversation rules.
- 61d53ed: Keep one typed Broker retry path and remove the unused exception adapter.
- d65bb18: Return joined TCP capacity outcomes directly to prepared delivery while preserving one socket/source/reply owner and strict send APIs.
- d609188: Narrow TEL and transaction-state query fields before state access and remove unconsumed TSN preparation metadata.
- 13f81df: Use the shared cue publication contract for registry and credential state-notice processing while preserving independent proof and dependency admission.
- 9a03310: Publish only known multisig reply and VDR attributes, and encode republished credential proofs in the advertised CESR genus.
- 7ed9e95: Replay independently signed v1 multisig children after local approval, including remote-first arrival, database reopen, and signed attachment-genus selection.
- 171cd0d: Preserve credential-state field guarantees through production and validate incoming notice fields without metadata-map assertions. Reject coerced event kinds before acquiring dependency escrow.
- a3972bb: Preserve required registry notice fields and validated array types through TSN receiving.
- 29ea095: Require verified persisted witness signatures before reporting HTTP receipt
  success or retrieval, and fan out only accepted complementary witness evidence.
  Select witness identities and proof indexes from the requested event, including
  retrieval and cached completion after witness replacement.
- f5164a3: Allow locally prepared multisig groups to establish accepted state before gathering witness receipts, without relaxing remote witness validation.

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
