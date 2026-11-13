---
---

Release tooling only, no package release impact. Adds a `Release train` workflow that resolves each package's latest (or given) tag, drops versions already on npm, qualifies each distinct commit once through the stage gate, and publishes in dependency stages with independent packages in parallel. The shared npm release workflow accepts a tag, waits for dependencies to be visible on npm, checks the built dependency graph, and creates the GitHub release when called from the train.
