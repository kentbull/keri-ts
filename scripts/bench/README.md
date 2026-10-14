# Progressive CESR qualification

The corpus generator keeps one reusable ESSR item and a bounded output chunk,
not the aggregate transfer. It uses independent byte encoding so a broken
production encoder cannot prevent construction of a valid large fixture.
Small cross-version/domain tests validate its counts and payload hashes.

Run each case in a fresh Deno process:

```sh
python3 scripts/bench/run-cesr-benchmark.py --output /tmp/cesr-baseline.jsonl
```

Options select aggregate MiB, item/chunk KiB, nesting, genus, binary input,
repeats, timeout, and RSS limit. Defaults run only two observations: 16/256 MiB,
1 MiB items, one GenericGroup and one fresh process per volume. The manual hosted
target uses the same pair. Larger transfers, other dimensions and repeats remain
explicit options for a concrete investigation, not an automatic release matrix.
Every yielded ESSR item must match its independent SHA-256 oracle.

The JSONL report contains the exact source revision, corpus manifest and hashes,
Deno/V8/TypeScript versions, machine metadata, first-frame latency and bytes
received, throughput, observed memory, exit status, and failures. External
100 ms RSS sampling can observe peaks while synchronous parsing blocks the
event loop; it is sampled evidence, not an exact allocation high-water mark.
Source generation and digest verification are included in worker time. Corpus
construction and process startup are excluded from worker elapsed time but
included in supervisor wall time. Reports expose both.

This initial harness is parser-only and synthetic. It does not claim encryption,
signature verification, network, disk, or consumer qualification. Later phases
add those paths and compare them separately. Failures and killed processes have
no throughput result. A fast rejection is never a performance improvement.

Preserve historical parser checkpoints and raw runs without automatically
rerunning them. Production transport/crypto/storage observations are a separate
path in the [qualification plan](../../docs/plans/qualification/QUALIFICATION_PLAN.md).
Small token-boundary and byte-at-a-time tests belong in ordinary CI; repeated
signature verification at every possible two-chunk split is unnecessary.
Large benchmarks and endurance tests are manual-only qualification: the
maintainer may select `essr-qualification` in **KERI Extended Interop**. Raw JSONL
evidence is uploaded even when a case fails; both extended job caps stay 15 minutes.
This job has no PR trigger, is not a dependency of the PR stage gate, and must
not be configured as a required check for merging to master.

The phase sequence is: baseline; safe decoding; lifecycle/ownership contract;
byte cursor; generator traversal; payload sinks; streaming ESSR; recipient
decryption; durable references; HTTP ingress; runtime/egress; final qualification
and removal of the superseded parser. No protocol version compatibility is cut.
