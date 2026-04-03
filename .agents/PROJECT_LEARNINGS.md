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

| Topic                          | File                                                                    | Scope                                                                        |
| ------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| CESR Parser                    | `.agents/learnings/PROJECT_LEARNINGS_CESR.md`                           | Parser architecture, state machine contract, parity, binary handling         |
| Crypto Suite                   | `.agents/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md`                   | Primitive semantics, key material, signing/verification behavior and interop |
| KELs                           | `.agents/learnings/PROJECT_LEARNINGS_KELS.md`                           | Event-log/state-transition work, DB parity, replay/verification semantics    |
| ACDC                           | `.agents/learnings/PROJECT_LEARNINGS_ACDC.md`                           | Credential issuance/exchange semantics and data-model concerns               |
| Witness/Watcher/Observer Infra | `.agents/learnings/PROJECT_LEARNINGS_WITNESS_WATCHER_OBSERVER_INFRA.md` | Network roles, deployment, ops/interoperability notes                        |

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
   `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md`;
   parser-adjacent changes should preserve KERIpy parity and contract-to-test
   traceability.
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
17. `Habery` now eagerly reloads persisted habitat records on open, the
    local-store Gate B visibility slice (`tufa list` / `tufa aid`) is wired into
    the interop harness, and live Gate C compatibility-mode visibility now
    passes against KLI-created encrypted stores.
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
22. Compatibility-mode visibility is now a demonstrated interop path, not just a
    readonly-open design: `.keri/db` and `.keri/ks` alt tails are supported,
    `list` / `aid` can skip config loading and signator creation, and the live
    interop harness verifies encrypted KLI-store visibility via `--compat`; true
    decrypt/encrypt semantics remain the next real blocker.
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
33. CESR codex reasoning has to respect KERIpy's layering: `Matter` and
    `Indexer` use shared non-versioned base code spaces with semantic subset
    views layered on top, while `Counter` is the distinct genus/version-aware
    table family. Reused literals across semantic subsets are not collisions.
34. Local habitat state is no longer allowed to live only in `Hab.kever`:
    `states.` is now the durable source of truth, `kels.` / `fels.` / `dtss.`
    back reopenable local event state, and `Habery.habs` should remain an
    in-memory reconstruction cache rather than becoming another persisted truth
    source.
35. DB parity changes should ship with maintainer-grade source docs for the new
    record contracts, storage families, and runtime seams; otherwise the code
    may be behaviorally closer to KERIpy while still being too opaque for safe
    future parity work.
36. `Baser` and `Keeper` named-subdb docs are now mirrored store-by-store in
    source, with `reopen()` as the canonical meaning seam because it shows the
    property name, subkey, wrapper type, and tuple/value wiring together; field
    comments are the shorter scan-oriented mirror.
37. PR CI for `master` now has a dedicated stage-gate workflow that runs
    formatting, lint, static quality checks, and tests, and the KERI package
    release workflow installs the same pinned KERIpy CLI before running interop
    tests so GitHub Actions coverage matches local expectations.
38. CI dependency bootstrap now treats cacheability as part of workflow design:
    active GitHub Actions paths restore a shared Deno/module cache, npm cache,
    and, where interop tests run, a KERIpy virtualenv cache keyed by the pinned
    KERIpy Git SHA so expensive setup work is skipped unless dependencies
    actually change.
39. Runtime version-module generation is no longer allowed to infer build
    metadata implicitly from ambient GitHub env vars during checks:
    deterministic `version:check` uses empty metadata by default, while
    artifact-producing CI steps must opt into stamped metadata explicitly.
40. KERIpy LMDB interop depends not just on pinning `lmdb@3.4.4`, but on
    preserving LMDB-js data-format v1 semantics as a CI/runtime contract; the
    KERI workflows should export `LMDB_DATA_V1=true` and rebuild/cache the
    native addon accordingly instead of assuming runner defaults are compatible.
41. The LMDB-js v1-compat rebuild path must avoid
    `npm rebuild ... --build-from-source` on the published package because that
    path invokes a Rollup-based JS rebuild step the CI runner does not provide;
    rebuilding only the native addon via `node-gyp` is the correct contract for
    CI.
42. Once a PR gate grows beyond one cheap job, the real bottleneck is usually
    feedback topology rather than raw runner speed: split static checks, interop
    tests, package smoke, and slower cross-platform coverage into separate jobs,
    but keep one tiny aggregate status job if branch protection already depends
    on a stable check name.
43. CI reproducibility for native-addon library repos means pinning the whole
    bootstrap surface, not just the package graph: exact Deno/Node versions,
    action commit SHAs, explicit environment assertions, and saved built
    tarballs all reduce "works locally, shrugs in Actions" debugging time.
44. Test parallelization needs to follow isolation boundaries, not folder names:
45. KEL state-machine readability improved materially once normal processing
    outcomes became typed decisions instead of exception-driven branch control;
    this is now the preferred porting rule for `Kever`/`Kevery`, escrows, and
    future `Tever`/`Tevery`-style processors. Preserve the split
    `state-machine decides` / `orchestrator applies`, and treat
    `docs/adr/adr-0005-kel-decision-control-flow.md` as the normative contract
    for this family of designs.
46. Cue handling is now an explicit shared-runtime architecture seam, not a
    helper hidden inside commands: `AgentRuntime` keeps the shared root cue
    deck, `Hab.processCuesIter()` owns cue semantics, `processCuesOnce()` /
    `cueDo()` own delivery, and hosts consume structured `CueEmission` values
    instead of raw bytes only.
47. Local location-scheme mutation now has its own KLI-parity command surface:
    `tufa loc add` must feed a signed `/loc/scheme` reply back through the
    parser -> `Revery` -> reply-store path, and local CLI commands should not
    shortcut `locs.` / `lans.` with direct DB writes.
48. KERIpy-style parser family names on their own are not sufficient
    maintainability parity: once `KeriDispatchEnvelope` grew beyond a bootstrap
    subset, the anonymous `{ prefixer, seqner, diger, sigers }`-style element
    objects became architectural debt. The durable rule is to keep the KERIpy
    family names (`tsgs`, `trqs`, `ssgs`, etc.) but promote each family element
    into a named dispatch value object in `core/dispatch.ts`, with CESR
    primitives plus TS-friendly derived getters.
49. Parser-dispatch normalization must follow the actual CESR parser output, not
    an idealized KERIpy class guess: in the current `keri-ts` parser seam the
    ordinal material inside transferable groups and source-seal families arrives
    as compact `NumberPrimitive` values, not fixed-width `Seqner` instances, so
    the runtime dispatch layer should model a shared ordinal union instead of
    forcing an incorrect `Seqner` assumption. DB-core tests can safely use Deno
    module parallelism, but CLI/app tests that mutate `console`, `HOME`, or
    persisted local stores need file-level isolation, and long interop harnesses
    should be split into individually addressable scenarios so one slow parity
    lane does not dominate the whole PR gate.
50. Gate E now has a real shared `AgentRuntime` seam and plan artifact: mailbox
    endpoint auth plus mailbox/agent OOBI generate+resolve work through a
    cue/deck runtime hosted either command-local or by `tufa agent`, but the
    current closure is still a bootstrap slice, not full KERIpy escrow/TEL
    parity.
51. `Matter` and `Indexer` should now be treated as low-level parser/storage
    bases rather than normal semantic construction surfaces: when the code
    already knows it is handling a signer/verfer/diger/siger/cigar/etc., it
    should instantiate and return that narrow subclass directly, while truly
    generic seams stay on parser outputs or explicit `Matter`/`Indexer` bases.
52. `keri-ts` now has a real non-native `Serder` construction/verification seam
53. CESR-native parity work is no longer just a parser concern: `Mapper`,
    `Compactor`, and `Aggor` are now evolving into semantic CESR-native
    primitives, and ACDC top-level `Serder` verification depends on their
    compact/disclose behavior rather than generic `saidifyFields` alone.
54. ACDC parity has a special verification rule that must stay explicit in TS:
    expanded top-level ACDC bodies may carry a `d` derived from the most compact
    variant, so `SerderACDC` must verify compact-form SAID semantics separately
    from "does the visible raw reserialize from the visible SAD?" semantics. for
    JSON/CBOR/MGPK KERI and ACDC bodies, and local habitat inception now
    consumes a `SerderKERI` instead of raw saidify helper output; however,
    CESR-native serder parity and deeper ACDC compactification behavior remain
55. Delegated rotation recovery parity depends on two coupled invariants:
    `fetchDelegatingEvent()` must distinguish original accepted boss lookups
    from current authoritative boss lookups and repair `.aess` when it
    rediscovers accepted delegation chains, and `verifyIndexedSignatures()` must
    carry verified `verfer` material forward so prior-next exposure thresholds
    still work during delegated recovery validation.
    open, so maintainers should not treat this milestone as full `serdering.py`
    closure yet.
56. CESR-native parser hydration is now a stricter KERIpy-parity contract at the
    top-level frame seam: once the parser classifies a native
    `FixBodyGroup`/`MapBodyGroup` as a message body, success means full
    `SerderKERI`/`SerderACDC` hydration and anything less should be a parse
    error. Generic native map/list corpora still belong to lower-level
    mapper/aggor/compactor surfaces, not metadata-only top-level frame bodies.
57. KERI native top-level message bodies are fixed-field only; even a
    message-shaped native `MapBodyGroup` carrying `v`/`t`/`d`/`i` and the rest
    of the expected KERI labels must be rejected by the shared native
    serder/reaper layer. Native map-body top-level semantics belong to ACDC and
    lower-level mapping surfaces, not KERI messages.
58. Digest-code ownership belongs at the CESR primitive layer, not in app code
59. The Gate E runtime root should stay a composition root, not a queue bag:
    shared state such as `hby`, host mode, and the cue deck may live on
    `AgentRuntime`, but topic-local flow state belongs to component-owned
    classes like `Reactor` and `Oobiery`, with durable worklists defaulting to
    KERIpy-style DB stores instead of new root-level in-memory decks. or
    serder-local helpers: `DigDex` stays the canonical codex namespace, but
    `Diger` should own `code -> digest implementation` dispatch so `Saider`,
    `Serder`, and habitat flows can consume digest behavior without carrying
    private hash switches.
60. CESR-native serder parity is now organized around one protocol/version/ilk
    support matrix in `native.ts` instead of a split "hard-coded KERI plus
    separate ACDC layout table" design; parser hydration, `Serdery`, and native
    inhale/exhale should all extend that one matrix rather than adding sidecar
    native branching.
61. ACDC section parity depends on two different identifier rules that must stay
    explicit in TS: top-level compactive ilks hash over the most compact section
    form, while partial section-message ilks keep the visible section expanded
    but still require embedded `$id`/`d`/`agid` values to be computed and
    verified.
62. Long-tail KERI serder parity now includes wrapper accessors, not just raw
    scalar projections: `sner`, `tholder`, `ntholder`, `bner`, and KERIpy-like
    `berfers` typing are part of the subtype contract and should be regression
    tested when serder projection behavior changes.
63. Native KERI route fields are a `Pather` problem, not a `Labeler` problem.
    Even simple semantic routes like `ksn` or `reply` must serialize through
    KERIpy's `Pather(path=..., relative=True, pathive=False)` rules, which
    choose a StrB64/Bytes code family based on the compact path payload. A
    "label-looking" workaround can preserve semantics for some fixtures while
    still breaking byte parity.
64. Native serder construction/verification cannot feed CESR-native raw back
    through non-native `smell()` logic. For native `kind=CESR`, the serder
    already knows `proto`/`pvrsn`/`gvrsn`; it must carry that smellage
    explicitly while validating the byte round-trip instead of trying to sniff a
    self-describing version string that native bodies do not contain.
65. TypeScript literal-overload APIs do not survive boolean forwarding. When a
    caller-facing method like `Hab.sign(..., true|false)` forwards a plain
    `boolean` into an overloaded callee like `Manager.sign(...)`, the narrow
    return-type contract is lost even if the runtime logic is fine. The stable
    fix is to branch before the call and pass literal `true` / `false`, while
    the callee implementation should return explicitly typed homogeneous arrays
    instead of a union-widened `map(...)` result.
66. Maintainer-doc coverage is no longer just a class-boundary rule. The
    broadest ongoing drift risk is exported helper/type/fixture seams and dense
    internal helper ladders; for those areas, grouped family comments and short
    invariant-focused helper docstrings are the preferred pattern, while
    obviously derived constant families such as codex-set blocks can stay
    documented at the grouped block level instead of one symbol at a time.
67. Later KERIpy DB parity now depends on exposing normalized ordinal-wrapper
    APIs before upper-layer event routing arrives: `Komer.cntAll()`, `Suber`
    branch iteration via `getTopItemIter()`, and the non-legacy `OnSuber*` /
    `OnIoDup*` / `OnIoSet*` method families should be the preferred forward
    surface, while older `getOn*` names remain temporary compatibility aliases
    until current local call sites migrate.
68. Ordinal-wrapper call-site migration has to follow the real upstream graph,
    not a blanket rename instinct: current KERIpy has genuinely moved some paths
    such as `fels.` onto normalized `getAll*` iterators, while other paths such
    as `kels.` still legitimately use `addOn()` / `getOnLast()`-style calls.
    When the upstream refactor is uneven, mirroring that unevenness is safer
    than "cleaning up" into invented parity.
69. Maintainer-grade DB documentation now has to cover storage-family methods
    and adapter seams, not just class boundaries. For `LMDBer`, `Baser`,
    `Komer`, `Suber`, and the `On*`/`IoSet*`/`Dup*` families, method docs should
    explain the storage model, hidden suffix/proem behavior, and whether a name
    is the forward parity surface or a temporary compatibility alias.
70. `PathManager` is now explicitly documented as the local adaptation of HIO
    `Filer` responsibilities: shared path derivation, temp/clean/alt-home
    fallback, and reuse/clear policy stay centralized there, while resource
    lifecycles remain with owners such as `LMDBer` and `Configer`.
71. Gate E parity work now has an explicit documentation floor: runtime seams
    such as `AgentRuntime`, `Revery`, `Kevery`, `Hab.reply*`, CLI runtime hosts,
    and cue/deck contracts must ship with source docs that explain DB stores
    touched, cue/escrow side effects, BADA/idempotence rules, and any current
    `keri-ts` divergence from KERIpy. Plan docs alone are not an adequate
    substitute once maintainers start porting behavior cue-by-cue.
72. Gate E runtime turns should stay Effection-native: `processRuntimeTurn()`
    and similar orchestration seams should be `Operation`s, not promise helpers
    wrapped back into Effection. The only legitimate promise-adaptation boundary
    is the real host API edge such as `fetch()` / response-body reads; widening
    that boundary obscures cancellation semantics and can hide bugs like
    aborting a successfully fetched OOBI response before its body is read.
73. The same Effection boundary rule now applies to recent CLI/server glue:
    Commander registration callbacks should stay synchronous if they only
    dispatch selection state, and promise-returning host APIs such as dynamic
    import or `Deno.serve().finished` should be adapted locally inside small
    `action()` helpers rather than spread across `withResolvers()`/`spawn()`
    plumbing or monolithic lifecycle wrappers.
74. If `KeriDispatchEnvelope` is the parser-to-runtime seam, it must mirror the
    full KERIpy parser `exts` accumulation contract rather than only the
    currently consumed bootstrap fields; otherwise every later receipt/query/
    EXN/TEL port will be tempted to bypass the seam and re-parse attachments ad
    hoc.
75. Accepted identifier state in `keri-ts` should now live in one place: the
    live `Kever` cache on `Baser`. `Hab` may resolve a `Kever`, and `Kevery`
    may create/update one, but habitat code should not reintroduce thin
    `states.` projections or hand-written local event logging. Local inception
    must feed signed events through the same `Kevery`/`Kever` acceptance path
    used for remote processing, or the codebase will immediately drift back
    into split-brain state handling.
76. `bt` is the semantic backer-threshold field; `bner` is the wrapper view of
    that field, and `bn` is only a scalar convenience projection. The real
    parity risk is not choosing `bn` versus `bt`, but collapsing the threshold
    to a JS `number` too early in `Kever`/state code. Carry `NumberPrimitive`
    or `bigint`-exact threshold values through validation and state
    serialization, and normalize deprecated intive numeric `bt` inputs in
    `SerderKERI.bner` so the KERIpy compatibility surface stays intact.
77. For `Kever` decision helpers, keep the decision boundary explicit: helper
    functions that run below `evaluateInception()`/`evaluateUpdate()` should not
    return anonymous “almost a decision” unions. Either return a named internal
    plan/input type with one clear purpose, or collapse the helper into the
    decision method so only the public decision seam returns `KeverDecision`.
78. Typed decision families stay readable when both the union variants and their
    payload nouns are explicitly named. Prefer `KeverAccept` /
    `KeverDuplicate` / `KeverEscrow` / `KeverReject` and
    `AttachmentVerified` / `AttachmentEscrow` / `AttachmentReject` over
    anonymous object-literal union members, and prefer field names like
    `transition` and `attachments` over vague transport names like `plan` or
    `atc`.
79. Weighted threshold parity is now a cross-layer contract, not just a CESR
    primitive nicety: `Tholder` owns semantic threshold normalization and
    `satisfy(indices)`, `SerderKERI` must preserve weighted `kt`/`nt` forms
    across JSON/CBOR/CESR-native parsing and makify, durable `KeyStateRecord`
    fields `kt`/`nt` may now be structured threshold expressions instead of
    string-only hex, and both `Kever` and `Revery` should treat
    `tholder.satisfy(...)` as the authoritative signer-threshold check instead
    of reintroducing numeric `parseInt(..., 16)` shortcuts.
80. KERIpy documentation parity for dense state-machine code now includes
    intra-method maintainer comments, not just class/function docstrings. For
    `Kever` attachment-processing paths, `keri-ts` source should explain the
    trust-domain model (`local` vs remote), misfit-before-weaker-escrow
    ordering, witness-threshold staging, and delegation-role semantics at the
    actual decision points, while explicitly calling out any delegation-recovery
    parity that is still not implemented.
81. Signature-suite dispatch is now a CESR primitive-layer contract: concrete
    curve imports belong in `packages/cesr/src/primitives/signature-suite.ts`,
    verification in KEL/reply runtime must flow through `Verfer.verify()`, and
    small indexed “both” signature codes must preserve the implicit
    `ondex=index` rule or prior-next exposure checks will silently fail.
82. The KERIpy mental model is now the intended key-management boundary in
    `keri-ts`: `Signer` owns signing and `.verfer`, `Verfer` owns verification,
    `Salter` owns deterministic signer derivation, and `Manager` should stay an
    orchestration layer over creators, keeper state, AEID policy, and replay.
    When those responsibilities blur, suite drift and keeper-state drift follow
    almost immediately.
83. `Manager.sign({ pre, path })` is now a keeper-addressing API, not a raw
    derivation-path API. `path` means `(ridx, kidx)` for one managed key lot;
    `salty` managers reconstruct signers from persisted keeper parameters and
    must validate them against stored pubs, while `randy` managers use the same
    address only to select the stored signer set. Also: persisted keeper state
    does not retain `temp=true`, so derived salty signing is only reliable for
    normal persisted sequences.
84. The architectural rationale for derived-path signing is now captured in
    `docs/adr/adr-0006-manager-derived-path-signing.md`: treat `Manager.sign({ pre, path })` as keeper-state addressing, preserve KERIpy precedence, do
    not invent deterministic `randy` derivation, and do not add new LMDB state
    just to make the branch work.
85. Non-transferable receipt couples are now a wire/storage detail, not a
    runtime API. Parser/reply/app code should normalize them immediately into
    `Cigar` instances with attached `.verfer`, like KERIpy; LMDB stores such as
    `scgs.` and `ecigs.` may stay tuple-backed as `[Verfer, Cigar]`, but any
    runtime load path must rehydrate that tuple before routing or message
    rebuild sees it.

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
