# Untouched parser checkpoint

Measured 2026-10-12 on macOS 26.6.2 arm64. All workers used clean commit
`3654e2b9907c00fd6bd5784f7ece1496724fe3b0`; its production parser is unchanged
from master `b7b43f12f50f06aeaaaecdece79fa148d18df0a4`. The exact harness at that
commit is retained in Git, before subsequent explanatory comments were added.
Raw compressed JSONL includes source and harness hashes, runtime, machine,
workload manifests, independent digest oracle, limits, and individual results.

## Findings

| Input                                    | Aggregate raw payload         | Results across three repetitions                           |
| ---------------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| Text, 64 KiB or 1 MiB items, depth 0/1/3 | 16 MiB, 256 MiB, 1 GiB, 4 GiB | All 72 cases threw a maximum-call-stack RangeError         |
| Text, 4 KiB items, depth 1               | 16 MiB, 256 MiB, 1 GiB, 4 GiB | All 12 cases threw the same RangeError                     |
| Text, 4 KiB items, flat                  | 256 MiB, 1 GiB, 4 GiB         | All nine cases exceeded the 120-second budget              |
| Binary, 64 KiB items, depth 1            | 16 MiB, 256 MiB, 1 GiB        | All nine cases exceeded the 768 MiB sampled RSS limit      |
| Text, 4 KiB items, flat, serial control  | 16 MiB                        | All three completed with correct order and payload digests |

Failed cases did **not** process their requested aggregate volume. They establish
correctness or resource-limit failures, not throughput, memory scaling, or a
speedup denominator. The binary limit is sampled every 100 ms and can overshoot.

The successful serial control measured:

| Metric                            | Median        | Range               |
| --------------------------------- | ------------- | ------------------- |
| Worker elapsed                    | 9.487 seconds | 9.377–9.573 seconds |
| Raw payload throughput            | 1.687 MiB/s   | 1.671–1.706 MiB/s   |
| First frame                       | 32.411 ms     | 31.304–37.442 ms    |
| Bytes received before first frame | 65,536        | 65,536–65,536       |
| Sampled process RSS peak          | 217.39 MiB    | 214.56–227.38 MiB   |

Worker time includes incremental fixture generation and the hash/order oracle;
process startup is reported separately. These are parser-only synthetic ESSR
results, not authenticated exchange, decryption, transport, or storage results.
The initial successful rows in `small.jsonl.gz` overlapped an exploratory binary
run and are excluded from the performance table. `control.jsonl.gz` and
`binary-serial.jsonl.gz` were repeated sequentially in a separate clean worktree.
Ordinary host activity can still introduce timing noise.

## Reproduction

From the measured revision, run these independently (each defaults to three
fresh worker processes per case):

```sh
python3 scripts/bench/run-cesr-benchmark.py --output large.jsonl --payload-mib 16 256 1024 4096 --item-kib 64 1024 --depth 0 1 3 --timeout 30
python3 scripts/bench/run-cesr-benchmark.py --output small.jsonl --payload-mib 16 256 1024 4096 --item-kib 4 --depth 0 1 --timeout 120
python3 scripts/bench/run-cesr-benchmark.py --output control.jsonl --payload-mib 16 --item-kib 4 --depth 0 --timeout 120
python3 scripts/bench/run-cesr-benchmark.py --output binary-serial.jsonl --payload-mib 16 256 1024 --item-kib 64 --depth 1 --binary --timeout 30
```

These commands belong to manual qualification. The one-off
`essr-qualification` target in KERI Extended Interop is excluded from the PR
stage gate and required checks for merging to master. Only the tiny corpus
correctness fixture runs in normal CI.
