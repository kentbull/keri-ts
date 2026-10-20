# Remove automatic local mailbox consumption

Status: implementation complete in [PR #556](https://github.com/kentbull/keri-ts/pull/556).
The PR records final scoped CI and merge state; this is no longer an implementation queue.
Baseline: local `master` `420d96cc2c168e8a2bc3abe3a3305c63608a08b3` after #554 and #555.
The phase descriptions retain the approved boundaries and acceptance criteria.

This replaces the unimplemented LocalMailboxReader extraction and CLI/config
proposal. Do not implement that component, its worker, recipient selection or
operator flags. Remove the unsupported consumption path instead.

## Decision and evidence

MailboxPoller should retrieve messages from mailbox endpoints over HTTP/SSE.
It should not automatically scan the local provider database and feed those rows
into its own recipient protocol handlers. Direct HTTP/TCP ingress and existing
in-process protocol intake already serve direct application delivery.

Co-resident controller and Mailboxer objects do not establish a need for direct
local database consumption. The inspected ecosystem applications use remote
mailbox polling or direct intake:

- [KERIpy Poller and provider streams](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/app/indirecting.py#L731-L1033).
- [KERIA HTTP ingress](https://github.com/WebOfTrust/keria/blob/928ce26a4dfcb802c0efa9b2810c53edd7920f59/src/keria/app/indirecting.py#L68-L108).
- [Sally direct/indirect composition](https://github.com/GLEIF-IT/sally/blob/df7bf7e7680e4b4e0e5cd9781d039bd61d0d7871/src/sally/core/serving.py#L118-L184).
- [Wallet Flet composition](https://github.com/keri-foundation/wallet-flet/blob/d4055f05a56264e24d828b8d739a80cde356cb73/wallet/core/agenting.py#L70-L124)
  and [Locksmith HTTP/SSE polling](https://github.com/keri-foundation/locksmith/blob/3a5ad9ebcf98b4ec03baf1bbb91d928d49c168e4/src/locksmith/core/indirecting.py#L334-L411).

These source snapshots establish the reviewed patterns, not an exhaustive claim
about private deployments. KERIpy `7143832813cac6a394ab1faf9be83bb3372be87c`
and GLEIF-IT `b8626e1d58770a4a480ea72a01acc5580278a9f2` remain the original
protocol references. No Python implementation changes are included.

Follow the workspace's `enctx/adrs/ten-constraints.md` and
[ADR-0013](../../adr/adr-0013-simple-component-flows.md). Establish the ownership
and caller boundaries first, then remove the behavior. Do not create a temporary
component solely to delete it. Keep required dependencies explicit; no replacement
service bag, queue framework, acknowledgement API or compatibility shim.

## Final scope and contracts

### Remove

- MailboxPoller's localCursors, readLocalMailbox and local-prefix scan in pollDo.
- Local mailbox batches produced by that automatic scan.
- MailboxDirector.hasMailboxStore if the final caller inventory confirms it is
  only used by the removed path. Retain the provider's actual store guards.
- Tests whose only contract is progress/replay of this removed local consumer.
- Current documentation claims that a host automatically processes local mailbox
  rows for its own AIDs.

There will be no LocalMailboxReader, optional local worker, local recipient list,
new CLI/config fields, dormant implementation or replacement local cursor map.

### Preserve

- Mailboxer provider storage, its topic indexes and ordered reading APIs.
- Authorized ForwardHandler `/fwd` publication, MailboxDirector query correlation
  and provider-side SSE iteration, including the response's per-topic positions.
- Poster's local-storage shortcut when this host is an authorized destination
  mailbox. Storage remains storage; it does not promise recipient processing.
- Remote endpoint selection/signing, per-endpoint workers, HTTP/SSE retrieval and
  persisted remote cursor advancement only after successful consumption.
- The #555 timeout normalization: finite positive overrides floor with a 1 ms
  minimum; header/poll defaults and read-idle behavior remain unchanged.
- Existing direct HTTP/TCP protocol intake, validation, escrow processing and
  application completion semantics.
- Joined cancellation, failure propagation, borrowed-store ownership and worker
  shutdown before owned stores close.

An incoming `/fwd` remains a mailbox-storage request. Do not automatically unwrap
and dispatch its payload merely because its recipient is locally controlled.
Direct application delivery uses the authorized direct endpoint/intake. Do not
add routing rewrites, loopback requests, endpoint-role changes or store migration.
Stored rows remain available for authorized retrieval, including requests to a
provider running on the same machine. No provider data is deleted.

### Simplify the existing batch contract

Keep MailboxPollBatch, its `pre` and `messages` fields, and the awaited callback
into settleMailboxPollBatch. All poller batches now come from an endpoint:
remove the redundant local/remote `source` discriminator and make `eid` required.
Update producers, consumers, explicit exports, tests and documentation together.
Keep the declaration in its current module; no shared-reader module is needed.

Preserve `pre` as the mailbox subject and `eid` as the provider, including group
subject versus member-signer distinctions. Do not change remote batch boundaries
or when successful callback completion advances persisted progress.

runAgentRuntime still starts the existing MailboxPoller. `pollMailbox` now has
only remote work to control; no new switch or extra worker is added. Preserve
IPEX's exclusive command-owned polling callback and its completion counters.
Storage-enabled witness/agent/mailbox hosts retain their provider behavior and
remote polling without gaining any new configuration requirement.

## Phased execution

### Phase 0: confirm ownership and caller/test dispositions

Inspect MailboxPoller constructions, pollDo callers, pollMailbox overrides,
MailboxPollBatch uses, provider-enabled hosts and every local-consumption test.
Primary owners are `packages/keri/src/app/forwarding.ts`, `agent-runtime.ts`,
`mailbox-director.ts`, `cli/ipex.ts`, the runtime exports, and Tufa's host kernel,
indirect host and witness role.

Classify each affected fixture as direct recipient processing, remote mailbox
consumption, provider service or removed local-consumer behavior. Assign retained
protocol assertions to the appropriate existing path. A seeded-store test alone
is not an application requirement. If a concrete workflow depends on automatic
local reads, identify its intended direct or remote delivery contract before
changing it; do not silently discard its accepted-state assertions.

Exit: all affected callers have a migration disposition, and deletion is bounded
to the local recipient-consumption path rather than provider storage/readers.

### Phase 1: remove the local path and migrate contracts/tests

Delete the local consumer and narrow MailboxPollBatch as described above.
Migrate actual callers directly; introduce no transitional adapter or reader.
Remove unused helpers/imports only when made obsolete by this deletion.

Retire #554's local cursor mechanics tests because that component behavior no
longer exists. Preserve the composed challenge/exchange acceptance assertions by
using the appropriate existing direct-ingress or remote-mailbox fixture. Do not
replace them with assertions that only verify a method was called.

Add a focused regression demonstrating that a running runtime with provider
storage does not consume local rows automatically. Establish that the worker has
progressed through a real observable operation, rather than asserting absence
after an arbitrary sleep or prescribed scheduler-turn count.

Exit: no local consumer or renamed equivalent remains; ordinary direct delivery,
provider service and remote polling retain their existing contracts.

### Phase 2: qualify boundaries and reconcile maintainer documentation

Review these flows at the same final source revision:

1. Direct HTTP/TCP or explicit in-process intake reaches accepted protocol state
   without depending on mailbox rows or mailbox polling.
2. Authorized `/fwd` ingress stores the payload; running the provider host does
   not cause the removed automatic recipient-consumption behavior.
3. An authorized remote consumer retrieves that stored payload through SSE,
   processes it, and advances its persisted remote position after completion.
4. Failure/cancellation joins active remote I/O and consumers before store close.

Update the existing runtime contract, runtime learning notes, affected composition
ADR claims and maintainer coverage ledger in the same implementation change.
Mark removed declarations retired, not relocated. Preserve #554 as historical
evidence of a resolved defect in a feature subsequently removed; do not reopen
that finding or imply its tests still describe the final design. Keep #555 current.

Document touched classes, functions, parameters, members and meaningful return/
failure/lifetime contracts concisely. Explain the remaining provider, poller and
direct-intake boundaries and the batch's required endpoint identity. No new
documentation tests, lint rules or architecture guide.

Exit: source, tests, runtime docs and coverage records describe the same remote-
only poller and intact provider/direct-ingress responsibilities.

## Focused acceptance and delivery

- Stored messages for local and external recipients remain stored and retrievable;
  neither is automatically consumed just because a host owns Mailboxer.
- Keep authorized and unauthorized forwarding/provider-query regressions.
- Retain an end-to-end provider/consumer case with real signed messages and accepted
  protocol state; preserve existing participant topology.
- Retain remote callback failure and cancellation coverage: no premature persisted
  cursor advancement, cleanup joined, original failures visible. Do not build a
  new retry framework to replace retired local replay tests.
- Keep independent remote endpoint progress, restart from persisted remote positions,
  group query signing, IPEX completion gates and direct ingress coverage.
- Keep all #555 timeout table/manual-clock regressions and SSE partial-event cleanup.
- Verify no obsolete local batch source checks, cursor members, public aliases or
  proposed local-reader configuration remain.

Run focused mailbox-poller tests first, then affected mailbox-runtime, mailbox-SSE,
mailbox-director lifecycle, challenge-mailbox, runtime-store-ownership, IPEX and
Tufa host/CLI owners. Use existing tests where they already establish the contract;
do not add a test for every deleted line. Run formatting, lint, quality/type,
changeset and existing local-link checks, plus installed-package/type checks for
the changed exported batch shape.

This narrower deletion fits one cohesive implementation PR, with the phases above
as execution and review checkpoints. Do not split out a temporary abstraction or
an inconsistent code/docs state merely to retain the old two-PR proposal. Use
scoped CI and exact-head local-test credit, selecting affected mailbox/witness/IPEX
integration owners from the actual diff. No full interoperability battery is
required solely for this localized removal.

Include a major keri-ts changeset for the removed exported poller behavior and
batch fields. Include a major Tufa changeset for the removed automatic host
behavior. Explain operator impact without adding a compatibility switch: use
direct ingress or authorized mailbox retrieval. No package publication is implied.
Follow human-oriented commits and run ENCTX maintenance after final file/Git
mutations before handoff when implementation is authorized.

## Delivery evidence

[PR #556](https://github.com/kentbull/keri-ts/pull/556) delivers the removal and
contract/documentation reconciliation. The mailbox implementation commit is `b41674ed`. Package qualification also
exposed an existing build selector tied to the old host-kernel doc comment;
it now identifies the exported runHostKernel symbol in generated JavaScript and
declarations. A real Tufa npm build passes after that focused build-script repair. Major changesets cover both
keri-ts and Tufa. No local reader or operator setting was added.

The provider-isolation regression fails on the baseline because stored replies
are accepted automatically. After removal, 114 focused tests pass: 79 across
isolated KERI suites (mailbox-poller-runtime, mailbox-sse, mailbox-director-lifecycle,
mailbox-runtime, challenge-mailbox-runtime, challenge-direct-runtime,
runtime-store-ownership, forwarding, poster-queue, ipexing and ipex-v2), plus
35 Tufa CLI, progressive-ingress and Node HTTP-host tests. Commands use
`deno test -A --unstable-ffi` on Deno 2.9.7. The regression observes completed remote
cursor progress before checking stored local responses, then verifies explicit
direct intake accepts those same payloads without consuming provider rows.

Formatting, lint, quality/type, changeset, diff and changed-document local-link
checks passed. The PR requests mailbox interoperability and installed-package
checks, with local unit credit tied to its final head. Its check results are the
authoritative completion record; no full interoperability battery is claimed.
