---
---

Release tooling only, no package release impact. A pushed package tag whose annotation carries a `Release-Train: yes` line is skipped by its per-package workflow so a release-train run can release it without overlap.
