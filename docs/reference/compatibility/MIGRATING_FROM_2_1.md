# Upgrading from 2.1.x

For anyone on **keri-ts 2.1.0** and the matching `@keri-ts/*` packages moving to **2.2.0**. The
2.2.0 train made the library, not the CLI, the owner of workflows, and added the browser wallet.
Backward compatibility with 2.1.0 is not a goal: removed APIs have no shim, deprecated alias or
migration reader. LMDB data keeps its format. Wire formats are unchanged unless stated.

Upgrade every `@keri-ts/*` package together; each pins `keri-ts` to an exact version. The list
below is built from the changesets under `.changeset/` and checked against the 2.1.0 tag
(`v2.1.0`); a name that never existed in 2.1.0 is not listed. See also the
[wallet developer guide](../../design-docs/runtime/WALLET_LIBRARY_GUIDE.md).

## New entry points

| Entry                  | What it is                                                            |
| ---------------------- | --------------------------------------------------------------------- |
| `keri-ts/db/indexeddb` | `indexedDbOpener`, `IndexedDbPersistence`; single-writer by default   |
| `keri-ts/runtime/web`  | `barrierHttpClient`, `acquireStoreLock`, `requestPersistentStorage`   |
| `@keri-ts/wallet/web`  | The wallet root surface plus `openWebWallet` and the wallet-level API |
| `@keri-ts/wallet/lmdb` | `createWalletBaser` (moved from the wallet root)                      |

`keri-ts`, `keri-ts/runtime`, `keri-ts/runtime/web`, `keri-ts/db`, `keri-ts/db/indexeddb`,
`cesr-ts`, `@keri-ts/wallet` and `@keri-ts/wallet/web` carry a polyfill-free `browser` export
condition. `keri-ts/cli`, `keri-ts/db/lmdb`, `keri-ts/runtime/node` and `@keri-ts/wallet/lmdb`
are Node-only.

## Wallet package

- `createWalletBaser` is no longer exported from `@keri-ts/wallet`. Import it from
  `@keri-ts/wallet/lmdb`. The root is now browser-safe and exports `openWalletBaser(opener, identity)`; `@keri-ts/wallet/web` adds `openWebWallet`.
- `openWebWallet` is new in 2.2.0 (it was not in 2.1.0), so there is no earlier `WebWalletHealth`
  to migrate from. Its `runtime` option narrows to `kram` and `operationStores`.

## Runtime composition (`keri-ts/runtime`)

Removed outright:

- The `ipexAuxiliary` option, `AgentRuntime.ipexAuxiliary`, `IpexAuxiliary` and
  `IpexAuxiliarySelection`. Every runtime of a writable Habery now composes the per-identifier DH
  and Unblind owners, `runtime.operations` and (unless `registryRoots: "refuse"`) the root
  replicator, with no option. Use `runtime.ipex.dhke(hab)` and `runtime.ipex.unblind(hab)`. A
  read-only Habery has `ipex === null`. KRAM is still off when `kram` is omitted, and then the
  owners' `approve` throws a "requires KRAM" error.
- `approvePendingMultisigProposal`, `MultisigApprovalCallbacks` and `ApprovalPromptContext`.
  Choose with `listGroupProposals` or `findGroupProposal` and approve with
  `approveGroupProposal(deps, said, { groupAlias, registryName })`; calling it is the consent and
  nothing prompts. `MultisigApprovalOptions` keeps only `resume`, `groupAlias` and `registryName`.
- `approveUnblind`. The discloser consented by signing the Grant, so an authenticated Unblind
  query for a live Grant that identifier sent is answered automatically, bounded by the Grant's
  registry scope and deadline. `requestUnblind` stays the disclosee's step.
- `RootCopyReport`, `RootResealFailure`, `replicateRegistryRoots` and `resealRegistryRoots`.
  Use `replicateRootCopies` and `resealRootCopies`, which return typed `RootCopyResult` values
  (`sent`, `deferred`, `refused`, `failed`). `RootCopyRecovery` remains a CLI-side line type.
- `runPresentationUnblind`, `awaitGroupIssuanceProof` and `acceptGroupIssuanceProof` (Tufa
  internals, replaced by library calls and `acceptGroupDerivedProof`).

Changed:

- `Unblind.approve(grant, { states })` and `Unblind.start(grant, { states })` take the
  credential-state vocabulary (default `["issued", "revoked", ""]`). The `Unblind` constructor no
  longer accepts `states` or `now`, `IpexAuxiliaries.unblind(hab)` takes no vocabulary, and the
  `awaitingQuery` phase is gone.
- `kram: { enabled: true }` without `caches` now installs `DEFAULT_KRAM_CACHES`
  (`~: [1000, 5000, 60000, 300000, 5000, 60000, 300000]` ms) instead of failing with "No KRAM
  cache type for message" on the first non-exempt v2 message. Explicit `caches` are unchanged.
- Library waits return `{ outcome: "timed-out", ... }` values instead of throwing (`waitForOobi`,
  `resolveOobi`, `queryKeyState`, `queryAnchor`, `waitForDelegation`), and take small declared
  collaborators instead of an `AgentRuntime`.
- `IssuanceDelivery.deliver` returns the destinations reached; `posterDelivery` hands the Poster
  the whole wire as a stream, so multi-frame wires reach a mailbox relay.
- A delivery failure no longer ends a DH issuance at the first error: it retries with a doubling
  delay (`RetryBackoff`) until the Grant deadline, or until `ISSUANCE_RETRY_BOUND_MS` (10 minutes)
  for a group issuer without a deadline.
- A DH query that reaches an Issuee before its consent is persisted (`Baser.heldq`), so it
  survives a restart, and so does an Unblind request the discloser owes a reply to (`Baser.heldu`).
- New durable tables, ignored by KERIpy: `rrsn.` (root copies sent, keyed group, registry,
  recipient), `Baser.heldq` (held DH queries), `Baser.heldu` (owed Unblind requests), `kpub.` (the KEL each mailbox last accepted) and, in the registry database, `dvus.`
  (blind-derivation coordinates). The first pass on a store from before `rrsn.` sends one root copy per other member
  per held registry once.
- `OWNER_LOOP_MS` does not exist in any release; the owners run on one fiber with
  `OWNER_BUSY_MS` and `OWNER_IDLE_MS`.

## Tufa CLI

- `tufa delegate confirm` gains `--timeout <seconds>` (default 30) and its errors say which
  request or anchor never arrived.
- `tufa witness start` and `tufa mailbox start` accept `--version 1.0|2.0` for the host AID they
  create (default 2.0; an existing alias keeps its KEL version).
- `tufa multisig incept|rotate|interact|rpy` sign only the event they were asked to propose; a
  pending proposal from another member stays unsigned until `multisig join`. `--endpoint` no
  longer selects a different receipting path (the Counselor receipts over HTTP and falls back to
  TCP). A delegated group `incept` or `rotate` without `--proxy` fails before the event is
  authored. `multisig join --auto` approves without asking only inside `join`.
- `--witness-gvrsn` no longer reaches the group DH issuance path.
- `tufa oobi resolve`, `tufa dkr resolve` and the hosted DID resolver wait on the OOBI they were
  asked for; a timeout reads `OOBI <url> did not resolve within <ms>ms.`
- `tufa ipex unblind --grant` run as the discloser only listens and delivers the reply.
- Other commands named in the changesets (`ipex`, `vc registry`, `challenge`, `mailbox`) call the
  library with unchanged flags and output.

## Mailboxes and hosting

- A rotation is announced to the identifier's mailboxes by the runtime's `KelPublisher` (a cue from
  `completeEvent` and the Counselor, its own fiber, a durable `Baser.kpub` record). `completeEvent`
  and the Counselor push a `RotatedCue`; they no longer post inline, and `EventCompletion.mailboxes`
  and `tellMailboxes` do not exist. The wallet exposes `mailboxes.publication` and
  `mailboxes.waitForPublication`, and `health()` reports `mailbox-unreachable`. See the
  [wallet guide](../../design-docs/runtime/WALLET_LIBRARY_GUIDE.md#mailboxes-and-rotation).
- A mailbox poll that fails (unreachable host, refusal, no response) backs off and no longer stops
  the runtime; the poller no longer posts the KEL itself, a 403 asks the `KelPublisher` to post it
  again.
- The CORS preflight allows the `CESR-Genus` and `Authorization` request headers.
- `FetchHttpClient` requests can be cancelled in WebKit.

## Known limits

See [Known limits in 2.2.0](../../design-docs/runtime/WALLET_LIBRARY_GUIDE.md#known-limits-in-220).
