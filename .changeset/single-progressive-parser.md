---
"cesr-ts": minor
"keri-ts": minor
"@keri-ts/tufa": minor
---

Remove the synchronous CESR stream engine, feed/flush/reset API, parser event
wrappers, unused KERI CESR re-export stubs, and atomic ESSR conversion adapter. Expose async finite parseBytes
alongside progressive parse; use the same engine for complete KERI records and
streamed grant-file inspection. Shorten benchmark API names to benchmarkParser,
BenchmarkOptions, and BenchmarkResult; countFrames returns the single-run count
directly. Preserve KERI/CESR/ACDC protocol versions.
