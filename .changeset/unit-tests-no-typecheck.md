---
---

Test tooling only, no release impact. The group runner starts `deno test` with `--no-check`, because every invocation re-type-checked the whole module graph (about 3 s for one file, and the runner starts one process per file in the serial suites). `keri-ts`'s `deno task check`, which the static-checks job runs, now also checks `test/integration` and `test/manual`, so test files are still type-checked once per PR.
