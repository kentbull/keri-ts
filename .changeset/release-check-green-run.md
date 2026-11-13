---
---

Release tooling only, no package release impact. The shared npm release workflow now decides in a plan job whether the package's release check is needed: a recorded green PR Stage Gate run (push or workflow_dispatch) on the exact commit or an identical tree that covered the package's unit shards skips it; otherwise it runs sharded with the PR gate's unit shards.
