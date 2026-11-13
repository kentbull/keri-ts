---
---

Test tooling only, no release impact. `run-keri-test-group.ts` compiles the Tufa CLI once per interop run and exports it as `KERI_TEST_TUFA_BIN`; the interop helpers spawn that binary instead of `deno run packages/tufa/mod.ts`, which reloads the whole module graph (about 400 ms) on every call. Without the variable the CLI still runs from source.
