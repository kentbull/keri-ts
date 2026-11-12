# @keri-ts/hosting

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
