---
---

Test tooling only, no release impact. `scripts/ci/keripy_fast_timing.py` shortens the poll intervals and cycle time of the frozen KERIpy peers by monkeypatch when `KERI_TEST_FAST=1`, which `run-keri-test-group.ts` sets for every target except `qualification` and the extended-interop workflow pins off. The interop readiness probes poll every 50 ms, and the demo witnesses are probed together.
