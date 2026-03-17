# PROJECT_LEARNINGS (Index)

## Purpose

Top-level routing and durable cross-topic memory for `keri-ts`.

Use this file to:

1. identify current focus areas,
2. locate the right topic learnings doc(s),
3. capture only the highest-signal cross-topic state,
4. apply consistent handoff updates without duplicating topic detail.

## Current Focus

1. CESR parser work is complete enough for upper-layer progress, with a formal
   `GO` completeness decision against the current KERIpy baseline.
2. Phase 2 KERI work is centered on DB parity, key-management, and practical
   `kli`/`tufa` interoperability gates.

## Topic Learnings Index

| Topic                          | File                                                                             | Scope                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| CESR Parser                    | `docs/design-docs/learnings/PROJECT_LEARNINGS_CESR.md`                           | Parser architecture, state machine contract, parity, binary handling         |
| Crypto Suite                   | `docs/design-docs/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md`                   | Primitive semantics, key material, signing/verification behavior and interop |
| KELs                           | `docs/design-docs/learnings/PROJECT_LEARNINGS_KELS.md`                           | Event-log/state-transition work, DB parity, replay/verification semantics    |
| ACDC                           | `docs/design-docs/learnings/PROJECT_LEARNINGS_ACDC.md`                           | Credential issuance/exchange semantics and data-model concerns               |
| Witness/Watcher/Observer Infra | `docs/design-docs/learnings/PROJECT_LEARNINGS_WITNESS_WATCHER_OBSERVER_INFRA.md` | Network roles, deployment, ops/interoperability notes                        |

## Context Pack Policy

At session start:

1. Read `AGENTS.md`.
2. Read this file.
3. Read only the topic doc(s) relevant to the requested task.
4. Read any contract/ADR/plan docs referenced by those topic docs.

This keeps context focused and avoids long-thread drift.

## Compaction Policy

1. Keep this file as a routing layer, not a second full history log.
2. Keep durable cross-topic conclusions here; push topic detail into topic docs.
3. When a topic handoff log grows noisy, roll minor entries into one milestone
   summary instead of preserving every micro-step.
4. Before splitting a topic doc for size, first compact duplicated or stale
   historical detail.

## Cross-Topic Snapshot

1. CESR parser lifecycle behavior is governed by
   `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md`; parser-adjacent
   changes should preserve KERIpy parity and contract-to-test traceability.
2. CESR parser architecture remains intentionally atomic/bounded-substream
   first; incremental nested parsing is deferred behind explicit performance
   evidence.
3. CESR breadth closure is complete across the tracked P2 vector set, and the
   current expectation is to preserve that coverage as a regression floor while
   upper-layer work proceeds.
4. Primitive-first CESR hydration, per-primitive test organization, and
   maintainer-oriented docstrings are in place; future primitive changes should
   keep learner/maintainer readability as a first-class design goal.
5. KERI Phase 2 work is now sequenced around DB parity first, with
   `docs/design-docs/db/db-architecture.md` serving as the cross-topic DB
   invariants reference for KEL/ACDC/infra tasks.
6. DB parity planning artifacts exist and D1 is the active workstream; `LMDBer`
   core parity progressed enough to unblock further Suber/Komer/Baser work, but
   DB work remains parity-first rather than abstraction-first.
7. `kli`/`tufa` interoperability planning has expanded beyond init/incept into a
   usable bootstrap arc including list/aid visibility, service endpoints, OOBIs,
   direct+mailbox communication, and challenge flows.
8. Deno config ownership is graph-wide for local-source workflows; if root or
   `packages/keri` entrypoints load local CESR source, the active config must
   also carry CESR-owned import-map entries.
9. Local `deno install` of `tufa` from repo source is a maintainer path, not the
   primary user path; the supported distribution path remains the npm package
   artifact, and CLI startup now lazy-loads handlers so `--help` and `--version`
   do not pull CESR/LMDB startup work.
10. Formatting policy is explicitly `dprint`-based: CI and release workflows are
    expected to enforce `deno task fmt:check`.
11. The DB architecture contract now includes a maintainer-facing `LMDBer`
    family taxonomy so ordering and multiplicity semantics can be reasoned about
    by storage model rather than by individual method name.
12. The DB architecture contract now explicitly distinguishes native LMDB
    duplicate semantics from synthetic keyspace virtualization, with focused
    `Dup*`/`IoDup*` examples to prevent maintainers from conflating the two.
13. The DB architecture contract now includes an explicit design-rationale
    section for the `OnIoSet*`/`OnIoDup*` two-dimensional model, explaining when
    the abstraction is justified, what it buys higher layers, and where the real
    overengineering risk lives.
14. `packages/keri` test stability currently depends on pinning `lmdb` exactly
    to `3.4.4`; allowing caret drift to `3.5.1` triggered Deno N-API panics
    during app-level DB startup on the current macOS arm64 maintainer
    environment.
15. `lmdber.ts` documentation is now organized by storage family and explicitly
    distinguishes KERIpy parity methods from `keri-ts`-only extensions,
    including the `OnIoSet*` family.
16. `LMDBer` unit coverage is now organized the same way: readable family-based
    tests for lifecycle/plain/`On*`/`IoSet*`/`Dup*` semantics plus a much
    smaller parity-oracle file for reverse mixed-key scans, with the old
    representation-sweep monolith removed.
17. `Habery` now eagerly reloads persisted habitat records on open, and the
    local-store Gate B visibility slice (`tufa list` / `tufa aid`) is wired into
    the interop harness; compatibility-mode visibility remains a separate Gate C
    concern.
18. CESR now has a dedicated maintainer walkthrough and parity matrix for the
    primitive layer, organized by `Matter` / `Indexer` / `Counter` families and
    cross-linked to the parser architecture docs so maintainers can onboard
    without re-deriving the model from source.
19. Local npm/Node execution of `tufa` needs error-shape normalization around
    filesystem permission failures: `@deno/shim-deno` may surface primary-path
    mkdir denials as plain Node-style `Error` objects with `code` values like
    `EACCES`/`EPERM`, so fallback logic for `~/.tufa` must not rely only on
    `instanceof Deno.errors.PermissionDenied`.
20. Local npm/Node execution also cannot assume full `FsFile` parity from
    `@deno/shim-deno`; `syncSync()` may be unimplemented even though
    `syncDataSync()` works, so `Configer` durability paths should use the latter
    for cross-runtime compatibility.
21. Minimal `Suber` / `Komer` foundations now exist and back the active
    bootstrap-path `Baser` / `Keeper` stores; this is enough to stop extending
    the raw-LMDB pattern on the Gate C visibility path, but it is not evidence
    of full `subing.py` / `koming.py` parity.
22. Compatibility-mode visibility now has an honest readonly-open path:
    `.keri/db` and `.keri/ks` alt tails are supported, `list` / `aid` can skip
    config loading and signator creation, and readonly opens no longer try to
    write `aeid`; encrypted reopen semantics and true decrypt/encrypt behavior
    remain the next real blockers.
23. KERIpy-corresponding class ports need source-documentation parity as well as
    behavior parity: when we add or translate a class, we should port its
    maintainer-facing responsibilities and invariants into `keri-ts` source
    docstrings in the same change, not defer them to cleanup work later.
24. `Komer` now supports JSON, CBOR, and MGPK serializer selection at the
    constructor boundary, matching KERIpy's format choices without changing the
    current live-store default away from JSON.
25. Before 1.0, `keri-ts` should optimize for KERIpy parity rather than
    preserving compatibility with older `keri-ts` behavior; local back-compat
    shims that are not needed for KERIpy interop are drift, not safety.
26. KLI interop tests are now expected to run in regular quality checks against
    a real installed KERIpy CLI, not skip opportunistically; isolated test
    `HOME` values should preserve the active `DENO_DIR`, KLI resolution should
    use the real executable path when pyenv shims are on `PATH`, and CI should
    install a pinned KERIpy commit before test jobs so interop coverage is
    deterministic.
27. `Komer` parity now assumes the KERIpy `KomerBase -> Komer` split exists in
    `keri-ts`; future `IoSetKomer` / `DupKomer` work should extend that base
    instead of re-flattening object-mapper behavior.
28. Exact KERI CBOR byte parity is now an explicit cross-project rule: source
    code should use the shared CESR CBOR codec instead of direct `cbor-x`
    imports, and the encoder is configured to match KERIpy `cbor2` preferred
    map-size bytes rather than `cbor-x`'s fixed-width object-map default.
29. LMDB wrapper generics are now an explicit parity contract: `Komer`, `Suber`,
    and CESR-backed storage wrappers should use the narrowest real KERIpy value
    type, and mixed-primitive stores should be modeled with explicit tuple
    aliases rather than widened `Matter`-level fallbacks.
30. CESR code-table parity now requires generated semantic codex families, not
    just raw size/name tables: primitive validators should consume the shared
    KERIpy-derived matter/indexer codex sets, and TS-only counter-group families
    should live in one shared module so `Prefixer`-style drift cannot hide
    behind local string sets.
31. CESR codex organization is now explicitly dual-layer: generated KERIpy
    parity codex objects such as `MtrDex`, `PreDex`, `DigDex`, and `IdrDex` are
    the primary source of truth, and `codex.ts` helper sets are derived
    readability views rather than a competing authority.
32. The dual-layer codex rule also now covers non-cryptographic and
    singleton-ish CESR primitives: `Dater`, `Seqner`, `Ilker`, `Verser`,
    `Noncer`, and `Traitor` should validate through canonical codex exports or
    derived helpers, and trait semantics should come from generated `TraitDex`
    parity rather than local string lists.
33. Local habitat state is no longer allowed to live only in `Hab.kever`:
    `states.` is now the durable source of truth, `kels.` / `fels.` / `dtss.`
    back reopenable local event state, and `Habery.habs` should remain an
    in-memory reconstruction cache rather than becoming another persisted truth
    source.
34. DB parity changes should ship with maintainer-grade source docs for the new
    record contracts, storage families, and runtime seams; otherwise the code
    may be behaviorally closer to KERIpy while still being too opaque for safe
    future parity work.
35. `Baser` and `Keeper` named-subdb docs are now mirrored store-by-store in
    source, with `reopen()` as the canonical meaning seam because it shows the
    property name, subkey, wrapper type, and tuple/value wiring together; field
    comments are the shorter scan-oriented mirror.
36. PR CI for `master` now has a dedicated stage-gate workflow that runs
    formatting, lint, static quality checks, and tests, and the KERI package
    release workflow installs the same pinned KERIpy CLI before running interop
    tests so GitHub Actions coverage matches local expectations.
37. CI dependency bootstrap now treats cacheability as part of workflow design:
    active GitHub Actions paths restore a shared Deno/module cache, npm cache,
    and, where interop tests run, a KERIpy virtualenv cache keyed by the pinned
    KERIpy Git SHA so expensive setup work is skipped unless dependencies
    actually change.
38. Runtime version-module generation is no longer allowed to infer build
    metadata implicitly from ambient GitHub env vars during checks: deterministic
    `version:check` uses empty metadata by default, while artifact-producing CI
    steps must opt into stamped metadata explicitly.
39. KERIpy LMDB interop depends not just on pinning `lmdb@3.4.4`, but on
    preserving LMDB-js data-format v1 semantics as a CI/runtime contract; the
    KERI workflows should export `LMDB_DATA_V1=true` and rebuild/cache the
    native addon accordingly instead of assuming runner defaults are compatible.
40. The LMDB-js v1-compat rebuild path must avoid `npm rebuild ... --build-from-source`
    on the published package because that path invokes a Rollup-based JS rebuild
    step the CI runner does not provide; rebuilding only the native addon via
    `node-gyp` is the correct contract for CI.

## New Thread Kickoff Template

```text
Use AGENTS.md startup protocol.
Read PROJECT_LEARNINGS.md and relevant topic learnings docs.
Summarize current state in 10 bullets.
Then do task: <TASK>.
```

## End-of-Task Handoff Template

```text
### YYYY-MM-DD - <Task Title>
- Topic docs updated:
  - <topic file path(s)>
- What changed:
  - ...
- Why:
  - ...
- Tests:
  - Command: ...
  - Result: ...
- Contracts/plans touched:
  - ...
- Risks/TODO:
  - ...
```
