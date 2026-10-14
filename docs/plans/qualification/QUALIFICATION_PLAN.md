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
4. Run two production-path scale observations and report their measured envelope.
5. Publish the explicit parity matrix after affected Mapper checks are rerun.

Use small pin/fix/evidence PRs under the [roadmap](../PARITY_ROADMAP.md); findings
may require additional narrowly scoped fixes. Large raw observations can be
reviewed as linked artifacts with compact provenance/results, not committed
transcripts. Retain distinct acceptance and failure checks; remove redundant permutations.

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
Delete redundant tests when a retained case proves the same boundary. Preserve
protocol assertions and participant topology; do not substitute name-filtered skips
for cleanup. Tests and fixtures count toward the 300–500-line target.

Fast deterministic regressions remain in required merge CI. Large ESSR, gigabyte
and endurance runs remain local/manual. Only the maintainer dispatches hosted
extended jobs; retain both existing **15-minute** job caps. Do not dispatch them
as part of autonomous continuation. Use identified disposable test stores only.

## Minimum production observations

The reduced release gate replaces the previous 24 runtime trials and automatic
gigabyte/repeat matrix. Run the final real HTTP→verification→plaintext storage→
reopen/replay path once at **16 MiB** and once at **256 MiB**, using fixed 1 MiB
logical messages, 64 KiB input chunks and the same policy/identity cardinality.
The small run proves the full path; the 16-fold larger run checks in-flight growth.

Use existing small cases for v1/v2, qb64/qb2, nesting, fragmented ESSR, limit
refusal and actual TCP callers. Retain one case per distinct slow-consumer,
cancellation, directional failure or shutdown boundary; do not repeat the same
failure for every volume, wire format and host. Signed independent GenericGroup
early usability must still be proved on real HTTP and TCP. Parent-owned nested
children are a different boundary.

Generate corpora incrementally outside the measured path; no transfer-sized
arrays. Keep each sealed message within admission limits. Use fresh processes
and explicit budgets. Report individual observations without statistical
variance or throughput claims beyond the measured envelope. Repeat or enlarge
only to resolve a concrete anomaly; 1/4 GiB qualification is deferred.

Preserve historical parser checkpoints and raw results without rerunning them
automatically. Their parser-only timings are separate from the production path.

## Measurements and provenance

Record exact source revisions, interpreter/runtime/dependencies, actual imported
modules, machine, commands, policy overrides, corpus/representation hashes,
durations, failures/skips and individual observations. Measure:

- First parsed child and bytes received; first verified usable child separately.
- Throughput, CPU and elapsed time; peak RSS, heap, external/native crypto memory.
- Retained-byte high water, queue/tree counts, active decryptions, metadata,
  open resources, storage and cleanup. Separate mapped-file residency.

Acceptance requires bounded in-flight credit as aggregate bytes rise
under fixed policy, real backpressure, durable replay and usable independent
GenericGroup children before transfer completion. No predetermined speedup is
promised. Two observations establish a measured envelope, not a statistical
memory plateau or universal size guarantee. Earlier parser-only 4 GiB observations
do not qualify the full runtime.
This is an in-flight guarantee. Keep accepted-state cardinality fixed in the
scale comparison; use existing evidence for increasing identifiers/state and report
resident cache growth. Existing KERIpy-style accepted-state APIs are preserved;
eviction/public borrowing redesign is deferred. Do not subtract unexplained
growth or promote in-flight credit into a total-RSS claim. Store/escrow reopen
and existing payload-staging recovery checks do not imply new delivery durability.

The next-release [transport S9 gate](../runtime/TRANSPORT_PLAN.md) uses real TCP
sockets and HTTP bodies, not a parser-only source substitution. Include signed
enclosed acceptance before client EOF, fragmented multi-message connections,
independent GenericGroup usability, concurrent stalled peers, slow reads/writes,
partial delivery, cancellation, truncated EOF, shutdown and half-close deadline
expiry. Measure both parsed and verified-usable latency at the application state
boundary. Verify source pulls, pending bytes/items, credit and open handles plateau;
report kernel/native buffering separately. Exercise source Deno and packed Node.
Qualify installed tarballs at the advertised Node minimum as well as the current
CI runtime. Transport promises use the older supported API; that repair alone
does not qualify dependency, crypto, fetch or CLI compatibility at the minimum.
Reuse maintained cases once per distinct boundary, not another full
cross-product. Include finite/source caller parity, parsed-frame input without
reparsing, HTTP request framing/auth/method and scoped response consumption.
Keep mailbox/default routing and explicit duplex evidence distinct.
Reconcile the reference-backed TCP/HTTP messenger, direct TCP and mailbox SSE
callers with KERIpy 714. Qualify actual callers under slow sinks/cancellation and
shared services in both hosts; record framing, completion and joined-stop evidence.
Upstream finite collection is permitted. Further stack-wide artifact, export,
JSON and cache conversion is deferred; separately label already merged TS additions.
Shared-engine tests alone leave a required reference-backed caller unqualified.
Streaming intake must not report DID/OOBI completion before their final checks.
Reopen/retry evidence must identify the durable owner; a live delivery queue or
local socket drain does not prove recovery or remote acceptance.

## Final parity report

Classify supported behavior, unfinished processing, intentional divergences,
reference stubs and unqualified claims separately. Include exact PRs/revisions,
default policy, measured envelope, every unresolved failure and its dependency.
Retain explicit historical v1 extensions, native-genus limitations, reference
`xip/pro/bar` stubs, API narrowing and upstream-versus-fork provenance. Re-run
affected checks after the final [Mapper repair](../cesr/MAPPER_PLAN.md).

Reference gaps are classified using the [upstream registry review](../../reference/credentials/UPSTREAM_REGISTRY_GAPS.md).
Qualify our implemented behavior without waiting for absent upstream processing.
The active baseline is `7143832813cac6a394ab1faf9be83bb3372be87c`, including
schema hardening (#1713). Earlier `927c0cb8` results remain historical evidence;
run final qualification against 714 and label retained fork/legacy targets separately.
