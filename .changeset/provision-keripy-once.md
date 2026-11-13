---
---

Test tooling only, no release impact. The pinned KERIpy venv and the did-webs-resolver checkout and venv under `~/.cache/tufa-interop` are now built once by the group runner before any test file starts, and their builders take a cross-process cache lock, so two interop files running as concurrent processes no longer race to create or delete the same venv.
