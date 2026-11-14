---
---

Patch the data-v1 lmdb-js rebuild so closing an environment calls mdb_env_close() and releases its descriptors and maps. Build tooling only; no published package changes.
