# Progressive Parser Execution Plan

## Status

Approved for implementation on 2026-10-12. This document records the work and
acceptance gates; it does not claim any phase is complete. Update the phase
ledger with PR links and immutable verification evidence as work lands.
[ADR-0012](../../adr/adr-0012-progressive-nested-parser.md) and the
[target contract](CESR_PROGRESSIVE_PARSER_CONTRACT.md) govern the result.

The workload is many smaller ESSR messages in large aggregate transfers. Memory
must depend on admitted active messages and bounded queues, not transfer size.
Support for arbitrary multi-gigabyte individual sealed messages is not assumed.

## PR sequence

| Phase | Cohesive change                                                      | Required evidence before completion                                                                | Status                                |
| ----- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1     | Streaming benchmark source and untouched baseline; no parser changes | Immutable commit/runtime/corpus manifest; correctness oracle; bounded isolated runs                | Pending                               |
| 2     | Large byte-to-text and base64 correctness; exact token decoding      | 1 MiB+ values, small-token/large-tail cases, both domains; decoding-fixed atomic baseline          | Pending                               |
| 3     | Progressive contract, ownership, limits, and execution plan          | Accurate distinction between current behavior and accepted target                                  | This document; implementation pending |
| 4     | Segmented input cursor and bounded views                             | No accumulated suffix copying; bounds, split headers, cancellation; cursor checkpoint              | Pending                               |
| 5     | Async generator frame traversal with `yield*`                        | Early GenericGroup children, exact single-frame enclosures, scopes, partial failure                | Traversal implemented                 |
| 6     | Payload sinks, reopenable references, and bounded manifests          | Backpressure, stage ownership, finish/abort, runtime filesystem boundary                           | Pending                               |
| 7     | Progressive ESSR attachment reads and incremental digest             | Both count models/domains; no retained raw envelope or unbounded item list                         | Parser payloads implemented           |
| 8     | Bounded recipient decryption and explicit ciphertext retention       | Logical-message limits, authentication before plaintext storage, unchanged crypto wire format      | Pending                               |
| 9     | Durable payload storage and reopenable consumers                     | `.essrs` compatibility, escrow/replay, file/DB crash recovery, orphan cleanup                      | Pending                               |
| 10    | HTTP/file ingress with end-to-end backpressure                       | No whole-request read on streaming routes; cancellation/EOF propagation; real HTTP test            | Pending                               |
| 11    | Runtime consumption, forwarding, and egress                          | No hidden bulk joins/arrays; streaming serialization and KERIpy interop                            | Pending                               |
| 12    | Final qualification and removal of the old production path           | Complete benchmark/report; old engine, aliases, and compatibility-only tests removed; docs updated | Pending                               |

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
one test cleanup/reorganization PR against current master and leave it open for
human review. Revalidate the side-chat audit against the new code, remove only
proven duplication or tests without a production contract, retain protocol and
resource-lifecycle regressions, and simplify test scheduling without hiding
coverage. Keep production behavior unchanged in that PR.

Run the complete maintained test inventory, including all manual and long-running
targets, using the local KERIpy main checkout at
`927c0cb8794d7c84fc17143c67df64aab9deda6c`. Verify the harness actually imports
that checkout. Record every run, skip, failure, topology, and duration. Heavy
qualification remains outside required merge CI.

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
benchmarks, gigabyte transfers, and endurance tests run exclusively through the
manually dispatched KERI Extended Interop workflow alongside other long-running
qualification targets. They are not dependencies of the PR stage gate and must
never become required checks for merging to master. Run and preserve their
evidence for this implementation goal without adding them to the testing
critical path. Performance claims name their checkpoint and workload;
parser-only measurements do not establish the full runtime's memory bound.
