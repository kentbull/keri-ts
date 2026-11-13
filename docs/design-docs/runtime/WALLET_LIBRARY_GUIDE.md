# Wallet developer guide

For someone embedding keri-ts in a wallet, most often a browser app on IndexedDB. The runtime
and its workflows are library code; Tufa is one caller of them, not the owner of any behavior.
Source is the authority. Statements below that the code does not show are marked
**unconfirmed**.

Related: [store contract (ADR-0015)](../../adr/adr-0015-pluggable-store-contract.md),
[held signers (ADR-0016)](../../adr/adr-0016-held-signers-and-presigned-habs.md),
[ingress and egress](INGRESS_AND_EGRESS.md), [mailbox](../mailbox/MAILBOX.md),
[IPEX](../exchange/IPEX.md), [2.1 to 2.2 migration](../../reference/compatibility/MIGRATING_FROM_2_1.md).

## Entry points

| Import                 | Purpose                                                                                     | Browser |
| ---------------------- | ------------------------------------------------------------------------------------------- | ------- |
| `keri-ts/runtime`      | Runtime, workflows, operation owners, proposals, Counselor                                  | yes     |
| `keri-ts/runtime/web`  | `barrierHttpClient`, `acquireStoreLock`, `requestPersistentStorage`                         | yes     |
| `keri-ts/db`           | Backend-neutral stores and `StoreOpener`                                                    | yes     |
| `keri-ts/db/indexeddb` | `indexedDbOpener`, `IndexedDbPersistence` (single-writer by default)                        | yes     |
| `keri-ts/db/lmdb`      | LMDB backend                                                                                | no      |
| `keri-ts/runtime/node` | TCP and local files                                                                         | no      |
| `@keri-ts/wallet`      | `Wallet` inventory, `WalletAuthor`, `RegistryCustody`, `WalletDiscloser`, `openWalletBaser` | yes     |
| `@keri-ts/wallet/web`  | The root surface plus `openWebWallet` and the wallet-level API                              | yes     |
| `@keri-ts/wallet/lmdb` | `createWalletBaser` (LMDB inventory)                                                        | no      |

Entries marked "yes" carry a `browser` export condition; the npm bundle gate
(`scripts/npm/check_browser_bundle.mjs`) bundles them with esbuild and rejects Node-only
modules.

## Opening a browser wallet

`openWebWallet({ name, bran })` (or `seed` with `aeid`) composes, in order: one
`indexedDbOpener` (which takes the Web Locks single-writer lock for the wallet's identity), an
encrypted Habery (an unencrypted keeper is refused with `UnencryptedKeeperError`), the
persistent-storage request, the wallet inventory on the same queue, `createAgentRuntime` over
the output-barrier HTTP client, and `runAgentRuntime` with mailbox polling. The barrier holds
every request until the commit that preceded it is durable (ADR-0015 rule 6).

Defaults a host can override through `runtime`: KRAM is on with `WALLET_KRAM_CACHES` (5 minute
drift, 24 hour acceptance and pruning windows, so a wallet offline for hours can drain its
mailbox), and `operationStores.derived` is the wallet's `derived-updates.` table so
`recordIssued` can read derivation coordinates.

`close()` stops the runtime, flushes and closes every store, then releases the lock, and rejects
with every failure after all steps ran. After a latched persistence failure, `close()` then
`openWebWallet()` loads the last durable state.

## The wallet-level API

Promise-returning, typed, and the wallet owns the Effection bridge (`wallet-api.ts`):
an app never calls `run(...)`.

| Call                                         | Result `outcome`                                      |
| -------------------------------------------- | ----------------------------------------------------- |
| `identifiers.incept(opts)`                   | `complete`, `incomplete` (with `reason`), `timed-out` |
| `identifiers.rotate(pre, opts)`              | as `incept`                                           |
| `identifiers.complete(pre, opts)`            | as `incept`; retries receipts and the delegation wait |
| `oobis.resolve(url, opts)`                   | `resolved`, `failed`, `timed-out`                     |
| `mailboxes.add / remove(pre, mailbox, opts)` | `authorized` / `revoked`, `rejected`, `timed-out`     |
| `credentials.pending(pre?)`                  | pure read of Grants awaiting consent                  |
| `credentials.receive(grant, opts)`           | `admitted` (with `delivery`), `ended`, `timed-out`    |
| `credentials.resendAdmit(grant)`             | `delivered` or `undelivered` delivery state           |
| `credentials.issue(opts)`                    | `issued`, `ended`, `timed-out`                        |
| `credentials.present(input, opts)`           | `delivered`, `ended`, `timed-out`                     |
| `credentials.requestProof(pre, options)`     | the verifier's `apply`, as `present`                  |
| `credentials.presentations(pre?)`            | pure read of pending presentation Grants              |
| `credentials.unblind(grant, opts)`           | `unblinded`, `ended`, `timed-out`                     |

Every call that waits takes `timeoutMs` (defaults in `WALLET_TIMEOUTS`). After `timed-out` the
operation keeps running in the runtime; `receive` and `unblind` called again resume it, and a
finished `issue` is recorded in the inventory by the wallet's own `ChangeSink`. `receive` records
the admission before it delivers the Admit, so consent is on record whatever the network does.
`issue` takes an optional `registry`; omitted, each issuance gets a fresh registry, because a DH
exchange derives a registry's root with the recipient and the registry takes it once.

`health()` returns `ok`, `latched` (a persistence write failed), `faulted` (the operation owners
recorded a fault outside any single operation), `stopped` (the runtime task ended without
`close()`; `cause` says why) or `closed`. A call on a stopped or closed wallet rejects with
`WalletStoppedError`.

Group identifiers are not covered by this surface yet; use the runtime directly (below).

## The workflow contract

Defined in `app/runtime/workflow-contract.ts` and followed by every library workflow:

- `begin*` is an explicit operation that returns after local commit. A consent call may sign.
- `*Status` is a pure synchronous read of durable state.
- `waitFor*` only observes. It starts no worker and returns `WaitResult`: `settled` or
  `timed-out`, each with the status read at return. Remote and time-driven outcomes are values;
  only caller-contract, invariant and infrastructure failures throw.
- Owners publish a `WorkflowChange` (`kind`, `id`) to a `ChangeSink` after commit. The sink is a
  hint: consumers re-read status. A sink must not throw into a workflow.
- Nothing in an operation blocks on a remote without a timeout.

## Operation owners

`runtime.operations` (a writable Habery's runtime always has it) holds in-memory live tables whose
status is derived from the protocol stores:

| Owner          | Consents (may sign)                                                                       | Pure reads and waits                                            |
| -------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `issuance`     | `beginIssuance`, `approveIssuanceExchange`, `admitIssuance` (then `deliverIssuanceAdmit`) | `issuanceStatus`, `pendingIssuanceGrants`, `waitForIssuance`    |
| `presentation` | `present` (offer, grant, apply, agree, spurn)                                             | `presentationStatus`, `waitForPresentation`                     |
| `unblinding`   | `requestUnblind` (the discloser answers its own Grant's queries with no consent call)     | `unblindingStatus`, `pendingPresentations`, `waitForUnblinding` |
| `groupIpex`    | `proposeGroupAdmit`, `proposeGroupIpex`, `approveGroupIpex`                               | `groupIpexStatus`, `groupIpexProposals`, `waitForGroupIpex`     |

`runAgentRuntime` drives all owners on one fiber: every `OWNER_BUSY_MS` (50 ms) while anything is
live, every `OWNER_IDLE_MS` (1 s) otherwise, and beginning an operation wakes it
(`operations.wake`). A failure that escapes an owner pass is recorded in `operations.health`
(`faults`, `last`) and the loop continues; a failure of one operation ends that operation as
`failed`. Delivery failures retry with a doubling delay (`RetryBackoff`, 1 s up to 30 s).

Presentation selects credentials from the embedder's inventory through
`OperationStores.views`; `openWebWallet` binds it to its `Wallet`. Without it only replies and
`apply` can be presented.

Restart behavior: status after a reopen is what the protocol stores prove. In-memory only: the
transient phases, `abandoned` and `failed` reasons, consent times, and the destinations of a
delivery. An issuance that had not anchored reads `interrupted` and needs a new Grant.
`resendPresentation(ops, said)` and `rebuildIssuanceAdmit(deps, admit)` rebuild a signed message
from stored signatures and deliver it again without signing.

## Groups

Group work is a set of explicit library calls plus the `Counselor`.

- **Proposals.** A member proposes with `proposeGroupInception`, `proposeGroupRotation`,
  `proposeGroupInteraction` or `proposeGroupEndpointRole`; each creates this member's event,
  hands it to the Counselor, publishes the proposal and returns without waiting. Other members
  see proposals with `listGroupProposals` / `findGroupProposal` (pure reads), approve with
  `approveGroupProposal(deps, said, ...)` (calling it is the consent; nothing prompts), or hide
  the notice with `dismissGroupProposal` (KERI has no reject message). Registry events use
  `proposeRegistryEvent`; legacy credential events `proposeCredentialRegistry`,
  `proposeCredentialIssue`, `proposeCredentialRevocation`; a group mailbox role
  `proposeGroupMailbox` then `completeGroupMailbox`; a group delegator's approval
  `proposeGroupDelegationApproval` then `requestDelegatedEvent`.
- **Counselor.** `runtime.counselor` completes group events on KERIpy's `gpse`, `gpwe`, `cgms`
  rows: signature stage, witness receipts judged against the event's own witness set, and
  delegation. It acts only on events registered with `start` or `supply`, survives restarts, never
  signs, and lets a non-elected member submit receipts after `fallbackAfterMs`. Observe it with
  `waitForGroupEvent`. A group habitat is held across a reopen even while its inception is
  unaccepted.
- **Issuance and Admit.** A group issues or receives a v2 DH credential through
  `runtime.operations.issuance` (`prepareGroupIssuance`, `beginGroupIssuance`,
  `approveGroupIssuanceExchange`, `followGroupIssuanceProof`; `groupIssuanceProposals` lists what
  a member may consent to). A group's Admit or other v2 IPEX message goes through
  `runtime.operations.groupIpex`. Root copies for the other members come from the runtime's
  `RootReplicator`, which derives what is owed from state and records sent copies in `rrsn.`.

## Mailboxes and rotation

A mailbox is authorized by an accepted `/end/role/add` for the identifier, which `addMailbox`
(or `mailboxes.add`) posts to the provider as `application/cesr`. The runtime polls each
authorized mailbox. A mailbox accepts a poll only from an identifier whose current key state it
holds, so a rotation must reach it.

- **Completing a rotation tells the mailboxes.** `completeEvent` posts the KEL (delegation chain,
  KEL, stored receipts) to every mailbox the identifier has an authorized role with once a `rot`
  or `drt` is fully witnessed (`tellMailboxes`); its result carries one `told` or `failed` entry
  per mailbox, and an unreachable mailbox does not fail the rotation. The Counselor does the same
  when a group rotation completes, in each member runtime that has the group's role.
- **The poller repairs a lagging mailbox.** On a 403 for a fully witnessed KEL, the endpoint
  worker posts the KEL replay itself and polls again at once; if that is refused too it falls
  back to `RefusalBackoff` (1 s doubling to 30 s per consecutive refusal), so a refused query is
  never repeated in a tight loop.
- A keri-ts mailbox authorizes a poll for a group identifier signed by one of its members when the
  member's threshold is met and its key is in the group's current key list.

A separate publisher component for KEL delivery was being landed by another worker when this was
written; it is not in the tree and is **not described here**.

## Known limits in 2.2.0

- An issuer that ended between staging the registry update and anchoring it reads `interrupted`;
  the registry stays behind the unchanged DH refusal and needs a fresh registry. An explicit
  recovery action is planned.
- A DH registry takes one exchange. Against a KERIpy holder, which keeps the old rule and refuses
  a second exchange on a registry it holds a root for, the issuer needs a fresh registry.
- The Unblind discloser's owed reply is held in memory only. A group Unblind reply lost to a
  restart is therefore not resent; **unconfirmed in code beyond the memory-only statement**.
- A group member that rotates before its group is refused by a keri-ts mailbox, because the host
  checks the member's key against the group's current key list. **Inferred from the host rule
  above; not exercised.**
- A KERIpy controller using a keri-ts mailbox after rotating is not told by its own runtime: the
  mailbox learns of a rotation from `completeEvent` or the poller's repair, which are keri-ts
  behavior. **Inferred; not exercised.**
- A v1 identifier cannot take part in v2 issuance: a keri-ts peer refuses a v2 message for an
  identifier whose latest accepted event is v1 (observed in the browser lane). A KERIpy v1
  witness therefore cannot serve v2 IPEX.
- esbuild consumers must mark `node:process` external: `effection`'s `main()` lazily imports it
  (`packages/keri/README.md`). Vite and webpack need nothing.
- Firefox may leave `navigator.storage.persist()` pending behind a permission prompt.
  `WebWallet.storage` is a promise that never rejects and does not hold the open.
- A failed Admit delivery is reported as `undelivered`; `resendAdmit` repeats it, and an issuer
  that already took the first Admit may drop the repeat as a KRAM replay.
- Group identifiers have no `openWebWallet` namespace yet.

### Coverage gaps

- `packages/keri/test/integration/app/interop-mailbox-kli-tufa.test.ts` ("tufa mailbox add works
  against the real KERIpy mailbox host") is permanently `ignore: true`: the pinned KERIpy peer has
  no standalone mailbox host (`kli mailbox start`) or mailbox admin endpoint, so `tufa mailbox add` against a KERIpy provider is untested.

## Hosting the runtime in a Worker

What the code shows, not what has been run: `openWebWallet`, the store lock and the
persistent-storage request reach the platform only through `globalThis.navigator?.locks` and
`globalThis.navigator?.storage`, IndexedDB through the injectable `indexedDb` host option, and
page-lifecycle flushing only when a `document` exists (otherwise `lifecycle` is `null` and the
host should call `close()` itself). Those APIs exist in dedicated and shared workers in current
engines, but **no worker lane has been run**, so treat Worker hosting as unqualified.

Design points a Worker host should settle:

- One wallet per identity is enforced by the Web Locks lock, shared across the origin. If a
  Worker owns the wallet, a page tab that also opens it gets `StoreLockHeldError`; route the page
  through messages to the Worker, or use a `SharedWorker` so several tabs share one owner.
- The wallet API returns functions' results and Habs (`IdentifierEvent.hab`); results that cross
  `postMessage` must be plain data, so a Worker host maps results to JSON.
- Without a page there is no `pagehide`; the output barrier remains the protection, and the host
  should call `close()` before the Worker is terminated.
