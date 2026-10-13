# Incremental KRAM intake plan

Owner: roadmap **3f**, within [exchange admission](EXCHANGE_ADMISSION_PLAN.md).
K1–K6b are merged through #184: storage, time, policy, snapshots and authentication
helpers exist; optional runtime intake remains guarded pending K7–K10.
[#172][snapshot] at `04178add` preserves the implementation and its observations;
it is being superseded by this review sequence, not merged as one large PR.

## Review units

Each unit targets at most 300–500 added or removed lines, including tests,
fixtures, scripts and docs. Smaller changes are welcome. Stack dependent units on their
predecessors; K1–K3 may proceed independently in parallel. These are acceptance boundaries; revise a boundary before publishing
if its complete, coherent diff would exceed the target.

| Unit | Concern                     | Focused evidence                                             |
| ---- | --------------------------- | ------------------------------------------------------------ |
| K1   | Raw pathed storage          | Binary identity, order, deduplication and reopen             |
| K2   | Shared microsecond time     | Existing registry cutoffs and exact boundaries               |
| K3   | Cache policy                | Selection, exemptions, staged changes and reopen             |
| K4   | Durable partial factors     | Sender/foreign separation, limits and encoding               |
| K5   | Nested snapshots            | Borrowed input, owned hydration and joined disposal          |
| K6a  | Source authentication       | Last-source precedence and exact missing-state queries       |
| K6b  | Signature normalization     | Current sender pools and independent foreign proofs          |
| K7   | Timeliness/replay decisions | Inclusive windows, xid lifetime and receipt time             |
| K8a  | Atomic partial staging      | Pooling, rotation and cache/factor/snapshot publication      |
| K8b  | Ready handoff lifecycle     | Failed delivery, frozen receipt time and joined cancellation |
| K9   | Cache pruning               | Finite passes, cursor release and final xid removal          |
| K10  | Runtime/HTTP wiring         | Existing real workflows and downstream ownership             |

K1–K3 introduce independently usable storage/time/policy facilities. K4–K5
introduce tested persistence and ownership operations. K6a–K9 supply processing
before K10 enables optional intake. K6a/K6b/K7 are complete internal decision
helpers; K8a stages real partial state and K8b owns the consumption lifetime.
Introduce no public Kramer intake until those paths are complete. No partial
stage should expose runtime KRAM
as complete, or require a placeholder processor. Keep normal refusals typed;
cancellation, I/O, corruption and programming failures propagate.

## Evidence preservation

Use `04178add` as the recoverable donor, not as newly verified merge evidence.
Redistribute its semantic oracle cases with their owning units, preserving exact
wire commitments, cache values, source queries and participant topology. Keep
independent frozen expectations independent of TypeScript results. Named shared wire/KEL/cache literals may remove
actual repetition while keeping
all 29 intake, four exemption and two retention observations explicit. Do not
hide bulk by minifying fixtures or replacing readable data with opaque blobs.
Budget K6a/K6b/K7 at roughly 250–400 total changed lines each, K8a at 350–450,
and K8b at 250–400, including focused evidence. These are planning estimates;
measure the actual diff before publication and split again if necessary.

Prefer extending existing test files. Introduce a maintained fixture generator
or integration test only when it fills a demonstrated coverage gap and its
maintenance value justifies the diff. Exploratory Python/TypeScript probes can
remain uncommitted; retain their commands, revisions and results as evidence.
Existing runtime and HTTP tests should receive the smallest necessary regression.

Inspect frozen `core/kraming.py`, its callers and tests at
`927c0cb8794d7c84fc17143c67df64aab9deda6c`. Verify actual imported modules for
oracle runs. Audit missing source references above the database's safe-integer
range: they must not silently permit signature fallback or lose query precision.

## Final KRAM gate

Require partial/repeat/complete/replay, rotation, last-source precedence,
nontransferable and indexed signatures, foreign proof independence, exact missing
state cues, inclusive microsecond boundaries, xid opening/lifetime, durable
receipt time, and safe configuration transitions. Prove nested evidence survives
retry/reopen until its parent route consumes it; children remain independently
unaccepted. Verify cancellation joins reads and disposal before freeing capacity,
with no premature durable publication and retry after failed downstream handoff.

K10 must preserve sender allow/deny, OOBI verification and HTTP authorization.
Only after these gates may the roadmap call optional KRAM implemented. Per-instance
busy/size guards do not establish a shared runtime budget. Whole-row allocation
and unbounded consumed-work scans retain their phase 4/5 owners. `xip/pro/bar`
remain frozen-reference processing stubs even when intake understands their bodies.

V2 registry foundations proceed alongside this sequence; dependent IPEX
presentations require both those foundations and receiver-observed KRAM cutoffs.

[snapshot]: https://github.com/kentbull/keri-ts/pull/172
