---
---

Release tooling only, no package release impact. The release train now dispatches each package's own npm release workflow (the npm trusted publisher) with the tag and waits for it, instead of calling the shared workflow itself, which npm does not accept as a trusted publisher. The per-package workflows gain tag, wait_for and train_id dispatch inputs.
