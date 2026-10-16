# KERIpy parity, removal and release roadmap

Current direction (2026-10-15): concrete KERIpy-shaped runtime composition and
complete-enclosure buffered parsing, alongside application-accounting and unsupported
delivery-durability removal. Buffered decoding, concrete cue/output owners,
protocol-only Reactor serialization, shared host workers and the public API
reduction are implemented. Final composed and installed-package qualification
remains open; source architecture does not certify release readiness. Older
resource guarantees are superseded. [ADR-0013](../adr/adr-0013-simple-component-flows.md) is normative.
KERIpy reference: `7143832813cac6a394ab1faf9be83bb3372be87c`.

Structural parsing and substantial protocol foundations exist. Full composed
interop and release qualification remain incomplete. Parent-owned nested children
are never independently accepted GenericGroup siblings. Ordinary queues carry
records; actual files, sockets, iterators and payloads retain explicit cleanup.
Existing accepted-state APIs need no eviction redesign for this removal.
Shared ResourcePolicy, its errors and constructor plumbing are removed, along with
remaining client, Reactor queue/waiter, listener and reply-proof quotas. Buffered
decoder integration, accounting deletion and concrete cue/runtime ownership are
implemented. This roadmap owns residual review and qualification, not a second
migration back to retired APIs.

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
- Finite CLI convergence now uses the host workers with elapsed deadlines and
  joined shutdown. Serial whole-runtime, finite mailbox and approval pumping are
  removed; phase-specific tests use actual component operations. Local endpoint/startup callers now
  use direct protocol intake; hollow per-Hab seeding, the mailbox host forwarding
  wrapper and unused host context/no-HTTP branch are removed. Protocol-only
  fixtures use exact direct intake, retaining their actual assertions and topology.
  Audit remaining
  forwarding-only facades for actual responsibilities. Both Registrar wrappers are
  removed after verifying they had no production callers. AgentMode/runtimeMode are removed;
  hosts choose provider mailbox construction explicitly.
- Witness receipt, delegation and raw transport entrypoints now borrow actual
  Reactor/services instead of a parent runtime. Standalone receipting constructs
  only a protocol processor over the existing Habery, with no extra stores/workers.
- HTTP receipt false-success/fanout is corrected: both transports require the
  requested event's accepted witness signature; GET validates accepted proof and
  fanout uses only verified complementary indexed signatures. Real-HTTP regressions
  cover foreign/forged/wrong-event proof, valid retrieval, three-witness fanout
  and historical receipt selection/completion after a nonempty witness replacement.
  Baser owns historical cohort and threshold lookup through the accepted event's
  prior-digest ancestry, including empty cohorts and superseded interactions.
  Later witness rotations/recoveries cannot change an old receipt requirement.
  Receipt classification and POST authorization cannot use
  later witnesses; missing dependencies remain escrowed. Periodic broad and final
  composed qualification remain required.
- Detached HTTP framing now preserves the selected frame genus instead of guessing
  it from body pvrsn. The redundant outer-genus hook is removed. A production-API
  single-controller reverse disclosure probe accepts the negotiated partial and
  refuses over-disclosure with KRAM enabled, without header rewriting or seeded
  issuer state. Convert this scoped evidence into maintained composed coverage;
  witnesses/mailboxes, multisig, restart and final qualification remain open.
  Poster now constructs v2 nested forwarding envelopes through the shared codec;
  qualified messages cannot be treated as body-first legacy embeds. Concrete
  target preparation is an owned operation, with source retention on failure.
  The [disclosure acceptance matrix](qualification/GRADUATED_DISCLOSURE_INTEROP.md)
  requires both implementation directions, full IPEX conversations through admit,
  dedicated spurns, credential chains/edge operators and multiple blinded/revealed
  attributes in focused maintained cases.
- Runtime exports now name supported operations/data explicitly; npm implementation
  deep-import patterns are removed. Keep actual Tufa composition and supported
  library operations; a new internal export must not silently expand package API.
  Finish residual facade/options and documentation review, then qualification.
- One finite decoder is shared by complete input and a small network input loop.
  It waits for complete counted enclosures before entering them. Progressive
  traversal, parser cursors, sink/EssrWriter staging and ordinary frame disposal
  are removed.
- FrameIntake/TcpRead and custom parser/channel bridges are removed. Host scopes
  own real I/O cancellation/join. No ParseOptions/CursorOptions or socket mechanics
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

1. Keep delivered removals absent: application accounting, outboxes, unsupported
   mailbox/KRAM acknowledgements, progressive parser machinery and generic runtime
   execution/delivery layers. Preserve wire/crypto checks, protocol state, actual
   cleanup and the concrete owners above. No compatibility implementation or
   replacement framework is required.
2. Finish residual facade/options review against real callers. Keep contracts,
   learnings and plans aligned with the resulting source, without duplicating
   completed migration work as new tasks.
3. Establish live graduated-disclosure and KRAM interop in both directions,
   single-signature and multisig with witnesses and mailboxes. Existing frozen
   fixtures and legacy ACDC tests do not close this gate. Maintained signed
   unregistered IPEX now crosses a Python mailbox between actual TS/Python
   credential processors in both directions, including independently signing TS
   groups and three witnesses. TS presentation grants/replay also cross the Python
   mailbox with witnessed single/group holders, delayed observer evidence and
   immutable receipt cutoffs. Python public presentation-registry intake and
   witnessed process-crash combinations remain distinct qualification limits.
   `xip/pro/bar` reference
   processing stubs remain labeled; do not invent upstream support.
4. Run the full maintained integration/e2e/interop inventory, representative real-path/
   lifecycle checks and exact installed-package checks. Preserve participant topology.
5. Refresh the held version PR only after those gates pass; publish CESR, KERI and
   Tufa in dependency order and verify actual registry artifacts under the
   [final release gate](#final-release-gate), including its version floor. No release yet.

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
Kent selected **1.0.0 for CESR, KERI and Tufa** on 2026-10-16, superseding the
earlier minor-version candidate. Keep manifests, generated versions, internal
dependencies and release tags aligned. The documented breaking removals define
this baseline; the version decision does not waive any qualification gate.
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
