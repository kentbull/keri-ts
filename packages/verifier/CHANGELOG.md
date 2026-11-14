# @keri-ts/verifier

## 2.2.3

### Patch Changes

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
  - @keri-ts/registrar@2.2.3

## 2.2.2

### Patch Changes

- Updated dependencies [7849724]
  - keri-ts@2.2.4
  - @keri-ts/registrar@2.2.2

## 2.2.1

### Patch Changes

- b8ec57c: Republish pinned to keri-ts 2.2.3, so a host does not resolve a second copy of keri-ts.
- Updated dependencies [b8ec57c]
  - @keri-ts/registrar@2.2.1

## 2.2.0

### Minor Changes

- ea1c337: `@keri-ts/registrar`, `@keri-ts/observer` and `@keri-ts/verifier` were not republished with 2.2.0, and their 2.1.0 tarballs pin keri-ts 2.1.0 exactly, so a keri-ts 2.2 consumer could not use them. They are republished against keri-ts 2.2 with no API change of their own: their sources type-check and their package tests pass unchanged on the 2.2 sources. `@keri-ts/hosting` is republished as well, because its tarball pins keri-ts exactly and 2.2.0 would otherwise bring a second copy of keri-ts into a consumer's tree.

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

- f05aff1: Breaking: add a Grant walk policy, `grantWalk: "open" | "closed"`, to `loadIpexHandlers` and `AgentRuntimeOptions`. The default is `"open"`, matching KERIpy. Under `"open"` a far node the Grant does not carry is a permanent unknown: an OR group with a valid sibling accepts, and an AND group or a sole Edge refuses at once without escrow. `"closed"` refuses any Grant that omits a far node, as every Grant did before. A node the disclosure plan selects but the Grant does not nest refuses under both. The internal `walkAcdcGraph` and the exported `walkIpexGraph` now take the policy instead of a `closed` boolean, the exported `AcdcGraph` interface requires it as `walk`, carrying it into `evaluateChain`, and `ipexGrantWalk(exchanger)` returns the configured policy. Wallet admission, disclosure and fresh issuance, ACDC v2 group approval and the verifier's current check now walk under the exchanger's policy, so they accept the same Grants the handler admits.
- 15237dd: Breaking: `WalletBaser` and `VerifierCueBaser` compose over an injected `DBer` instead of extending `LMDBer`. Construct them with `createWalletBaser` and `createVerifierCueBaser`; `VerifierCueBaser.TailDirPath`, `AltTailDirPath`, `CompatAltTailDirPath` and `TempPrefix` are replaced by `VerifierCueBaser.Family`. The wallet drops its `node:buffer` dependency in favor of standard base64 helpers. Stored values and paths are unchanged.
- c22f1c6: Breaking: `keri-ts/db` and `keri-ts/runtime` are backend-neutral and the native LMDB surface moves to `keri-ts/db/lmdb`. Import `LMDBer` and its options and defaults, `PathManager`, `openLMDB`, `createLMDBer`, `readStoredLmdbMapSize`, `resolveLmdbMapSize`, `clearDatabaserDir`, `BinKey`, `BinVal`, the `create*` store factories and `createHabery` from `keri-ts/db/lmdb`. `openRegistry` now requires an `opener` and loses its `web` option; `openLmdbRegistry` replaces its LMDB default.

## 2.0.1

### Patch Changes

- 1f23273: Depend on keri-ts 2.0.1, which rejects credentials whose body does not match their SAID. These packages pin keri-ts to an exact version, so they must be republished for the fix to reach their installs.

## 2.0.0

First npm release, coordinated with cesr-ts and keri-ts 2.0.0.

### Major Changes

- Use one upstream-aligned ACDC chaining evaluator for IPEX and application use.
  Remove the private graph evaluator and its unsupported operator/schema profiles.
  Applications supply issued-state verdicts, including the origin, and retain unknown
  optional branches until AND/OR reduction; schema and graph-shape failures remain global.

### Minor Changes

- Extract the existing credential verifier application, cue store, business policy and webhook workflow into `@keri-ts/verifier`. Tufa retains CLI registration and host composition and consumes the package directly; verifier imports move from `@keri-ts/tufa/runtime` to the new public package without a forwarding facade.

### Patch Changes

- Verify retained ACDC v2 Grant views against current authenticated observer evidence and shared graph policy, with read-only historical inspection and exact Grant-keyed reporting through existing cue stores.
- Retain authenticated per-Grant registry observations atomically with accepted IPEX evidence, preserve the first disclosed paths on later deliveries, and expose labeled read-only historical observations without changing current-authority policy.
- Use the runtime HTTP client and ordinary HTTPS certificate validation for ACDC v2 observer requests. Move observer selection, observation age and request timeout into the verifier application configuration, removing the dedicated observer and TLS command-line options.
