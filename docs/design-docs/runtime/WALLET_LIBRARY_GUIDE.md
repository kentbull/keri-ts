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

(Composition note, read last: the namespaces below are classes that each hold one `WalletScope`, the wallet's collaborators
and the single place an app's promise meets the runtime's scope; none extends a base class. `createWalletApi` builds them
once, and the classes are exported as types only. Every option and outcome a method takes or returns is a named type
(`TimeoutOptions`, `ReceiveOptions`, `UnblindOptions`, `PresentWaitOptions`, `ProposalListOptions`, the `*Outcome` and
`*Result` unions), so a signature never carries an inline object or union.)

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
`close()`; `cause` says why), `mailbox-unreachable` (the runtime gave up telling a mailbox a rotated
KEL; see below) or `closed`. Precedence: `closed`, `stopped`, `latched`, `faulted`,
`mailbox-unreachable`, `ok`. A call on a stopped or closed wallet rejects with `WalletStoppedError`.
`mailboxes.publication(pre)` and `mailboxes.waitForPublication(pre)` report where each mailbox stands
in being told the identifier's KEL.

Group identifiers use the group surface in the next section.

## The group wallet surface

A group acts through its members' separate consents, so the wallet's group API is organised the same way
(`src/web/group-api.ts`). The proposer starts something; every other member sees the same item in one list and
consents with one call; the runtime's Counselor and owners finish the work. The app only consents.

| Call                                      | What it does                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `groups.incept / rotate / interact`       | Propose the event as this member (`proposeGroupInception`, `...Rotation`, `...Interaction`) and wait on the Counselor |
| `groups.join(id, { alias })`              | Approve an inception (or the rotation of a group not joined yet) under a local alias                                  |
| `groups.status(event) / wait(event)`      | Read or wait on the Counselor for a group event                                                                       |
| `groups.inceptRegistry(group, name)`      | Propose the group's ACDC v2 registry (`proposeRegistryEvent`)                                                         |
| `groups.proposeMailbox / completeMailbox` | Propose the group's mailbox role; once approved, post it to the provider                                              |
| `proposals.list({ group?, all? })`        | One typed list: key and reply events, registry events, group IPEX messages, group issuance Grants                     |
| `proposals.approve(id, opts)`             | The one consent; the wallet picks the call from the proposal's kind and waits                                         |
| `proposals.dismiss(id)`                   | Remove an event proposal's notices (KERI has no reject message; 0 for kinds that raise none)                          |

`proposals.approve` calls `approveGroupProposal` for events and registry events (then waits on the
Counselor), `approveGroupIpex` for a group IPEX message, and `approveGroupIssuance` for a group issuance Grant (then
waits on the issuance). It returns `complete`, `approved` (consent recorded, nothing further observable, as for an
endpoint-role reply), `ended` (with a `reason`) or `timed-out`, each with the status read at return. Group event
waits return `complete`, `superseded`, `unknown` or `timed-out`.

The credential calls select the group path when the identifier is a local group:

- `credentials.issue({ pre: group, registry, ... })`: only the elected custodian (the member the group's latest
  accepted event elects) begins the issuance with the credential; the registry must already exist
  (`groups.inceptRegistry`). Other issuer members consent through `proposals.approve`. The runtime proposes the
  registry update and the other members approve it as a `bup` proposal.
- `credentials.receive(grant)`: a holder group member approves the DH exchange, waits for the issuer to finish it,
  then proposes the Admit, or approves the Admit another member proposed for that Grant, waits until the group's
  Admit is accepted and records the admission. The elected lead member delivers the Admit (`delivery: by-lead`).
- `credentials.present({ verb: "grant", pre: group, ... })` proposes the group's Grant (`proposeGroupPresentation`);
  the other members approve it as a proposal and the lead delivers it.
- `credentials.unblind(grant)` requests the proofs as the disclosee or answers as the discloser
  (`requestUnblind` / `answerUnblind`); every member must name the same `proposer`, which defaults to the member
  the group's latest event elects.
- `credentials.pending(group)` lists the pending Grants addressed to the group.

A group inception checks that every other member can be reached (an end role is known for each, so resolve their
OOBIs first) before it creates the group habitat; otherwise it rejects and nothing is left behind, so the same alias
can be tried again (`proposeGroupInception`, so the CLI behaves the same). A group issuance is recorded in the wallet
inventory when it completes, for the custodian and for a member that consented through `proposals.approve`, through
the same `ChangeSink` reaction as a single-signature issuance. A member may not hold the registry root copy yet; its
recorder then stays registered and tries again on the next issuance change or when the root copy is retained (the custodian's `issued` result carries
`recorded`).

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

| Owner          | Consents (may sign)                                                                                                                                                                                                      | Pure reads and waits                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `issuance`     | `proposeIssuance` (or `prepareIssuanceGrant` then `beginIssuance(ops, grant)`), `approveIssuanceExchange(ops, grant)`, `receiveIssuance` or `admitIssuance(deps, grant)` then `deliverIssuanceAdmit` (`admitAndDeliver`) | `issuanceStatus`, `pendingIssuanceGrants`, `waitForIssuance`    |
| `presentation` | `present` (offer, grant, apply, agree, spurn)                                                                                                                                                                            | `presentationStatus`, `waitForPresentation`                     |
| `unblinding`   | `requestUnblind(ops, grant, options?)`; `answerUnblind(ops, grant, options)` for a group discloser (an individual discloser answers its own Grant's queries with no consent call)                                        | `unblindingStatus`, `pendingPresentations`, `waitForUnblinding` |
| `groupIpex`    | `proposeGroupAdmit`, `proposeGroupIpex`, `approveGroupIpex`                                                                                                                                                              | `groupIpexStatus`, `groupIpexProposals`, `waitForGroupIpex`     |

The party is derived from the Grant: the issuer is the credential registry's identifier, the holder is the Grant's
recipient, and an Unblind's party is the Grant's recipient (the disclosee) or its sender (the discloser). So
`beginIssuance(ops, grant, auths?)`, `approveIssuanceExchange(ops, grant)`, `admitIssuance(deps, grant, options?)`,
`requestUnblind(ops, grant, options?)` and `answerUnblind(ops, grant, options)` take no habitat; `UnblindingOptions`
carries `states` and, for a group, the `proposer`. `receiveIssuance(ops, input)` is the whole individual holder path
(approve the DH exchange, wait, then `admitAndDeliver`) with the outcome `admitted`, `ended` or `timed-out`, and calling
it again after `timed-out` resumes. `admitAndDeliver(deps, input)` signs the Admit, runs the host's `onAdmitted` step once
before delivery (the wallet records its consent in its inventory there) and delivers within a budget; a failed or
expired delivery is a value, and `deliver: false` leaves the bytes to the caller.

### Pacing

Background loops are fixed-tock doers (`doEvery` in `app/runtime/doing.ts`): a pass, then a wait of one tock on the
runtime clock, as a HIO `Doer` re-runs every `tock`. Nothing wakes a loop early, and work that arrives between tocks is
seen on the next one (`OwnerWake` and `operations.wake` do not exist). A `DoerPacing` is `{ tockMs, sweepTocks }`: a
loop that has a full sweep does it on tock 0 and every `sweepTocks`, and does lighter work on the tocks between.

| Loop                                                                                                 | Tock                          | Sweep                 | Runtime option    |
| ---------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------- | ----------------- |
| Operation owners (and the root replicator's rotation check)                                          | 50 ms (`OWNER_TOCK_MS`)       | 1200 tocks (a minute) | `ownerPacing`     |
| `KelPublisher`                                                                                       | 250 ms                        | 240 tocks (a minute)  | `publisherPacing` |
| Cue routing, OOBI resolution, authentication, signals, TEL publication, delegation, group counseling | 31.25 ms (`PROTOCOL_TOCK_MS`) | 1920 tocks (a minute) | `protocolPacing`  |
| Mailbox poller worker selection                                                                      | 31.25 ms                      | 1920 tocks            | `pollerPacing`    |
| Escrow loop (`ProtocolProcessor.escrowDo`)                                                           | 31.25 ms (`ESCROW_TOCK_MS`)   | none                  | none (fixed)      |

A host that must be gentler (a browser wallet in a background tab, a mobile wallet on battery) passes longer
`DoerPacing` values; a test passes small ones. The escrow loop waits a fixed `ESCROW_TOCK_MS` after every pass and never
skips or shortens one. The outgoing delivery workers (`Poster.deliverDo`, the query sender) keep their per-turn loop.
The mailbox poller no longer walks every identifier each turn: it re-selects workers on tock 0 and every sweep, when the
topics or the number of identifiers change, and for identifiers given to `MailboxPoller.prompt`; an accepted
`/end/role` reply tells the runtime (`Revery.onEndRole`), so a new mailbox role prompts the KEL publisher and the poller
at once.

### Failures, retries and what is durable

A failure that escapes an owner pass is recorded in `operations.health` (`faults`, `last`) and the loop continues; a
failure of one operation ends that operation as `failed`. Issuance, presentation and Unblind (single and group) deliver
through one `DeliveryOutbox`: a failed message keeps its signed bytes and is retried with a doubling delay until the
Grant's deadline, or, for an operation with no deadline, until failures have lasted a bound (10 minutes), when it ends
`failed`. An active status reports a retrying delivery as `failure` (`attempts`, `reason` with the error's `cause` chain
flattened, `retryAt`); presentation status has no `attempts` or `blocked` fields any more.

The waits are injectable through the runtime options, with the production values as defaults: `RetryPolicy`
(`baseMs`, `maxMs`, `boundMs`; `DEFAULT_RETRY_POLICY` is 1 s, 30 s, 10 minutes) for `operationRetry` (delivery retries),
`counselorReceiptRetry` and `kelPublishRetry` (`DEFAULT_KEL_PUBLISH_RETRY`, 1 s doubling to 60 s with a 5 minute bound);
`issuanceQueryResendMs` for the individual issuer's DH query resend; and `mailboxPolling` (request-open, poll-window,
read-idle and refusal back-off times). Group issuance keeps the production delays.

Two requests are durable so a restart does not lose what KRAM would drop as a replay: a DH query that reached an Issuee
before its consent (`Baser.heldq`, keyed by exchange id) and an Unblind request a discloser has accepted and owes a reply
to (`Baser.heldu`, keyed by discloser and exchange id, removed when the operation ends). No `ipexQueries` runtime option
exists. The issuance owner rescans for resumable Grants every `ISSUANCE_SWEEP_MS` (5 s) rather than once, so a custodian
that reloaded while its registry update awaited the other members resumes when the update is accepted.
Compiled schema validators are cached: `validateSchema` keeps the compiled validator of a fully resolved schema closure
per store, keyed by the verified root SAID (at most 256 per store, oldest evicted), so a Grant that waits in escrow does
not recompile its schemas on every retry; a missing or invalid result is never kept.

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
- **Issuance and Admit.** A group issues or receives a v2 DH credential through `runtime.operations.issuance`. The
  group is derived from the Grant, the proposal or the credential's registry, not passed in:
  `proposeGroupIssuance(ops, draft, options?)` (prepare, then the custodian's own approval in one consent),
  `approveGroupIssuance(ops, grant, options?)` (an issuer member's consent),
  `approveGroupIssuanceExchange(ops, grant, coordinator?)` (a holder group member), `followGroupIssuanceProof` and
  `groupIssuanceProof`. `groupIssuanceElection(ops, group, coordinator?)` is a pure read of the custodian a coordinator
  elects and whether the local member is it; the coordinator is an optional pin that defaults to the group's latest
  establishment event, and the custodian is always the election's. `approveGroupIssuance` refuses a proposal the elected
  custodian did not sign, so a disagreement fails at consent instead of stalling DH. `groupIssuanceProposals` lists what
  a member may consent to and `pendingGroupGrants` the Grants addressed to a group. `deriveGroupCustody(deps, hab, grant)`
  returns null when a `/registry/root` copy was sent to the local member for a disclosed registry, so a member holding a
  copy of a still-pending Grant is never adopted as the custodian. A group's Admit or other v2 IPEX message goes through
  `runtime.operations.groupIpex` (`approveGroupIpex(ops, said, options?)`). A group presents through
  `proposeGroupPresentation`, with a presentation registry too (the registry update is proposed first and the member's
  Grant contribution waits for it, phase `awaitingRegistryUpdate`), and proves with `requestUnblind` / `answerUnblind`
  naming a `proposer`. Root copies for the other members come from the runtime's `RootReplicator`, which derives what is
  owed from state and records sent copies in `rrsn.`; `RegistryRoot` publishes a `root` change when it retains one.

## Mailboxes and rotation

A mailbox is authorized by an accepted `/end/role/add` for the identifier, which `addMailbox`
(or `mailboxes.add`) posts to the provider as `application/cesr`. The runtime polls each
authorized mailbox. A mailbox authenticates a poll against the KEL it holds for the identifier, so a
rotation has to reach it. Telling it is the `KelPublisher`'s job (`app/mailbox/kel-publisher.ts`,
`runtime.kelPublisher`):

- **A cue and its own fiber.** Completing a rotation (`completeEvent`, and the Counselor for a group rotation)
  pushes a `RotatedCue` onto `kelPublisher.rotated`; the publisher's fixed-tock doer (`runAgentRuntime` starts it) drains it
  on its next tock. The cue is only a hint: what is owed is derived from state.
- **A durable record.** `Baser.kpub.` keeps, per (identifier, mailbox), the establishment event whose KEL the
  mailbox last answered 2xx for, and a `failed` entry when publishing used up its budget. A post is owed unless the
  record shows the identifier's latest establishment event, so a lost cue, a bare `Hab.rotate`, a crash or a
  one-shot host (the CLI runs a pass after a rotation) loses nothing. Groups are included.
- **When it posts.** An event is published once it is fully witnessed and, for a delegated identifier, its
  authorizing source seal is stored. A host that cannot take a multi-message stream (KERIpy answers 400 or 406) is
  recorded as told, because it does not authenticate polls.
- **Retry and give-up.** A failed post is retried after 1 s, doubling to 60 s, and given up when the next attempt
  would start more than 5 minutes after the first (`KEL_PUBLISH_BUDGET_MS`). Giving up writes `failed` to the record
  and publishes a change. The runtime never fails because a mailbox is unreachable.
- **What re-arms a given-up entry.** A new rotation of the identifier, a successful poll of that mailbox, a
  request from the poller's unauthorized handling (`KelPublisher.repair`), `prompt` (the library's `addMailbox` and
  `completeGroupMailbox` prompt it), or the next runtime open (memory starts
  empty, so each owed entry gets a fresh budget).
- **Observing it.** `kelPublisher.status()` reads every (identifier, mailbox) as `published`, `pending` (being
  sent or waiting out a retry delay), `waiting` (gated: unwitnessed, unanchored or no URL) or `timed-out`, and
  `kelPublisher.waitForPublication(pre, { timeoutMs })` observes until every mailbox of `pre` is `published` or
  `timed-out` (a `WaitResult`). The wallet wraps them as `mailboxes.publication(pre)` and
  `mailboxes.waitForPublication(pre)`, and `health()` reports `mailbox-unreachable` (with the identifier,
  mailbox and last reason) while an entry is `timed-out`.

### Who may read a mailbox

On a keri-ts host a transferable identifier's mailbox is read by the identifier itself (its current threshold met) and,
for a group, by any signing member that polls as itself with `q.i` set to the group, which is also the shape
KERIpy's `GroupHab.query` emits. The member must meet its own current threshold and provably have controlled a
group-current key (a poll signature by a key in both key lists, or a verifying signature by such a key on an
establishment event in the member's KEL), so a member that rotated ahead of its group is still served. Forwarded mail
is plaintext CESR unless the sender used ESSR, which makes this check the read protection. A KERIpy host does no
read authorization of `mbx` queries at all, so a poll it accepts can be refused here. Two refusals are expected:

- **The host does not hold the member's KEL.** The keri-ts poller and `KelPublisher` submit it (a local group's
  submission carries the signing member's KEL). A KERIpy member's poller does not, so its KEL has to reach the host
  by OOBI or a mailbox add first; until then its poll is refused with 403.
- **A rotation-only member.** A member named only in the group's `rmids` holds no current group key and is refused
  until a rotation makes it a signing member.

### The mailbox poller

The poller is a state machine (`mailbox-poller.ts`). Each poll ends in a `PollOutcome` (`served`, `no-response`,
`unreachable`, `unauthorized`, `refused`) and `nextPoll` turns it and the back-off state into the next action; only a
served poll resets the back-off, and an unreachable mailbox no longer stops the runtime. The poller does not post the KEL
itself: a 403 calls its `onUnauthorized` hook, which the runtime wires to `KelPublisher.repair` (forget what the mailbox
was given so the publisher posts it again), and the worker backs off. A successful poll calls `onPolled`, which re-arms a
given-up publication. `MailboxPoller.prompt(pre)` makes it re-select the workers of an identifier at once.

## Known limits in 2.2.0

- An issuer that ended between staging the registry update and anchoring it reads `interrupted`;
  the registry stays behind the unchanged DH refusal and needs a fresh registry. An explicit
  recovery action is planned.
- A DH registry takes one exchange. Against a KERIpy holder, which keeps the old rule and refuses
  a second exchange on a registry it holds a root for, the issuer needs a fresh registry.
- An Unblind request a discloser has accepted and owes a reply to is persisted (`Baser.heldu`), so a reopened
  runtime answers it with no resend. A group Unblind keeps its per-operation state (the members' wrappers it has
  taken in and the contributions) in memory (`GroupUnblind` in `unblinding-workflow.ts`); what a restart does to a
  partly contributed group reply is **unconfirmed**: the code shows the state is memory only and I found no test that pins the outcome.
- A rotation-only group member (in `rmids`, not `smids`) cannot read the group's mailbox until a rotation makes it a
  signing member, and a refused poll reports only 403 "Query requester is not authorized": the response does not
  say whether the requester's KEL is unknown to the host or its keys are not the group's.
- A KERIpy controller using a keri-ts mailbox after rotating is not told by its own runtime: only keri-ts runs the
  `KelPublisher`, so the mailbox learns of the rotation from a keri-ts runtime or by other means.
  **Inferred; not exercised.**
- A v1 identifier cannot take part in v2 issuance: a keri-ts peer refuses a v2 message for an
  identifier whose latest accepted event is v1 (observed in the browser lane). A KERIpy v1
  witness therefore cannot serve v2 IPEX.
- esbuild consumers must mark `node:process` external: `effection`'s `main()` lazily imports it
  (`packages/keri/README.md`). Vite and webpack need nothing.
- Firefox may leave `navigator.storage.persist()` pending behind a permission prompt.
  `WebWallet.storage` is a promise that never rejects and does not hold the open.
- A failed Admit delivery is reported as `undelivered`; `resendAdmit` repeats it, and an issuer
  that already took the first Admit may drop the repeat as a KRAM replay.
- A group member that consented to an issuance records the credential only once it can read the exact derivation
  opening, which needs the registry root copy. The copy arrives after issuance from the replicator; when the
  runtime retains it, `RegistryRoot` publishes a `root` change (the registry is the id), and the wallet's sink gives
  every tracked recorder another try. The custodian records at completion. **Not exercised end to end.**
- A group inception that cannot reach a co-member is refused before anything is created. A proposal that is
  created and then fails to send (the network, after the route check) leaves the group habitat in place; the wallet
  offers no re-send.
- A `KelPublisher` entry that timed out stays timed out until a new rotation, a successful poll of that mailbox, a
  repair request, `prompt` or the next runtime open re-arms it; `health()` reports `mailbox-unreachable` meanwhile.

### Fast-follow

Work the maintainers listed as next, none of it on master (so none is described as behavior above):

- Retry only the missing dependency of an escrowed message. A retry of an escrowed message re-runs its checks; the schema
  validator cache removes the recompile, not the rest.
- An explicit action to recover an issuer that crashed between staging and anchoring the registry update, which reads
  `interrupted` today.
- A way for a rotation-only group member to read the group's mailbox.
- Host-side catch-up from witnesses for a KERIpy controller on a keri-ts mailbox, so the host learns a rotation the
  controller's runtime never sent it.
- A distinct refusal reason when a poll is refused because the host does not hold the requester's KEL, instead of the one
  403 "Query requester is not authorized".

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
