---
---

Test tooling only, no release impact. The pinned candidate and mailbox-fork KERIpy moves to 54cf0a04, which ships a tock registry with fast defaults. `scripts/ci/keripy_fast_timing.py` detects the registry and only sets `KERI_OOBI_RETRY_TOCK=1` there; the monkeypatches remain for the main, 1.2 and 1.3 peers.
