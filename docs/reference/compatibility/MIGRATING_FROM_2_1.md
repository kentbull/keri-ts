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

- `openWebWallet` returns `identifiers`, `oobis`, `mailboxes`, `credentials`, `groups` and `proposals`. They share one
  `WalletScope` they hold (no base class), their option and outcome types are named and exported, and the namespace
  classes are exported as types only. Group identifiers use the same `credentials` calls; see the guide.
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
  the fixed `OWNER_TOCK_MS` (`DoerPacing`); `OWNER_BUSY_MS`, `OWNER_IDLE_MS`, `OwnerWake`,
  `operations.wake` and the publisher's busy and idle cadences never shipped.

## New runtime options and status fields

- `createAgentRuntime` / `openWebWallet`'s `runtime` option take pacing and retry values, each with a production default:
  `ownerPacing`, `publisherPacing`, `protocolPacing` and `pollerPacing` (`DoerPacing`: `tockMs`, `sweepTocks`; a host may
  slow them for a background tab or battery), `operationRetry`, `counselorReceiptRetry` and `kelPublishRetry`
  (`RetryPolicy`: `baseMs`, `maxMs`, `boundMs`), `issuanceQueryResendMs`, and `mailboxPolling` (request-open, poll-window,
  read-idle and refusal back-off times). See the [wallet guide](../../design-docs/runtime/WALLET_LIBRARY_GUIDE.md#pacing).
- Active issuance, presentation and Unblind statuses carry `failure` (`attempts`, `reason`, `retryAt`) while a delivery
  is being retried. Presentation status has no `attempts` or `blocked` fields, and `present` has no `maxAttempts`.
- The `IPEX` owner functions derive the party from the Grant (`beginIssuance(ops, grant)`, `approveIssuanceExchange(ops, grant)`, `admitIssuance(deps, grant)`, `requestUnblind(ops, grant, options?)`), and group issuance is
  `proposeGroupIssuance` / `approveGroupIssuance` with `groupIssuanceElection`; see the guide. Holders can use the
  `receiveIssuance` and `admitAndDeliver` workflows instead of sequencing the calls.
- `RegistryRoot` takes an optional `ChangeSink` and publishes `{ kind: "root", id: registry }` when it retains a copy.

## Tufa CLI

- `tufa ipex` group issuance: `--coordinator` is optional (default the group's latest establishment event) and
  `--custodian` is optional and only asserts the custodian the election names. `tufa ipex admit --acdc-v2` calls the
  `admitAndDeliver` workflow with unchanged flags and output.
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

## Patch releases 2.2.1 to 2.2.5

2.2.1 and 2.2.2 fix defects found by qualification; read their notes:
[2.2.1](../../versioning/2.2.1-release-notes.md) and
[2.2.2](../../versioning/2.2.2-release-notes.md). 2.2.3 adds
`replaceGroupMember` for a group's local member; see the
[2.2.3 notes](../../versioning/2.2.3-release-notes.md). 2.2.4 cuts the CPU cost of an idle runtime
and changes no call; see the [2.2.4 notes](../../versioning/2.2.4-release-notes.md). 2.2.5 fixes
ways a remote party could end an agent's runtime (2.2.4 and earlier are affected), adds relay mode,
retires a replaced group member, adds wallet recovery and refill, and removes or changes several
exported names: `Manager.release`, `SignerCondition`, `settleProposedRotation`, the poller and
Revery callbacks, `RuntimeOperations.health` and others, and `OpenWebWalletOptions.delivery` is now
required. Read the [2.2.5 notes](../../versioning/2.2.5-release-notes.md), especially its Breaking
changes list, before upgrading. 2.2.2 changes types a 2.2.0
caller may already use:

- The IPEX disclosure options take `priorSaid` only; `prior` is a type error and is refused
  with a `ValidationError` when untyped.
- A wallet group's `credentials.present` requires `verb`.
- `unblindingStatus` returns `interrupted` for a discloser that has not begun, where it threw.
- The issuance and Unblind operation tables are private; use `liveOf`, `endedOf` and
  `settledOf`.
- `settleProposedRotation` takes a `ProposedRotation`.
- Schemas are validated by `@cfworker/json-schema`: `$dynamicRef` and an unknown `$schema`
  are refused.

## Known limits

See [Known limits in 2.2.0](../../design-docs/runtime/WALLET_LIBRARY_GUIDE.md#known-limits-in-220).
