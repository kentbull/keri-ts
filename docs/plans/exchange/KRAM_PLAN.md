# Incremental KRAM intake plan

Owner: roadmap **3f**, within [exchange admission](EXCHANGE_ADMISSION_PLAN.md).
K1–K9 and optional runtime intake K10a are delivered through #204. They cover
storage, microsecond time, policy, source/signature normalization, durable partial
staging, ready handoff and finite pruning. The donor [#172][snapshot] remains
recoverable evidence, not a merge target.

## Current review boundaries

| Unit | Boundary                       | Remaining evidence                                |
| ---- | ------------------------------ | ------------------------------------------------- |
| K10a | Optional runtime/HTTP intake   | Final workflow qualification                      |
| K10b | Scoped receipt into EXN escrow | Durable retry and unchanged first receipt         |
| K10c | IPEX presentation cutoff       | Actual presentation verification and dependencies |

K10b carries completed, nonexempt KRAM receipt authority to Exchanger without a
sender-controlled timestamp override. Private exchange metadata preserves the
first receipt through route escrow, retry, reopen and acceptance. K10c belongs to
the [IPEX plan](IPEX_PLAN.md); presentation processing remains guarded until its
actual child proof, registry and receiver-cutoff checks work together.

Cancellation, I/O, corruption and programming failures propagate. Normal intake
refusals remain typed. Each remaining unit follows the roadmap's 300–500-line or
smaller target and preserves published history.

## Evidence preservation

Use `04178add` as the recoverable donor, not as newly verified merge evidence.
Redistribute its semantic oracle cases with their owning units, preserving exact
wire commitments, cache values, source queries and participant topology. Keep
independent frozen expectations independent of TypeScript results. Named shared wire/KEL/cache literals may remove
actual repetition while keeping
all 29 intake, four exemption and two retention observations explicit. Do not
hide bulk by minifying fixtures or replacing readable data with opaque blobs.

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

Optional intake preserves sender allow/deny, OOBI verification and HTTP authorization.
Its final qualification remains part of the full workflow gate. Per-instance
busy/size guards do not establish a shared runtime budget. Whole-row allocation
and unbounded consumed-work scans retain their phase 4/5 owners. `xip/pro/bar`
remain frozen-reference processing stubs even when intake understands their bodies.

V2 registry foundations proceed alongside this sequence; dependent IPEX
presentations require both those foundations and receiver-observed KRAM cutoffs.

[snapshot]: https://github.com/kentbull/keri-ts/pull/172
