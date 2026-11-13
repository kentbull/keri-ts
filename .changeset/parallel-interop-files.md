---
---

Test tooling only, no release impact. Interop owners whose files share no fixed ports or process-global state (`interop-parity`, `interop-reference-profiles`, `interop-ipex-disclosure`, `interop-delegation`, `interop-witness-main`, `interop-oobi-bootstrap`) now run two files at a time as separate child processes (`processes: 2`). Each concurrent child gets its own slice of the random-port range, and cached KERIpy fixtures are published atomically.
