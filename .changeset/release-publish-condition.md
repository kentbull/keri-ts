---
---

Release tooling only, no package release impact. The shared npm release workflow's publish and GitHub release jobs now state their own status condition, so a skipped release check (recorded green run found) no longer skips publication.
