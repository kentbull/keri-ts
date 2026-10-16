# KERIpy parity, removal and release roadmap

Current direction (2026-10-15): concrete KERIpy-shaped runtime composition and
complete-enclosure buffered parsing, alongside application-accounting and unsupported
delivery-durability removal. These accepted targets remain to be implemented and
qualified; recording them does not certify current source. The
previous source checkpoint and resource guarantees are superseded, not proof of
current completion. [ADR-0013](../adr/adr-0013-simple-component-flows.md) is normative.
KERIpy reference: `7143832813cac6a394ab1faf9be83bb3372be87c`.

Structural parsing and substantial protocol foundations exist. Full composed
interop and release qualification remain incomplete. Parent-owned nested children
are never independently accepted GenericGroup siblings. Ordinary queues carry
records; actual files, sockets, iterators and payloads retain explicit cleanup.
Existing accepted-state APIs need no eviction redesign for this removal.
Shared ResourcePolicy, its errors and constructor plumbing are removed, along with
remaining client, Reactor queue/waiter, listener and reply-proof quotas. Buffered
decoder integration and accounting deletion are implemented; concrete cue/runtime
ownership and full qualification remain open.

## Accepted architecture; supersedes older preservation instructions

- Plain cues and Decks; delete CueSink optional lifecycle, prepareCueEmission,
  QueryReply admission callbacks and generic delivery wrappers. CueDelivery and
  DirectReplyDelivery are removed; Respondant owns actual reply state and output.
  RuntimeDeliveries is also deleted into QueryCoordinator, which owns its packets
  and response I/O. CueSink, its optional hooks and root adapters are deleted;
  composition routes records directly, and default queries reach actual transport.
- Reactor has only justified protocol/connection responsibilities. Its
  general execution gate is removed: dispatch returns data and captures replies
  before protocol cue publication. Private serialization covers dispatch/escrows
  only. No replacement universal executor, mutex or callback bus.
- Choose concrete dependencies at construction. Remove vague service bags and
  repeated class narrowing. Legacy/v2 Regery owners and direct processor injection
  replace the placeholder VDR/ACDC bags. Application entrypoints retain one check
  for genuine readonly registry absence. No speculative DI layer.
- CLI and hosts drive the same workers. Delete duplicate whole-runtime pumping,
  forwarding-only facades without real consumers. AgentMode/runtimeMode are removed;
  hosts choose provider mailbox construction explicitly.
- Narrow public runtime exports to supported operations/data. Remove optional
  hooks and wrappers; condense contracts, learnings and plans to current decisions.
- One finite decoder shared by complete input and a small network input loop.
  Wait for complete counted enclosures before entering them. Remove progressive
  traversal, parser cursor, sink/EssrWriter staging and ordinary frame disposal.
- Delete FrameIntake/TcpRead and custom parser/channel bridges. Host scopes own
  real I/O cancellation/join. No ParseOptions/CursorOptions or socket mechanics
  in higher layers. Keep framing, qualified evidence and real storage consumers.

Memory and latency proportional to the enclosing group are accepted. No early
GenericGroup delivery, constant-memory huge-group gate or dual-engine option.
ADR-0012 now records this buffered decision. Older progressive directions are
superseded; this does not
reinstate ADR-0001 wholesale. Only a new explicit decision supported by a real
workload can reverse this choice. Historical benchmarks are not authorization.

## Acceptance matrix

Each linked owner contains the evidence gate and unresolved limitations. Phase
numbers refer to the seven follow-on phases, not the earlier migration steps.

| Area          | Implementation                                                            | Qualification / limit        |
| ------------- | ------------------------------------------------------------------------- | ---------------------------- |
| Parser/Mapper | [Engine][cesr], [claims/IDs][mapper]                                      | Wire correctness             |
| Protocol      | [Protocol owners][protocol-owners]                                        | Protocol semantics           |
| Runtime       | [ESSR][essr], [retired accounting plan][resource], [transport][transport] | Installed artifacts          |
| Storage       | [Adopted reads/recovery][storage]                                         | Actual store/cursor lifetime |
| Qualification | [Reference pins][pins], [full battery][qualification]                     | Source closed; packed gate   |
| Release       | [Three packages][release]                                                 | Registry artifacts           |

The [closeout report](../reports/parity/RUNTIME_PARITY_2026-10-14.md) is historical
source evidence. Requalify the final implementation; it does not authorize
preserving removed accounting or delivery guarantees.

## Publication sequence

1. Remove application accounting and unsupported delivery durability under
   [ADR-0013](../adr/adr-0013-simple-component-flows.md). Parser/codecs/domain,
   ordinary Decks, storage/replay, runtime and CLI must not expose budgets,
   estimates, reservations, credits or capacity-refusal protocols. Only a minimal
   private socket control justified by production evidence may remain.
2. Delete outbox storage/workers/wiring/CLI/tests completely; remove durable mailbox
   consumer acknowledgements/deadletters and KRAM ready/snapshot acknowledgement
   machinery. Keep KERIpy-supported escrows, caches, mailbox storage/cursors,
   accepted evidence, transactions and real cleanup. No old-version keri-ts API or
   data compatibility, migration/recovery readers, or new-to-old tests.
3. Complete the accepted runtime and buffered-parser removals above, including
   their transport callers, public API and documentation. Refactor real ownership
   first; retain framing, cryptographic checks and transaction ordering. No
   replacement framework, generic gate, no-op policy or compatibility layer.
4. Establish live graduated-disclosure and KRAM interop in both directions,
   single-signature and multisig with witnesses and mailboxes. Existing frozen
   fixtures and legacy ACDC tests do not close this gate. `xip/pro/bar` reference
   processing stubs remain labeled; do not invent upstream support.
5. Run the full maintained integration/e2e/interop inventory, representative real-path/lifecycle
   checks and exact installed-package checks. Preserve participant topology.
6. Refresh the held version PR only after those gates pass; publish CESR, KERI and
   Tufa in dependency order and verify actual registry artifacts. No release yet.

Historical resource PRs are removal inputs, not a stack to finish or preserve.
The runtime, storage, parser, KRAM and ESSR subject plans own meaningful remaining
correctness gates. The old phase-4 accounting work is retired.

The multisig responsibility extraction (#161), ESSR outcome extraction (#163),
and proof cleanup (#165) are delivered. Do not recreate them. During the
deletion/refactoring phase, **1,000–3,000 changed lines per PR** are permitted
when they complete one cohesive architectural cut. Count tests, fixtures, scripts
and docs. Prefer a complete mechanism removal over artificial slices with
temporary interfaces or repeated caller edits; split unrelated responsibilities. Do not game the count by minifying,
compressing artifacts or omitting verification. Finish and merge the current cohesive PR before opening the next; keep WIP small.
Require green scoped CI on the exact final head. Preserve published history unless rewriting is
explicitly authorized.
Preserve benchmark evidence and protocol participant topology; merged clean
worktrees may be retired. Delete implementation-mirroring accounting tests.
Use explicit changesets and register every maintained test in the inventory.

Reuse existing tests/workflows before adding coverage. Commit new integration or
end-to-end tests only with strong justification, especially a missing happy path;
exploratory probes may remain uncommitted with recorded evidence. Apply the same
maintenance-value test to unit tests: choose the smallest meaningful regression,
not implementation-mirroring assertions or new infrastructure by default.
Preserve distinct protocol assertions and topology; delete redundant permutations.
Fixed-volume scale runs and early-enclosure delivery are no longer release gates.
Use representative real traffic; retain meaningful protocol and cleanup evidence.

Final reporting must classify **supported**, **unfinished**, **intentional
divergence**, **reference stub**, and **unqualified** behavior separately.
Passing parser tests alone cannot close final composed qualification.
[Upstream gaps][upstream-gaps] do not block completion indefinitely: implement and
qualify the approved TypeScript path, record the reference limitation and any
intentional difference, then complete against our own acceptance/release gates.
Discussion proposals and unimplemented stubs are not processing requirements.
Long qualification stays outside required merge CI; only the maintainer dispatches
hosted extended jobs, whose existing 15-minute cap remains unchanged.

## Final release gate

The approved final task is publication of `cesr-ts`, `keri-ts` and `@keri-ts/tufa`
for downstream diddaemon adoption. Complete the removal acceptance, reference-backed
transport/lifecycle and storage/escrow checks, and live graduated-disclosure/KRAM
single/multisig witness/mailbox interop before publishing. Default store acquisition
and joined shutdown remain correct; borrowed stores remain caller-owned.
No accounting completion or old-version compatibility gate remains. Prove actual
HTTP/TCP progress through verified acceptance; local write completion is insufficient.
Recheck the current held version PR's generated versions, dependency ranges,
changelogs and exact-head checks after all implementation changes land.
The current Changesets workflow only maintains versions; npm publication uses
the existing package tag/dispatch workflows. Release in dependency order and
verify registry versions, dependency metadata, tarball identity and installed
package smoke behavior. If Actions cannot publish, use the authorized local
publishing path while preserving the checked artifact and version identity.
Report exact published versions and release evidence for the downstream chat;
do not close the goal on a merged version PR or a successful build alone.

[release]: https://github.com/kentbull/keri-ts/pull/347
[delivered]: ../reports/parity/DELIVERED_THROUGH_168.md
[cesr]: cesr/CESR_PROGRESSIVE_PARSER_PLAN.md
[multisig]: exchange/MULTISIG_PLAN.md
[ipex]: exchange/IPEX_PLAN.md
[exchange]: exchange/EXCHANGE_ADMISSION_PLAN.md
[essr]: essr/ESSR_PLAN.md
[resource]: runtime/RESOURCE_POLICY_PLAN.md
[storage]: db/STORAGE_RECOVERY_PLAN.md
[transport]: runtime/TRANSPORT_PLAN.md
[qualification]: qualification/QUALIFICATION_PLAN.md
[pins]: qualification/REFERENCE_ENVIRONMENTS.md
[mapper]: cesr/MAPPER_PLAN.md
[upstream-gaps]: ../reference/credentials/UPSTREAM_REGISTRY_GAPS.md
[protocol-owners]: ../reports/parity/RUNTIME_PARITY_2026-10-14.md#classification
