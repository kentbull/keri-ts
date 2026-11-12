# @keri-ts/hosting

## 2.1.1

### Patch Changes

- c22f1c6: Make `keri-ts/db` and `keri-ts/runtime` backend-neutral and move the native LMDB surface to `keri-ts/db/lmdb`. This breaks imports of `LMDBer`, `createHabery`, the `create*` store factories and `openRegistry`'s LMDB default from their old entrypoints; import them from `keri-ts/db/lmdb` (`openLmdbRegistry` replaces the default).
- c9d7528: Add the `keri-ts/runtime/node` entrypoint for host-only transport: `TCPMessenger`, `TCPStreamMessenger`, the `tcp-egress` and `socketBytes` helpers, `NodeHttpClient`, `nodeTcpDialer` and `fileBytes`. `keri-ts/runtime` no longer exports them, so it reaches neither `node:` modules nor the `Deno` global through its transport code; import them from `keri-ts/runtime/node` instead. `requireTcpDialer` and `TcpDialer` stay on `keri-ts/runtime`.
- a127ef9: Route TCP egress through an optional `HttpClient.tcp` dialer, so browser hosts without sockets get a clear error and `NodeHttpClient` supplies the existing TCP behavior.

## 2.1.0

### Minor Changes

- d80ccc5: Move to `cesr-ts` and `keri-ts` 2.1.0 so this package and its dependents no longer install libsodium.

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
