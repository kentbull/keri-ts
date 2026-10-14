# End-to-end qualification plan

Owner: roadmap **7**, after the actual runtime/resource/storage/transport paths
work. Preserve the original test topology and benchmark checkpoints. #134's test
reorganization is complete; use the maintained inventory, not its historical count.
The [reference inventory](REFERENCE_ENVIRONMENTS.md) owns environment/pin closure.

## Review units

1. Audit ordinary/macOS/local reference pins and actual imports.
2. Audit extended and embedded DID Webs environments; qualify applicable upgrades
   or document the retained historical target. Split independent environments.
3. Execute the complete maintained inventory and report failures/skips.
4. Run the approved repeated production-path benchmarks and report observations.
5. Publish the explicit parity matrix after affected Mapper checks are rerun.

Use small pin/fix/evidence PRs under the [roadmap](../PARITY_ROADMAP.md); findings
may require additional narrowly scoped fixes. Large raw observations can be
reviewed as linked artifacts with compact provenance/results, not committed
transcripts. This does not reduce the required matrix or turn failed cases green.

## Test inventory and execution

Run every maintained target in `scripts/ci/keri-test-suites.ts`, including manual
delegation and witness endurance, plus CESR and Tufa suites. `test:audit` proves
ownership, not execution. Preserve assertions and participant topology; repair
discovered defects in focused dependent PRs. Failed/skipped cases are unqualified.

Prefer maintained scenarios and extend their smallest relevant assertions.
New integration/end-to-end tests require strong justification: identify the
missing happy path or defect boundary, why existing coverage cannot exercise it,
and ongoing maintenance value in the PR. Exploratory qualification probes may
stay uncommitted; record exact commands/revisions/results without adding a
permanent harness by default. Apply the same proportionality to unit tests.
Do not weaken current assertions, remove participants or skip maintained targets
to meet PR size goals. Tests and fixtures count toward the 300–500-line target.

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

Reference gaps are classified using the [upstream registry review](../../reference/credentials/UPSTREAM_REGISTRY_GAPS.md).
Qualify our implemented behavior without waiting for absent upstream processing.
Current main `71438328` adds schema hardening (#1713); assess this delta separately
from frozen `927c0cb8` evidence and record any unqualified newer behavior.
