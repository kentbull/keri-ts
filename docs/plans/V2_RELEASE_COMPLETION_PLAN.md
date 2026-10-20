# Complete the 2.0.0 package family and withdraw 1.0.0

Date: 2026-10-20.
Status: approved for execution by Kent on 2026-10-20.
Planning source: `777fc8d2d250358290b84aefa60126ce0dda86fc`.

## Outcome and authorization

Deliver and publish **cesr-ts 2.0.0, keri-ts 2.0.0 and @keri-ts/tufa 2.0.0**.
Kent restored the coordinated 2.0.0 target because the accepted library changes
break public contracts and warrant a major version. This supersedes the interim
1.1.0 target. Keep this plan's existing path so the active goal and references
continue to resolve.

Provide a prominent breaking-changes list in the release notes and a dedicated
1.0.0-to-2.0.0 changes and migration document, as specified in PR 32 below. The
package version does not change the agreed protocol scope. Previous keri-ts API
compatibility remains outside scope; explain replacements rather than adding
compatibility shims.

Kent's earlier authorization to withdraw 1.0.0 remains in effect. npm permanently
reserves a published name/version even after unpublishing, so recreating 1.0.0 is
not an available release strategy
([npm policy](https://docs.npmjs.com/policies/unpublish/)). Withdrawal/publication
happens only after the remaining implementation, interop, ownership assessment,
source organization and final qualification; do not remove releases during
implementation.
The release must support the agreed KERI/ACDC/CESR v1/v2 protocol lanes and
interoperate with independently identified KERIpy main, 1.2.x and 1.3.x peers.
Previous keri-ts API and database compatibility is not a requirement. Do not add
aliases, migration readers or old-keri-ts compatibility tests.

Kent authorized committing this plan, opening its PR to master and executing it
as the release goal. Execution covers implementation, commits, PRs, merges,
qualification and publication of the three packages. Preserve the review and
qualification gates below and any subsequent narrower boundaries Kent sets.

The scope includes:

- Correct logging, strict configuration validation and exact-key OOBI cleanup.
- Explicit acceptance of configurable threshold limits.
- LMDB-owned ESSR evidence; remove the filesystem archive, unused durable
  plaintext persistence and unnecessary ESSR staging/streaming infrastructure.
  Correct persistence against pinned KERIpy main's actual Baser ordered set in
  PR 12e; direct legacy database compatibility is deferred, legacy wire is required.
- Explicit ordinary/stream messenger construction and wire parity; remove the
  persisted CESR body preference and all of its public/configuration plumbing.
- The justified architecture/readability changes described below.
- Explicit multisig message reporting contracts and Tufa-owned CLI presentation,
  separate from the remaining approval/lifecycle behavior changes.
- Complete multisig credential CLI coordination: registry creation, issuance,
  all six IPEX verbs, revocation, peer approval/fanout and observable completion.
- Native-v2 credential CLI authoring, disclosure and presentation workflows.
- Legacy group backer registries with actual backer receipts and rotation.
- Legacy TEL replay and real old-peer HTTP/mailbox reachability.
- Two bounded reconciliation findings concerning initialization and AEID changes.
- Move the Sally-style verifier application, command and workflow store into Tufa;
  retain protocol Verifier, evidence validation and reusable IPEX operations in keri-ts.
- A final ProtocolProcessor assessment and cohesive source organization within all three packages.
- Fresh qualification, accumulated-changeset changelogs, prominent breaking-change
  release notes and a dedicated migration document, withdrawal of the three
  1.0.0 distributions and actual publication of all three 2.0.0 packages.

**Scope confirmed by Kent:** include native-v2 CLI authoring and group backer
registries in 2.0.0. These are required implementation and qualification work,
not optional follow-ups. Keep the different protocol models explicit:

| Surface                    | Proposed 2.0.0 release acceptance                                                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy credential CLI      | Complete no-backer and backer-enabled lifecycle, including single/group participants, ordinary/establishment-only anchors and issuer KEL witnesses; prove supported interoperability with main, 1.2.x and 1.3.x.  |
| Group backer registries    | Implement explicit backer membership/thresholds, VCP/VRT, BIS/BRV, actual TEL backer receipts, peer approval/fanout and restart/replay. KEL witness receipts are a separate obligation.                           |
| Native-v2 credential CLI   | Author genuine-v2 credentials and registry events; complete single/group issuance, disclosure, IPEX receipt, presentation, state changes and vacuous updates through public commands.                             |
| Native-v2 interoperability | Qualify against implemented main reference capabilities and independent TS public intake; keep reference gaps explicit. Old 1.2/1.3 peers retain the legacy lane and are not expected to accept native-v2 bodies. |

Automatic delivery retries, durable outboxes, delivery acknowledgements, generic
database providers and broad Python porting remain future minor-version candidates, not
promises for the next minor release. Keep existing protocol escrows and their
ordinary recovery; they are not the deferred outbound retry feature.

## Baseline and evidence

The prior chat, **keri-ts Responder refactor**
(`01a14d08-bc45-7203-9e9c-d196828bc08b`), reports qualification after #573/#574:
**1,393 passed, none ignored**, four resolver cases using Python 3.13.16, and
installed-package checks on three Node profiles. Manual endurance was excluded.
Credit that baseline; do not repeat the full battery merely to begin this work.
It does not qualify the changes proposed here.

Current source establishes these gaps:

| Area                  | Concrete finding                                                                                                                                                   | Owning source                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Logging               | debug/info use stdout; escrow diagnostic review remains deferred                                                                                                   | `src/core/logger.ts`, `docs/plans/PARITY_ROADMAP.md`                                           |
| Configuration         | scalar/non-string URL entries disappear silently; later malformed fields can follow earlier writes                                                                 | `src/app/habbing.ts`                                                                           |
| Thresholds            | both deployment caps are already configurable, with boundary tests                                                                                                 | `packages/cesr/src/primitives/tholder.ts`                                                      |
| OOBI cleanup          | exact-key command exists; replace its special store with ordinary Baser loading                                                                                    | `src/db/basing.ts`, `src/db/core/lmdber.ts`, Tufa endpoint command definitions                 |
| Group VDR             | VCP/ISS exist, but proposal registration and completion differ from the working group paths                                                                        | `src/app/credential-workflows.ts`, `multisig-workflows.ts`, `src/vdr/credentialing.ts`         |
| Group IPEX            | grant coordinates group initiation; the other verbs do not uniformly use it                                                                                        | `src/app/cli/ipex.ts`, `src/app/ipex-grouping.ts`                                              |
| Revocation            | REV wire construction exists, but CLI VDR approval/issuance orchestration does not include it                                                                      | `src/app/grouping.ts`, `multisig-workflows.ts`                                                 |
| Replay                | Tevery requests v2 proof framing unconditionally; query normalization discards attachment genus                                                                    | `src/vdr/eventing.ts`, `src/app/parsering.ts`                                                  |
| Old mailbox HTTP      | polling bypasses the existing narrow legacy-media fallback                                                                                                         | `src/app/forwarding.ts`, `cesr-egress.ts`                                                      |
| Initialization        | empty/cancelled prompts can omit encryption; persistent-path failure retries as temporary                                                                          | `src/app/cli/init.ts`                                                                          |
| AEID mutation         | live crypto state and secret rows change before the final AEID write, without one encompassing transaction                                                         | `src/app/keeping.ts`                                                                           |
| Backer evidence       | historical backer lookup uses raw rows rather than the full accepted management coordinate; partial receipts overwrite and partial-witness escrows are not retried | `src/vdr/eventing.ts`                                                                          |
| Group backer CLI      | group creation rejects backers; the CLI has only a boolean backer flag and no roster/threshold or registry rotation command                                        | `src/app/credential-workflows.ts`, Tufa credential command definitions                         |
| Native-v2 composition | ordinary ProtocolProcessor dispatch does not install RegistryObserver; presentation tests use a custom `/_registry` intake path                                    | `src/app/protocol-processing.ts`, `src/acdc/observing.ts`, `interop-ipex-presentation.test.ts` |
| Native-v2 authoring   | registry/disclosure APIs exist, but CLI composition, durable disclosure handling and public group approval are incomplete                                          | `src/acdc/registraring.ts`, `src/app/cli/vc.ts`, `src/app/cli/ipex.ts`                         |

Unqualified `src/` paths above are under `packages/keri/`. These are static
findings, not newly executed regression results.

The active [parity roadmap](PARITY_ROADMAP.md), [compatibility inventory](../reference/compatibility/KERI_V1_V2_COMPATIBILITY.md)
and [qualification standard](qualification/QUALIFICATION_PLAN.md) remain their
respective owners. ENCTX's historical main-reconciliation plan and test-family
inventory were checked against current source; their old gap labels are not
an implementation queue.

## Design rules and explicit decisions

Apply Kent's [ten constraints](/Users/kbull/enc/enctx/adrs/ten-constraints.md)
and [ADR-0013](../adr/adr-0013-simple-component-flows.md).
**Refactor responsibility first, then change behavior.** A preparation PR is
justified when it makes a substantial behavior change independently reviewable.
A small local rearrangement may be the first separate commit in one cohesive PR;
do not manufacture empty abstraction PRs or temporary APIs.

| Constraint                   | Application in this work                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Separation of concerns       | CLI handles input/output and deadlines; protocol owners validate; stores persist; messengers own network lifetimes.        |
| Encapsulation                | Pass the actual subordinate dependencies; keep routing, locks and storage initialization private.                          |
| Cohesion and loose coupling  | One owner for group proposal publication/completion; independent workers exchange concrete records.                        |
| DRY                          | Share protocol knowledge, such as media-refusal policy and group evidence rules; do not unify unlike send/query lifetimes. |
| KISS                         | Prefer ordinary branches, typed records and existing transactions over frameworks.                                         |
| Single responsibility        | A cleanup command cannot start protocol processing; a diagnostic cannot determine acceptance.                              |
| Depend on abstractions       | Retain narrow HTTP/time contracts where used; do not invent an interface for every concrete domain owner.                  |
| YAGNI                        | No speculative negotiation, compatibility service, outbox, event bus or future extension hooks.                            |
| Composition over inheritance | Compose existing parser, protocol, store and messenger owners; add no stream-messenger hierarchy.                          |
| Disciplined open/closed      | Extend proven route and encoding boundaries; introduce a new extensibility point only for demonstrated variation.          |

SOLID additionally requires preserving substitutability and small interfaces:
injected clients must obey the same cancellation/failure contract; collaborators
must not be identified by concrete-object equality; send-only users should not
receive irrelevant receive-result machinery. Do not weaken a real same-store
invariant just to remove a reach-through expression.

Accepted decisions:

1. **Keep configurable Tholder deployment caps.** Retain `maxWeights` and
   `maxSithLength`, their existing defaults and positive-safe-integer validation.
   Configure them before concurrent processing begins. This is an explicitly
   accepted local exception, not a wire maximum or permission to restore global
   accounting. Existing tests already prove tunability; add no configuration
   framework or CLI flags without a real caller. Correct only directly
   contradictory policy sentences when adopting the plan.
2. **Prefer synchronous semantic boundaries over a global protocol mutex.**
   Preserve coherent validation, commit and publication, not `acquireProtocol`
   itself. Prepare immutable evidence asynchronously; make the final decision
   against current state and commit synchronously in the concrete protocol owner.
   Keep existing exclusion during the responsibility/storage refactor, then
   remove it only after the focused overlap tests below pass. A single protocol
   worker is an alternative to evaluate if a concrete remaining invariant
   requires it, not the default replacement. Neither extra processor instances
   nor LMDB writer serialization alone makes an earlier asynchronous decision safe.
3. **Keep request-specific mailbox authorization.** A query SAID identifies its
   body, not its current attached proofs. Preserve exact-envelope authorization,
   post-escrow reevaluation and capture before application publication.
4. **Keep exact-event Poster waits.** `send` admits work; `wait(evt)` observes
   that admission while the worker delivers. Python also waits on `sent(said)`
   or a delivery doer's completion. Event identity avoids stale same-SAID
   successes. Neither form proves remote acceptance.
5. **Keep clocks at actual time owners.** RuntimeClock is a small existing
   dependency for deadlines and trusted timestamps, including deterministic
   tests. Effection scheduling does not remove wall-time requirements. Remove
   only unused forwarding of the clock, not the contract wholesale.
6. **Keep structured resource cleanup.** Effection `resource`, `call`, `ensure`
   and native abort integration are not inherently callback architecture.
   Simplify control flow while preserving cancellation, joined cleanup,
   original failure identity and independent cleanup failures.

## Review of the supplied architecture comments

| Comment                                | Disposition and planned work                                                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `endpoint-roleing.ts` receives runtime | Confirmed. Give subordinate proposal work explicit Habery, protocol/input and Poster dependencies; composition stays with the command. Do not replace runtime with a smaller service bag.                                                              |
| Oobiery receives Reactor               | Confirmed coupling between independent input owners. Oobiery should own its input Kevery/parser context and borrow its actual semantic/store dependencies, matching Python's OOBI-specific parsing responsibility.                                     |
| `consume` callbacks                    | Distinguish resource acquisition callbacks from protocol-consumer inversion. Move HTTP query processing visibly into HTTPMessenger; expose complete SSE records to their processing owner. No new callback runner or event bus.                        |
| `attemptPostCesr` cleanup and race     | Name the cancellation and cleanup policies; replace throw/catch-as-filter where simpler. Retain abort of an active consumer, cleanup registration before work, and aggregation of distinct failures.                                                   |
| Monolithic protocol processor          | Make concrete semantic owners independently usable. Keep a thin normalized-message dispatcher only where an input genuinely handles multiple protocols; do not make it a required runtime service bag or a new scheduler.                              |
| `acquireProtocol`                      | Refactor asynchronous evidence preparation, synchronous admission and subsequent effects before removing whole-turn exclusion. Compare ownership alternatives below; do not replace it with `withLock(callback)`, per-family locks or queued closures. |
| `mailboxQueryAuthorized`               | Security-relevant result, not a smell by itself. Keep policy in Kevery and eliminate duplicate interpretation only if the post-escrow contract is preserved. No authorization-token/cache framework.                                                   |
| Reactor in witnessing                  | Comment is stale: Receiptor now takes ProtocolProcessor. Keep same-store validation, expressed through direct ownership or composition instead of `protocol.kvy.db` reach-through.                                                                     |
| TCP conversation/result types          | Confirmed unused production result language. Remove `TCPConversation`, nested receive telemetry and unused `TcpTransmission` counters after caller audit; return normal operation completion. Preserve send-only versus receive-through-EOF execution. |
| `converse` naming                      | Use a name describing the actual operation, such as `sendAndReceive`. Use `msgDo`/`receiptDo` only for genuinely corresponding worker responsibilities, not cosmetic Python naming.                                                                    |
| `http-client.ts`                       | Keep native Fetch and scoped response cleanup here. No speculative redesign was identified; HTTP policy and domain parsing belong above it.                                                                                                            |
| `postman.wait(evt)`                    | Retain. Consolidate repeated domain-specific CLI handling where useful, including partial successes and original causes. Do not introduce a generic completion broker.                                                                                 |

### How the HTTP query response currently reaches processing

```text
QueryCoordinator -> HTTPMessenger.query -> postCesr -> attemptPostCesr
  -> openFrameResponse -> HttpClient.open -> provide(FrameResponse)
  -> query's consume(response) closure
  -> processMessages, or consumeMailboxSse followed by processMessages
  -> ProtocolProcessor -> accepted state and cues
```

The response does not return to QueryCoordinator. The callback consumes it while
its scope is alive; posting returns completion/refusal and the public query
operation returns void. The refactor makes that response processing visible in
HTTPMessenger without allowing a live response to escape its owning scope.

### Protocol ownership exploration and recommended boundary

This is a source-grounded recommendation, not a completed concurrency proof.
The inspected Python checkout is `71438328`; repeat the relevant comparison
against the unmodified main pin selected by PR 02.

KERIpy combines per-input processing context with shared accepted state.
TCP Reactants and Oobiery construct their own parser/Kevery contexts, while
Kevery shares `Baser.kevers` and Tevery shares `Reger.tevers`. Some compositions
share an Exchanger/Verifier. Regery also owns local registry/storage lifetime;
it is not an object to duplicate per message. Ordinary semantic handlers run
synchronously, without a scheduler suspension between their decisions and writes.
Copy that boundary where appropriate, rather than mechanically copying object counts.

TS already creates input-local Keverys. Independent operations enter the common
ProtocolProcessor because HTTP, TCP, OOBI and mailbox input each progress under
their own lifetime, while background and finite-command escrow work also calls
it. Those separate input lifetimes are valid. Coupling them to one asynchronous
state-mutating operation is the part to change.

The planning baseline gave concrete reasons for the split. The ESSR redirect
below supersedes its filesystem-specific design, while preserving synchronous
semantic ownership:

- `core/eventing.ts` already performs KEL decisions/writes synchronously, then
  publishes the accepted cache and cues. `acdc/regengine.ts` also rechecks
  registry state inside its synchronous writer.
- `app/exchanging.ts` authenticates, reads prior admission state, then suspends
  for ESSR reads/hashing, nested evidence, file publication, flush and handlers.
  Its receiver-time assertion does not revalidate every earlier assumption.
- `app/ipexing.ts` checks that a predecessor has no response; accepted EXN
  publication later pins `erpy`. With independent asynchronous admissions,
  both responses can pass the check before their sequential writes. The
  transaction must contain the final state-dependent check as well as the write.
- `vdr/eventing.ts` shares cached Tevers whose original constructor captured
  input policy and cues. Rotation also mutates live fields before logging.
  Separate accepted state from input context and publish only after commit.
- The earlier `db/payload-archive.ts` design adds filesystem publication,
  ownership and recovery outside LMDB. Remove that architecture in PRs 12a–12b;
  its extra coordination is not a requirement to preserve.

| Design                                                               | Assessment                                                                                                                                                                       |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input-local parsing/policy with concrete synchronous semantic owners | Preferred. Existing stores and accepted-state caches remain shared; state-sensitive work cannot suspend.                                                                         |
| One worker consuming concrete prepared messages                      | Valid if a remaining ownership constraint justifies its queue, completion/cancellation contract and mandatory worker lifetime. Not required merely because several inputs exist. |
| One worker awaiting today's asynchronous dispatch                    | Does not solve the long shared critical section; retains head-of-line blocking and can deadlock recursive group replay.                                                          |
| Independent asynchronous processors relying only on database locks   | Reject. Stale decisions and shared caches/cues remain outside the protected transaction.                                                                                         |

The intended operation shape is:

```text
input-owned Effection operation
  receive / parse / normalize immutable evidence
  concrete semantic owner: validate current state -> commit -> publish live state
  finish required LMDB durability and perform the actual transport/handler work
```

The middle step is synchronous. It accepts normalized domain input without
depending on a parser instance, transport, Effection scope or arbitrary operation.
It owns its transaction; callers must not hold a writer across a yield.
Re-resolve protocol-correct historical/current key coordinates, response winners,
proof unions, approval state and registry anchors at this boundary. Async
preparation may verify byte commitments, but cannot carry a final authorization
decision across suspension. Keep routine accept/duplicate/escrow/reject outcomes
as concrete data rather than an extensible command framework.

Capture each operation's own cue/reply result at the semantic boundary; do not
leave a shared unpublished Deck to be drained after unrelated asynchronous work.
Preserve the required durability point before exposing completion or external
effects. LMDB commit visibility and completed disk flush are distinct in
[lmdb-js](https://github.com/kriszyp/lmdb-js#overlapping-sync-options);
moving a flush wait must not silently weaken the existing contract.

This is not a promise that every effect can be detached after acceptance.
Forwarding prepares child wire; multisig handling reopens and processes approved
children. Keep those responsibilities explicit, recheck state after preparation,
and preserve required causal ordering and duplicate/replay behavior. A dependent
child must not overtake the parent work it requires. Do not introduce a durable
outbox, generic task queue or promise of exactly-once network delivery.

Two existing handlers make that condition concrete. ForwardHandler checks
recipient authority before asynchronously collecting child bytes; the final
current-authority check must accompany synchronous mailbox publication after
collection, preserving the request's exact mailbox identity. Multiplexor reads
known wrappers, awaits replay, then records local approval. A new wrapper arriving
during that replay can miss both the old snapshot and the approval flag.
Make local approval and arrival handling converge on independently verified
child processing without another approval or a third-message wakeup.
Preserve Mailboxer's intentional per-topic appearances even when bytes are
deduplicated. An accepted EXN is not proof that all handler work completed;
do not suppress required publication with a blanket duplicate-effect rule.

ESSR evidence must live in LMDB with accepted/escrow state, proof unions and
receipt metadata committed cohesively. PR 12e supersedes the earlier local
multiplicity guarantee: match pinned main's ordered-set writer, validate incoming
commitments and reconstructed evidence separately, and explicitly expose the
repeated-fragment limitation. Preserve non-downgrade of acceptance. Remove private file
ownership, publication/reclamation and startup recovery rather than preserving
those mechanisms behind interfaces. Eliminate asynchronous preparation and
current-state rechecking whose sole purpose was file I/O; keep checks required
by real protocol state and remaining suspending handlers. Do not restore a
whole-protocol mutex or replace files with another persistence framework.

The guarantee here is one process's cooperative protocol execution plus each
store's real transaction. It does not create atomic transactions across Baser,
Reger and RegBaser, or make in-memory caches coherent across multiple processes.
Retain the existing host/storage ownership contract.

### Readability inventory

A TypeScript AST scan of 344 production files found 1,284 conditional
expressions; 89 contain nested conditionals and 26 contain an await/yield.
These are candidate counts, not defect counts or a target to eliminate.

Prioritize these actual policy/control-flow sites in their owning refactors:

- `cli/ipex.ts`: recipient resolution, approval waiting and proposal lookup.
- `multisig-workflows.ts`: route dispatch, embedded credential validation and
  group/anchor selection.
- `ipex-grouping.ts`: conditional proposal publication.
- `cesr-egress.ts`: body/attachment preparation and abort-versus-post operation.
- `oobiery.ts`: multi-OOBI terminal result/cue construction.
- `cli/multisig.ts` and Tufa `generic-cesr-ingress.ts`: awaited result selection.
- `vdr/eventing.ts` and `query-replies.ts`: multi-branch dependency/correlation
  decisions when those owners change.

Use `if`/`switch` or a named private function when it labels real policy. Retain
clear scalar choices, comparisons, defaults and simple encoding arithmetic.
Do not add a blanket ternary lint ban or rewrite crypto/codec code for style.
The grant recipient refactor must initially preserve its offline-versus-network
resolution rules; validating exported recipient AIDs is a separate behavior
change, not formatting.

## Phases and cohesive PR sequence

One implementation PR at a time. Labels retain their original phase grouping;
row order and explicit dependencies describe review order after accepted redirects.
Every feature PR contains its focused regression evidence.
The final integration PR fills cross-boundary gaps rather than postponing all
tests until the end.

| PR      | Reviewable result                                                                                      | Dependency      |
| ------- | ------------------------------------------------------------------------------------------------------ | --------------- |
| 01      | Adopt this release scope and configurable-threshold exception; correct minimal contradictory contracts | Approval        |
| 02      | Pin and verify independent Python main, 1.2.x and 1.3.x test profiles                                  | 01              |
| 03      | Narrow endpoint/OOBI/receipt input dependencies; preserve behavior during the ownership refactor       | 01              |
| 03a     | Separate TEL input policy from accepted state and publish Tever cache changes after commit             | 02, 03          |
| 03b     | Separate immutable payload preparation from synchronous reference publication                          | 03              |
| 03c     | Make EXN admission synchronous against current state; give asynchronous consequences explicit owners   | 03b             |
| 03d     | Remove whole-protocol exclusion after proving input, escrow, reply and cancellation invariants         | 03a, 03c        |
| 04      | Simplify TCP completion API and remove unused bookkeeping                                              | 03d             |
| 05      | Make HTTP query response ownership and cancellation flow explicit                                      | 03d             |
| 06      | Separate SSE event delivery from parsing/timing/cursor policy                                          | 05              |
| 07      | Correct log streams, filtering and actual escrow-ejection diagnostics                                  | 01              |
| 08      | Validate URL configuration before all affected writes                                                  | 03              |
| 09      | Add narrow existing-store access for typed OOBI maintenance                                            | 01              |
| 10      | Add `tufa oobi clean` preview/apply                                                                    | 09              |
| 11      | Make init honor encryption and persistence choices                                                     | 07, 08          |
| 12      | Prove AEID failure atomicity; repair only if the regression confirms the gap                           | 02              |
| 12a     | Replace the ESSR file archive with ordered LMDB evidence and synchronous publication                   | 12              |
| 12b     | Remove recipient file staging and unnecessary ESSR streaming; qualify actual peer exchanges            | 12a             |
| 12c     | Establish consistent database close failures and command completion                                    | 12b             |
| 12d     | Move OOBI cleanup to ordinary Baser ownership and canonical pending table                              | 12c             |
| 13      | Give group proposal publication and completion explicit cohesive owners                                | 03d, 12d        |
| 13a     | Separate concrete ordinary/stream messenger construction and query response ownership                  | 05, 06, 12b, 13 |
| 13b     | Wire explicit delivery intent and remove the entire persisted CESR body preference                     | 13a             |
| 12e     | Correct ESSR storage/callers against actual pinned-main Baser; expose set limitations                  | 12a, 12b, 13b   |
| 13c     | Qualify messenger wire contracts with actual peers and installed packages                              | 13b, 12e        |
| 13d     | Name multisig reporting explicitly and move affected CLI presentation to Tufa                          | 13, 13c         |
| 13e     | Separate WitnessInquisitor sending and concrete query workflow ownership                               | 13c, 13d        |
| 19      | Add old-peer media fallback to mailbox polling                                                         | 02, 05, 06      |
| 13f     | Remove custom direct HTTP query replies and compose independent receive owners                         | 13e, 19         |
| 13g     | Close bounded query peer and installed-package evidence gaps, if not covered by 13f                    | 13f             |
| 13h     | Restore human maintainer documentation across recent query, transport and reporting refactors          | 13g             |
| 13h1    | Replace query broadcast with command-owned Deck handoff and one noticer consumer                       | 13h             |
| 13h2    | Reserve keyStateSaved for validated persisted remote notices and preserve accepted catch-up            | 13h1            |
| 13i     | Separate shared CLI bootstrap ownership and primitive parsing without changing behavior                | 13h2            |
| 13j     | Compose finite OOBI/authentication bootstrap with invocation-specific completion                       | 13i             |
| 13k     | Apply consistent CLI boundary validation and option precedence by command family                       | 13j             |
| 14      | Route or guard every group-capable CLI entry point before effects                                      | 13, 13d, 13k    |
| 15      | Finish group registry inception and issuance completion                                                | 02, 13, 14      |
| 16      | Complete group initiation/approval for all IPEX verbs                                                  | 15              |
| 17      | Carry query wire context to the TEL replay owner, preserving current output                            | 03d, 13f        |
| 18      | Emit legacy-compatible TEL replay without changing signed bodies                                       | 02, 17          |
| 20      | Complete group revocation approval, fanout and recipient observation                                   | 15, 18, 19      |
| 21      | Correct accepted backer-cohort selection and durable partial-receipt processing                        | 02, 20          |
| 22      | Produce and collect real TEL backer proofs through concrete runtime owners                             | 03d, 05, 21     |
| 23      | Add explicit backer policy and group registry inception/rotation commands                              | 13, 14, 22      |
| 24      | Complete group BIS/BRV, backer-policy changes and legacy replay                                        | 18, 20, 23      |
| 25      | Compose native-v2 public registry intake, dependency recovery and replay                               | 03d, 13f        |
| 26      | Establish native credential/disclosure custody and explicit CLI composition                            | 14, 25          |
| 27      | Add single-identifier native registry/credential authoring and state changes                           | 26              |
| 28      | Coordinate exact native-v2 anchors through group approval and fanout                                   | 13, 15, 27      |
| 29      | Connect native-v2 CLI IPEX delivery and wallet acceptance                                              | 16, 28          |
| 30      | Complete native-v2 presentation and vacuous-update workflows                                           | 28, 29          |
| 30a     | Expose the narrow public protocol operations required by the Tufa verifier application                 | 30              |
| 30b     | Move the verifier application, command, workflow store and maintained tests into Tufa                  | 30a, 12c        |
| 31      | Run the bounded actual-peer lifecycle matrix and close remaining evidence gaps                         | 04–30b          |
| 31a     | Assess remaining ProtocolProcessor responsibility; remove it if explicit dependencies suffice          | 31              |
| 31b     | Organize CESR sources and cohesive large-file units for human navigation                               | 31a             |
| 31c     | Organize KERI protocol/application sources and cohesive large-file units                               | 31b             |
| 31d     | Organize Tufa command/hosting sources and validate the resulting package graph                         | 31c             |
| 32      | Prepare 2.0.0 versions and breaking-change guide; qualify the reorganized candidate                    | 31d             |
| Release | Withdraw 1.0.0 distributions, then publish and verify CESR -> KERI -> Tufa 2.0.0                       | 32              |

This is an estimated decomposition, not a quota of PRs or a promise to finish
in one night. A confirmed issue may justify a small sibling PR. Skip an empty
repair PR with evidence rather than inventing a change. Do not merge unrelated
concerns to save PR count, or split a cohesive removal using temporary APIs.

### Phase A: contracts and actual reference profiles — PRs 01–02

Capture exact immutable commits for **unmodified WebOfTrust main**, a selected
1.2.x release and a selected 1.3.x release, with their actual Python/HIO/Falcon
dependencies and loaded module paths. Check live remote state at execution start,
then freeze pins for the run; do not chase main while qualifying.

Observed local candidates, not newly verified remote selections:

- main `c102367ea0b8416ffb3c01403d18b3fd4a6a38bf`;
- 1.2.15 `76c5cd568d07f17ae317ea54f39b163ae8823cba`;
- 1.3.6 `3fb88ce9007d46415099972189cbaae784e14905`.

The frozen CESR/reference pin `71438328` and mailbox fork `331f32e4` retain their
own provenance. Neither substitutes for the three requested native peer lanes.
Use the direct Python repository and existing isolated reference environments;
do not move or alter an unrelated Python working tree.

Extend existing `keripy-runtime.ts`, `probe-keripy.py`, reference configuration
and suite selection with small explicit profile data. Old CLI `init/incept`
does not accept the current harness's `--version` option. Express these known
test-launch differences without production shims or a generic adapter system.
Prove the intended interpreter/imports before running a scenario. A missing
required environment is a failed gate, not a silently skipped lane.

PR 01 records the narrow threshold exception in the owning ADR/roadmap and
directly conflicting instruction text. Preserve numeric/wire checks, and
retain the existing raised-cap, invalid-setting and qb64/qb2 regressions.

### Phase B: ownership and readable control flow — PRs 03–06

PR 03 narrows the confirmed runtime bundles, gives OOBI input its own Kevery
over shared semantic state, and preserves same-store composition. Inventory all
mutating entry points, including direct Exchanger/group calls, so a dispatcher
refactor cannot leave a second unsafe route. Keep current exclusion while these
responsibilities are separated.

PR 03a separates Tever's accepted state from per-input policy/cue ownership.
Compute candidate state before persistence and publish cache changes after a
successful transaction. Prove a failed TEL write leaves the prior live state
intact. Keep protocol acceptance changes for the later backer feature PRs.

PRs 03b/03c established a synchronous EXN publication boundary after asynchronous
preparation. Their private-file design is superseded by the ESSR removal in
PRs 12a–12b. Preserve useful protocol decisions, proof accumulation, first receipt
and handler ordering; do not retain archive guards, ownership or recovery merely
because those earlier PRs introduced them.

PR 03c separates EXN evidence preparation from synchronous current-state
validation and commit. Built-in route verification is synchronous today; remove
the unused permission for arbitrary suspending validation hooks after the caller
audit. Keep asynchronous forwarding and group-child work in explicit operations,
with concrete inputs/results and required ordering. Preserve exact evidence,
proof accumulation, first receipt, duplicate semantics and handler completion.

PR 03d updates dispatch/escrow callers to the resulting boundaries and removes
`acquireProtocol` when the proof passes. Escrow scans process concrete candidates
against current state, release cursors before suspension and retain their
existing captured horizon. Do not lock the whole engine across a scan's file I/O.
If a real invariant still needs serialization, identify the exact owner and
compare the smallest scoped mechanism with one concrete-message worker before
changing this design. Do not silently restore global exclusion or introduce a
queue of callbacks. Combine adjacent preparation PRs only if keeping them separate
would create temporary APIs rather than independently reviewable changes.

Use a bounded set of focused tests at the owning PR, reusing existing cases:

- Preserve independent KEL/query progress and correct current/historical key
  evidence after a related rotation. Remove file-stage synchronization fixtures
  when the archive and its asynchronous preparation disappear.
- Prepare competing IPEX responses and same-SAID proof/payload admissions;
  only the allowed response wins, proofs accumulate and retained bytes/receipt
  remain stable. Include an escrow retry overlapping new proof arrival.
- Cancel before commit and during actual post-commit work; no partial LMDB
  evidence, rollback of acceptance, unjoined I/O or duplicate group side effects.
- Change forwarding authority during child preparation and deliver another
  peer wrapper during local approval replay. Recheck authority before mailbox
  publication; every eligible wrapper must be processed without another approval.
- Preserve exact mailbox authorization through forged matching-SAID attachments,
  partial proofs, recovered dependencies and the final query of a multi-frame
  request. Correlated replies must survive unrelated cue publication.

Retain behavioral cleanup/isolation assertions; remove tests that merely assert
the old mutex/waiter implementation. No large scheduling matrix or new generic
test harness is required. Existing lifecycle tests and the later native/group
interop PRs provide their separate end-to-end evidence.

PR 04 removes unused TCP result variants/counting and their exports without
compatibility aliases. Keep real peer-byte, accepted-input, half-close,
concurrent RX/TX, source/parser failure, deadline, abort and joined-close checks.
Replace assertions about removed result shapes with observable protocol/I/O
assertions; receive EOF remains required only when receive processing is requested.

PR 05 separates send-only posting from response-consuming query execution.
HTTPMessenger visibly obtains the scoped frame response and processes CESR/SSE.
CESR egress owns prepared framing and the narrow media-refusal rule; HttpClient
owns native request/read cleanup. Use small named private operations for real
branches. Preserve one-frame-at-a-time processing: eagerly parsing the entire
input would change behavior when a later malformed frame follows a valid send.

Cleanup must preserve pre-abort behavior, active-consumer cancellation, exact
owned cancellation reasons, foreign AbortErrors, primary plus cleanup failure,
parser iterator return and no caller resumption after halt. A value-returning
cleanup-error filter may replace throw/catch-as-filter; no cleanup manager.

PR 06 exposes complete mailbox SSE records through a scoped pull boundary so
the owner visibly consumes, processes and then advances its cursor. Keep
fragmented UTF-8/CRLF, complete events before EOF, unfinished-tail discard,
idle-after-first-complete-event behavior, absolute deadlines and backpressure.
Do not add a producer queue/task merely to remove a local callback. If a pull
design increases lifetime machinery, retain the minimal immediately awaited
local consumer with named responsibilities and record that concrete review
decision; arbitrary injected protocol consumers still leave CESR egress.

### Phase C: operator contracts — PRs 07–12

**Logging.** Route all enabled diagnostic levels to stderr at the existing
logger. Retain the current four levels and loglevel selection. Compare actual
KEL/reply/TEL/TSN/credential/EXN/v2-registry removal paths with the selected
references. Pending retries, acceptance cleanup, family migration and EXN
`preserveEscrow` must not become warning floods or false ejections. Report
terminal ejection/expiry after committed removal, with family, identity,
reason and original cause where available. Failed writes must not report
successful removal; unexpected infrastructure errors still propagate.
No logging wrapper, service injection, callback, history or new level is needed.

Use focused owner tests and actual CLI subprocess stdout/stderr assertions at
debug/info. Combined output assertions cannot detect JSON contamination.

**URL configuration.** One shape validator owns collection knowledge for
`iurls`, `durls`, `wurls` and the existing alias `curls` caller. Absent means
`[]`; `[]` is valid. Present null/scalar/mixed array/empty or whitespace-only
entry fails with field/index. Preserve accepted strings exactly and retain TCP;
do not introduce URL normalization, scheme restrictions or new datetime policy.
Validate all Habery URL fields even without `dt`, before any OOBI pin. Preserve
alias endpoint URL parsing and validate before signed reply effects.

The decisive regression is valid early fields plus invalid late `wurls`:
both OOBI stores and existing records remain unchanged. Cover malformed
`curls`, absence, empty arrays, mixed types, valid HTTP/TCP and reopen.
This resolves the older ENCTX proposal's inconsistent statement about empty
arrays in favor of its explicit collection-shape contract.

**Existing-store access and cleanup.** PRs 09–10 introduced exact-key cleanup
and a separate maintenance opener. PR 12d supersedes that ownership design:
load an ordinary Baser and use its canonical `oobis` table, including KERIpy's
`>` separator. Normal table initialization and habitat reload/cleanup are
accepted startup effects. Do not promise that preview leaves all storage bytes,
metadata or unrelated startup state untouched.

```text
tufa oobi clean --name NAME [--compat] --head-dir DIR --key-file keys.json
tufa oobi clean --name NAME [--compat] --head-dir DIR --key-file keys.json --apply
```

Selection remains a nonempty JSON array of exact string keys, deduplicated
without altering bytes. Preview does not delete selected rows. Apply preflights
all requested keys, deletes only pending `oobis` rows and reports completed and
remaining operations honestly. Missing keys or failures exit nonzero; close
failure does not roll back completed deletions. Final success follows resource
closure. Do not add wildcard/age/URL heuristics or clear other OOBI tables.
Missing target storage must fail before ordinary loading can create a database.
Keep generic LMDBer `openExisting` non-creating semantics separate from this CLI's
ordinary Baser lifecycle. Open no Keeper, Habery, Configer or agent runtime.
The operator stops and backs up the service; the CLI performs no orchestration.

**Initialization.** Separate resolved init choices from prompt/open effects.
Use hidden terminal input with correct restoration, or explicit noninteractive
credentials, including the existing valid `--aeid` plus `--seed` path without
an unnecessary passcode prompt. Reject incomplete or contradictory credential
combinations. Empty, cancelled, mismatched or absent noninteractive credentials
fail before key material is created. `--nopasscode` and `--temp` are explicit;
reject contradictory encryption choices. Preserve passcode derivation.
Persistent-path failures propagate; never retry in temporary mode. Qualify
blank/cancel/EOF, wrong passcode, encrypted reopen, explicit plaintext/temp and
an invalid persistent parent with no temporary fallback.

**AEID failure atomicity.** The risk is source-grounded, not reproduced yet.
Use real disposable Keeper stores and failure injection after early salt/seed
writes to check rollback and reopen. If confirmed, use one existing keeper
transaction for affected rows and AEID; publish live encrypter/decrypter/seed
only after commit. Validate inputs before mutations. Prove old state is readable
after failure and new state after success, including signing and wrong-key refusal.
Exercise several affected `prms`/`pris` rows and preserve read-only-open
nonmutation and the existing documented AEID transition matrix. Atomicity must
not silently redefine passcode policy.
Do not add a passcode-management command, migration framework or crypto redesign.
If the existing code already satisfies the invariant under the real storage
semantics, retain only the useful regression and omit a fabricated repair.

### ESSR archive removal — PRs 12a–12b

Delivered in #598/#599. The archive/staging removal remains required; their
ordinal-preserving and first-representation storage decisions are superseded by
[PR 12e](#essr-storage-correction--pr-12e). Historical test results remain evidence
of the implementation tested, not qualification of the corrected contract.

Kent explicitly requires removal of the custom archive and unnecessary ESSR
content infrastructure. This supersedes the earlier private-file preparation
contract. Do not retain it behind interfaces, compatibility wrappers or flags.
Keep the remaining release scope and perform final qualification after this
refactor and all later implementation/organization changes.

Inspection establishes the starting point:

- `Baser` lazily opens `PayloadArchive`, performs archive startup recovery and
  reconstructs ESSR evidence through private file references; Exchanger prepares,
  pins and retires those files around its semantic publication boundary.
- `Baser.savePlaintext/getPlaintext` and `plaintext.meta.` have no production
  callers in the inspected source; their callers are tests. `EssrRecipient`
  already decrypts into a complete crypto buffer before staging another file.
- Independently pinned KERIpy main `424a50c`, 1.2.14 `bab95c1` and 1.3.6 `4ce4cc7`
  store exchange evidence in LMDB and verify the committed ESSR digest over
  concatenated raw Texter bytes. Digest verification is already upstream.
- A disposable native-LMDB probe against each of those three references inserted
  two identical Texters: `.essrs.add` returned true then false, reconstruction
  retained one fragment and failed the original digest. This confirms the
  sequence-versus-set storage hazard; the implementation PR adds the signed EXN
  acceptance/retry regression, rather than calling this table probe full interop.

**PR 12a: LMDB evidence and archive removal.** Make accepted evidence and protocol
escrows authoritative in the ordinary exchange stores: body, signatures, source
seals, pathed/nested material, ESSR fragments and required receipt/genus facts.
Inspect the pinned reference's `processEvent`, `logEvent`, escrow/retry and clone/
reconstruction paths; preserve supported acceptance and retry semantics. Commit
validation and affected rows together with ordinary native transactions. Remove
`payload-archive.ts`, `PreparedPayload`, `payload.refs.`, `payload.owners.`, archive
recovery, file publication/reclamation, archive open/close integration and exports.
Remove the unused archive-dependent `savePlaintext/getPlaintext`, plaintext
metadata and their tests in this same persistence PR, so archive deletion needs
no transitional facade. Inspection found no required production consumer.
Remove private provisional rows such as `enst.stage.` when their sole purpose is
archive-era asynchronous preparation. Keep only metadata with a demonstrated
protocol/application consumer; remove file-reference metadata rather than moving it.
Simplify Exchanger's file-driven preparation, reference comparisons and finishing;
keep actual route security, current-state checks and handler responsibilities.

PR #598 originally retained repeated fragments with ordinal CESR writes. That
decision is superseded: PR 12e restores ordinary main-targeted IoSet behavior
and replaces the sequence-success expectation with an explicit limitation test.
Keep acceptance/reopen/retry/replay successes using distinct fragments and
signed-digest rejection without corrupting prior evidence. Archive-only recovery,
ownership and reclamation tests remain removed.

**PR 12b: ordinary authenticated data and removal of staging infrastructure.**
With unused durable plaintext APIs removed in PR 12a, simplify the recipient's
remaining transient plaintext path. Return ordinary authenticated data with an explicit caller lifetime; do not
persist decrypted plaintext automatically. Retain signed payload-digest checks,
accepted-EXN/recipient selection, sealed-box authentication and SCS source/envelope
validation where applicable. Inspect the reference before describing any receiver
check as absent upstream. Remove the plaintext store constructor dependency,
`FilePayload` ownership/discard APIs and file staging from `EssrRecipient`.
Trace all production consumers across CESR, KERI and Tufa, then delete unnecessary
`payload-store.ts`, `payload-view.ts`, sink/owned-payload types, ESSR content-reader/
streaming adapters, exports and tests. Replace incidental uses with existing
finite byte/serialization APIs where appropriate. Preserve independently justified
CESR counters, framing, parsing, nested message semantics and actual transport
streams; ESSR having used a shared primitive is not itself a deletion rationale.
Retain no forwarding-only compatibility facade or replacement storage framework.
Update package probes and qualification scripts to exercise retained public
behavior; remove archive-only probes rather than preserving dead APIs for tests.

Keep checks focused and part of these PRs. Adapt existing ESSR/security cases
instead of building an exhaustive new matrix. Add one bounded bidirectional
supported ESSR exchange with each relevant pinned main/1.2/1.3 peer, using its
actual supported wire lane; verify accepted evidence and byte commitments through
public processing/reconstruction, not only fixture decoding. Credit capability
limits honestly and keep the repeated-fragment upstream defect explicit rather
than masking it in ordinary happy-path interop. Preserve digest-mismatch and
justified recipient/authentication refusals. Run relevant installed-package checks
for changed public exports/native storage, and record all removed APIs in the
planned 2.0.0 breaking-changes guide and release notes.

Prepare a concise conceptual upstream recommendation: ESSR fragments form an
ordered sequence with multiplicity, so persistence and escrow/replay must retain
positions even when qualified values repeat; include the minimal digest-breaking
example and a small ordinal-sequence storage suggestion. Do not submit an issue,
PR or other upstream message without separate authorization. The final completion
report must state removals, the LMDB evidence owner, justified deviations, actual
checks and whether this small upstream correctness improvement remains warranted.
Split a PR further only when a real independently reviewable responsibility needs
it; do not leave dead compatibility layers as a finished intermediate outcome.

### Database lifecycle and OOBI ownership — PRs 12c–12d

**PR 12c: close correctness.** Inspect LMDBer close/reopen, actual pinned lmdb-js
and Effection implementation, and the affected owners before changing behavior.
Retain `openExisting`, refusal to create missing storage/tables, and its clearing
restriction. Shutdown failures propagate for every handle, independent of opening
policy. Repeated close is harmless only when the wrapper knows closure succeeded;
never classify arbitrary native failures as already closed. Failed close prevents
reopen, reuse and directory removal. Model only the uncertainty the binding
actually leaves, with a small explicit implementation rather than lifecycle
frameworks or policy flags. Inspect `quiesceEnvTimers`: elapsed time is not proof
of closure; retain a teardown drain only if source and focused runtime evidence
justify it.

Verify Effection's operation/cleanup failure semantics. Preserve both failures
with minimal local handling where the runtime loses one, and attempt closure of
all resources an affected owner owns. `tufa oobi clean` emits overall success
only after its resources finish closing. Keep useful completed/remaining deletion
reporting on failure without claiming rollback. Test ordinary and existing-only
close failures, known-closed repetition, refused reopen/delete after close failure,
simultaneous operation/cleanup failures, with CLI shutdown-failure output qualified in PR 12d. Use a
small native-close fault boundary and real storage checks. Record binding limits
and public behavior changes in the breaking-changes guide.

**PR 12d: ordinary Baser cleanup.** Inspect KERIpy's Baser lifecycle and current
CLI, then remove `openOobiStore`, `OobiStore`, dedicated options/exports, duplicate
pending-table construction and tests enforcing the abandoned startup isolation.
Use established Baser loading and `Baser.oobis`. Do not replace the opener with
another maintenance mode, partial Baser, lazy schema or special loading bypass.
Reassess path/default helpers and remove those with no remaining purpose; retain
the separately required generic `openExisting` contract. Use the smallest target
presence check compatible with ordinary loading. Normal table/metadata creation
and habitat reloading/cleanup are accepted, including during preview.

Retain exact selection, preview/apply, protected adjacent tables and truthful
partial-failure reporting. Test through real Baser loading, missing-target refusal,
canonical separator behavior and successful database reopening. Keep focused
pinned-KERIpy coverage proving the proper pending table is selected and the
resulting store reopens. Preserve PR 12c's close contract. Keep documentation
minimal; report removed machinery, accepted startup effects, actual checks and
remaining binding uncertainty. Both PRs precede final qualification and 2.0.0.

### ESSR storage correction — PR 12e

Execute the approved [ESSR storage supplement](essr/ESSR_STORAGE_PARITY_PLAN.md)
next after messenger PR 13b (#605), before PR 13c, expanded
multisig feature work and final qualification. Use one cohesive corrective PR:
restore Baser's typed `CesrIoSetSuber<Texter>` contract first, then align Exchanger
append/set behavior and qualify against actual pinned-main `Baser.essrs`.
Keep #598/#599 archive, staging and durable-plaintext removals.

The storage target is main `424a50c03421165c5f289e07a341bd57b8d8ab78`, table
`essrs.`; legacy 1.2.14/1.3.6 Baser binds `.essrs`. A manually constructed Suber
cannot establish native Baser compatibility. Incoming signed bytes and stored
reconstruction are distinct: accept the reference's repeated-fragment and
alternate-fragmentation limitations explicitly, without weakening digest/auth
checks or adding replacement storage. Do not reproduce main's separate
unknown-sender escrow evidence-loss defect.

The supplement specifies focused tests, actual main Baser bidirectional/reopen
evidence, bounded wire reruns on all three pins, and concise corrections to
contracts, compatibility/breaking-change docs, historical reports and inventory.
Direct legacy LMDB compatibility has a [canonical deferred roadmap owner](db/DB_PARITY_PLAN.md#deferred-legacy-lmdb-compatibility)
outside the 2.0 gate; v1 protocol wire support remains mandatory. Preserve
historical findings with accurate scope rather than rewriting them as current
implementation truth. No upstream submission is authorized.

### Transport supplement: explicit messenger selection — PRs 13a–13c

The approved 1.2.x release target is now GLEIF-IT/keripy v1.2.17, immutable
commit `b8626e1d58770a4a480ea72a01acc5580278a9f2`, with `gleif-hio==0.6.21`.
It replaces WebOfTrust 1.2.14 after the finite TCP probe exposed queued-input
loss at EOF. Main/1.3 and the separately labeled mailbox fork remain unchanged.
Use the canonical reference JSON for execution pins throughout the remaining work.

Adopt [MESSENGER_SELECTION_PARITY_PLAN.md](runtime/MESSENGER_SELECTION_PARITY_PLAN.md)
as an approved, required supplement to this goal. Execute it next, after the
initial typed publication cut of PR 13 and before expanding group CLI/IPEX
behavior. The existing ordinary/stream Poster admissions currently converge on
HTTP POST; correcting that boundary first prevents misleading lifecycle coverage.
The remaining durable proposal selection/resume work in PR 13 is still required.

Follow the supplement's caller inventory and review boundaries:

- **13a: construction and response ownership.** Extract HTTP query receive work
  into its cohesive owner. Add small concrete `messengerFrom` and
  `streamMessengerFrom` construction: ordinary signed-message HTTP POSTs, one
  finite opaque HTTP PUT for stream delivery, and shared raw TCP socket mechanics.
  Preserve full endpoint paths, destination/authentication, endpoint precedence,
  ordinary media-refusal fallback, response lifetime and real cleanup. Construction
  has no I/O. Refactor responsibilities before introducing the stream operation;
  keep production stream routing for 13b rather than mixing that behavior change
  into the ownership extraction.
- **13b: explicit callers and preference removal.** Route the existing one-worker
  Poster admissions through their concrete messengers. Preserve ordinary multi-role
  and stream first-present-role routing, introductions, forwarding, local-provider
  bypass and per-admission outcomes. Initial grant/admit/spurn retain explicit
  stream delivery; join completion and existing ordinary publishers retain ordinary
  delivery. Queries/mailbox polling are signed POSTs, and specialized mailbox-admin
  and receipt APIs retain their own contracts. Delete `cesrBodyMode`, its persisted
  reads/writes, Habery/options/CLI/export surface, framing switches and obsolete
  preference tests together. No replacement global setting, migration reader,
  aliases or user-store row cleanup. Record removed APIs/options and the stream
  PUT endpoint requirement in the 2.0.0 breaking guide and release notes.
- **13c: bounded actual-peer and package evidence.** Extend the maintained fixture
  owners, not a new harness. Exercise signed ordinary POST and multi-message PUT
  in both directions with unmodified pinned main/1.2/1.3, accepted semantic state,
  and exact method/framing assertions. Cover actual TCP payload admission with
  GLEIF 1.2.17, the separately labeled composed mailbox environment, and installed Node
  factories and supported CLI behavior. Do not add retired-feature absence guards. Preserve the upstream main/1.3 TCP factory limitation
  rather than patching it. Omit an empty third PR if the evidence fits 13a/13b.

Use the supplement's small contract/lifetime matrix and existing topology. Before
13b merges, run a real composed Python/Tufa stream exchange; do not postpone PUT
endpoint discovery to final qualification. Add wire assertions to existing IPEX
coverage, including ordered support messages and initial PUT versus join POST.
Native-v2 CLI-specific assertions depend on the later authoring/IPEX work in PRs
27–30 and must be completed there and in PR 31; early transport probes do not
claim those unfinished CLI features. Reuse the same peer fixtures and assertions
instead of multiplying every verb/role/framing/profile combination.

Do not add queues, transport registries, scheduling frameworks, asynchronous
upload infrastructure, payload archives, memory budgets, retries or durable acks.
Transport completion remains distinct from protocol acceptance. Preserve the later
ProtocolProcessor assessment without requiring its retention for messengers.
Carry these contracts through reorganization, then rerun affected checks and the
final whole-release source/artifact qualification. All other release objectives
and deferred scope remain unchanged.

### Multisig reporting names and CLI ownership — PR 13d

Complete this cohesive naming-and-layering refactor after the ESSR correction
and messenger qualification, before the remaining durable-selection work in PR
13 and expanded lifecycle features in PRs 14–16/20. The first publication-owner
cut already exists; this refines its contracts without changing approval behavior.

| Existing reporting name       | Replacement          |
| ----------------------------- | -------------------- |
| `ProposalPublication`         | `GroupSendResult`    |
| `ProposalIdentity`            | `GroupMessageRef`    |
| `SignedGroupProposal`         | `SignedGroupMessage` |
| `ProposalDelivery`            | `GroupDelivery`      |
| Result collection `proposals` | `messages`           |
| Identity field `said`         | `exnSaid`            |
| Identity field `proposal`     | `payloadSaid`        |

Apply the adopted [result contract simplification](exchange/RESULT_CONTRACT_SIMPLIFICATION_PLAN.md)
in this same cut: keep signed/delivery helper records internal, expose one
`RegistryResult` and one `IssueResult` with optional group facts, and preserve
flat Tufa JSON through explicit projection.

Apply fields only to these reporting records, never indiscriminately to protocol
objects or unrelated SAIDs. `exnSaid` identifies the outer coordination EXN.
`payloadSaid` is the existing Multiplexor aggregation key: the v1 embedded-bundle
SAID or supported v2 signed-child SAID. `deliveries` records completed transport
destinations, not participant approval or group acceptance. Existing `join --said`
continues to select the outer EXN SAID. Preserve genuine proposal terminology for
approval/grouping behavior; this is not a global vocabulary replacement.

Rename associated extraction, signing, sending and aggregation helpers
consistently, together in one cohesive keri application module with explicit
dependencies (refine the existing publication module). Shared signing/sending
stays in keri; its workflows return typed data. Move affected CLI JSON projection
and presentation into Tufa command adapters, including only the necessary output
orchestration. Do not move the whole CLI, make keri import Tufa, pass formatting
callbacks into keri or add a renderer framework.

Refactor ownership/contracts before behavior under the ten constraints and SOLID.
Preserve wire bytes/signatures, routing, exact local-processing order, Multiplexor
indexes, worker ownership, failure propagation and acceptance checks. Add no new
proposal IDs, persistence, queues, lifecycle machinery or old-name aliases.

Update callers, public declarations, tests and CLI output expectations. Run
focused multisig/grouping/credential/endpoint cases, affected Tufa tests, relevant
static/library-boundary and installed-package checks. Include an appropriate
changeset and concise breaking-change guide/release-note entry for the renamed
types, fields and JSON output. Keep this separate from pending multisig lifecycle
features; later PRs use the resulting typed contracts.

### Query composition parity — PRs 13e–13g

Adopt [QUERY_COMPOSITION_PARITY_PLAN.md](runtime/QUERY_COMPOSITION_PARITY_PLAN.md)
as required release work after messenger qualification and the reporting/layering
cut 13d, before finishing durable proposal resume or expanding lifecycle features.
It supersedes the messenger supplement's requirement to retain HTTPQuery-owned
CESR/SSE response intake. Ordinary POST, whole-stream PUT, TCP reply intake and
joined transport cleanup remain required. Advance the already planned PR 19
(old-peer mailbox media fallback) between 13e and 13f so removing direct HTTP
responses does not strand legacy peers waiting on an incompatible polling request.
Do not duplicate that fallback in the new query sender.

- **13e: responsibility-first ownership.** Introduce a concrete WitnessInquisitor
  sender and scoped KeyStateNoticer/LogQuerier/SeqNoQuerier/AnchorQuerier operations.
  Remove QueryCoordinator and its generic watch/continuation registry; wire actual
  cues, delegation and host lifetimes explicitly. Move only affected command
  composition/presentation into Tufa. Preserve wire/failure behavior during this
  structural cut; any necessary direct HTTP operation stays private until 13f.
- **13f: coherent behavior change.** Use ordinary messengers for query sends.
  Delete HTTPQuery, custom direct HTTP replies/options/reservations, retained
  exact-packet resend machinery and implicit CLI controller-OOBI catch-up.
  Ordinary non-mailbox queries acknowledge intake with 204; independently
  composed mailbox/direct endpoint/TCP receivers feed normal protocol processors.
  Workflows complete only from accepted evidence under one elapsed command
  deadline. Audit and retain shared ReplyStreams and genuinely required TCP
  QueryReplies functionality. No replacement coordinator, generic continuation
  callbacks, retry API, queue framework, aliases or dormant compatibility implementation.
- **13g: bounded cross-peer evidence if still needed.** Reuse maintained witness,
  mailbox and query owners for genuine main/GLEIF 1.2.17/1.3.6 progression in both
  directions and installed public library/CLI checks. Fold this cut into 13f if
  its required evidence is already complete; never defer a known broken path.

**13h: maintainer documentation follow-up.** Immediately after the current query
interop PR and before further feature work, review #612 and the related recent
transport, ESSR and reporting refactors for lost explanatory documentation.
Restore useful module/class/function explanations, parameter meaning, invariants,
accepted-state versus transport completion, cancellation/failure behavior and
KERIpy correspondence wherever maintainers would otherwise have to reconstruct
intent from implementation. Explain real contracts without restating types,
adding a play-by-play report or changing behavior. This targeted review supersedes
the earlier minimal-docs preference where source documentation became too terse.

**13h1–13h2: command-owned query cues.** After maintainer docs and before
bootstrap ownership, execute the approved
[Deck/cue query observation plan](runtime/QUERY_CUE_OWNERSHIP_PLAN.md).
First replace keyStateUpdates/Channel subscriptions with a command-scoped Deck,
one noticer and explicit transfer through the existing cue owner, wired before
sending/receiving. Preserve KERIpy pull/match/append behavior, unrelated/deferred
cues, cooperative turns and independent transport owners; remove the unsupported
simultaneous-noticer product contract. Then separately restrict keyStateSaved to
validated, persisted remote KSNs, removing ordinary KEL-acceptance publication
after auditing consumers. A saved notice establishes the target; accepted local
KEL state completes catch-up. No request correlation/freshness machinery or new
notification service. Use focused signed-input, cue-handoff, deadline/cleanup and
existing peer/package checks. Future Channels require an evidenced production use.
Correct affected docs with each implementation cut; no global ProtocolProcessor
removal or broader Effection rewrite is a prerequisite.

**13i–13k: CLI bootstrap and validation.** After the query cue/KSN cuts and
before group CLI lifecycle expansion, execute the approved
[three-PR bootstrap composition plan](runtime/CLI_BOOTSTRAP_COMPOSITION_PLAN.md).
First extract the shared finite operation and give state inspection Baser directly,
preserving behavior. Then replace whole-AgentRuntime bootstrap with explicit
Oobiery/Authenticator and minimal KEL/reply intake/retry.
Scope success/failure/deadline to the selected bootstrap records and fresh
authentication attempts; unrelated historical failure or pending work must not
determine completion, including old escrows for the same AID. Per the #620 design
correction, ordinary resolution means response processing; later operations check
accepted evidence. Delete inferred protocol-dependency scans and recovery queries.
Keep Authenticator's controller-state/authorization checks, actual work-family
selection, owner-managed multi-OOBI recovery and joined cleanup under one named
scope with a monotonic deadline. Preserve the independent reply reconstruction fix.
Finally consolidate equivalent primitive CLI validation with correct omission,
false/zero/empty semantics, file/CLI precedence and command-local policy. Retain
all #595 credential guarantees. Keep delegated inception's legitimate runtime,
coordinate physical relocation with the later organization cuts, and do not make
ProtocolProcessor removal a prerequisite. Use focused existing tests and relevant
interop/package checks; no new scheduler, persistence, ESSR wrappers or exhaustive
matrix. These are implementation PRs before final qualification, not release steps.

Preserve exact-envelope mailbox authorization, awaited processing before cursor
advancement, independent endpoint progress, signer/subject/attester distinctions,
and the existing finite anchor-recovery candidate policy/topology. TCP can still
receive same-socket replies; HTTP sending never interprets response bytes as
protocol evidence. Cover KSN-to-logs progression, sequence/anchor predicates,
single-owner cue handoff, real 204 plus asynchronous receipt, one refusal or
cancellation and one absent-evidence deadline. Convert superseded direct-response
tests to supported behavior; do not add absence guards for deleted features.

Record the removed public APIs/custom HTTP behavior in the breaking guide and
appropriate changesets. Update only affected ownership contracts; no execution
report is needed. Carry this composition through later recovery/native-v2 work,
ProtocolProcessor assessment and package organization, then rerun final release
qualification. Preserve all remaining release objectives and deferred scope.

### Phase D: group credential lifecycle — PRs 13–16 and 20

PR 13 establishes one typed, domain-specific proposal/publication responsibility.
Remove untyped VCP/ISS payload/embed bags and duplicated publication knowledge.
Keep CLI prompts/files/deadlines separate from authorization, signing and
persistence. Refactor first without silently changing acceptance. Avoid a
generic workflow engine, callback scheduler or runtime-shaped parameter object.

After PR 13d, typed send results expose `messages` with `exnSaid` and `payloadSaid`;
transport destinations remain distinct from approval/acceptance. Define a
public CLI selection/resume path for the exact VCP/ISS/REV from durable evidence,
independent of whether its notification still exists. Reuse the existing join
selection surface where it fits. Resuming must not re-prompt recorded approval,
construct another event or require accepted rows to be manually seeded.

PR 14 inventories every CLI entry point that selects, signs with or mutates a
group habitat: inception, interaction, rotation, delegation, endpoint roles,
credential commands, IPEX and ordinary commands accepting a group alias.
Each uses the appropriate group proposal/approval/fanout path, or rejects with
the correct supported group command before effects. In particular, verify
ordinary `interact`/`rotate` against their multisig counterparts; endpoint-role
commands already have explicit group handling. Raw contribution output must
identify partial evidence. Preserve existing KEL/delegation/endpoint approval
tests and add focused subprocess regressions for uncovered entry points.

PR 15 finishes existing VCP/ISS paths. Register the exact signed local wrapper
before transmission so returning proofs can recognize local approval. One
command-owned host runs the existing workers and observes accepted state.
Persist the actual protocol progression required across group anchor signatures,
witness receipts and TEL publication. Existing `tmse/tpwe/tede` definitions are
not proof that their lifecycle is implemented; inspect their real writers/readers.

Before local signing or KEL mutation, preflight the VCP/ISS group, issuer,
registry identifier, credential/schema validity, TEL event, source seal and
exact anchor relationship. This applies to both initiation and peer approval.
Reuse pure validation responsibilities; add no generic preflight framework.
Missing dependencies remain pending without signing. Malformed or inconsistent
proposals produce no new local signature, anchor or alias writes.

Assign completion to one concrete VDR owner. Restore no historical Registrar
facade by name; add a domain owner only for the demonstrated work. Do not mark
`ctel` complete at mere local TEL admission when group anchor/witness obligations
remain. Match reference completion semantics without describing fire-and-forget
TEL publication or local transmission as remote acceptance. Prove remote state
separately. Honor advertised establishment-only anchoring through rotation.

PR 16 applies group initiation to **apply, offer, agree, grant, admit and spurn**,
reusing existing wrapped-IPEX approval, group-index signing, threshold aggregation
and leader selection. Preserve verb-specific predecessors, parties, recipient
selection, support proofs and admit wallet acceptance. Member fanout, group
business acceptance and elected external delivery are separate facts.
Offline output must not label partial group evidence as a completed grant.
Preserve actual Poster partial-success diagnostics at CLI boundaries.

PR 20 extends VDR proposal approval with REV and uses the completed owner:

- Validate group membership, credential issuer, registry, prior TEL event and
  exact anchor relationship before a member signs.
- Aggregate proofs for the original event; duplicate approval/revocation does
  not create a replacement credential, another REV or another KEL anchor.
- Fan out to peers, then disseminate completed evidence to the issuee/selected
  recipients using their supported protocol lane.
- Prove holder/verifier revoked state through actual delivery or fresh replay.
  Old issuance or stale TSN replay must not revive a revoked credential.

This phase completes the legacy no-backer baseline, including ordinary and
establishment-only anchors, single/group counterparties and witnessed operation.
The required backer phase extends that same lifecycle with separate TEL backer
evidence; the required native-v2 phase supplies genuine-v2 CLI authoring.
Do not treat success in this baseline as completion of either expansion.

Required adversarial/lifetime cases:

- Declined or unauthorized proposal produces no local signature or publication.
- Parent signatures cannot authenticate child events/credentials.
- Duplicate signature indices and foreign endorsements cannot satisfy thresholds
  or select leader; weighted thresholds do not require every member.
- Local-first and remote-first arrival, stale/mismatched anchors, changed group
  key state, late signatures and missing witnesses retain honest pending results.
- Restart after proposal receipt, approval before threshold, anchor before
  receipts, and TEL acceptance before publication. Resume the same protocol
  event from durable evidence through explicit command execution. Include a
  subprocess restart after notification consumption and resume using only the
  public CLI.
- Deadlines/cancellation join workers before stores close; no durable network
  outbox or new retry guarantee is added.
- Every participating member converges on the same accepted business state;
  elected external delivery is independently observed.

### Phase E: legacy replay and peer interoperability — PRs 17–19

PR 17 carries parsed attachment genus through `queryEnvelopeFromDispatch` into
the TEL query policy owner, preserving current emitted bytes. Keep body protocol
version, attachment genus and HTTP media type separate. Introduce no peer
capability registry or inferred protocol downgrade.

PR 18 selects replay framing from the actual request context. Genuine unselected
legacy requests receive v1-compatible attachment counters/source seals without
a v2-only selector. Explicit v2 contexts retain v2 framing. Direct library
callers select their intended wire settings explicitly. Reuse `Reger.cloneTvt`
and known semantic attachment conversion; preserve raw signed bodies, SAIDs,
signatures and source-seal meaning.

Reger currently treats requested genus as a floor. A v1 request for an event
whose signed body or proof requires v2 must receive an explicit unsupported
outcome; do not silently raise the floor and call it v1 compatibility. Missing,
opaque or unmappable proof material must never be rewritten into plausible wire.
Preserve replay horizons, order, lazy reads and cursor cleanup.

Define refusal at the replay owner: incompatible later evidence may be discovered
after a valid prefix has been sent. Return a typed unsupported outcome and
terminate the stream without reporting completion; preserve any prefix the
receiver already accepted. Preflight available metadata when sufficient, but
do not eagerly materialize every body merely to hide this streaming boundary.
Test incompatibility both at the first event and after a valid emitted prefix.

PR 19 adds the existing narrow legacy-media fallback to mailbox query polling.
Share the exact pre-processing media-refusal predicate; close the refused
response before the one alternate `application/cesr+json` attempt. Reuse identical
signed query/attachments and Authorization. No fallback on unrelated 406,
authentication/KRAM refusal, parser failure, transport failure or later application
rejection. Preserve SSE response lifetime and consume-before-cursor behavior.
This specific HTTP accommodation is not the deferred generic delivery retry.

### Phase F: real group backer registries — PRs 21–24

**PR 21: accepted cohorts and accumulated evidence.** Extract the narrow
backer-state selection responsibility before changing admission. Resolve
`ra.i/ra.s/ra.d` against accepted registry management evidence, not a raw or
escrowed body. VCP uses its validated initial roster; VRT uses its validated
rotated ordered roster and threshold; BIS/BRV use their exact historical
management tuple. Reuse existing signature verification and merge valid proofs
by unique index. Retry and reopen partial-witness `twes` evidence; repeated
bodies may contribute missing proofs without reapplying business state.
Preserve earlier valid contributions instead of replacing `tibs`.

**PR 22: real backer participation.** Add one concrete backer-operation owner,
composed with explicitly hosted nontransferable backer signers, the parser,
existing endpoint resolution and Poster/messengers. It validates the exact
event, issuer anchor, registry history and its authorized index before signing.
Expose activation through the existing agent/witness hosting CLI composition,
with an explicit selected backer AID and role; do not auto-host or sign as every
local Hab. Use the established listener and endpoint ownership. B1 must launch
backers through this public command, not a test-only service constructor.
Eligibility to endorse is separate from observer acceptance: requiring a full
backer threshold before producing a contribution would deadlock the workflow.
Do not bypass verification by globally enabling local processing.

Use the existing wire: original TEL body, indexed backer signatures
(`WitnessIdxSigs`) and issuer source proof (`SealSourceCouples`), in the selected
CESR genus. Both parsers already deliver these to Tevery. Add no new receipt
message or KEL `rct`. Collect verified contributions, then disseminate the
threshold-complete evidence. Persist received evidence and protocol progression;
delivery retries/outboxes remain outside scope.

**PR 23: backer policy and management.** Replace the inadequate boolean-only
input with explicit ordered backer roster and threshold input, retaining a
clear no-backer choice. Add registry rotation with cuts/additions/threshold.
Validate the proposed policy before effects and display the policy change for
group approval. Remove the group-backers rejection only when the actual receipt
path is available.

There is no inspected standard `/multisig/vrt` handler or Python registry-rotation
CLI. Use existing `/multisig/ixn` or `/multisig/rot` approval for the exact issuer
anchor, with the VRT evidence supplied separately and verified before signing.
Prove the binding between both parts. Do not invent a TS-only route and label
it Python CLI compatibility. Keep establishment-only anchoring distinct from
registry management rotation.

**PR 24: issuance/revocation and completion.** Select BIS/BRV from accepted
registry mode and historical management state. Existing issuance/revocation
coordination must validate the actual embedded ilk and relationships. Complete
three separate obligations: group authority over the issuer anchor, required
issuer KEL witness evidence, and TEL backer quorum with completed dissemination.
None alone establishes remote acceptance.

Exercise a nonempty roster and a real threshold, change the backer roster
between issuance and revocation, then replay both states to a fresh observer.
The old event retains its original authorized cohort. Use existing protocol
tests for signature/ordering invariants; add focused regressions only for the
accepted-coordinate and partial-proof bugs and the new concrete owner.

Inspected Python main, 1.2.x and 1.3.x do not automatically produce TEL backer
receipts; their Tevery comments disable that cue path. Python Registrar's
witness progression does not implement it. Qualify TS backer services against
real Python observer intake. A helper invoking the unmodified Python signer
can independently produce proof bytes, but must be labeled a Python API driver,
not a native autonomous backer service.

### Phase G: native-v2 credential CLI — PRs 25–30

**PR 25: production intake and recovery.** Compose the existing RegistryObserver
into ordinary parsed runtime ingress for `rip`/`bup`, sharing the correct public
KEL and native registry store. Keep its validation separate from legacy Tevery.
Give missing inception/anchor/order dependencies explicit progression on relevant
input and after reopen, discovering foreign registry work from durable escrows
without requiring local aliases. Preserve source-seal hints and verify them
against accepted, witnessed KEL evidence. Preserve injected/owned/readonly store
lifetimes. Provide native registry replay/export through existing input/output
paths. Remove the need for a custom `/_registry` HTTP branch or direct
accepted-row writes in feature tests.

**PR 26: explicit composition and persisted disclosure state.** At command
composition, select legacy or native-v2 owners explicitly. Proposed input is
`--protocol v1|v2` for registry/credential authoring and any ambiguous store
selection; do not infer body version from package version or `--gvrsn`.
Keep `vdr.rgy` and `acdc.rgy` concrete. No generic registry adapter or service bag.

Retain the exact credential, event and authorized disclosure opening needed
after restart; the blinded event alone cannot recreate an opening.
Reuse evidence stores where their contracts fit; keep local disclosure custody
separate from public registry rows, using a narrow typed owner for missing
records. Do not expose openings in routine logs or broadcast undisclosed
credential content.

Distinguish prepared/staged, anchored and accepted state in command output.
Persist preparation before anchor coordination and recover deterministically
across separate KEL/registry environments; do not claim a cross-database atomic
transaction. Never generate a new nonce/event on a resumed operation.

**PR 27: single-identifier native authoring.** Expose native registry inception,
credential construction/issuance, revocation/state changes, list and status using
existing `regcept`, credential builders and `Registry.blind`. `vc create --protocol v2` constructs and issues; `vc revoke --protocol v2` commits the native
`revoked` state. Validate schema, issuer, registry and disclosure inputs before
local signatures or durable creation. Complete real KEL anchoring, witness
obligations and evidence publication.

Export/import genuine-v2 credentials, accepted registry chains, necessary KEL
evidence and authorized disclosure material through ordinary CLI/runtime intake.
A staged body or local alias is not an accepted chain. Preserve ordering and
original signed bytes. Use explicit export/replay to a fresh receiver; this does
not add subscriptions, automatic freshness guarantees or a synchronization service.

**PR 28: group authoring.** Reuse standard `/multisig/ixn` or `/multisig/rot`
approval for the exact `rip`/`bup` anchor seal. Distribute the corresponding
native event and authorized support separately; members validate its identity,
schema/state relationship and anchor before signing. Reuse group KEL authority,
threshold and witness completion; keep native registry acceptance with its
existing engine. Do not invent `/multisig/rip` or overload legacy VCP/ISS/REV.
Resumption selects the original proposal and retained opening after a member
has already consumed its notification.

**PR 29: native IPEX.** Select the native proof-building and verification owners
for all six CLI IPEX verbs. Openers select their protocol explicitly; responses
derive it from the accepted predecessor and reject a contradictory flag.
Grant/admit must use native accepted-chain
and disclosure evidence, not legacy `iss`/`anc` assumptions. Distinguish EXN
acceptance from credential wallet acceptance and prove both. Persist received
native credential/disclosure selection for later list/export/presentation;
accepting an EXN does not imply possession of an undisclosed full credential.
Keep recipient and group fanout behavior consistent with PR 16.

For native group IPEX, verify the existing v1 `/multisig/exn` coordination
envelope carrying a genuinely v2 child with its original nested evidence.
The inspected v2 nested-multisig contract permits only KEL/endpoint routes;
do not silently enable a v2 `/multisig/exn` wrapper. Body and attachment versions
remain independent and their admissible combinations require exact tests.

**PR 30: presentation and state changes.** Expose domain-named native operations
such as `vc registry blind --protocol v2 --said ... --state ...`,
`present --grant ...` and `vacate`, composing existing methods. Provide
presentation-registry creation and integrate presentation preparation into grant
orchestration. Complete holder/group presentation through its registry and anchor,
retaining the issuer's independent state-change semantics. Validate the referenced grant and
authorized holder before a CLI presentation commitment; library syntax checking
alone is insufficient. Presentations bind the grant and its receiver cutoff.
A vacuous update preserves the prior binding; it is not credential revocation.
Reuse supported disclosure/Mapper forms without adding new operators or porting
reference stubs. Cover supported command forms with focused owner tests.

### Verifier application ownership — PRs 30a–30b

Implement the accepted [Tufa verifier separation supplement](credentials/TUFA_VERIFIER_SEPARATION_PLAN.md)
after credential features, before the actual-peer matrix, final ProtocolProcessor
assessment, package organization and qualification. Recheck its inspected paths
and exports against the completed feature work; skip an empty export PR if those
operations are already public. The supplement's original planning-only status is
superseded by Kent's instruction to include it in this execution goal.

**PR 30a** exposes only existing reusable IPEX evidence operations, the grant route
constant and the necessary transitional CLI parser through appropriate public
entrypoints. Keep semantics unchanged and verify installed declarations and the
browser-safe root. Do not add APIs merely to preserve an obsolete facade.

**PR 30b** moves the Sally-style application, cue store and command atomically to
Tufa, splitting workflow sequencing, business policy and webhook delivery into
cohesive units as the supplement specifies. Remove original files and keri-ts
application exports in the same PR; no re-exports, compatibility shims, sibling
source imports or new dependency containers. Protocol Verifier, KEL/TEL/native-v2
validation, accepted evidence, escrows and reusable IPEX operations remain in
keri-ts. Tufa depends on public keri-ts APIs; never reverse that dependency or
retain ProtocolProcessor solely for this consumer.

Preserve current command and application behavior during relocation, including
its explicit legacy-Reger profile. This move does not add native-v2 application
verification, Sally parity, delivery guarantees, retries or durable outboxes.
Existing local webhook delivery markers are application records, not KERI
acknowledgements. Reproduced behavior defects justify a separately reviewed
follow-up, not silent semantic changes during the move. Apply the close contract:
the command owns its cue store and closes it before runtime/Habery; overall
success follows required cleanup.

Move the existing five agent cases and real issuer/holder/verifier CLI workflow
without reducing topology. Retain protocol tests in keri-ts. Include one saved,
protocol-valid credential refused by business policy without a webhook or change
to protocol validity, one unsuccessful HTTP delivery and a focused cleanup-failure
case. Update suite ownership, Tufa nested-test checking and maintained execution
tasks with the move; do not leave deleted test paths or duplicate runs. This local
CLI workflow is not a Python interoperability test. Run established peer cases
only if shared protocol behavior changes.

Installed coordinated tarballs must prove public imports/declarations, absence of
the application from keri-ts, the Tufa runtime API and real cue-store lifecycle,
and one `tufa verifier run --once` issuance to a loopback webhook. Preserve package
build guards against bundled sibling source and direct native LMDB dependencies.
Record removed APIs and replacement imports prominently in the 2.0.0 migration
guide/release notes. Broad final qualification follows this move and all remaining
implementation and organization work. Old keri-ts APIs and private formats impose
no compatibility requirement; preserve protocol interoperability and document
intentional breaks.

### Phase H: bounded actual-peer confidence — PR 31

Kent explicitly requested sufficient happy-path interoperability with limited,
justified sad paths. Build a small scenario set, reusing maintained helpers and
existing tests; do not multiply every feature by every transport, threshold,
runtime and Python version. Use HTTP for the new end-to-end cases; retain the
existing transport suite for TCP/lifetime coverage.

The additions have five scenario families, not a Cartesian product:

| Case                                        | Focused happy path                                                                                                                                                                                                                               | Independent interoperability evidence                                                                                                                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1: native CLI lifecycle                    | Independent Tufa group issuer/holder/verifier stores complete registry inception, issue, IPEX delivery/admit, presentation, vacate and issuer revocation. Use one ordinary and one establishment-only anchor, with a reopen before presentation. | Real Python witnesses/mailbox where those roles are implemented; Tufa public commands and ordinary ingress, without the custom registry endpoint or direct row seeding. This proves CLI composition, not Python recipient parity by itself.                          |
| N2: native evidence in both directions      | Python authors native registry/credential evidence for ordinary Tufa import/intake; Tufa CLI authors genuine-v2 evidence for Python's implemented registry/disclosure vetting APIs.                                                              | Unmodified pinned main, live Python construction/verification and independently owned state; assert body identity, authentic anchors, disclosed state and accepted state where the API actually accepts events. No historical fixture-only pass.                     |
| N3: native IPEX in both directions          | One representative grant/admit conversation in each direction using real Python v2 APIs, including a disclosed subset and presentation proof. Reuse N1's group CLI orchestration and existing verb tests.                                        | Python-produced proofs are verified by Tufa; Tufa-produced nested proofs and grants are verified by Python. Assert recipient/credential state as well as transport/EXN completion, labeling any narrower Python proof-verification result accurately.                |
| B1: group-backed lifecycle to Python        | Tufa group issuer uses separate real backer processes with a nonempty roster and meaningful threshold: VCP -> BIS -> VRT -> BRV. Rotate the roster between issuance and revocation, then replay to a fresh Python observer.                      | Run the same compact verifier case against main, 1.2.x and 1.3.x; each parses original TEL plus real backer/source proofs and reaches issued then revoked state. Assert the historic management tuple as well as the final status.                                   |
| B2: Python-produced backed evidence to Tufa | Python's real constructors/signers produce a short VCP/BIS/VRT/BRV chain; ordinary Tufa CLI/runtime ingestion reaches matching accepted/revoked state.                                                                                           | Reuse the three pinned profiles and their genuine crypto/parser APIs, with no TS-built fixture substituted for Python output. A minimal API driver is allowed; it must not patch reference code, preaccept rows, or claim to be an autonomous KERIpy backer service. |

Use only a few targeted failure checks for this expansion:

- One altered child/anchor proof must not become an accepted native credential.
  Reuse an existing real-verifier regression if it already exercises the new path.
- Withhold one required backer contribution, observe honest pending state, reopen
  and deliver it; the same event must complete. This also checks the concrete
  partial-proof recovery bug without a separate broad failure matrix.
- Keep the accepted-management-coordinate regression local to Tevery; raw or
  escrowed management evidence must not authorize a historical backer cohort.

Existing threshold, duplicate-index, wrong-signer, cancellation and ordering
tests remain relevant; do not reproduce all of them as new multi-process interop
scenarios. Add another negative only for a newly demonstrated defect.

Native-v2 evidence uses main. The old peer profiles are tested on their legacy
lane, without attempting to downgrade native credentials. At the inspected main
pin, Python's production parser still rejects nonempty ACDC ilks and its native
KLI path is incomplete. Use actual supported APIs for N2/N3 and report exactly
which operations are proof verification versus full receiver acceptance.
Recheck that limitation at the execution pin. Do not patch Python or seed its
accepted registry rows to make a nonexistent foreign-intake path appear complete.
TS public intake and CLI composition must pass regardless of that upstream gap.
This is a documented interoperability boundary, not permission to skip an
implemented Python capability or count an unexecuted assertion as passed.

PR 31 closes the actual-peer matrix, using public CLI/protocol intake and
independent stores rather than seeding accepted rows:

| Scenario               | Required evidence                                                                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native peer identities | Unmodified main, GLEIF 1.2.17 and selected 1.3.x execute with verified imports; the mailbox fork remains separate.                                                                                                                                        |
| TEL both directions    | TS-generated v1 evidence accepted by each peer; peer-generated issuance/revocation accepted and replayable by TS.                                                                                                                                         |
| Late observer          | Fresh state obtains issuer KEL, registry and credential TEL, reaches issued then revoked, reopens and remains revoked.                                                                                                                                    |
| Wire combinations      | All three peer families accept supported v1 body/v1 genus. Main/TS exercise supported v1 body/v2 genus and genuine v2; 1.2/1.3 unsupported-v2 rejection is a negative test, not an expected acceptance cell. Unsupported downgrade is explicitly refused. |
| Transport              | Actual HTTP and supported TCP paths; old witness-mailbox polling, not only standalone fork-mailbox APIs.                                                                                                                                                  |
| Multisig roles         | TS proposer/Python approver and Python proposer/TS approver where actual reference commands exist; independent member stores.                                                                                                                             |
| Complete lifecycle     | Registry -> issue -> apply/offer/agree/grant/admit -> revoke -> holder/observer revoked state; separate spurn path.                                                                                                                                       |
| Threshold/topology     | Existing single/group directions, witnessed/delegated setups and a weighted threshold with a non-required absent member.                                                                                                                                  |
| Negative/recovery      | Tampered or missing child proof, wrong issuer/anchor, duplicate indices, partial signatures, hostile ordering, restart and stale replay.                                                                                                                  |
| Operator/store         | Config no-write failures, cleanup Python reopen, encrypted-store compatibility and initialization intent.                                                                                                                                                 |

Python-main apply/offer/agree CLI files and some group-join recipient handlers
are stubs at inspected references. Test real Python protocol ingestion for
those lanes and actual KLI commands where implemented. Label CLI, protocol and
fixture evidence separately. Do not patch the reference silently, claim full KLI
command parity from TS-only tests, or make a TS feature imitate an upstream stub.
Any required lane blocked by a genuine reference defect must be reported with
its exact source and reproducer; do not count it as passing.
The broad negative/recovery row above is an existing regression boundary, not a
request to multiply the five added interop families. Preserve its current useful
coverage and add only the limited cases justified here.

### Reconciliation dispositions beyond the selected work

The old Gate F/G messaging, mailbox and challenge gaps are stale; those commands
and interop tests now exist. Generic `fetchTsgs`, DB provider extraction, broad
Komer/Suber rewrites and passcode-derivation replacement have no newly established
need. Preserve affected existing regressions and qualify touched rows/escrows.
Do not create work from a symbol-name mismatch or historical unchecked box.

The init correction and AEID atomicity gate above are the additional significant
findings selected from that review. AEID atomicity is a first-principles custody
requirement even where Python has the same sequential-write pattern; it is not
misrepresented as a missing Python port.

## PR review, validation and documentation discipline

Each PR description states the concrete before/after behavior, ownership,
reading order, relevant Python source/version, deliberate divergence, executed
checks and unqualified limits. Include tests/docs in review size. Use the
repository's human-oriented commit workflow when execution is authorized.
Attach each created PR to the execution chat and finish it before its successor.

Run the smallest tests capable of falsifying each change, then the affected
maintained owners. Keep formatting/lint/type/quality/manifest/changeset checks
appropriate to the touched paths. Use [PR test scope](../reference/PR_TEST_SCOPE.md):
exact-head local credit only for tests actually run; select relevant interop and
package checks. Every PR needs a release-impacting or empty changeset.

Existing owner tests cover most protocol/lifetime boundaries. Extend them where
possible. New fault, actual-peer or subprocess tests are justified by the specific
gaps above. Preserve participant topology and independent cryptographic/storage
oracles. Do not replace interoperability with mocks, reduce witnesses/members to
obtain a pass, or add tests that merely assert a new helper's internal shape.

Use disposable test state. Native-heavy qualification on this Mac should use
the established Linux/named-volume setup without macOS LMDB bind mounts. Before
Python pytest/CLI execution, follow the workspace's KERIpy test skill. Resource
exhaustion or a crashed runner is not a failed assertion or passing evidence;
repair the environment without changing protocol limits to hide it.

Keep documentation minimal:

- Update the owning contract/help only when behavior changes.
- Correct the directly conflicting threshold policy once.
- Update compatibility entries only when the corresponding capability is proven.
- Keep detailed commands and review discussion in PRs/CI artifacts.
- Maintain no per-PR plan diary, coverage ledger or duplicated ENCTX tracker.
- Produce one concise final release report with source/artifact/reference identity,
  results, failures/skips and supported-profile limits.

After every final file/Git-state mutation under the workspace, run the prescribed
ENCTX maintenance and require healthy/no-stale-source results. Do not silently
change source selection or indexing policy.

## Final ownership assessment and package organization — PRs 31a–31d

After feature implementation and its actual-peer interop evidence, reassess
ProtocolProcessor before reorganizing the source. If it has become a dependency
bundle or forwarding facade, remove it and pass actual semantic dependencies into
its callers. Retain it only for a demonstrated cohesive responsibility. If it was
already removed during PR 03d, credit that result and skip an empty PR 31a.

Then reorganize code within **cesr-ts, keri-ts and @keri-ts/tufa** for readability
and maintenance, with separate human-review PRs by package. Inspect the resulting
dependency graph before choosing the final layout. Group change-together owners
under meaningful internal subdirectories and split large files only at real
responsibility boundaries. Give particular attention to crowded app/CLI modules;
use KERIpy organization where it improves navigation, with the accepted ownership
and flow constraints deciding divergences. Do not impose file-count quotas,
arbitrary file-size limits or one directory per class.

The intended categories follow actual concerns: CESR framing/codecs/primitives;
KERI semantic domains, identity/group/credential workflows and concrete transport
owners; Tufa command families, HTTP protocol endpoints and hosting. These are
starting hypotheses, not a fixed taxonomy that overrides the completed design.
Internal subpackages do not require new published packages or a new framework.
Keep narrow deliberate public entrypoints; avoid wildcard barrels and old-path
compatibility shims. Keep behavior changes separate from moves/splits.

Update imports, focused tests, suite ownership, DNT/package export discovery and
build scripts together. Give each PR a short old-to-new category map and reading
order so reviewers can distinguish moves from substantive splits. Verify source
checks and affected integration/package paths after each cut, including strict
NodeNext declarations and packed entrypoints for the resulting graph. Re-run the
affected actual-peer paths when moving their composed owners. PR 32's complete
final qualification must run after every ownership and organization change;
pre-reorganization feature evidence alone cannot authorize publication.

## Final qualification, 1.0.0 withdrawal and 2.0.0 publication — PR 32 and release

1. **Prepare exactly 2.0.0 and consume the accumulated changesets.** Audit all
   pending release intents and reconcile their bump levels to the coordinated
   2.0.0 major target, including CESR, while retaining their substantive change
   and breaking-change descriptions. Supersede any interim 1.1.0 preparation;
   do not downgrade major changes to minor bumps or reuse 1.0.0.
   Use `release:version` to generate/update all three local package changelogs
   and remove the consumed changeset files; do not delete pending notes without
   carrying their information into the changelogs. Retain accurate prior release
   history and identify 1.0.0 as withdrawn where appropriate. Use
   `manifest:sync/check` and `version:check`; inspect Deno mirrors, npm lock
   entries, generated modules and internal dependencies. The version-preparation
   PR must show the three 2.0.0 versions, resulting changelogs and consumed-note
   deletions. It is not publication; no release tag is pushed here.

   **Breaking-change documentation is a release gate.** Create
   `docs/reference/compatibility/MIGRATING_TO_2_0.md` from the actual final diff
   against the published 1.0.0 package artifacts and their public entrypoints,
   supported exports and CLI contracts, rather than treating changesets as a
   complete inventory. Organize the document by CESR, KERI and Tufa. Cover
   removed or changed public APIs/types/imports, including archive/staging and
   durable-plaintext APIs removed by the ESSR redirect, component ownership and calling
   patterns, CLI options/output/configuration validation, runtime/dependency
   requirements and any storage/encryption implications that actually change.
   For each break, state the old behavior, the replacement or lack of one, and
   the caller/operator action, with small before/after examples where useful.
   Document package reorganization only where it changes supported imports;
   distinguish public breaks from internal moves. State explicitly that old
   keri-ts API/database compatibility is not promised, while preserving the
   supported KERI/ACDC/CESR protocol and independently tested KERIpy peer lanes.
   Do not invent breaks for a package solely to justify its coordinated version.

   Put a **Breaking changes** section near the top of each package's 2.0.0
   changelog entry and GitHub release notes, before the general change list.
   Include the package's concrete breaks and a link to the dedicated document;
   if a package has no public break, say so and explain its coordinated major
   version. Ensure published notes use a working, version-pinned public link.
   Review the lists, migration document and generated changelogs against the
   final APIs, CLI behavior and qualified runtime/protocol profiles before
   publication, and read back the actual GitHub notes after release. These are
   final user-facing release artifacts, not an implementation diary; retain
   the minimal-documentation policy during the preceding feature PRs.
2. **Qualify the final candidate.** After implementation, final ownership assessment,
   source reorganization and version inputs are
   settled, run the complete maintained KERI/CESR/Tufa and actual-peer matrix,
   including required manual delegation and witness endurance owners. The prior
   baseline excluded manual endurance; do not carry that exclusion silently.
   Use ordinary PR CI and authorized local/manual execution; maintainer-only
   hosted dispatch follows its explicit authorization rule.
3. **Qualify exact packed artifacts.** Test the declared Node minimum (currently
   20.3), selected current Node, applicable established runtime/platform profiles,
   and source Deno. Prove strict NodeNext declarations without `skipLibCheck`,
   crypto/tamper refusal, CLI/HTTP, real TCP and >16 MiB LMDB read/reopen/owned
   bytes. Install compiler tools after runtime smoke. Test all three tarballs
   together with their actual declared dependency graph. Record qualified
   tarball digests. The published artifact must match that qualified artifact;
   if the release workflow rebuilds, prove deterministic equality or run the
   required installed-artifact qualification on the workflow-built tarball
   before publication.
4. **Repair before release.** A regression receives a focused fix and relevant
   retesting. Record the exact final clean source, matrix and artifacts. If a
   merge changes qualified source, requalify affected evidence; do not call
   pre-change results final. Run the broad battery again when the repair changes
   shared protocol/runtime behavior or leaves cross-feature uncertainty.
5. **Merge reviewed version preparation and inventory the old distributions.**
   Verify clean, synchronized master and the qualified release commit. Recheck
   live versions, dist-tags, dependencies, maintainers, applicable download counts,
   remote tag targets, GitHub releases and assets. Inventory other actual package
   distribution surfaces, such as JSR or versioned container artifacts, from
   workflows and live records; do not infer that a dependency on JSR means these
   packages were published there. Record 1.0.0 source/tag/artifact identities in
   the concise final report before withdrawal. Never retarget or reuse a published
   version/tag; the specific deletions below are the authorized withdrawal.
6. **Withdraw the 1.0.0 distributions at the release boundary.** Kent authorizes
   these final-stage withdrawals. Preserve per-platform partial outcomes for
   targeted recovery rather than broad deletion retries.

   - npm: remove only each package's exact 1.0.0 version if current npm policy
     permits. Evaluate dependent packages in Tufa -> KERI -> CESR order. Low
     downloads alone do not establish eligibility. If removal is prohibited,
     deprecate that exact version with a clear withdrawal/upgrade notice instead;
     do not unpublish entire package histories, rename packages, or attempt to
     republish 1.0.0. Recheck the final outcome per package. npm deprecation
     warns users but does not make the old bytes unavailable; report that limit.
   - GitHub: remove the three verified 1.0.0 releases and their attached artifacts,
     and delete only their corresponding `tufa-v1.0.0`, `keri-v1.0.0` and
     `cesr-v1.0.0` version tags after recording their targets. Do not rewrite
     source history or recreate those version labels with different bytes.
   - Other confirmed surfaces: withdraw the exact 1.0.0 artifacts using each
     platform's supported mechanism. On JSR, yank any actual matching versions;
     deletion does not free a version number there either
     ([JSR version policy](https://jsr.io/docs/packages#versions)). Record absent
     surfaces as not published and any platform-enforced retention explicitly.
7. **Publish CESR first.** Create the annotated `cesr-v2.0.0` tag at the verified
   release commit and push that tag explicitly. Wait for the package workflow,
   then verify `cesr-ts@2.0.0` and its exact registry artifact.
8. **Publish KERI second.** Verify its CESR dependency resolves to the intended
   published version, then explicitly push `keri-v2.0.0` at the same verified
   release commit. Verify `keri-ts@2.0.0`.
9. **Publish Tufa third.** Verify both dependency versions are available, then
   explicitly push `tufa-v2.0.0`. Verify `@keri-ts/tufa@2.0.0`. Use the existing
   package tag workflows and shared npm release workflow.
10. **Verify publication, not just workflow success.** Check npm metadata,
    internal dependencies and qualified/workflow/npm/GitHub tarball equality for
    every package. Perform clean registry-only installs and installed Tufa/native/runtime/
    declaration checks. Source tarball smoke does not prove published dependency
    resolution. Verify all three GitHub releases and assets separately. Ensure
    current/latest aliases select 2.0.0, and read back the withdrawal/deprecation
    state of every 1.0.0 distribution; do not call a deprecation a deletion.
11. **Finish with evidence.** Report the three published versions and links,
    source/tag/artifact identity, actual peer pins and qualification results,
    plus the exact 1.0.0 withdrawal outcome and any registry retention limits.
    Preserve any failed release side effect for targeted recovery; do not
    republish another artifact under an existing version. Confirm final clean
    repository and healthy ENCTX state.

If time expires, report the exact completed PR, remaining gate and any active
work. Do not reduce scope, relabel a skip, publish a partially qualified release
or claim the complete multisig lifecycle from transport success alone.
