# End-to-end qualification plan

Planning constraint: the [accepted simplification](../PARITY_ROADMAP.md) supersedes older
architecture requirements. Concrete owners, one worker model and complete-enclosure
buffering replace speculative frameworks; protocol correctness and real cleanup remain.

Owner: roadmap **7**, after the actual runtime/storage/transport paths
work. Preserve the original test topology and benchmark checkpoints. #134's test
reorganization is complete; use the maintained inventory, not its historical count.
The [reference inventory](REFERENCE_ENVIRONMENTS.md) owns environment/pin closure.

## Review units

1. Audit ordinary/macOS/local reference pins and actual imports.
2. Audit extended and embedded DID Webs environments; qualify applicable upgrades
   or document the retained historical target. Split independent environments.
3. Execute the complete maintained inventory and report failures/skips.
4. Qualify representative real HTTP/TCP paths and actual resource cleanup.
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
for cleanup. Tests and fixtures count toward the roadmap's review size: cohesive
deletion/refactoring PRs may use 1,000–3,000 changed lines.

PR validation follows [explicit test scope](../../reference/PR_TEST_SCOPE.md).
Relevant deterministic regressions may receive exact-head local credit instead
of duplicate CI execution. Select applicable interop/package checks and run the
broad maintained battery about every 20 implementation PRs. Scoped PR checks do
not replace this final full clean-source qualification. Large ESSR, gigabyte
and endurance runs remain local/manual. Only the maintainer dispatches hosted
extended jobs; retain both existing **15-minute** job caps. Do not dispatch them
as part of autonomous continuation. Use identified disposable test stores only.

## Buffered parsing and real transport qualification

The [buffered parser](../cesr/CESR_PROGRESSIVE_PARSER_PLAN.md) supersedes required
16/256 MiB runs, gigabyte matrices, constant-memory plateaus and early delivery
from incomplete GenericGroups. Preserve historical measurements as evidence;
do not rerun them to justify the rejected machinery. Memory and first-message
latency may grow with the complete enclosure. A new performance program requires
a demonstrated workload problem and Kent's explicit decision.

Use representative v1/v2, qb64/qb2, nested, fragmented ESSR and malformed-wire
cases. Verify that no child is delivered until its counted enclosure is complete,
and that a complete enclosed message can reach verified state before TCP EOF.
Parent-owned children remain with their parent; wire chunks are not boundaries.

Exercise actual TCP sockets and HTTP bodies through verification, persistence,
reopen/replay and egress. Retain each distinct slow-consumer, cancellation,
directional error, truncated EOF, half-close and joined-shutdown boundary. Preserve
participant topology, mailbox routing and witness completion semantics. No repeated
cross-product of payload volume and wire format is required. Ordinary progress
and actual resource cleanup remain requirements.

Qualify source Deno and installed tarballs at the advertised Node minimum and
current CI runtime, including dependency, crypto, fetch, CLI and native LMDB paths.
Cover finite/network caller parity, already parsed messages without reparsing,
HTTP framing/auth/method and scoped response consumption. Lower layers do not
receive AgentRuntime, parser option bags or general callback gates.

Record exact code/reference revisions, actual imported modules, runtime and native
dependencies, commands, input/artifact identity and results/failures/skips. Measure
resource use only to investigate an actual concern; do not infer a universal bound
from a few observations. Local drain, HTTP status and live queues do not establish
remote protocol acceptance or durable recovery. DID/OOBI completion requires final
validation. Retained file cleanup is for real storage consumers, not parser stages.

## Final parity report

Classify supported behavior, unfinished processing, intentional divergences,
reference stubs and unqualified claims separately. Include exact PRs/revisions,
runtime configuration, measured envelope, every unresolved failure and its dependency.
Retain explicit historical v1 extensions, native-genus limitations, reference
`xip/pro/bar` stubs, API narrowing and upstream-versus-fork provenance. Re-run
affected checks after the final [Mapper repair](../cesr/MAPPER_PLAN.md).

Reference gaps are classified using the [upstream registry review](../../reference/credentials/UPSTREAM_REGISTRY_GAPS.md).
Qualify our implemented behavior without waiting for absent upstream processing.
The active baseline is `7143832813cac6a394ab1faf9be83bb3372be87c`, including
schema hardening (#1713). Earlier `927c0cb8` results remain historical evidence;
run final qualification against 714 and label retained fork/legacy targets separately.

## Removal-specific release gates

Verify no shared accounting APIs, aliases, formula tests or retired store creators
remain in source or built declarations. Test current supported state and actual
cleanup; no old-version keri-ts data or new-to-old compatibility tests. The [graduated disclosure matrix](GRADUATED_DISCLOSURE_INTEROP.md) requires
pairwise directions, complete apply/offer-through-admit conversations, dedicated
spurn cases, chained credentials/edge operators and multiple blinded/revealed
attributes. A standalone apply/grant probe does not close that gate. Current
KERIpy interop remains mandatory: live graduated disclosure and KRAM in both
directions, single-signature and multisig, with witnesses and mailboxes. Frozen
fixtures or legacy ACDC cases cannot substitute for that topology. KRAM downstream
failure must follow KERIpy's acceptance boundary, not an application ack protocol.
