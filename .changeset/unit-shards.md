---
---

Test tooling only, no release impact. The PR stage gate's `unit-tests` job is now a matrix of concurrent shards (keri-app, keri-runtime, keri-core, tufa, packages) chosen by the plan job, instead of one job that ran every owner in turn.
