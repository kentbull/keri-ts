# End-to-end qualification plan

Owner: roadmap **7**, after the actual runtime/resource/storage/transport paths
work. Preserve the original test topology and benchmark checkpoints. #134's test
reorganization is complete; use the maintained inventory, not its historical count.
The [reference inventory](REFERENCE_ENVIRONMENTS.md) owns environment/pin closure.

## Test inventory and execution

Run every maintained target in `scripts/ci/keri-test-suites.ts`, including manual
delegation and witness endurance, plus CESR and Tufa suites. `test:audit` proves
ownership, not execution. Preserve assertions and participant topology; repair
discovered defects in focused dependent PRs. Failed/skipped cases are unqualified.

Fast deterministic regressions remain in required merge CI. Large ESSR, gigabyte
and endurance runs remain local/manual. Only the maintainer dispatches hosted
extended jobs; retain both existing **15-minute** job caps. Do not dispatch them
as part of autonomous continuation. Use identified disposable test stores only.

## Repeated benchmark matrix

| Dimension          | Required coverage                                           |
| ------------------ | ----------------------------------------------------------- |
| Aggregate transfer | 16 MiB, 256 MiB, 1 GiB, 4 GiB                               |
| Logical message    | 4 KiB, 64 KiB, 1 MiB, mixed, limit probes                   |
| Structure          | Flat, large GenericGroup, nested groups                     |
| ESSR               | Independent messages and fragmented logical payloads        |
| Input              | 4 KiB, 64 KiB, 1 MiB, irregular partitions                  |
| Wire               | Applicable v1/v2 and qb64/qb2                               |
| Pressure/failure   | Slow sinks, concurrency, cancellation, late malformed child |

Use representative semantic combinations, not an arbitrary full cross-product.
Small correctness fixtures cover exhaustive splits. Generate large corpora
incrementally outside the measured path; no preloaded transfer-sized arrays.
Keep each logical sealed message within its admission limit. Repeat in fresh
processes with explicit time/memory/process budgets and report raw observations
and variance, not only averages. Crashes/limit failures are not throughput results.

Preserve five independent checkpoints: untouched source, decoding-fixed atomic,
cursor/copying fix, progressive generator, complete transport-to-storage runtime.
Do not overwrite historical worktrees or staged benchmark artifacts. Compare
successful order/content/digests; test the target's earlier-child survival on later
failure separately from the old atomic semantics.

## Measurements and provenance

Record exact source revisions, interpreter/runtime/dependencies, actual imported
modules, machine, commands, policy overrides, corpus/representation hashes,
durations, failures/skips and individual observations. Measure:

- First parsed child and bytes received; first verified usable child separately.
- Throughput, CPU and elapsed time; peak RSS, heap, external/native crypto memory.
- Retained-byte high water, queue/tree counts, active decryptions, metadata,
  open resources, storage and cleanup. Separate mapped-file residency.

Acceptance requires retained working memory to plateau as aggregate bytes rise
under fixed policy, real backpressure, durable replay and usable independent
GenericGroup children before transfer completion. No predetermined speedup is
promised. Earlier parser-only 4 GiB observations do not qualify the full runtime.

## Final parity report

Classify supported behavior, unfinished processing, intentional divergences,
reference stubs and unqualified claims separately. Include exact PRs/revisions,
default policy, measured envelope, every unresolved failure and its dependency.
Retain explicit historical v1 extensions, native-genus limitations, reference
`xip/pro/bar` stubs, API narrowing and upstream-versus-fork provenance. Re-run
affected checks after the final [Mapper repair](../cesr/MAPPER_PLAN.md).
