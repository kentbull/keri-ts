# Progressive Parser Execution Plan

## Status

Approved for implementation on 2026-10-12. This document records the work and
acceptance gates. The phase ledger links merged changes and pending review;
benchmark artifacts retain immutable revisions and individual observations.
[ADR-0012](../../adr/adr-0012-progressive-nested-parser.md) and the
[target contract](CESR_PROGRESSIVE_PARSER_CONTRACT.md) govern the result.

The workload is many smaller ESSR messages in large aggregate transfers. Memory
must depend on admitted active messages and bounded queues, not transfer size.
Support for arbitrary multi-gigabyte individual sealed messages is not assumed.

## Acceptance matrix for the remaining parser gaps

Current verified master: `192ecff938249e5a77fc092c9f09db67287dde32` after #165
(starting boundary was `876d24b4` after #159); frozen upstream authority `927c0cb8794d7c84fc17143c67df64aab9deda6c`.
The seven follow-on phases below are distinct from the original twelve migration
steps. Follow-on phase 1's identified tables/semantics and phase 2's parent-owned
parsing are delivered. Phase 3 has delivered serialization, annotation, and
forwarding/persistence and four nested multisig routes. Phases 4–7 remain incomplete despite their foundations.

The links below lead to the detailed gates and scope limits. PR numbers in this
matrix refer to the follow-on sequence, except where a GitHub PR is named.

| Requirement      | Boundary             | Owning PR  | Evidence gate                       | Open limit           |
| ---------------- | -------------------- | ---------- | ----------------------------------- | -------------------- |
| Multisig         | Merged #160–161      | 3d         | [Proofs/retry][nested-gates]        | Four routes          |
| IPEX             | Proofs merged #162   | 3e         | [Grant/admit][nested-gates]         | DAG/VDR pending      |
| Exchange proofs  | Merged #165          | 3e cleanup | [Policy/cues][proof-cleanup]        | IPEX still pending   |
| v2 admission     | Direct dispatch      | 3f         | [Sender/KRAM][nested-gates]         | Reference stubs      |
| ESSR outcomes    | Merged #163          | After #162 | [Outcomes/cleanup][nested-gates]    | Local limits         |
| Shared admission | Local guards         | 4          | [Concurrent load][resource-gates]   | Allocation gaps      |
| Storage/recovery | Wire retained        | 5, with 4  | [Crash/reopen][storage-gates]       | Whole-row reads      |
| Transport        | Streaming foundation | 6          | [Usable child][transport-gates]     | Paths incomplete     |
| Reference pins   | Mixed targets        | 7          | [Imports/pins][qualification-gates] | Fork ≠ upstream      |
| Qualification    | Small corpora        | 7          | [Full matrix][qualification-gates]  | Runtime unqualified  |
| Mapper SAID      | Stale claim accepted | Final      | [Valid/tampered][mapper-gate]       | Disclosure semantics |

[proof-cleanup]: #exchange-proof-correction-after-162
[nested-gates]: #follow-on-pr-3-nested-consumers-split-by-ownership-boundary
[resource-gates]: #follow-on-pr-4-shared-runtime-resource-policy
[storage-gates]: #follow-on-pr-5-reconcile-durable-storage-and-reopenreplay
[transport-gates]: #follow-on-pr-6-reconcile-transport-and-consumer-backpressure
[qualification-gates]: #follow-on-pr-7-runtime-pins-and-final-qualification
[mapper-gate]: #remaining-current-reference-primitive-and-serder-slices

Final parity reporting must distinguish supported processing, unfinished work,
intentional divergences, reference stubs, and unqualified claims. No structural
parser result closes the full runtime or bounded-memory gates.

## PR sequence

This ledger covers the original migration. Its phase numbers are separate from
the follow-on PR numbers in the acceptance matrix above.

| Phase | Change               | Result                                |
| ----- | -------------------- | ------------------------------------- |
| 1     | Streaming baseline   | Merged [#126][pr126]                  |
| 2     | Large-input decoding | Merged [#127][pr127]                  |
| 3     | Progressive contract | Merged [#128][pr128]                  |
| 4     | Segmented cursor     | Merged [#129][pr129]                  |
| 5     | Generator traversal  | Merged [#130][pr130]                  |
| 6     | Payload owners/sinks | Merged [#131][pr131]                  |
| 7     | Incremental ESSR     | Merged [#132][pr132]                  |
| 8     | Recipient decryption | Merged [#133][pr133]                  |
| 9     | Durable payloads     | Merged [#137][pr137]                  |
| 10    | Streaming ingress    | Merged [#138][pr138]                  |
| 11    | Consumers/egress     | Shared policy pending                 |
| 12    | Final qualification  | Engine removed; qualification pending |

Required evidence by phase:

1. Preserve the immutable commit/runtime/corpus manifest and correctness oracle;
   run the untouched baseline in bounded isolation.
2. Prove 1 MiB+ values and small-token/large-tail cases in both domains; preserve
   the decoding-fixed atomic baseline.
3. Distinguish implemented behavior from the accepted target.
4. Prove bounded views, split headers, cancellation, cursor checkpoints, and no
   accumulated suffix copying.
5. Prove early GenericGroup children, exact single-frame enclosures, genus scopes,
   and partial failure.
6. Prove backpressure, stage ownership, finish/abort, and the filesystem boundary.
7. Cover both count models/domains without retained raw envelopes or unbounded
   item lists.
8. Prove logical-message limits and authentication before plaintext storage;
   preserve the crypto wire format.
9. Prove `.essrs` compatibility, escrow/replay, file/DB crash recovery, and orphan cleanup.
10. Prove streaming routes avoid whole-request reads; exercise cancellation/EOF
    through real HTTP.
11. Prove streamed serialization and KERIpy interoperability without hidden bulk
    joins or arrays; finish shared resource policy.
12. Complete the benchmark report and remove the old engine, aliases, and
    compatibility-only tests; keep contracts current.

[pr126]: https://github.com/kentbull/keri-ts/pull/126
[pr127]: https://github.com/kentbull/keri-ts/pull/127
[pr128]: https://github.com/kentbull/keri-ts/pull/128
[pr129]: https://github.com/kentbull/keri-ts/pull/129
[pr130]: https://github.com/kentbull/keri-ts/pull/130
[pr131]: https://github.com/kentbull/keri-ts/pull/131
[pr132]: https://github.com/kentbull/keri-ts/pull/132
[pr133]: https://github.com/kentbull/keri-ts/pull/133
[pr137]: https://github.com/kentbull/keri-ts/pull/137
[pr138]: https://github.com/kentbull/keri-ts/pull/138

Phase 9 builds on [#135](https://github.com/kentbull/keri-ts/pull/135), which makes
dispatch/settlement and mailbox batch delivery yield through completion with
explicit mailbox endpoint identity, and
[#136](https://github.com/kentbull/keri-ts/pull/136), which publishes durable
payload references. Exchange integration merged in
[#137](https://github.com/kentbull/keri-ts/pull/137). HTTP/runtime ingress also incorporates the merged test cleanup
[#134](https://github.com/kentbull/keri-ts/pull/134) and grouped-receipt repair
[#139](https://github.com/kentbull/keri-ts/pull/139); its review diff contains only ingress.

Phase 11 serialization and HTTP output merged in
[#140](https://github.com/kentbull/keri-ts/pull/140), CLI consumers in
[#141](https://github.com/kentbull/keri-ts/pull/141), lazy replay and replies in
[#142](https://github.com/kentbull/keri-ts/pull/142), and exchange/witness delivery
in [#143](https://github.com/kentbull/keri-ts/pull/143).

The query/mailbox slice in [#145](https://github.com/kentbull/keri-ts/pull/145)
queues bounded query requests outside guarded dispatch,
awaits each complete SSE event consumer, and produces mailbox output on HTTP
demand without holding LMDB iterators across suspension. Finite OOBI/DID
verification still collects at most 8 MiB. Stored mailbox values are read whole
before their 4 MiB output check; aggregate connection and memory admission belong
to the approved resource-policy follow-on.

Keep each PR incremental: branch from the latest merged predecessor. If prepared
ahead, base it on the predecessor branch and retarget after that predecessor
merges. Native GitHub stacks are optional if they preserve this review boundary;
stack tooling is not an implementation dependency. Merge after the exact head's
required CI passes. Use empty changesets for tooling/docs and release-impacting
changesets for package/API changes.

KERI/Tufa filesystem code uses native Deno APIs and the existing `@std/path`
conventions. Keep Node-specific adaptation at npm packaging boundaries. Temporary
file names may use Web Crypto UUIDs; publication uses the owning protocol SAID or
a qualified content digest with representation scope where needed.

Phase 12 separated the test/body migration in
[#144](https://github.com/kentbull/keri-ts/pull/144) from the final KERI consumer
migration. The atomic engine, synchronous push API, event wrappers, unused KERI
CESR re-export stubs, and atomic ESSR adapter are removed. Consumers use progressive
`parse` or async finite `parseBytes`; KERI complete records use `Reactor.processBytes`
through the same progressive source. Local bootstrap replies retain normal
signature and BADA acceptance without serializing solely to parse them again.
Protocol regressions remain on the new API.

The engine-removal checkpoint closes the implementation portion of phase 12.
Run the final controlled end-to-end matrix after the approved current-main and
resource-policy follow-ons so it qualifies the finished implementation. Preserve
the earlier independent benchmark checkpoints; do not treat parser-only results
as runtime qualification.

## Additional approved review and qualification work

### Completed test cleanup and qualification

[#134](https://github.com/kentbull/keri-ts/pull/134) merged after the complete
local inventory passed: 1,059 tests, including 577 KERI tests across 111 files
and the manual endurance targets. Static/unit/package CI and installed npm
smokes on glibc and Alpine also passed. The immutable TypeScript qualification
revision was `1e0af1b189ae947bb236178946e6ab008d885507`; subsequent phases must
register new tests explicitly and preserve the qualified protocol coverage.
Hosted interop completion remains outside the merge gate.

Run the complete maintained test inventory, including all manual and long-running
targets. Preserve the frozen upstream-main baseline at
`927c0cb8794d7c84fc17143c67df64aab9deda6c`. Final qualification uses the published
`kentbull/keripy` fork `b08ddeb047fd865d60affe82a0dc77f5efaf4672`: that same main
base plus standalone mailbox commands/admission, explicit mailbox protocol
selection, the transferable receipt-table lookup repair, and explicit VC export
genus selection, and JSON mailbox queries for topic names that cannot be native
CESR labels. Credential CLI commands also select anchor, grant, admit, and
mailbox-consumption versions explicitly; admit uses protocol-specific serders for
embedded KERI/ACDC bodies. Explicit encodings and CLI protocol defaults remain
unchanged. The existing credential fixtures select v1; legacy pathed IPEX grants
continue to reject v2.
This is fork-on-main qualification, not pure upstream parity.
Verify exact commit and actual imports, and record every run, skip, failure,
topology, and duration. Extended interop and ESSR workflow jobs have a 15-minute
limit; only the maintainer dispatches them. Full local qualification still runs
every maintained target, including long topologies.

The replay blocker discovered during qualification was repaired in
[#139](https://github.com/kentbull/keri-ts/pull/139). Canonical grouped
transferable receipt proofs (`-F`) replace emitted v1 `-D` quadruples, and
runtime dispatch verifies the groups. Stored evidence and legacy decoding are
preserved. The affected OOBI and credential flows passed without changing their
topology or assertions; the broader table upgrade remains in the follow-on sequence.

Continue the progressive parser sequence from these merged prerequisites. Any
interop regressions or missing features discovered against this KERIpy revision
must have an evidence-backed follow-up list and sequenced implementation plan.
Execute those follow-ups after the progressive parser work; do not disguise
production repairs as test cleanup.

## Benchmark protocol

Generate valid inputs incrementally; never preload the whole corpus or create a
transfer-sized chunk array in the measured process. Separate fixture preparation
from measurements. Record exact commit, runtime/dependency versions, machine,
workload parameters, corpus hashes, limits, commands, and raw results.

| Dimension          | Qualification cases                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Aggregate bytes    | 16 MiB, 256 MiB, 1 GiB, 4 GiB                                                                    |
| Logical messages   | 4 KiB, 64 KiB, 1 MiB; representative mixed distribution                                          |
| Structure          | Flat stream, one large GenericGroup, several nested groups                                       |
| ESSR fragmentation | Independent sealed messages; multiple Texters per message; many fragments in one logical payload |
| Input              | 4 KiB, 64 KiB, 1 MiB and irregular chunks; applicable v1/v2 text/binary                          |
| Consumer           | Fast, throttled, cancelled; malformed/truncated later child                                      |

Use representative large combinations, plus exhaustive splits for small
correctness fixtures. Run fresh processes repeatedly and report variance.
Apply explicit process/time/memory budgets; a crash or limit violation is a
failed case, not a throughput number.

Capture five checkpoints: untouched source; decoding-fixed atomic parser;
cursor/copying fix; progressive generator; complete transport-to-storage path.
This distinguishes buffer-copy and decoding improvements from progressive
emission. Preserve successful frame order/content/digests across checkpoints;
the target's intentional earlier-child survival on later failure is checked
separately from the old atomic behavior.

Measure first-child latency and bytes received, first verified usable result,
throughput, CPU/elapsed time, peak RSS/heap/external/crypto memory, queued bytes,
active work, metadata, open resources, and storage/cleanup. Report mapped-file
residency separately from retained parser memory. Do not promise a predetermined
speedup.

Final acceptance requires child delivery before the outer enclosure completes,
bounded queues and metadata as aggregate size rises, functioning backpressure,
correct cancellation, durable replay, and unchanged successful protocol results.
Keep only fast deterministic correctness checks in ordinary CI. Large ESSR
benchmarks, gigabyte transfers, and endurance tests use explicit local
qualification or the manually dispatched KERI Extended Interop workflow alongside
other long-running targets. Do not dispatch that workflow during this run. They
are not dependencies of the PR stage gate and must
never become required checks for merging to master. Run and preserve their
evidence for this implementation goal without adding them to the testing
critical path. Performance claims name their checkpoint and workload;
parser-only measurements do not establish the full runtime's memory bound.

## Approved follow-on sequence: current KERIpy alignment

Execute this sequence after the phase 12 engine removal and attendant repairs;
finish phase 12 qualification with the final matrix below. Reconcile
prepared/merged work before each PR, keep the same plan, and implement only
missing behavior. Synchronous-engine removal and #134's test reorganization are implemented;
do not recreate them or reshuffle those tests here.
These are approved future obligations, not claims about current parser support.

The frozen test baseline at upstream `927c0cb8` records actual execution failures;
final qualification uses the explicit mailbox fork above. A read-only table audit
also confirmed differences from current keri-ts tables. Preserve their independent
historical table-source provenance until implementation and vectors change together.

The initial evidence was keri-ts `517dd4c3e85b15fa0f84ac829c9a7400594cbbd8`
and KERIpy main `927c0cb8794d7c84fc17143c67df64aab9deda6c` on 2026-10-13.
Resolve the applicable upstream main once at this sequence's start and freeze its
full SHA. Record the actual starting TypeScript revision, Python/runtime versions,
import paths, fixture provenance, and every harness pin. The original generated tables used `450ae1c`; follow-on PR 1 upgrades table
verification to the frozen upstream `927c0cb8`. Runtime
qualification uses the fork pin below. Keep those environments distinct and never
label old table verification current-main parity or chase a moving main during a run.

For #134 qualification, the user separately authorized rebasing the mailbox
implementation onto this frozen upstream revision and publishing an immutable
commit on `kentbull/keripy`. Record that fork commit, upstream parent, mailbox
delta, and actual import path separately from upstream-main evidence. Preserve
the existing `mailbox-impl` branch. Published `mailbox-main-interop` commit
`b08ddeb047fd865d60affe82a0dc77f5efaf4672` is based on upstream
`927c0cb8794d7c84fc17143c67df64aab9deda6c`, ports the original mailbox commits
`1faba4f2` / `9924fffa`, adapts their handler to nested messages, and adds explicit
mailbox protocol selection, the `vrcs` lookup repair in forwarding introductions,
explicit VC export genus selection, and JSON mailbox queries for slash-prefixed
topics that native CESR labels cannot encode. It also adds explicit credential
command version boundaries and protocol-specific admit body rehydration.
The #134 runtime qualification uses this declared fork; protocol-table pins remain
independently identified. A successful fork run proves that declared combined surface,
not unmodified upstream-main mailbox behavior.

Keep progressive async generators, one bounded shared cursor, local genus scopes,
explicit resource ownership, and structural parsing separate from acceptance.
Retain the existing regressions for ordered GenericGroup siblings, chunk-invariant
attachments, exact enclosures, terminal truncation, v1 item/v2 payload counts,
unsupported versions, cancellation, and cleanup. Do not reproduce reference
parser defects such as overdeclared enclosure acceptance, version-scope leaks, or
ambiguous processing-success reporting. No permanent parser strategies, heuristic
cross-major fallbacks, or old keri-ts API compatibility layers are authorized.

### Reference audit and acceptance inventory

Before changing wire semantics, audit the complete relevant reference delta:
counting/codices, primitive widths, structing, Serder/native serialization,
attachment handlers, nested-message extraction, and runtime processing. Classify
source differences separately from reproduced wire failures, missing features,
intentional API differences, and reference defects.

Regenerate independent Python fixtures and expected structural summaries from
the frozen source. Verify actual imported modules, including independently
installed resolver environments. Add each failing regression with its repair;
do not introduce a permanently failing master gate. Additional discovered defects
receive narrow dependent PRs before the affected capability is declared complete.

### Follow-on PR 1: reference tables and wire semantics

Update generation/verification and every affected consumer coherently. Known
deltas include v2 `-N` / `--N` becoming `NonceSealSingles` /
`BigNonceSealSingles`, and GramHead using Matter `b` with different widths from
`0Q`. Audit removed and renamed counters as well. Update registries, semantic
primitives, structing/native encoding, decoding, annotation, and consumers
where their meaning changes. A code's presence in a table does not authorize its
use as a top-level attachment; inspect accepted contexts.

Preserve the selected reference's supported v1/v2 surface and established
interoperability requirements. Document genuine removals and never assign two
meanings to one genus/code through fallback. Acceptance requires independent
Python-to-TS and TS-to-Python fixtures in qb64/qb2; exact widths, counts, bytes,
semantic roles, and consumed extents; small/big forms, malformed lengths, and
split headers; and generated-table verification against the immutable pin.
Still-older runtime pins remain explicitly labeled until separately upgraded.

Implementation and independent table/wire evidence are recorded in
[`CESR_CURRENT_REFERENCE_TABLES.md`](CESR_CURRENT_REFERENCE_TABLES.md).
The native nonce-seal registry omission in the frozen reference is a documented
admission boundary: structing support does not imply native event or attachment
support. Broader current-reference parity still depends on the following slices.

### Follow-on PR 1a: current-reference text escapes

Bexter and Labeler now implement frozen `927c0cb8` escaping: `AAA` emits
`4AAB-AAA` and decodes back to `AAA`; leading hyphens are escaped independently
of length. Pather explicitly opts out and retains its own path escaping.
This slice is limited to those text semantics and their consumers.

`reference-text-vectors.py` verifies its imported source and emits literal
qb64/qb2 fixtures for empty text, leading `A`/`-`, all length-modulo-four cases,
and relative/absolute paths. `current-text-vectors.ts` independently emits TS
tokens; the Python verifier consumed 108 tokens with matching semantics and
exact extents. The full CESR suite passed 449 tests, including native, path,
threshold, protocol v1/v2 consumers, and a 1 MiB Bexter decode through both domains.

### Current-reference fixed-field semantic records

Frozen `927c0cb8` `SealKind.d` now uses `Noncer` throughout TS fixed-field
records, small/big typed-seal attachment hydration, runtime projection, and tuple
storage. Qualified empty (`1AAP`), 128/256-bit salt, and digest values retain their
wire roles; the empty crew field is still `1AAP`, not empty text. Python's
`kramTDCS` database cast remains `Diger` despite its parser admitting `Noncer`.
TS preserves all admitted roles after reopen and preserves common digest-row bytes;
this does not establish Python database interoperability for empty/salt rows.

`FirstSeen` and its clan/cast registries now own `f: NumberPrimitive` and
`dt: Dater`, including hexadecimal ordinal and ISO datetime crew projections.
Runtime dispatch consumes this plain record; storage aliases derive from its
tuple descriptor. `Dater.dts` now returns ISO text, and existing datetime consumers
use that canonical accessor without retaining the former TS `iso8601` alias.
The constructor accepts explicit `dts`; encoded-input precedence and datetime
wire validation remain unchanged. There is no new counter family or context
admission: nonce seals remain structing-only, and first-seen attachment counters
retain v1 item counts and v2 quadlet/triplet counts.

`reference-structing-vectors.py` verifies the imported frozen modules and emits
literal qb64/qb2 records and groups. Independent TS emission is decoded by the
actual Python Structor and attachment methods: 32 record/group/wrong-role checks
pass, alongside 455 CESR tests and 59 focused runtime tests. Coverage includes
small/big counters, split headers, exact consumed extents, truncated input, missing tuple fields,
wrong primitive roles, record identity, and database reopen.

### Weighted-threshold deployment limits

`Tholder.maxWeights` (1,000 terms) and `maxSithLength` (65,536 JSON characters)
bound weighted thresholds before rational conversion or JSON decoding. Count all
clauses and nested outer/member weights, and include whitespace in the JSON
budget. These tunable settings do not constrain numeric thresholds or define
protocol maxima. Frozen `927c0cb8` rejects oversized `sith` but actually admits the
same 1,001-weight `limen`; TS deliberately closes that wire-input bypass.
Boundary, aggregate, nested, pre-decode, override, and qb64/qb2 tests cover this
policy. A source-verified Python probe confirms the default boundaries and the
reference bypass. Larger deployments can raise both caps before parsing begins.

### Remaining current-reference primitive and Serder slices

Audit the remaining primitive/Serder delta at the same frozen revision before
claiming parity: path traversal limits and changed ACDC/KERI semantic accessors. Pather now exposes bounded resolution as part of the 3e disclosure prerequisite
below. The default depth limit applies to resolution; it does not limit wire path
construction. Changed Serder accessors still require a scope-specific audit.

The native seal repair now encodes and projects the seven frozen `Serder.ClanCodes`
families through the existing typed descriptors. It preserves homogeneous runs,
ordered SAD keys, and event-only list admission. Native nonce/big seal counters
remain excluded. Unsupported maps fail before serialization instead of being
silently lost. The former generic map/list fallback is removed.

`NumberPrimitive.fromNum` owns automatic `M/R/N/S/T/U` selection for native fields,
seal records, Serder wrappers, and numeric thresholds. Explicit `0H/0A` wire
hydration remains supported. Independent fixtures cover all seven seal families,
23 native events, JSON protocol 1/2, malformed boundaries/roles, and 17 numeric
transition values. Reverse probes ask the frozen Python reader to reconstruct
actual TS output. Current Python rejects native protocol 1; the historical TS
layouts remain, but this slice makes no current native-v1 parity claim.

Ignored SAID fields now remain in the returned SAD and its declared version size;
only the digest input excludes them. Twelve frozen Python literals cover JSON,
CBOR, and MGPK with protocol 1/2, both with and without ignored fields. Tests also
cover unversioned exclusions, input immutability, and missing-field rejection.

Aggregate commitments now use their declared CESR/JSON/CBOR/MGPK list framing.
Standalone `Aggor` verifies disclosed map SAIDs before compacting them, while
generic transport groups remain `Structor` values. Independent frozen fixtures
cover all four formats, compact/partial disclosure, malformed commitments, and
26 ACDC issuee projections. `SerderACDC.issuee` reads disclosed attributes or the
first aggregate member; compact sections reveal no recipient. The KERI revocation
recipient path exercises those same projections.

One reproduced validation gap remains outside this slice: standalone saidive
`Mapper` verifies serialization round trips but accepts a stale claimed SAID
after a map member changes. After the progressive runtime follow-ons below,
add a focused parity repair with independent positive and tampered vectors for
all supported kinds. Reuse the resulting verification path from `Aggor` once it
preserves the independently established disclosure behavior.

Separate API naming differences from reproduced wire or validation gaps. Implement
actual gaps in cohesive dependent slices, retaining protocol v1/v2 fixtures and
avoiding old keri-ts compatibility aliases. Pure diagnostic wording and
Python-specific buffer adaptations do not require a port.

### Follow-on PR 1b: imported v2 event replay

The #134 interop run at TS `f3a267e6` against the declared mailbox fork reproduced
v2 event bodies being replayed by `Baser.cloneEvtMsg` with fixed v1 attachment
counters. This fails downstream OOBI and credential-evidence parsing. Explicit v1
CLI fixtures qualify the existing v1 scenarios; they do not close this v2 defect.

Phase 11 left `Baser.cloneEvtMsg` on fixed v1 counters and a non-native version
sniff. The independent core repair hydrates stored bodies with `SerderKERI`,
selects every replay counter from the body protocol/genus, and preserves v2
qualified ordinals. Six frozen `927c0cb8` fixtures prove JSON v1/v2 and native v2
source seals/grouped receipts after database reopen; Python independently
constructs and parses each expected envelope. This narrow repair can land before
the reference-table update.

The acceptance fixture now generates signed KERI v1/v2 anchor chains, v1 TEL
registry/issuance events, and an ACDC credential with frozen Python. The runtime
receives TEL evidence before its anchors, resolves the KEL through actual HTTP
OOBI ingestion, unescrows and verifies the credential, then closes/reopens storage
and reproduces Python's TEL, credential, and source-chain wire in both genera.
This exposed and repaired fixed-v1 TEL clone counters, fixed-width credential
ordinal construction, and unnecessary ordinal widening in TEL storage/escrow.

Protocol version and attachment genus remain independent: frozen `927c0cb8`
rejects v2 `vcp` bodies. These fixtures therefore use supported v1 TEL/ACDC bodies
with both attachment genera and KERI v1/v2 anchors. They do not invent unsupported
v2 TEL encoding or establish the separately tracked ACDC-v2/nested-runtime parity.
Stored bodies remain unchanged; explicit genus selectors replace no protocol
bytes and no parse failure retries another version.

### Follow-on PR 2: parent-owned nested message attachments

Regenerate the pinned reference failure: a native signed `xip` parent and two
signed children serialized with `messagize(..., nests=[child1, child2], nested=True, gvrsn=Vrsn_2_0)`. Reference KERIpy returns one parent, its own
signature, and two nests; the former TS implementation accepted the flat parent
and rejected the nested form inside `BodyWithAttachmentGroup`. Temporary
review fixtures are clues only, not durable test inputs.

Represent a bounded parent-owned message tree. Preserve the context-dependent
distinction between GenericGroup siblings, following top-level messages, and
messages embedded in an enclosed attachment region. Every child retains its own
body, signatures, attachments, genus, and resources. Do not flatten signatures or
permit arbitrary extra top-level frames in a single-frame enclosure.

Deliver the parent only after all its required enclosed contents complete. On
failure, discard undelivered descendants; previously delivered independent
GenericGroup siblings survive. Acceptance requires independent expected trees
across both domains, applicable genera/body formats, nested selectors, multiple
children, deeper nesting, every-byte splits, and malformed later children. Prove
no partial-parent delivery, signature reassignment, duplicate child delivery, or
scope leakage; enforce tree byte/node/depth limits and cancellation cleanup;
preserve legitimate single-frame rejection cases.

Implemented in #155: `CesrFrame.nests` owns child frames; frame `gvrsn` records
resolved attachment genus separately from body metadata. The shared generator
engine distinguishes enclosed children from GenericGroup siblings and retains
all descendant stages until parent validation/finalization. Existing frame byte,
leaf, ESSR byte/item limits aggregate over the tree; `maxTreeNodes` defaults to
256 and cursor depth remains 64. `discardFrame` claims and disposes every child
owner, including runtime cleanup paths when normalization rejects nesting.

`reference-nested-vectors.py` verifies frozen imported source bytes and records
actual signed Python trees, both wire domains, protocol 1/2 JSON/CBOR/MGPK,
native xip, deeper descendants, attachment enclosures, v1 nesting, and scoped
v1 child selectors. A GenericGroup in enclosed attachments remains invalid.
Focused tests exercise every-byte splits, all admission limits, late-child
failure, read/finish cancellation, and repeated recursive disposal. The parser
slice initially guarded serialization, annotation, KERI normalization, and HTTP
inspection. Follow-on consumers remove only their independently tested guard.

### Follow-on PR 3: nested consumers, split by ownership boundary

Frozen authority remains KERIpy `927c0cb8794d7c84fc17143c67df64aab9deda6c`.
The following source references are relative to its `src/keri/` directory; they
are processing obligations, not claims that TS already implements those paths.

- `core/parsing.py:1378` routes protocol-v2 `qry/rpy/exn/xip/pro/bar` to
  `Kevery.processMsg`; `core/eventing.py:4645` applies sender allow/deny policy,
  optional KRAM intake, then type-specific dispatch. No universal child-dispatch
  loop exists. `processXip/processPro/processBar` at lines 4780/4784/4788 are
  explicit stubs; native parsing/serialization does not establish their processing.
- `peer/exchanging.py:323` passes nests to `/multisig`, `/ipex`, and `/fwd`
  handlers after sender-evidence handling. Escrow writes nested substreams at
  line 458, retry reloads them at line 514, accepted storage writes them at
  line 607, and replay consumes them at line 968. These paths preserve evidence;
  they do not independently authorize every child as a top-level message.
- `app/grouping.py:881` validates the specific v2 multisig route, one-child
  cardinality, child ilk and the parent's signed child SAID. `app/forwarding.py:521`
  verifies the v2 forward envelope's child relationship, then line 550 stores the
  serialized child. Each actual route owns its acceptance and dependency rules.

**3a — serialization (implemented):** `framePayload`/`attachmentPayload` preserve
admitted trees using existing parser ownership. `peer/exchanging.py:1195`
(`serializeParsedSubstream`) and `core/eventing.py:1563` (`messagize`) establish
valid child enclosure shapes. TS borrows descendant ESSR references, computes
counts without opening payloads, scopes child genus selectors, preserves each
message's signatures and child ordering, and qualifies non-native child bodies
through Texter. Existing tree byte/node/depth limits bound retained metadata;
this adds no second parser or resource-policy framework. Both domains and
protocol versions, scoped genera, empty child evidence, ESSR reopen/cancellation,
and actual frozen-Python acceptance/re-serialization are qualified. Category
normalization remains explicit: ordinary leaves, children, then ESSR; original
interleaving between those categories is absent from `CesrFrame`.

**3b — finite nested annotation (implemented):**

Implemented after the nested serializer slice: annotation traverses each parent's
hydrated child iterator while GenericGroup siblings remain independent roots.
One `AnnotatedFrame` retains the root and all descendant lines. The existing
finite wire renderer preserves original wrapper headers, indentation, scoped
genus selectors, signatures, and ESSR order; it checks every node is consumed
exactly once without introducing another body parser or flattening child evidence.

Frozen Python `927c0cb8` trees prove text/qb2, v1/v2, native/non-native, deep nesting,
scoped child genera, and signed annotation/deannotation round-trips. Focused
regressions cover root ordinals, indentation, missing/extra/repeated child nodes,
and recursive payload transfer or cleanup after rendering failure, collection
failure, and cancellation. Finite annotation retains its 8 MiB default admission;
`annotateFrames` callers release entire trees through `discardFrame`. KERI
normalization retains guards for other nested routes; the v2 forwarding slice
below closes its own verification, dispatch, replay, and ownership behavior.

**3c — forwarding and persistence (implemented):** Runtime normalization admits
nested protocol-v2 `/fwd` messages only. `ExchangeInput` and handlers borrow the
hydrated children; `ForwardHandler` requires one valid child body and verifies
its digest against the parent's signed `a.evt`. The recipient authenticates the
child's signatures; forwarding never recursively dispatches it.

Actual nested serializer output enters KERIpy-compatible `enst.` IoSet rows.
Private per-admission staging permits atomic replacement with accepted/escrow
metadata, preserving earlier rows on rejection, cancellation and transaction
failure. Verified duplicates replace rows and invoke the handler again, as the
frozen Python probe proves. Reopen/retry/replay parse stored rows with shared
remaining parent-tree credit and temporary file-backed ESSR, releasing owners
on errors and cancellation. Fresh parsed children are reused. Bounded row reads
and writes preserve original qualified ciphertext, order and IoSet deduplication;
`payload-store.md` records the 24 MiB aggregate wire-copy ceiling and the native
LMDB allocation-before-size-check limitation. No second whole ESSR array or
private wire pointers are introduced.

`exchanging-nests.test.ts` exercises the real handler, normalization, child and
parent proof separation, signature/commitment failures, missing sender state,
escrow/retry, duplicate replacement, atomic rollback, concurrent cancellation,
recovery and durable replay. `packages/keri/scripts/qualify-nested-exchange.ts`
qualifies actual stored rows with frozen Python `927c0cb8`, checking nested
signature ownership and Python's replacement/handler semantics.

**3d — multisig (merged, [#160](https://github.com/kentbull/keri-ts/pull/160)):** `/multisig/icp|rot|ixn|rpy`
requires exactly one child of the frozen allowed ilk, its valid SAID and the
matching signed route field. V1 aggregation stays keyed by embedded `e.d`; v2
uses the signed child SAID. Local membership is necessary for coordination, and
a locally controlled submitter must approve before child replay. Parent proofs
never satisfy child thresholds. First remote arrivals notify; already approved
arrivals feed ordinary KEL/reply processors. Later local approval reopens earlier
remote wrappers. Child dependency/signature escrows remain independent of the
accepted wrapper and use normal retry turns.

The route slice reuses #159's staged publication and file-owned replay. It also
fixes exchange retry skipping the next row when a live LMDB iterator's current
row is removed: each retry closes its key cursor before mutation and advances to
a captured initial key horizon. Tests retain two real participant stores and
prove approval order, invalid proofs/commitments, membership and route guards,
missing dependency/retry, duplicate replacement, reopen, rollback and cancellation.
`qualify-nested-multisig.ts` checks 12 actual accepted JSON/CBOR/MGPK wrappers with
frozen upstream927 and reparses Python's serialized children. The reference's
27 selected v2/approval tests pass independently. These are small-corpus checks,
not memory/endurance qualification.

The Tufa CLI still proposes and joins v1 pathed exchanges, matching frozen
`cli/commands/multisig/{incept,interact,rotate,join}.py`; v2 evidence here covers
the explicit builders and runtime approval APIs, not a v2 CLI workflow. Preserve
v1 first-notice behavior: notifying again for an already indexed v1 proposal
causes its CLI approval consumer to re-propose it. The unchanged three-member
weighted CLI/mailbox/DID Webs integration passes after retaining that boundary.

The frozen default native EXN builder leaves `ri/x/p` empty and reports local
verification success even though `SerderKERI(raw=...)` rejects its output.
Default native multisig builders therefore remain unqualified; TS rejects the
empty required field. The qualification probe reproduces and reports this case
instead of counting it as supported. Nested children with further descendants,
`/multisig/vcp|iss|rev|exn`, and legacy pathed protocol-v2 coordination remain
guarded. Complete node/tree resource admission remains in follow-ons 4–5.

The dedicated refactoring PR [#161](https://github.com/kentbull/keri-ts/pull/161) merged before IPEX proof publication. It keeps
`multisigExnBody()` synchronous and limited to the route/child-kind relationship
and signed child SAID. Parsed-frame callers use the child's `SerderKERI` directly;
`nestedPayload(frame, Vrsn_2_0)` borrows evidence until consumption completes.
`prepareMultisigEventExn()` owns the byte convenience path: `parseBytes()`, pure
body construction, finite wire collection and joined frame disposal. Cancellation
aborts payload reads before cleanup returns. Parent signatures and child evidence
still share the correct outer attachment enclosure. V1 pathed construction and
Tufa participant topology remain unchanged. Validate byte-identical commitments,
parsed-frame reuse without payload reads, borrowed-owner lifetime, cancelled
preparation, the real workflows, and the existing upstream interoperability probe.
Apply the same boundaries in 3e without a repository-wide API migration.

**3e — IPEX (source audit complete; proof prerequisite merged in #162):** use frozen
`acdc/ipexing.py`, not just legacy `vc/protocoling.py`. Its 62 maintained tests
pass with actual imports from `/work/keripy-main927/src`. The existing TS handler
implements the legacy conversation graph only. The same planned IPEX unit owns
supplemental evidence selection and source-seal persistence, single-DAG disclosure
plans and graph semantics, independent issuer proofs, and `rip/bup` registry
vetting/retry. Presentation-registry history additionally depends on the
receiver-observed KRAM acceptance timestamp addressed with 3f. TS still lacks that v2 registry processing. The path-directed Compactor
prerequisite is implemented for review below. Both belong inside 3e; they do not
establish completed IPEX processing or create parallel workstreams.
Completion requires real grant/admit workflows with credential/KEL/TEL dependency
evidence, no silent evidence loss, and continued rejection of legacy pathed v2
input until its supported nested processing path is complete.

The proof prerequisite [#162](https://github.com/kentbull/keri-ts/pull/162) adds independently checked sender source seals and
route-selected supplemental signatures/source seals, persisted in KERIpy-shaped
`ests.`/`eidx.` tables. Known last-establishment groups freeze to historical
coordinates before sender escrow; retries restore cigar verifier context and
replay rechecks every retained factor. Route dependency decisions can escrow
without accepting the EXN. The qualification probe passes 15 v1/v2
JSON/CBOR/MGPK storage/replay cases through actually imported unmodified upstream
modules. This custom proof-route probe does not qualify any IPEX workflow.
Legacy v1 intake still requires signatures. The dedicated correction below
restores missing-state persistence and capability boundaries; consolidated
processMsg/KRAM intake remains 3f.

**Dedicated ESSR refactor (merged [#163](https://github.com/kentbull/keri-ts/pull/163)):** separates normal
recipient outcomes into successful authenticated message/owner transfer,
admission refusal (`busy`, configured size, exchange-acceptance prerequisite),
and verification failure (envelope, digest, authenticated decryption, framing).
Malformed undersized ciphertext is distinct from configured oversize refusal;
invalid Payload size metadata remains a contract exception. Preserve rejection
before reads/allocation, cancellation, joined cleanup, exactly-once reservation
release, propagation of unexpected storage/I/O/invariant errors, and no
unsuccessful plaintext publication. Update real callers exhaustively, remove the
obsolete exception-only API, and prove each outcome plus successful ownership
transfer. Keep this independent of the multisig extraction and full shared
resource implementation; per-recipient limits do not establish a runtime-wide
bound. Phase 4 integrates these admission outcomes with runtime reservations.

The concrete API is `EssrDecision`: `accept` owns the message, `refuse` reports
admission policy, and `reject` reports verification. Raw `Decrypter.open` and
`Manager.open` return null only for the pinned backend's authentication failure;
keeper loading and unexpected errors propagate. Qualified Cipher decryption
continues to throw on failed authentication. Finished plaintext remains owned
through sink cleanup and is disposed if handoff fails. Tests retain the real
keys, independent pinned KERIpy ciphertext, durable exchange/reopen workflow,
and participant topology; they add pre-read size classifications, repeated busy
refusal/later admission, joined cancellation, and storage/keeper failure probes.

#### Exchange-proof correction after #162

The focused live-LMDB inspection repair merged in [#164][lmdb-inspection]. The
dedicated cleanup merged in [#165][proof-policy-pr] after all six required checks
passed on `36af5404`. It corrects #162 within 3e before further IPEX implementation.

- **Persistence:** missing sender source state escrows only for `acceptsSscs`;
  strict supplemental and unresolved last-reference failures query/reject without
  creating escrow. KERIpy `MissingSignatureError` counterparts preserve an
  existing escrow. Sender signatures and `MissingChainError` dependencies retain
  their distinct escrow paths. Incomplete duplicates preserve accepted evidence.
- **Capabilities and representation:** selection, evidence delivery, nonempty
  sender-couple delivery and missing-evidence metadata are independent.
  `ExchangeProofVerification` reports valid factors plus invalid/missing status;
  authenticated records distinguish `retained` from `supplemental`. Domain records
  retain historical-resolution and selection boundaries without a generic framework.
- **Cues:** missing coordinate lists deduplicate within each reference helper call.
  Passing unresolved coordinates to selection does not query them a second time.
  Sender-signature queries and route-dependency proof cues require a newly inserted
  escrow row. An incomplete accepted duplicate emits neither of those cues.
- **Evidence:** focused real-store tests cover callback arguments, decisions,
  authentication rows, cues, retry/reopen and accepted-duplicate preservation.
  The existing frozen-Python wire probe checks capability delivery alongside
  storage/replay. Upstream's own strict missing-state and retry tests supply
  independent branch evidence. These are proof machinery tests, not IPEX workflows.

Source mappings at frozen upstream `927c0cb8`: [processEvent and queries][py-policy]
(lines 65–420), [escrow/retry][py-escrow] (426–575),
[stored-proof verification][py-verify] (1122 onward), and
[IPEX capabilities][py-ipex] (426–455; selection at 1721).
Parent/child proof separation, historical coordinates, `ests.`/`eidx.` and cigar
verifier reconstruction remain required. Excluding foreign endorsements from
leadership intentionally corrects the frozen first-group choice; ordinal bounds
are JS/database constraints, not protocol limits. Unresolved sender last groups,
unsupported nested IPEX and unfinished processMsg/KRAM remain guarded. This work
adds no second IPEX or shared-admission project.

[lmdb-inspection]: https://github.com/kentbull/keri-ts/pull/164
[proof-policy-pr]: https://github.com/kentbull/keri-ts/pull/165
[py-policy]: https://github.com/WebOfTrust/keripy/blob/927c0cb8794d7c84fc17143c67df64aab9deda6c/src/keri/peer/exchanging.py#L65
[py-escrow]: https://github.com/WebOfTrust/keripy/blob/927c0cb8794d7c84fc17143c67df64aab9deda6c/src/keri/peer/exchanging.py#L426
[py-verify]: https://github.com/WebOfTrust/keripy/blob/927c0cb8794d7c84fc17143c67df64aab9deda6c/src/keri/peer/exchanging.py#L1122
[py-ipex]: https://github.com/WebOfTrust/keripy/blob/927c0cb8794d7c84fc17143c67df64aab9deda6c/src/keri/acdc/ipexing.py#L426

#### Canonical disclosure prerequisite within 3e

The existing IPEX worktree now repairs Compactor's lost descendant cache and
adds path-directed canonical disclosure, plus the Pather resolution used by
frozen IPEX plan validation (`acdc/ipexing.py` 850–945). Focused independent
fixtures cover four serialization formats, scalar/subtree/ordinal/union paths,
root filtering and exact dotted-label traversal. The fixture generator verifies
actually imported unmodified upstream modules. Invalid paths and depth policy
have explicit checks. This implementation is under review; publication and
required CI remain gates.

Compaction preserves commitments while constructing disclosure variants; it
supplies no issuer authentication, graph acceptance or credential persistence.
Standalone Mapper stale claimed-SAID verification stays in its dedicated later
repair. Frozen `Compactor.raw` remains a stale pre-compaction snapshot; TS retains
its existing current-map serialization and compares canonical bytes with a fresh
reference Mapper. Partial bytes are compared directly. This intentional object
snapshot difference is recorded in the graduated disclosure guide. Registry
processing, grant/admit workflows, sender/KRAM admission and full qualification
remain incomplete.

**Remaining runtime slices:** IPEX workflow evidence and the affected v2
`processMsg` policy remain separate PRs. TS dispatch still bypasses the reference's consolidated non-event
allow/deny and optional KRAM intake; no full frozen-runtime parity is claimed.
Normalization continues to reject other nested roots, including the reference's
unimplemented `xip/pro/bar` processing stubs. HTTP inspection keeps its own guard
until its ownership/forwarding consumer is completed. Shared runtime reservations
and final end-to-end resource qualification remain follow-ons.

The eight-unit continuation has merged **3d multisig**. The remaining units are
**3e IPEX**, **3f affected v2 dispatch policy**, follow-ons **4–7**, and the
standalone **Mapper** repair. The dedicated multisig responsibility refactor is
an extraction within this sequence; the existing IPEX proof work is preserved.
Qualification may reveal additional focused repairs. The existing source-grounded acceptance gates still apply.

### Follow-on PR 4: shared runtime resource policy

Extend existing cursor, ESSR, and recipient limits through one runtime admission
policy. Initial defaults change only with recorded source or measurement evidence:

| Resource                                    | Initial policy                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| Transport/file read target                  | 64 KiB                                                                       |
| Maximum producer backing allocation         | 1 MiB                                                                        |
| Cursor retained input                       | 8 MiB per admitted stream                                                    |
| Ordinary body plus attachments              | 8 MiB per pending parent tree                                                |
| Logical sealed ciphertext                   | 8 MiB including sealed-box overhead                                          |
| Aggregate decoded ESSR                      | 8 MiB shared by a pending tree and its descendants                           |
| Ordinary attachment leaves                  | 4,096 per pending tree                                                       |
| Nested message nodes                        | 256 per tree                                                                 |
| Enclosure depth                             | 64                                                                           |
| Active parsing streams                      | 2 per runtime                                                                |
| Active decryptions                          | 1 across the runtime, including all recipient instances                      |
| Completed queue                             | At most one tree per admitted stream, charged to the shared budget           |
| Runtime-owned byte reservation              | 256 MiB                                                                      |
| Initial reservation for an 8 MiB decryption | 64 MiB for ciphertext, plaintext, and native copies; validate by measurement |

These are configurable deployment limits, not CESR validity rules. Many small
messages may progress through a multi-gigabyte GenericGroup; do not cap the whole
transfer at 8 MiB. There is no unbounded waiting-request queue.

Reserve before allocation or retention. Charge producer backing, owned hydration,
canonical ESSR wire expansion (including qualification and empty-item overhead),
pending descendants, delivered queues, ciphertext, plaintext, and native crypto
copies until consumption, disposal, or durable ownership transfer. Object/node
limits complement bytes; neither the reservation budget nor mapped-file residency
is an exact process RSS ceiling. Bound accumulated durable/retry metadata as well
as individual parser inputs. Exhaustion returns an explicit resource-limit/busy
outcome or bounded backpressure.

Add simple deterministic consumed-byte/work checkpoints where many empty wrappers
or tiny items can otherwise run without public yield; measure the scheduling
cost rather than introducing a strategy framework. Acceptance requires nested
trees and two concurrent streams respecting limits, empty items/wrappers unable
to bypass work/object caps, oversized declarations rejecting before payload reads,
slow consumers/decryptions stopping upstream, cancellation releasing reservations
exactly once, and validated configuration through the real runtime entrypoint.

### Follow-on PR 5: reconcile durable storage and reopen/replay

Extend #133 and phase 9 rather than recreating recipient processing or storage.
Keep qualified ciphertext evidence in interoperable `.essrs`, escrow, relay, and
replay paths; plaintext stays distinct. Private references never replace protocol
wire rows with proprietary pointers. KERIpy-origin rows without private metadata
remain readable with their actual insertion-order/deduplication semantics.

LMDB currently obtains a complete nested row before its size check. The finite
24 MiB wire-copy ceiling does not prove pre-allocation admission. Phases 4–5 must
close that native allocation boundary and account for runtime-wide copies.
Also reconcile runtime handle ownership: LMDB V1 disallows concurrent environment
handles for the same path in one process. The focused live-agent test repair uses
separate CLI/inspection processes with unchanged endpoint assertions and protocol
participants; it does not add shared handles or complete runtime admission.

Persist/reopen through streaming iteration or finite batches, remove bulk
`getAll`/join operations from the selected large-transfer path, and bound staging,
open handles, and pending metadata. Never publish a durable reference to missing
content. Acceptance requires actual close/reopen, escrow retry, replay, ordered
Texter evidence, and crash points around staging, finish, durable publication,
and cleanup. Recovery removes only proven unreferenced task-owned content;
rejected/cancelled nested trees release stages; file-backed operation retains no
second whole payload in memory.

### Follow-on PR 6: reconcile transport and consumer backpressure

Reuse phases 10/11 and engine removal, filling only missing production integration.
Carry bounded HTTP/file sources and reopenable payloads through parsing,
normalization, processing, storage, forwarding, and serialization. Streaming
routes must not first call `arrayBuffer()`; finite convenience collectors require
explicit caps. Await processing and sink credit, and bound queues by bytes and
items. Real EOF, abort, disconnect, and shutdown follow the same ownership scope;
keep delivered independent children and dispose unclaimed resources.

Acceptance requires real HTTP with a deliberately slow sink/consumer; a complete
GenericGroup child becoming usable after application verification before the outer
transfer finishes; bidirectional KERIpy interoperability on the actual serializer;
disconnect/cancellation/processing-failure/shutdown cleanup; and no transfer-sized
arrays, hidden joins, or uncapped collectors.

### Follow-on PR 7: runtime pins and final qualification

Upgrade relevant runtime/CI pins only when their actual paths work against the
frozen reference. Inspect the DID Webs resolver's embedded KERI independently;
changing KLI does not update that environment. Use the maintained test inventory
without changing #134's organization, original participant topology, or assertions.
Fast deterministic parser/resource/interop regressions belong in ordinary checks;
large/manual/endurance qualification stays outside required merge CI. The local
qualification exception and 15-minute extended-job cap above remain in force.

Reference inventory observed during #160 preparation (2026-10-13); pin changes
and full qualification remain owned by this follow-on. A declared pin is not
evidence of the modules a process actually imports.

| Environment         | Target                             |
| ------------------- | ---------------------------------- |
| Ordinary CI         | Upstream `927c0cb8`                |
| Extended interop    | Fork `b08ddeb0`                    |
| Local CLI harness   | Fork `b08ddeb0`                    |
| Frozen probes       | Upstream `927c0cb8`                |
| macOS compatibility | Historical `450ae1c2`              |
| Sally harness       | Historical `98b88cf7`              |
| Embedded DID Webs   | Resolver `8395277f`; KERIpy 1.2.14 |

Import evidence and unresolved qualification:

- **Ordinary PR table CI:** Upstream `927c0cb8` in `pr-stage-gate.yml`. Table generation checks the
  frozen checkout; retain upstream provenance separately from runtime fork results.
- **Extended interoperability:** Fork `b08ddeb0` in `keri-extended-interop.yml`. Shared runtime
  probe verifies source and interpreter; retain manual dispatch and both 15-minute caps.
- **Shared local CLI harness:** Fork `b08ddeb0` in `interop-test-helpers.ts`. Explicit
  `/work/keripy-mailbox` runtime remains separate from frozen source probes.
- **Frozen nested probes:** Upstream `927c0cb8`. `PYTHONPATH=/work/keripy-main927/src`; multisig
  probe verifies loaded module bytes against Git. IPEX, registry and KRAM import paths also observed
  under this root.
- **macOS compatibility:** Historical `450ae1c2` in `macos-compatibility.yml`. Workflow installs an
  older CLI on PATH while shared test helpers select their own runtime; reconcile both selections
  and probe actual imports. Not executed in this slice.
- **Standalone Sally harness:** Historical `98b88cf7` in `scripts/vlei-tufa-sally-interop.sh`.
  Separate installer/cache; not covered merely by changing the shared TypeScript helper. Not
  executed in this slice.
- **Embedded DID Webs:** Resolver `8395277f`; dependency `keri>=1.2.13,<1.3`. Actual cached Python
  3.13 environment imports released KERIpy 1.2.14 from its own site-packages with no commit
  provenance, and HIO 0.6.14. This is historical release compatibility, not frozen upstream or
  fork-on-main qualification; upgrade and qualify or explicitly retain that target.

Run incrementally generated 16 MiB, 256 MiB, 1 GiB, and 4 GiB aggregates using
fixed small messages and representative 1 MiB messages. Include flat and nested
groups, fragmented ESSR, slow consumers, concurrent streams, cancellation,
malformed later children, and maximum-message probes. Every logical sealed
message remains within its admission limit. Use repeated fresh processes and
record exact source revisions, imported modules, runtime/dependencies, corpus and
representation hashes, commands, policy/default overrides, raw observations,
failures, skips, durations, and variance.

Measure first parsed child and first verified usable result, throughput, peak
RSS/heap/external/native allocations, retained-byte high water, queued trees,
active decryptions, open resources, and cleanup. Separate mapped-file residency
from retained parser/runtime memory. Acceptance requires observed retained-memory
plateau as aggregate bytes rise under fixed policy, actual current-reference
interoperability, and all repaired lifecycle regressions preserved in the
progressive API. Failed or skipped cases are never counted as qualified.

Final handoff names exact revisions/PRs, delivered capabilities and their evidence,
default policy and observed memory envelope, the current-reference parity matrix
(including unsupported/intentional divergences), every unresolved failure and its
next dependency, and precise completed/prepared/blocked/unqualified boundaries.
