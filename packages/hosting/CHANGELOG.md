# @keri-ts/hosting

## 2.2.5

### Patch Changes

- 99c3866: On a relaying agent, a `/fwd` naming a local group that authorized the host as its `mailbox` or `agent` is now ingested once by the hosted co-member and stored once in the group's mailbox topic for its remote members, whoever sent it. Before, a third party's `/fwd` to the group was stored and not processed, and nothing did both. A child whose originator is a local habitat, an agent principal of the host or a member of the group (the edge that would pick it up) is ingested and not stored, so an edge's own `/fwd` to its group is not handed back to it. The shared rules live in the new `app/mailbox/agent-inbox.ts`: `authorizedStoringHost` (the `mailbox` or `agent` end role, also the forward handler's served-sender role check), `keepsForPickup` (a storing role from a remote identifier or a local group) and `ownTraffic`.

  A host that an identifier authorized as `agent` also keeps that identifier's raw inbound mail, as KERIA's agent receives a KERIpy sender's direct posts. `keepRawArrival` (exported from `keri-ts/runtime`) stores one dispatched raw message once for each principal: the recipient it names (`rp`/`ri` of an exn or xip, the delegator of a dip or drt) when that recipient authorized the host as agent and is remote or a local group, or, for a message that names no recipient, every remote identifier that authorized the host as agent. The topic follows the message: exn/xip by route, a delegated event for its delegator on `/delegate`, other KEL events on `/replay`, receipts on `/receipt`, replies on `/reply`, TEL events and ACDCs on `/credential`; queries and `/fwd` are never kept. Nothing is kept for its own traffic (as above), when the SAID does not verify, without attached authentication, or when the agent's decision is `drop`, `reject` or `duplicate`. Raw mail is not kept for the `mailbox` role, whose senders use `/fwd`.

  In `@keri-ts/hosting`, the generic CESR ingress offers each frame it has dispatched for a hosted endpoint to `keepRawArrival`; dispatch remains the single ingest. Poster delivers to a recipient whose agent is a local identifier through the local mailbox store instead of posting to its own ingress.

- ac85e2c: Generic CESR ingress answers 422 with `KRAM refused message: <reason>` when the final non-query frame is dropped for
  `timeliness`, `lifetime` or `unknownThread`, so a sender learns its message was late. Those reasons are decided only
  after a signature or anchored seal verified; replay, authentication, missing, pending and timestamp outcomes still
  answer 204. KERIpy always answers 204 here.
- e50c77d: A remote message that this receiver's KRAM refuses after its sender authenticated now reaches the application. `Kramer.intake` publishes a `kramRefused` cue (`KramRefusedCue`: `said`, `sender`, `ilk`, `route`, `reason`, `stamp`, and `deadline` and `xid` when they exist) for the reasons `timeliness`, `lifetime` and `unknownThread`, which KRAM decides only after a signature or anchored seal verified. `processCuesOnce` pushes it to the new `AgentRuntime.changes` sink as a `KramRefusedChange`, so the host's `ChangeSink` or the Signaler (topic `/workflow/kramRefused`, collapsed per SAID) receives it. `ChangeSink.push` now takes a `RuntimeChange`, either a `WorkflowChange` or a `KramRefusedChange`, and the wallet's sink forwards both. `timestamp`, `replay` and `authentication` refusals and local envelopes publish nothing; the cue is transient, with no durable record. `isKramLateReason`, `KramLateReason` and `kramExchangeId` live beside `KramRefusalReason`, and the generic ingress 422 uses the shared predicate.
- 77865d3: An agent can now relay for the edges it serves. With the new `AgentRuntimeOptions.relaying` (or `HostKernelSpec.enableRelay` in `@keri-ts/hosting`), `/fwd` intake delivers the child of a sender that authorized this host as its `mailbox` or `agent`. A recipient that is a habitat of the agent's own Habery (an edge's group co-member hosted on the agent) receives it through the agent's own ingress, as remote input to that habitat's endpoint, with signature, KRAM and escrow rules applied as for any received message. Any other recipient gets it through the agent's own Poster, at the recipient and topic the `/fwd` names. A group's `/fwd` is signed by its local member; it relays when that member authorized the host, or when the forwarded message comes from a group the member belongs to and that group authorized the host. Witness membership alone never grants relaying. Exactly one path runs: local habitat, then a recipient this host already stores for (stored as before), then relay. A failed onward send is the Poster's logged failed outcome; nothing is acknowledged back to the edge. Relaying requires a mailbox store.

  Breaking changes: `ForwardHandler` takes a second constructor argument, a `ForwardRelaying` (the runtime's `Poster` and `Reactor`), or `null` for store-only intake. `HostKernelSpec.enableRelay` is required.

- f516489: A relaying agent now refreshes its own view of a subject its edges ask about. When a runtime with `relaying` receives a `logs` or `ksn` query from a sender it serves (the same served-sender rule as `/fwd` relaying) about a subject that is not one of its own, it also queues its own ordinary `logs` query for that subject, signed by the serving host and sent directly to the subject's controller, agent or witness endpoint. The requester must be authenticated: its KEL is held and its current keys signed the query to threshold. The refresh is skipped when the agent can address no attester for the subject (none with an accepted location). It is on demand only; nothing is watched or stored. The edge's first answer is what the agent held, unless its query named a sequence number or anchor the agent lacked, in which case the agent escrows it and answers after the refresh lands; a later query returns the refreshed state. A `tels` query is not refreshed.

  A relaying runtime's cue router no longer queues a query identical to one already queued, so repeated edge queries about one subject leave one request queued.

  The query sender no longer throws when the eligible attesters have no accepted location. It chooses at random among the eligible attesters that have one, still never promoting another role, and when none has one the request waits as unresolved work does. Before, a missing location threw a `ValidationError` that ended the sender's loop and, through hosted ingress, failed the HTTP request that caused the query.

  `@keri-ts/hosting`: `drainRuntimeCues` only routes cues; it no longer runs a query-sender pass inside the HTTP request. Queries a request causes (a relaying agent's refresh, a KRAM recovery query) are sent by the runtime's query-sender worker on its tock, so the request never waits on or fails from them.

  New: `WitnessInquisitor.enqueueCueOnce`, `addressableAttesters`, `relayRefreshCue`, and an optional trailing `relaying` argument to the `ProtocolProcessor` constructor.

- 2b4d8eb: An edge runtime resolves OOBIs and schemas through its relay and never fetches a third party's URL. For a job whose origin is not the relay's, the Oobiery asks the relay to resolve it with the existing `/oobis` exchange, sent through Poster and signed by a local identifier that has authorized the relay as its mailbox, then fetches the result from the relay's own OOBI endpoint and verifies it as it does for a direct fetch. A controller, witness, agent or mailbox OOBI `.../oobi/{cid}/{role}[/{eid}]` is read from `oobi/{cid}/{role}[/{eid}]` on the relay, and a schema OOBI `.../oobi/{said}` from `oobi/{said}`. While the relay answers 404, is unreachable, or answers without the controller's KEL, the job stays queued in state `relay-requested` (or `relay-pending` before the relay can be asked) and jobs waiting on the relay take turns. After `RELAY_OOBI_TIMEOUT_MS` (30 seconds from the first relay attempt, on the runtime clock) it fails as `relay-unresolved` or `relay-unserved`. Another non-OK answer fails at once, as before, and a URL naming neither an identifier nor a SAID fails as `relay-unmappable-oobi`. The relay's own OOBI and any URL on an accepted relay location are fetched directly. The Oobiery takes an `OobiRelaying` (relay, Poster and clock), or null, after its cues, and `isRelayOrigin` exposes the relay-origin test the egress guard uses.

  On a relaying agent (`AgentRuntimeOptions.relaying`), the `/oobis` handler accepts a request only from a served sender, by the same rule as `/fwd` relaying (`servingHost`, now exported from the forward handler). In `@keri-ts/hosting`, a relaying host's OOBI endpoint also answers for any identifier whose accepted KEL it holds, through its service habitat, as KERIpy's `OOBIEnd` does with a default habitat; `AgentRuntime.relaying` tells the host it relays. A runtime without `relay` or `relaying` behaves as before.

- Updated dependencies [99c3866]
- Updated dependencies [d25473f]
- Updated dependencies [fa7cf41]
- Updated dependencies [a0a38f2]
- Updated dependencies [a7a6a70]
- Updated dependencies [16b4b0b]
- Updated dependencies [ef7a960]
- Updated dependencies [597a130]
- Updated dependencies [59a5462]
- Updated dependencies [b92b5f4]
- Updated dependencies [9cea907]
- Updated dependencies [979f05b]
- Updated dependencies [28eefde]
- Updated dependencies [d97fb7d]
- Updated dependencies [e50c77d]
- Updated dependencies [0dc3b5e]
- Updated dependencies [6bb21ba]
- Updated dependencies [8991821]
- Updated dependencies [0d7b71b]
- Updated dependencies [5376227]
- Updated dependencies [250cd4f]
- Updated dependencies [77865d3]
- Updated dependencies [f516489]
- Updated dependencies [76cfbba]
- Updated dependencies [886f2a5]
- Updated dependencies [2b4d8eb]
- Updated dependencies [f89b27c]
- Updated dependencies [edda12e]
- Updated dependencies [5a79358]
- Updated dependencies [d64e69e]
- Updated dependencies [00bed9a]
- Updated dependencies [fa60668]
- Updated dependencies [b23407f]
- Updated dependencies [102dfe0]
  - keri-ts@2.2.5

## 2.2.4

### Patch Changes

- Updated dependencies [7849724]
  - keri-ts@2.2.4

## 2.2.3

### Patch Changes

- b8ec57c: Republish pinned to keri-ts 2.2.3, so a host does not resolve a second copy of keri-ts.

## 2.2.2

### Patch Changes

- 0c41d14: A host serves the OOBI of an identifier whose accepted, uncut end-role record names one of the host's local identifiers as `eid` in the requested role, so a group's agent answers for the group even when `hostedPrefixes` is empty. Identifiers with no accepted end role at the host, other roles, and cut roles still return 404; `hostedPrefixes` remains the direct shortcut and, when non-empty, is the operator's scope: the named agent must be in it. Empty or absent, any local identifier qualifies.
- bee9c32: Two fixes for a custodial host that keeps many identifiers in one Habery.

  A signer the host releases (`Manager.release()`) no longer ends a running runtime. The mailbox poll for an identifier whose key is not held, and any other background loop that needs one, hit `Missing prikey in db for pubkey=...` and the runtime task failed, as did restarting while the signer was released. The error is now a typed `SignerNotHeldError` (same message, with the public key). The mailbox poller ends such a poll as a new `unsignable` outcome and waits; every runtime loop (queries, Poster, cues, escrows, OOBI, authentication, signals, delegation, Counselor, KEL publisher, operation owners) restarts after one. Each waiting loop is listed in `runtime.signerConditions` (`SignerCondition`: loop, missing public key, since) and the wallet's `health()` reports `signer-unavailable` with that list. `Manager.hold()` now notifies `Manager.onHold` listeners, and the runtime uses it to resume the waiting loops at once.

  Several local identifiers may now advertise one ingress URL. A POST to the shared path used to answer 409 `Ambiguous hosted endpoint path` and a custodial host needed the `hostedPrefixes: []` policy to work. The handler now picks among the identifiers sharing the longest matching path by the request's `CESR-DESTINATION` (`resolveHostedEndpointPath` takes it as an optional argument); a request with no destination, or one naming none of them, still answers 409. Per-identifier paths are unchanged.

## 2.2.1

### Patch Changes

- ea1c337: `@keri-ts/registrar`, `@keri-ts/observer` and `@keri-ts/verifier` were not republished with 2.2.0, and their 2.1.0 tarballs pin keri-ts 2.1.0 exactly, so a keri-ts 2.2 consumer could not use them. They are republished against keri-ts 2.2 with no API change of their own: their sources type-check and their package tests pass unchanged on the 2.2 sources. `@keri-ts/hosting` is republished as well, because its tarball pins keri-ts exactly and 2.2.0 would otherwise bring a second copy of keri-ts into a consumer's tree.

## 2.2.0

### Minor Changes

- b544564: `tufa oobi resolve`, `tufa dkr resolve` and the hosted DID resolver wait on the OOBI they were asked for (`waitForOobi` / `oobiStatus`) instead of on every pending runtime job. Unrelated pending group proposals, delegation escrows or queries no longer make an OOBI resolution time out. A timeout now reads `OOBI <url> did not resolve within <ms>ms.`

### Patch Changes

- 80d3943: The CORS preflight now allows the `CESR-Genus` and `Authorization` request headers. A browser page could not send a v2 detached CESR POST (which carries `CESR-Genus`) or a witness TOTP code (`Authorization`) to a Tufa-hosted witness or mailbox: the preflight refused them.

## 2.1.0

### Minor Changes

- Release 2.1.0 for every published package. It adds the SEDI `I1I` and `DI1I` issuer-identity Edge operators with KERIpy's open Grant walk as the default, a pluggable store contract (ADR-0015) that lets `keri-ts/db` and `keri-ts/runtime` be bundled for a browser over `MemStore` or IndexedDB-backed `WebDBer`, automatic registry root replication to group members at issuance and after rotation, and KERIpy's handling of v2 ACDC sections without a top-level `d`.

  This release contains breaking changes. Upgrade every `@keri-ts/*` package and `cesr-ts` together and follow the [upgrade guide](../../docs/reference/compatibility/MIGRATING_FROM_2_0.md).

  **Breaking changes**

  - The native LMDB surface moves from `keri-ts/db` to `keri-ts/db/lmdb`: `LMDBer`, `PathManager`, `openLMDB`, the `create*` store factories and, from `keri-ts/runtime`, `createHabery`. `openRegistry` requires an `opener` and loses `web`; `openLmdbRegistry` is the LMDB default.
  - Host-only transport moves from `keri-ts/runtime` to `keri-ts/runtime/node`: `Configer` and `createConfiger`, `NodeHttpClient`, `TCPMessenger`, `TCPStreamMessenger`, the TCP send helpers, `socketBytes` and `fileBytes`. `FetchHttpClient` can no longer reach `tcp:` endpoints; use `NodeHttpClient`.
  - The new `openHabery` needs a `StoreOpener` or borrowed stores, and one of `cf`, `createConfig` or `skipConfig`. `createHabery` keeps its arguments.
  - `Baser`, `Keeper`, `Reger`, `Noter`, `Mailboxer`, `RegBaser`, `WalletBaser` and `VerifierCueBaser` compose over an injected `DBer`; their constructors take a store and their LMDB path statics become `Family`. `Suber`, `Komer` and `LMDBer` table methods take an opaque `Table`.
  - `LMDBer` behavior: empty dupsort values and empty or over-long keys throw `DatabaseKeyError`, `addVal` no longer accepts `null`, duplicate reads of an empty key report absent, and failures raise `DatabaseKeyError`, `DatabaseNotOpenError` or `DatabaseOperationError` instead of a bare `Error`.
  - Config files move from `keri/cf/{base}/{name}/{name}.json` to `keri/cf/{base}/{name}.json`, the default `Configer` base is `main`, and the `--compat` home fallback is `~/.keri/cf`. Absolute `--base` and names are refused, the store directory is set to owner-only mode on every open, and an unusable store directory falls back to the home directory.
  - Delivery to a recipient, witness or mailbox whose latest accepted event is KERI v1 fails with `PeerVersionError` instead of sending v2.
  - Grants walk open by default, as in KERIpy. `walkIpexGraph` takes a `"open" | "closed"` policy instead of a boolean and `AcdcGraph` carries it as `walk`; pass `grantWalk: "closed"` for the 2.0 refusal of every Grant that omits a far node.
  - Edge chain evaluation follows KERIpy more strictly: unrecognized unary operators and `NOT` are non-retryable unknowns, every schema pin is checked, and a list, falsy or `n`/`w`-bearing Edge Section is malformed.
  - A v2 ACDC attribute, edge or rule section without a top-level `d` is no longer given one. The bytes and SAID built for such a body change to KERIpy's; credentials authored by 2.0.x keep their inserted `d` and still verify.

- d80ccc5: Move to `cesr-ts` and `keri-ts` 2.1.0 so this package and its dependents no longer install libsodium.

### Patch Changes

- c22f1c6: Breaking: `keri-ts/db` and `keri-ts/runtime` are backend-neutral and the native LMDB surface moves to `keri-ts/db/lmdb`. Import `LMDBer` and its options and defaults, `PathManager`, `openLMDB`, `createLMDBer`, `readStoredLmdbMapSize`, `resolveLmdbMapSize`, `clearDatabaserDir`, `BinKey`, `BinVal`, the `create*` store factories and `createHabery` from `keri-ts/db/lmdb`. `openRegistry` now requires an `opener` and loses its `web` option; `openLmdbRegistry` replaces its LMDB default.
- c9d7528: Breaking: `keri-ts/runtime` no longer exports host-only transport. Import `TCPMessenger`, `TCPStreamMessenger`, the `tcp-egress` helpers (`openTcpConnection`, `sendCesrTcp*`, `streamCesrTcp`, `writeCesrTcpSocket` and their types), `socketBytes`, `NodeHttpClient`, `nodeTcpDialer` and `fileBytes` from the new `keri-ts/runtime/node` entrypoint, so `keri-ts/runtime` reaches neither `node:` modules nor the `Deno` global through its transport code. `requireTcpDialer` and `TcpDialer` stay on `keri-ts/runtime`.
- a127ef9: Breaking: TCP egress goes through an optional `HttpClient.tcp` dialer. `FetchHttpClient` has none, so reaching a `tcp:` witness, mailbox or recipient through it now fails with `ValidationError: TCP endpoints are unavailable on this host.`; pass `NodeHttpClient` from `keri-ts/runtime/node`, which supplies the existing TCP behavior.

## 2.0.1

### Patch Changes

- 1f23273: Depend on keri-ts 2.0.1, which rejects credentials whose body does not match their SAID. These packages pin keri-ts to an exact version, so they must be republished for the fix to reach their installs.

## 2.0.0

First npm release, coordinated with cesr-ts and keri-ts 2.0.0.

### Minor Changes

- Extract the existing HTTP host/kernel, Hono app policy and connected protocol routes into `@keri-ts/hosting`, with unchanged listener, routing and cleanup behavior. Tufa retains CLI and role composition and imports the hosting package directly; hosting imports move from Tufa runtime subpaths to the new public package.
- Add a hosted-witness backend with public receipt service and a separate loopback-only provisioning listener for KERI Foundation allocation.

  Emit receipt bodies and attachments in the receipted event's version, and return v2 signed witness key-state notices.

- Run Registrar and Observer through normal TLS service commands with persistent private account enrollment. Keep configured Observer source access separate from revocable wallet publication/read permissions, and preserve both service state and permissions across restart.

### Patch Changes

- Compose ACDC v2 wallet IPEX negotiation, explicit unblinding and exact-view presentation through the existing CLI family. Gather required source-anchor receipts before returning Grant/Admit wire, preserve separate presenter authorization and holder consent, and select witness attachment genus independently of message body version.

  Forward explicit operator KRAM configuration through finite and hosted operations, and preserve registry aliases across installed Node command invocations.

- Retain the first authenticated, scoped DH or Unblind query in its actual owner until explicit consent, bounded by the original query and Grant lifetimes. Restore ordinary KRAM replay rejection and acknowledge unhandled custom-query transport without consuming its cache.
- Make the Tufa hosted witness backend follow upstream witness-hk for the whole TOTP workflow. `POST /aids` accepts the controller's full KEL (as KERIpy `kli witness authenticate` and Locksmith send it), so controllers can register or re-register after rotation; the parser alone authenticates events, and a supplied `secret` is used as given. On `POST /receipts` an invalid or missing code no longer returns 403: the event is processed as remote input (202 while escrowed, 200 with the receipt once accepted). A multi-event `/receipts` body is 400, and an unknown destination on `/aids` or `/receipts` is 400. Core `witnessReceiptPost` and hosting `handleWitnessReceiptPost` gain an optional `{ local }` option (default `true`), and hosting exports `handleWitnessReceiptPost`.
- Add scheduled HTTPS source observation and signed cache-only registry queries, with exact accepted heads and explicit freshness. Preserve CESR-v2 framing across full evidence replay and native query storage.
