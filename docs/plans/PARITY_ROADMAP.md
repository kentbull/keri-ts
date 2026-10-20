# KERIpy parity and maintenance roadmap

The cleanup/release baseline is **cesr-ts 1.0.0, keri-ts 1.0.0 and @keri-ts/tufa
1.0.0**, published and physically verified. The [release qualification report][release]
owns source/test/artifact identity, supported scenarios, retained failures and
reference limits. The cleanup is complete; the subject plans below retain future
regression obligations and explicit deferred profiles, not another migration queue.
Historical October 14 reports remain evidence at their own revisions.

The [v1/v2 compatibility inventory](../reference/compatibility/KERI_V1_V2_COMPATIBILITY.md)
owns the maintained matrix of HTTP, CESR and application compatibility boundaries.
The [KERIpy compatibility backlog](compatibility/KERIPY_COMPATIBILITY_PORTS.md)
records proposed backward/forward ports and target-branch assessment gates; it
does not activate a new implementation sequence or claim unassessed upstream gaps.

Post-release #523 (`e42b28cf`) moves TSN admission, routes and retries under
Tevery with independent record validators and a shared composed Revery. Published
1.0.0 packages do not contain this refactor. Its scoped evidence is separate from
the release battery; see the release report's post-release section.

The [runtime contract](../design-docs/runtime/INGRESS_AND_EGRESS.md) owns current
message production, delivery, completion and lifecycle behavior. The
[reliability roadmap](runtime/cue-reliability-roadmap.md) records deferred
capabilities and the evidence required before extending that behavior.

## Retained architecture

The [runtime contract](../design-docs/runtime/INGRESS_AND_EGRESS.md)
defines explicit HTTP/clock/transport composition and removal of RuntimeServices
and hidden dependency defaults, plus the separate verifier clock correction.
The [post-merge qualification](../reports/runtime/EXPLICIT_RUNTIME_DEPENDENCIES_2026-10-19.md)
passed every maintained unit/interoperability owner and installed-package checks.

[ADR-0013](../adr/adr-0013-simple-component-flows.md) governs concrete
KERIpy-shaped owners, plain records and Deck/cue flows wired by composition.
Refactor responsibility/contracts first, then behavior. Add an abstraction only
for a demonstrated current responsibility and caller; matching a Python class
name does not justify a forwarding wrapper.

- ProtocolProcessor orders protocol processing/escrows and captures correlated replies and publishes
  after commit. It is not an application callback scheduler or universal executor.
- QueryCoordinator, Respondant, Poster, mailbox, registry and concrete input owners
  do their actual work through narrow dependencies. Respondant interprets and
  publishes reply work; Poster owns queued execution and cleanup. Lower transport knows sockets,
  not AgentRuntime; independent siblings communicate through concrete records.
- CLI and long-lived hosts share workers. Finite commands observe accepted state
  under elapsed deadlines and join workers before closing owned stores. Borrowed
  stores remain caller-owned; phase-specific tests invoke actual owners.
- Package exports name supported operations/data. Root/runtime/db and the distinct
  CLI/application helper boundaries replace implementation deep-import patterns.
- Preserve protocol escrows, KRAM authentication/replay/timeliness caches, mailbox
  messages/cursors, correct signed evidence, transactions and real cleanup.

Application accounting, policies/estimates/credits, synthetic reservations,
outboxes, unsupported consumer/business acknowledgements, generic delivery gates,
serial runtime pumps and forwarding-only facades remain removed. No pre-1.0
compatibility shims, migration readers or new-to-old tests are required. Only a
minimal private socket constraint supported by observed production evidence could
justify an exception; native backpressure is preferred.

[ADR-0012](../adr/adr-0012-progressive-nested-parser.md) requires complete counted
enclosures before synchronous decoding. Progressive traversal, cursors, parser
staging, FrameIntake/TcpRead and ordinary-frame disposal are removed. Concrete
consumers own cancellation and joined I/O. Memory/latency may grow with the complete
enclosure. No incomplete-enclosure child delivery, constant-memory giant-group
or all-group rollback promise; a complete enclosed message may progress before EOF.

## Maintained boundaries

| Area              | Owning standard                                                               | Retained responsibility                                                     |
| ----------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Parser/Mapper     | [Decoder][cesr], [claims/schema][mapper]                                      | Exact framing/commitments; explicit generated-default profile limits        |
| Protocol          | [IPEX][ipex], [registry][registry], [KRAM][kram]                              | Independent proofs, conversations, observer/cutoff state and real escrows   |
| Runtime/transport | [ESSR][essr], [transport][transport]                                          | Data flows, HTTP/TCP progress, cancellation and joined cleanup              |
| Storage           | [Payload/recovery][storage]                                                   | Actual buffer/cursor/file lifetime, publication and reopen/replay           |
| Qualification     | [References][pins], [battery][qualification], [disclosure matrix][disclosure] | Current imports, full inventory, maintained topology and installed packages |

The [upstream registry review][gaps] distinguishes reference gaps from approved TS
integrations. DI2I and NOT have separately qualified TS profiles; exclude them
from Python interop while unsupported there. Missing/malformed/unknown evidence
cannot satisfy negation. Do not seed accepted reference rows to manufacture parity.
Global TEL freshness, arbitrary nested-depth/topology cross-products and the broader
unfinished protocol backlog are not activated by this completed release.

## Unresolved source/contract discrepancy

At `e42b28cf`, `packages/cesr/src/primitives/tholder.ts` still exposes deployment
caps `maxWeights = 1_000` and `maxSithLength = 65_536`; its unit tests enforce them,
including qualified wire input. These are configurable local limits, not numeric
representation or wire maxima. Frozen KERIpy coring.py also carries Limit/MaxSith,
which explains provenance but does not settle the accepted no-quota constraint.
A separate ownership/contract review must resolve this retained boundary before
claiming every non-socket quota is absent. This documentation reconciliation does
not change runtime behavior or authorize a replacement policy mechanism.

## Deferred review questions

The former root `TODOs.md` mixed delivered v2, mailbox, delegation and CLI work
with unverified review ideas. Its duplicate tracker is retired. The existing
[DB parity plan](db/DB_PARITY_PLAN.md) owns higher-level consumer/record parity;
[CLI parity reference](../reference/cli/KLI_TUFA_COMMAND_PARITY_MATRIX.md) and
[qualification plan][qualification] own command and interop coverage.

Other unresolved review questions from that scratchpad are passcode
interoperability, cue mapping/filtering, and the scope of audits for
key management/encryption, reply routing/watchers, challenge/authentication and
well-known OOBIs. These are deferred questions, not confirmed defects or an
activated implementation queue. A proposal to hide DB access, replace reflective
dispatch, rename records or simplify generics needs a demonstrated current problem
under ADR-0013; the old scratchpad does not authorize new facades or cleanup.

## Deferred escrow logging review

The credential-import work leaves a separate logging follow-up. This is roadmap
work, outside its implementation and qualification goal; no logging upgrade has
been implemented. Keep the existing logger rather than adding a wrapper, logger
service dependency, diagnostic queue or retained history.

- Compare KEL, reply, TEL/TSN, credential, EXN and v2 registry diagnostics with the
  [recorded KERIpy references](../reference/compatibility/KERI_V1_V2_COMPATIBILITY.md#version-vocabulary-and-reference-limits).
  Distinguish repeated pending attempts, accepted cleanup and actual terminal
  ejections before selecting severity. Preserve original causes and identifying
  fields; logging must never determine protocol decisions or removal.
- Review the existing debug/info/warn/error threshold and Tufa's loglevel flag.
  Decide whether TRACE and CRITICAL have concrete production uses; retain useful
  level selection without building a logging framework or speculative hooks.
- Keep CLI diagnostics on stderr at every enabled level so structured stdout
  remains usable. The current logger's debug/info console methods can write to
  stdout and need correction at the existing logger owner.
- Qualify threshold filtering, stderr/stdout separation and repeated pending work.
  Pending retries, successful cleanup, family migration and EXN preserveEscrow
  must not create warning floods or false ejection claims. Actual ejections
  remain diagnosable after committed removal. Use focused owner/CLI tests.

## Future change and release discipline

Keep one implementation PR active, prefer reviewer-sized cohesive concerns and
finish it before starting its successor. Cohesive 1,000–3,000-line removals may
avoid temporary APIs or repeated caller edits. Include meaningful tests/docs in
review size and preserve published history unless rewriting is explicitly approved.

Reuse maintained tests and participant topology. Add a test or fixture only for
a demonstrated coverage gap or regression with ongoing value; no framework or
implementation-mirroring quota tests. Scope CI to the affected owners and credit
exact-head local units. Run the broad battery about every twenty implementation
cuts, and repair failures before continuing. Full source/manual, interop and
installed-artifact qualification remains a release gate; narrow green checks do
not establish broad parity. Only the maintainer dispatches hosted extended jobs.

Npm release uses existing package tag workflows, not the Changesets version PR.
Publish CESR → KERI → Tufa and verify registry versions, internal dependencies,
exact workflow/npm/GitHub artifact identity and clean installed native/runtime/type
behavior at the advertised Node minimum and current runtime. Do not infer
publication from a merged version PR or successful build. Keep documented
reference stubs, intentional differences and unqualified claims separate.

[release]: ../reports/parity/CLEANUP_RELEASE_2026-10-16.md
[cesr]: cesr/CESR_PROGRESSIVE_PARSER_PLAN.md
[mapper]: cesr/MAPPER_PLAN.md
[ipex]: exchange/IPEX_PLAN.md
[registry]: credentials/REGISTRY_PLAN.md
[kram]: exchange/KRAM_PLAN.md
[essr]: essr/ESSR_PLAN.md
[transport]: runtime/TRANSPORT_PLAN.md
[storage]: db/STORAGE_RECOVERY_PLAN.md
[pins]: qualification/REFERENCE_ENVIRONMENTS.md
[qualification]: qualification/QUALIFICATION_PLAN.md
[disclosure]: qualification/GRADUATED_DISCLOSURE_INTEROP.md
[gaps]: ../reference/credentials/UPSTREAM_REGISTRY_GAPS.md
