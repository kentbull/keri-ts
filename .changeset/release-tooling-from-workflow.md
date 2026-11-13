---
---

Release tooling only, no package release impact. The shared npm release workflow runs the release plan, check runner and dependency verification from the workflow's own commit, checked out beside the tag, while building, testing and publishing the tag's content, so tags older than the tooling can use the release train and the green-run skip. Tags whose trees lack the current suites run their own serial check.
