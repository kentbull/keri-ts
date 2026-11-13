# Infrastructure and qualification learnings

## Honest test evidence

The maintained inventory in scripts/ci/keri-test-suites.ts owns files; the runner
enforces missing/duplicate/unowned coverage. Audit is not execution. Parallelize
only truly isolated files; runtime/server/stateful/interop lanes stay serial until
their assumptions change. Preserve participant topology and distinct semantic
assertions. Delete redundant permutations; byte-at-a-time parsing already visits
each token boundary, so do not reverify signed trees at every two-chunk split.
Large-input regressions need to exceed the faulty threshold, not repeat
increasingly large allocations. Partition checks use bytewise input plus selected
coalesced/semantic edges, retaining version/domain/error facts and blocked-source
assertions. Configurable integration limits may be small when native threshold
behavior has its own retained regression.

Witness harnesses use temporary copied configs and bind-checked randomized ports,
with a shared exclusion set for all HTTP/TCP endpoints in each topology.
Persistent witness preparation and serving bind primary and fallback LMDB/Configer
roots inside each actual fixture subprocess; changing HOME alone leaves writable
`/usr/local/var` stores outside cleanup. The existing witness fixture delegates
init/incept to the verified CLI module and preserves its exit status. Compatibility
inspection uses the same explicit root; the existing witness case checks actual store
files, including the internal unbased witness Reger.
Startup failures join tracked children before removing only harness-created roots.
Track children before readiness waits and report their output on startup failure.
Probe OOBIs, not nonexistent health endpoints; resolve both controller and witness
OOBIs. Proved controller/witness combinations do not imply untested KLI replacement
or arbitrary topology. The six-witness soak is manual, outside merge CI.
A default KLI inception may poll before the witness knows its KEL. The pinned
KERIpy Poller reconnects after 30 seconds and retries one second later; its outer
command deadline must include that cycle. Preserve authorization and full receipt
assertions rather than treating the arrival order as a different topology.
Finite Python witness preparation uses Oobiery and the current Receiptor's normal
receipt endpoint. Legacy WitnessReceiptor expects mailbox receipt polling.
Stored clone replay includes verified witness receipts; msgOwnEvent does not.
KERIpy's lazy Kever map needs membership/indexed access after reopen; dict.get
can bypass hydration and falsely report missing accepted state.

Verify Python interpreter, revision and actually imported modules. Console entry
exit status matters: python -m can ignore main's return. Explicitly select body
protocol and replay genus. Current witness CLI lacks protocol selection, so v1
fixtures use public Habery/setupWitness APIs. Fork-on-main and upstream evidence
remain separate. Source-root startup probes compare every loaded KERI module to
pinned Git bytes; installed hashes alone do not prove Git equivalence. Qualify
command-specific lazy imports separately. macOS PATH and shared helpers select
one explicit fork checkout; DID Webs retains a separate dependency environment
in the [reference inventory](../../docs/plans/qualification/REFERENCE_ENVIRONMENTS.md).
Release profiles in `keripy-reference.json` select independent main/1.2/1.3
checkouts through `KERIPY_INTEROP_PROFILE` and explicit root/interpreter paths.
Their CLI/version and export-genus differences are test-launch data, not runtime
compatibility shims. Keep actual-peer lifecycle qualification separate from bootstrap smoke.

The v2 candidate is a separate manifest profile with the six source pins and
existing R/W/spec references. `interop-v2-registry` owns its existing reciprocal
proof/reopen file; `interop-ipex-disclosure` owns the five v2 disclosure files.
Its Python peer composes normal Regery/Exchanger/Kevery/Parser/Revery owners and
one Pruner. Explicit local Admit supplies consent; current recheck plus the exact
accepted Admit/Grant pair gates reuse of retained child bytes after reopen.
Do not recreate the removed Python Wallet/SectionBaser/CLI Peer facades. The mixed
group peer lends its actual live KRAM/Parser/Regery/Exchanger to Multiplexor. Its
fixture-only onward approval explicitly selects an authenticated admitted Grant,
checks current issued state and exact selected body/proofs, then requires ordinary
v2 quorum verification before publication. A pre-sign v2 presentation
verdict cannot supply the completed KRAM cutoff that still needs this share.
The pinned read-only verdict gate remains for issuance and Admit. The TS side
retains its actual Wallet assertions. Plans use the one-DAG wire wrapper;
current-source local proof does not qualify another manifest-selected commit.
ESSR storage stays main-selected. Candidate root/interpreter configuration fails closed and
cannot be replaced by `KERIPY_MAIN_ROOT`. Reuse the setup action with its concrete
profile input; retain the explicit main/1.2/1.3 frozen matrix. Native proof children
already own temporary `openHby` stores; scope further isolation repairs to operations
the candidate lane actually launches.

LMDB V1 needs its own native rebuild/preflight and cache boundary. PR merge-ref
caches are invisible to later PRs: the master cache-warming workflow publishes
both existing dependency variants for reuse across branches. Native caches include
OS image, architecture, runtime versions, dependency locks and build/preflight sources;
a warm hit still proves the loaded addon uses NAPI and writes data-v1. On macOS,
provision libsodium independently of cached venvs; expose the resolved Homebrew
dylib without overwriting a conflict, verify actual loading and keep KLI import
assertions. /bin/bash scrubs DYLD variables, so GITHUB_ENV alone is insufficient.

Only pool interop files when their bootstrap is independent. Deep ACDC files share
one mutable pinned KERIpy venv: cold parallel setup races create/remove, so this
owner uses the runner's existing separate sequential processes. Preserve both
protocol scenarios and participant topology; no lock or new installer is needed.

PR scope uses the [existing suite owners](../../scripts/ci/keri-test-suites.ts)
and [description controls](../../docs/reference/PR_TEST_SCOPE.md). Exact-head local
unit credit avoids duplicate CI execution. Draft promotion does not rerun an
unchanged head; source pushes do. Selected interop/package checks retain
their real assertions and topology. A skipped lane is not execution evidence.
Periodic broad checks catch cross-feature regressions; full release qualification
still includes the maintained manual/endurance gates.

## KF provider onboarding

KF allocation is a finite Tufa caller over existing Habery, KRAM, Exchanger and
HTTP owners. Use a separate existing onboarding signer and explicit account AID;
discovery is public configuration, and allocation does not activate an account.
Require current reply authentication plus route, recipient and selected subject
checks, even when the provider KEL is already known. Pin the returned server AID
on later invocations. Cancellation acknowledgement precedes service-owned cleanup.
`infra kf onboard` composes registration, an accepted witnessed rotation, watcher
introduction/actual quorum observation, account completion and signed service
activation. Existing individual account/onboarding aliases remain separate.
Witness TOTP seeds are encrypted only in transit; the explicit credentials file
stores them as plaintext (0600) so rotation never strands them. Registration is
core `registerWithWitness` (Locksmith `register_with_witness`: full KEL and
`delkel` text parts, `Hab.decrypt` with current keys), so a lost row is
re-registered at any key state. `Hab.decrypt` mirrors KERIpy: every selected
key must open the ciphertext, so multi-key callers select one verfer. No client
operation ledger is needed. Retrying a selected
session reuses matching accepted rotation. Account operations use an explicit
account surface; operation status cannot infer its signing principal from a route.
The CLI flow does not establish normal Locksmith UI integration; that remains a
separate application gate even when the same TS backends pass client onboarding.

`witness backend` separately owns KF witness allocations. Its private listener
binds loopback; the public listener selects a distinct witness runtime/store by
CESR destination or OOBI. The whole TOTP workflow follows upstream witness-hk
`main`: `/aids` takes the controller's full KEL (first event names the subject)
and optional `delkel` as ordinary remote input, succeeds once the controller is
accepted, uses a supplied `secret` as given, stores the seed encrypted to the
witness's own key and returns it encrypted to current controller keys (`totps`
per key). Only the allocated controller with a valid code gets witness-local
ingress; on `/receipts` an invalid or missing code is processed non-locally
(202 escrow, 200 if already accepted), not refused. Unknown destinations are 400
on `/aids`/`/receipts`. Only deliberate deviations: 400 (not upstream's unhandled
500) for non-Ed25519 keys, and Tufa lifecycle codes (410/503). Stop workers and response streams, join
requests, then close stores. Shutdown retains allocations; explicit deletion
clears only that resource. Provider storage never implies mailbox polling.
Receipt body/genus follows the receipted event; hosted KSN and advertised endpoint
evidence use v2. Shared serialization owns counters. The hosted-backend test is
scoped evidence; four-backend Locksmith onboarding remains a separate gate.

`watcher backend` owns independent controller-authorized allocations and actual
periodic witness observations. Signed watcher-add/cut replies use the existing
Kevery stores and OOBI processing; polling records only the current response's
verification result. Ahead states trigger ordinary KEL acquisition, not direct
state replacement. Retained observations describe their recorded query time,
not global freshness. Controller queries require ordinary signature acceptance
and return v2 KSN evidence. Account witness OOBIs select the serving endpoint AID
at the end of the path, separately from the observed account at the beginning.

`registrar start` and `observer start` reopen explicit existing service identities.
Their public listeners use TLS; private loopback `PUT /accounts/{aid}` accepts
public KEL evidence plus service-specific roles, then commits activation before
changing live permissions. GET returns activation; DELETE revokes only the
dynamic grant. Registrar's configured Observer source identities and Observer's
explicit `--reader` identities remain separate from wallet enrollment. Public
`--kel` bootstrap authenticates configured service readers such as Dolly; deleting
a dynamic grant cannot revoke that operator-owned reader permission. An empty reader/publisher set denies access while the
normal routes stay mounted. Observer acquisition remains scheduled independently
of incoming wallet queries. The shared Deno/Node host retains TLS through startup
fallback; certificate trust and URL/name verification remain client policy.

The private admin APIs kf-boot drives are one contract across implementations.
`operator/kfboot/service-admin.ts` (`WitnessAdmin`, `WatcherAdmin`, `RegistryAdmin`)
ports kf-boot's `HioBootClient`: JSON in/out, forwarded but uninterpreted
`Idempotency-Key`, any status >= 400 is a typed `BootApiError`. Suite B
(`test/contract/service-admin.contract.test.ts`, `deno task test:contract`) drives
it against in-process TS roles and, when `WITNESS_HK_BIN`/`WATCHER_HK_BIN`/
`KF_REGISTRAR_BIN`/`KF_OBSERVER_BIN` are set, the Python services (HOME isolated).
Where upstream differs the contract is the status class: health any 2xx
(witness-hk 204, watcher-hk none), an enrollment KEL that does not establish the
account any 4xx (Python 400, TS 409). Do not change the Python services to match.

`roles/boot-service.ts` (+ `boot-service-store.ts`) ports upstream kf-boot; its wire
surfaces are the contract, Python is the reference. Route handlers are synchronous
Exchanger handlers whose outcome is keyed by the exn SAID, so concurrent surface
requests never share a reply; the async worker re-reads the session after every
backend call. Records keep kf-boot's snake_case fields because payloads expose them.
Python-only by justification: per-IP limits/tiers, the cleanup-task queue and CLI,
capacity counters. The worker loop runs kf-boot's session sweep (expire past-due,
delete closed sessions' watcher+witnesses, then stamp `resources_cleaned_at`); until
that stamp a closed session blocks a new start with 409, and a failed teardown retries
next sweep. Rows are never purged.
The shared host answers CORS preflight `OPTIONS` 204 (kf-boot 200): both 2xx.
Browser transport is probed by `deno task test:browser:transport` (local, Docker servers; evidence in
`docs/reports/browser-transport-probe-2026-11.md`). The shared host's CORS allow list must name every request
header keri-ts sends (`CESR-Genus` on v2 detached POSTs, `Authorization` for witness TOTP codes); a missing
one blocks the whole request in every engine. KERIpy's witness has no `Access-Control-Expose-Headers`, so
`Keri-Aid` is unreadable from a page. `redirect: "manual"` reads as status 0 in browsers.
Completed sessions stay readable by the ephemeral signer and the account and
`/onboarding/complete` is idempotent on them; `--session` recovery depends on it.
Service activation enrolls `cloneDelegation`+`clonePreIter` text KEL and fails the
operation (409) unless the ack echoes `aid`, `[role]` and the configured service AID.
Test wallets must hold runtime-owned stores in a live task: `run()` returning closes them.
`tufa boot backend` flags have no commander defaults: flag > `KF_BOOT_*` > kf-boot
default, so launchers keep one env block for both implementations (store identity:
`--name/--head-dir/--passcode`). `test/integration/kf-boot-e2e.test.ts` runs every role
as a subprocess and owns the `--session` recovery proof (~40s).
Suite A (`test/contract/boot-service.contract.test.ts`) runs one assertion set against
the TS boot service and, with `KF_BOOT_CONTRACT_PYTHON_BIN`, upstream kf-boot (quotas
lifted via Python-only env). Keep provisioning "in flight" with accept-and-hang
backends, never refused ports: hio's macOS TCP client crashes kf-boot on refusal.
Shared provider/wallet helpers live in `test/contract/kf-provider.ts`.

## Packaging and release

2.0.0 (2026-11-07) and 2.0.1 (2026-11-09) are published; the
[2.0.0 release notes](../../docs/versioning/2.0.0-release-notes.md) and package
changelogs own what shipped. The
[2.0.0 preparation report](../../docs/reports/parity/V2_PREPARATION_2026-10-21.md)
qualifies earlier source `f50fbf89` only. Version later changes through
changesets against the published packages.

Use dprint and deterministic version generation in checks; opt into build metadata
only for artifacts. Package manifests are authoritative for both Deno version
mirrors and npm workspace-lock entries; manifest:check must reject either drift.
Sync workspace versions without re-resolving or changing npm dependency metadata. Build helpers are real source files, not multiline JS/TS in
shell/workflow strings. Keep inline-code:check and export docstring checks honest.

The package graph puts @keri-ts/verifier and @keri-ts/hosting between Tufa and
public KERI/CESR operations. Verifier owns policy, cue storage and webhooks; hosting
owns the connected HTTP closure. Tufa retains CLI, indirect-host and role/TCP composition.
KERI's general entrypoints are root,
runtime and db; cli is the separate Tufa command-helper boundary. Runtime exports
are deliberate, not module wildcards. Do not publish app/core/db/vdr deep-import
patterns to expose implementation internals. Installed probes use named surfaces.
Derive every manifest export/bin
from DNT output, including the hosting package root imports/declarations;
fixed layout guesses can break advertised subpaths while the CLI still works.
For ordinary function modules, use a stable exported symbol as the selector, not
maintainer doc-comment prose: rewriting kernel documentation previously broke
Tufa package discovery despite unchanged executable code.
Assert packed targets. Strict installed NodeNext checking must pass without
skipLibCheck. LMDB 3.5.3's ESM declaration uses export assignment; normalize emitted
type-only imports to its valid CommonJS declaration branch, preserving ESM values.
DNT omits source resolution attributes. Keep Baser.env tied to LMDBer's own type.
Install compiler tools after runtime smoke so they cannot mask missing dependencies.
The packed consumer must actually read/reopen a >16 MiB native LMDB row and retain
owned bytes across later writes, sign/refuse altered data and transmit/close real
TCP. Module loading alone does not qualify those installed runtime paths.
Install all five local tarballs once per runtime
image (including macOS); run the installed Tufa bin without npx fallback. Source
tests do not qualify package resolution or Node hosting. Require Node >=20.3 in
all generated manifests; qualify the declared floor and current runtime without
compatibility flags. Node 18 is a historical target, not a release gate.
Keep the CESR core dependency graph framework-neutral. Tufa global-install smoke
uses the declared dependency graphs; do not require or reinstall the removed
CESR Effection adapter peer. Actual CLI/runtime imports qualify that topology.

Npm publish and GitHub Release creation are separate seams. Reruns skip existing
exact versions, use the uploaded tarball's dependency metadata, edit existing
release state and upload assets idempotently. Do not describe the old scope-access
blocker as current publication status; verify live state before release claims.

## Remaining qualification

The [qualification plan](../../docs/plans/qualification/QUALIFICATION_PLAN.md) owns
the full maintained inventory and required manual/endurance evidence. Use
representative traffic and investigate actual anomalies; no mandatory 16/256 MiB
or gigabyte performance matrix remains. Do not claim unmeasured scale evidence.
Long hosted jobs remain maintainer-dispatched with the existing 15-minute cap, outside required
merge CI. Record failures/skips and variance; parser-only timing does not prove
production memory bounds. [Runtime learnings](PROJECT_LEARNINGS_RUNTIME.md) own
signal/SSE shutdown, and [storage learnings](PROJECT_LEARNINGS_STORAGE.md) own
LMDB process and allocation boundaries.

## Extended workflow aggregation

`extended-interop-matrix.ts` expands the exported KERI suite groups rather than
copying their inventory into YAML. The reference-profile owner becomes four
independent jobs via `qualify-reference-profiles.py --profile`; every other row
invokes its original owner and preserves the runner's file isolation/concurrency.
The full, extended-interop and qualification groups currently expand to 29, 20
and 31 rows respectively. Keep peer preparation on the concrete row (main for
ESSR storage, candidate for v2 registry/disclosure/KRAM, services for v2
registry). Each job retains its 15-minute cap and separate timing artifact;
`fail-fast: false` preserves failure evidence from all selected scopes.

- 2026-11-12: 2.2.0 release-candidate qualification ran the full PR battery on master 6fcda417 (PR qualify/2-2-0-rc).
