# Intermediate parser checkpoints

These parser-only measurements preserve failed checkpoints as well as successful
ones. They include source generation and correctness verification, but no crypto,
network, or durable storage. Compressed JSONL carries the exact clean revision,
runtime, corpus/harness hashes, process budgets, and individual observations.
The host was also used for implementation and targeted tests; these are diagnostic
checkpoints, not a controlled final performance comparison.

| Artifact                                     | Revision                                   | Cases | Interpretation                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decoding.jsonl.gz`                          | `137b58712237e2340f1009943c6fda8bb05c4279` | 72    | Decoding fixes allow larger values. Flat 16/256 MiB cases pass; nested enclosures hit the RSS budget; flat 1/4 GiB cases hit the 30 s budget.                    |
| `cursor-preparation.jsonl.gz`                | `b0a6eb7f5573ada5e022084d88818b9888f7ab74` | 12    | Adding the cursor without changing the engine has no architectural effect: flat 16 MiB passes and nested input hits the RSS budget.                              |
| `generator-before-cancellation-fix.jsonl.gz` | `b7328b0fb71dd3386a3105491f51e78c9ce56fae` | 36    | Early traversal works at 16/256 MiB in all three depths, but a lifetime cancellation promise retains completed pull reactions. 1/4 GiB cases exceed 768 MiB RSS. |

| `generator-fixed.jsonl.gz` | `b8fcb90854c519f05d4085023ea9c2b658a391b5` | 36 | Every 16 MiB through 4 GiB case passes at depths 0, 1, and 3 with the same 768 MiB RSS and 240 s budgets. |

The generator defect was corrected in cursor commit `428773c`. Its fix retains
only the pending read's cancellation waiter. The post-fix checkpoint is included here; final
transport-to-storage qualification is recorded separately; a successful small
case does not establish bounded memory for the complete runtime.

Timeout budgets differ across checkpoints (30 s here for decoding/cursor, 240 s
for generator). Compare successful like-for-like cases; do not treat different
budget outcomes as quantitative speedups. Source order, payload hashes, and wire
hashes remain the correctness oracle.

At 4 GiB with 64 KiB items, sampled RSS stays between 207.9 and 285.0 MiB across all nine observations. These runs overlap ordinary development activity; use them to verify the former memory-budget failures are resolved, not to claim a controlled throughput gain.
