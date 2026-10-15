# Incremental KRAM intake plan

Planning constraint: [ADR-0013](../../adr/adr-0013-simple-component-flows.md) requires removal of
application accounting and unsupported delivery durability, without old-version
keri-ts API/data compatibility. Protocol correctness and real cleanup remain.

Owner: roadmap **3f**, within [exchange admission](EXCHANGE_ADMISSION_PLAN.md).
K1–K10 are implemented. They cover
storage, microsecond time, policy, source/signature normalization, durable partial
staging and cache pruning. The added ready/snapshot acknowledgement handoff
is a removal target, not KERIpy parity. The donor [#172][snapshot] remains
recoverable evidence, not a merge target.

## Implemented boundaries requiring composed qualification

| Unit | Boundary                       | Remaining evidence                                |
| ---- | ------------------------------ | ------------------------------------------------- |
| K10a | Optional runtime/HTTP intake   | Final workflow qualification                      |
| K10b | Scoped receipt into EXN escrow | KERIpy receipt timing and cache semantics         |
| K10c | IPEX presentation cutoff       | Actual presentation verification and dependencies |

Remove branded KramReceipt authority and downstream acknowledgement machinery.
Use KERIpy receiver-observed acceptance time and replay/cache semantics; sender
input cannot supply authoritative receiver time. K10c belongs to
the [IPEX plan](IPEX_PLAN.md); child proof, registry and receiver-cutoff checks
are implemented. Their complete maintained workflow qualification
remain open; do not infer completion from isolated receipt/cutoff tests.

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
`7143832813cac6a394ab1faf9be83bb3372be87c`. Verify actual imported modules for
oracle runs. Audit missing source references above the database's safe-integer
range: they must not silently permit signature fallback or lose query precision.

## Final KRAM gate

Require partial/repeat/complete/replay, rotation, last-source precedence,
nontransferable and indexed signatures, foreign proof independence, exact missing
state cues, inclusive microsecond boundaries, xid opening/lifetime, durable
receipt time, and safe configuration transitions. Prove nested evidence survives
supported partial/restart behavior without an added ready snapshot or downstream
acknowledgement. Children remain independently unaccepted. Cancellation joins real
reads and disposal; downstream failure must follow KERIpy acceptance semantics.

Remove kready./kpnd., ready-resume paths, factor/copy credits, body/item quotas and
policy arguments. Keep verified distinct signatures, sender establishment state,
foreign attachment factors and KERIpy replay/timeliness caches and pruning.
No old-version data migration or compatibility tests. Optional intake retains
sender policy, OOBI verification and HTTP authorization. `xip/pro/bar` remain
reference processing stubs even when intake understands their bodies.

Require live KERIpy ↔ keri-ts single-signature and multisig tests with witnesses
and mailboxes. Frozen fixtures alone are insufficient; include replay, refusal,
partial/restart and a downstream failure at KERIpy's actual acceptance boundary.

V2 registry foundations proceed alongside this sequence; dependent IPEX
presentations require both those foundations and receiver-observed KRAM cutoffs.

[snapshot]: https://github.com/kentbull/keri-ts/pull/172
