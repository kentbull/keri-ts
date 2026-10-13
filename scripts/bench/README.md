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
repeats, timeout, and RSS limit. The default grid covers 16 MiB through 4 GiB,
4 KiB through 1 MiB items, and zero/one/three generic enclosures. Aggregates
above 1 GiB use multiple legal outer enclosures rather than overflowing a big
counter. Every yielded ESSR item must match its independent SHA-256 oracle.

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

Compare five immutable revisions with identical manifests: untouched parser,
large-input decoding fix, byte cursor, progressive generators, and the complete
transport/crypto/storage path. Preserve raw runs and variance. Small exhaustive
split tests belong in CI; large qualification runs are explicit and bounded.

The phase sequence is: baseline; safe decoding; lifecycle/ownership contract;
byte cursor; generator traversal; payload sinks; streaming ESSR; recipient
decryption; durable references; HTTP ingress; runtime/egress; final qualification
and removal of the superseded parser. No protocol version compatibility is cut.
