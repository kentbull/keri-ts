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

## PR sequence

| Phase | Cohesive change                                                      | Required evidence before completion                                                                | Status                                                      |
| ----- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1     | Streaming benchmark source and untouched baseline; no parser changes | Immutable commit/runtime/corpus manifest; correctness oracle; bounded isolated runs                | Merged [#126](https://github.com/kentbull/keri-ts/pull/126) |
| 2     | Large byte-to-text and base64 correctness; exact token decoding      | 1 MiB+ values, small-token/large-tail cases, both domains; decoding-fixed atomic baseline          | Merged [#127](https://github.com/kentbull/keri-ts/pull/127) |
| 3     | Progressive contract, ownership, limits, and execution plan          | Accurate distinction between current behavior and accepted target                                  | Merged [#128](https://github.com/kentbull/keri-ts/pull/128) |
| 4     | Segmented input cursor and bounded views                             | No accumulated suffix copying; bounds, split headers, cancellation; cursor checkpoint              | Merged [#129](https://github.com/kentbull/keri-ts/pull/129) |
| 5     | Async generator frame traversal with `yield*`                        | Early GenericGroup children, exact single-frame enclosures, scopes, partial failure                | Merged [#130](https://github.com/kentbull/keri-ts/pull/130) |
| 6     | Payload sinks, reopenable references, and bounded manifests          | Backpressure, stage ownership, finish/abort, runtime filesystem boundary                           | Merged [#131](https://github.com/kentbull/keri-ts/pull/131) |
| 7     | Progressive ESSR attachment reads and incremental digest             | Both count models/domains; no retained raw envelope or unbounded item list                         | Merged [#132](https://github.com/kentbull/keri-ts/pull/132) |
| 8     | Bounded recipient decryption and explicit ciphertext retention       | Logical-message limits, authentication before plaintext storage, unchanged crypto wire format      | Merged [#133](https://github.com/kentbull/keri-ts/pull/133) |
| 9     | Durable payload storage and reopenable consumers                     | `.essrs` compatibility, escrow/replay, file/DB crash recovery, orphan cleanup                      | Merged [#137](https://github.com/kentbull/keri-ts/pull/137) |
| 10    | HTTP/file ingress with end-to-end backpressure                       | No whole-request read on streaming routes; cancellation/EOF propagation; real HTTP test            | Runtime integration implemented                             |
| 11    | Runtime consumption, forwarding, and egress                          | No hidden bulk joins/arrays; streaming serialization and KERIpy interop                            | Pending                                                     |
| 12    | Final qualification and removal of the old production path           | Complete benchmark/report; old engine, aliases, and compatibility-only tests removed; docs updated | Pending                                                     |

Phase 9 builds on [#135](https://github.com/kentbull/keri-ts/pull/135), which makes
dispatch/settlement and mailbox batch delivery yield through completion with
explicit mailbox endpoint identity, and
[#136](https://github.com/kentbull/keri-ts/pull/136), which publishes durable
payload references. Exchange integration merged in
[#137](https://github.com/kentbull/keri-ts/pull/137). HTTP/runtime ingress starts
from that merged master; its commit list and review diff contain only ingress.

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

The temporary atomic engine exists only for staged migration. Phase 12 removes
it and obsolete keri-ts API compatibility surfaces. Move semantic regression
coverage to the new API rather than deleting protocol tests. Do not ship two
permanent parser strategies. Consumers also get a convenient async complete-input
API over the progressive engine; synchronous `feed`/`flush` is not retained as a
second implementation. Collection must clean up undelivered owned payloads if a
later frame fails.

## Additional approved review and qualification work

After the open parser PRs through recipient decryption (#129–#133) merge, prepare
one test cleanup/reorganization PR against current master.
Draft [#134](https://github.com/kentbull/keri-ts/pull/134) is prepared and authorized
to merge once the complete maintained local inventory, including pinned-main,
manual, and long runs, passes. Interoperability CI is not an additional merge gate
for this cleanup. Its qualification and harness repairs are tracked separately.
Revalidate the side-chat audit against the new code, remove only
proven duplication or tests without a production contract, retain protocol and
resource-lifecycle regressions, and simplify test scheduling without hiding
coverage. Keep production behavior unchanged in that PR.

Run the complete maintained test inventory, including all manual and long-running
targets, using the local KERIpy main checkout at
`927c0cb8794d7c84fc17143c67df64aab9deda6c`. Verify the harness actually imports
that checkout. Record every run, skip, failure, topology, and duration. Heavy
qualification remains outside required merge CI. Extended interoperability jobs
have a 15-minute cap. Do not manually dispatch workflows during this run; the
user will exercise that CI separately.

Continue the progressive parser sequence after preparing that review PR. Any
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

Execute this sequence after phases 1–12 and their attendant repairs. Reconcile
prepared/merged work before each PR, keep the same plan, and implement only
missing behavior. Synchronous-engine removal and #134's test reorganization
already have owners; do not duplicate them or reshuffle those tests here.
These are approved future obligations, not claims about current parser support.

The initial evidence was keri-ts `517dd4c3e85b15fa0f84ac829c9a7400594cbbd8`
and KERIpy main `927c0cb8794d7c84fc17143c67df64aab9deda6c` on 2026-10-13.
Resolve the applicable upstream main once at this sequence's start and freeze its
full SHA. Record the actual starting TypeScript revision, Python/runtime versions,
import paths, fixture provenance, and every harness pin. Current generation/PR
interop uses `450ae1c`; some runtime harnesses use `98b88cf`. Never label those
older environments current-main parity or chase a moving main during a run.

For #134 qualification, the user separately authorized rebasing the mailbox
implementation onto this frozen upstream revision and publishing an immutable
commit on `kentbull/keripy`. Record that fork commit, upstream parent, mailbox
delta, and actual import path separately from upstream-main evidence. Preserve
the existing `mailbox-impl` branch. Published `mailbox-main-interop` commit
`4b35426fc0b4d2e1d6c8413e6ba1950b87dd0d39` is based on upstream
`927c0cb8794d7c84fc17143c67df64aab9deda6c`, ports the original mailbox commits
`1faba4f2` / `9924fffa`, and adapts their handler to nested messages. The #134
runtime qualification uses this declared fork; protocol-table pins remain
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

### Follow-on PR 2: parent-owned nested message attachments

Regenerate the pinned reference failure: a native signed `xip` parent and two
signed children serialized with `messagize(..., nests=[child1, child2], nested=True, gvrsn=Vrsn_2_0)`. Reference KERIpy returns one parent, its own
signature, and two nests; current TS accepts the flat parent and rejects this
nested form as multiple frames inside `BodyWithAttachmentGroup`. Temporary
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

### Follow-on PR 3: nested runtime processing and serialization

Inspect pinned `processMsg`/`msgProcess` and exchange paths to establish actual
processing order and required verification. Keep structural completion, child
verification, parent verification, exchange acceptance, escrow, and storage
distinct. Parsing a child does not authorize it as an unrelated top-level event.

Carry the tree and its ownership through normalization, dispatch, escrow/retry,
replay, and serialization, preserving each child's evidence and the parent's
commitments. Reuse hydrated primitives and Serders. Acceptance requires real
handlers receiving valid nested messages with correct signatures/order; invalid
child signatures, missing dependencies, malformed children, retries, and duplicates
matching pinned source/specification; round-trip/replay preserving structure and
original evidence; and no failed acceptance publication or payload leak. An
absent required runtime feature gets a narrow dependent PR, never silent omission.

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
