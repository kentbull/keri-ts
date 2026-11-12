---
---

Test-only fix: arm the child-lifetime guard signal handlers before it spawns its child, removing an intermittent orphan and exit-code race in guarded test subprocesses.
