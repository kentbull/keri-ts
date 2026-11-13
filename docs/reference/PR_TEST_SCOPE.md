# PR test scope

Use one `keri-ci` JSON block in a same-repository PR description to select the
checks relevant to its change. Static checks and changeset validation always run.
Without a block, the existing changed-path defaults apply. Fork descriptions
cannot reduce those defaults.

After the relevant unit tests pass locally on the exact committed source:

````markdown
```keri-ci
{"unit":{"local":"REPLACE_WITH_40_CHARACTER_PR_HEAD_SHA"},"interop":[],"package":false}
```
````

The local field attests that the selected change's unit checks passed. Keep exact
commands, results and environment in qualification logs and handoff evidence; PR
descriptions stay focused on the problem and fix. A new head needs
fresh applicable local validation and an updated SHA. Stale credit fails the
selection job. Keep interop or package checks when the change needs them.

To run selected maintained owners in CI instead:

````markdown
```keri-ci
{"unit":["core-fast-a","tufa"],"interop":["interop-delegation"],"package":false}
```
````

Unit choices are the existing `required` owners in
[suite inventory](../../scripts/ci/keri-test-suites.ts), plus `ci` (all KERI
required owners), `tufa`, `verifier` (the verifier package tests), `hosting` (the HTTP hosting tests), `wallet` (the wallet inventory tests), `registrar` (the publication/query service test), `cesr` and
`observer` (the scheduled-source/cache service test) and `ci-tools` (the scope contract tests). Interop choices are the concrete owners in
`extended-interop`. No new inventory, arbitrary command or test-name filtering is
introduced. Existing suite isolation and participant topology remain in force.

The plan job groups the selected unit owners into shards (`unitShards` in
`scripts/ci/pr-test-scope.ts`) and lists only shards that have work; CI runs one
`unit (<shard>)` job per listed shard, concurrently, with the owners inside a shard in
order. Shards are balanced by measured owner time, so move an owner between shards when
timings change. The stage gate still waits on the single `unit-tests` result.
`interop-ipex-disclosure` owns the maintained bidirectional v2 conversation and
graph cases separately from the reference-profile credential workflows, so disclosure
changes can select those files alone. Its reciprocal derived-issuance stories swap
Python and TypeScript roles, retain three witnesses, and use a separate rootless
verifier for exact holder presentation and Unblind. DH, Unblind and Admit remain
explicit actions on independent stores. The same owner includes one Python issuer-group
→ TypeScript holder-group story with an independent Python verifier, ordinary member
thresholds, and rootless elected Unblind delivery. `interop-kram` separately owns the live
single/group mailbox-authentication cases. Disclosure includes direct witnessed
presentation and uses the manifest's candidate pin; ESSR storage retains main. The separate
`interop-v2-registry` owner uses the candidate profile for the existing reciprocal
v2 proof and reopen cases. The five disclosure files use the selected flat-`dp`
profile through the same candidate setup. The default peer and the candidate are
both the `kentbull/keripy` `v2-spec` head, which has no standalone
`keri.app.mailboxing` host; the KRAM Python provider runs on its witness-hosted
mailbox instead. CI prepares both references without changing the KRAM owner's
default peer.
Direct and mailbox presentation share the same workflow and participant topology. Full mode includes all these owners.
Empty arrays explicitly select no owners for that lane.
The reference-profile owner expands through the same frozen-peer driver in local
aggregate runs and CI. An explicit `KERIPY_INTEROP_PROFILE` selects one child run.

The manually dispatched extended workflow expands the existing KERI group exports
into independent 15-minute jobs: `extended-interop` has 18 rows, `full` has 28,
and `qualification` has 30. Each includes four isolated reference-profile rows;
all other rows invoke their original concrete suite. The suite runner retains
file ordering, isolation and measured concurrency caps. Jobs do not cancel their
siblings after a failure, and each uploads its own timings. These are the KERI
groups, distinct from the broader full PR battery below.

For the periodic broad run, use:

````markdown
```keri-ci
{"full":true}
```
````

Full mode runs all required KERI owners, Tufa, verifier, hosting, wallet, CESR, every maintained extended
interop owner and installed-package smoke tests. Interop owners run in separate
jobs with their existing 25-minute PR cap. This is the broad PR battery; manual
endurance and final clean-source release qualification remain separate gates.
During the cleanup goal, select full mode about every 20 implementation PRs,
and fix regressions before proceeding. This cadence does not replace relevant
checks on each PR or the full final release qualification.

The selector reads the current PR description through the API on every run.
After editing only the block, rerun the workflow with `gh run rerun RUN_ID` or
GitHub's Re-run all jobs button. Ordinary description edits do not trigger or
cancel tests. Source pushes still trigger fresh checks. Marking a draft ready does
not rerun an unchanged head; explicitly rerun when its scope or validation needs
to change. A rerun whose PR head
has moved is refused; use the current source run. See GitHub's
[rerun behavior](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).
The selection job records the exact head and resolved scope in its summary.
A skipped lane is scoped validation, never a claim that its tests ran.

## Real-browser lane

`deno task test:browser` bundles `packages/keri/test/browser/` with
`deno bundle --platform browser`, serves it from a local static server, and runs the
shared `storeContract` and `wrapperContract` cases for `WebDBer` over real IndexedDB and
for `MemStore`, an IndexedDB reopen-fidelity case, and the engine-sensitive cases in
`engine-cases.ts` (aborted and latched batches, two openers on one database name, and a
few-thousand-row round trip), the halting cases in `halt-cases.ts` (a request that never answers,
answers headers only, or goes idle mid-stream must halt and close its connection, against the page's
own `/stall` route) and `wallet-cases.ts` (`openWebWallet` closes while a mailbox poll is idle) in Chromium, Firefox and WebKit through Playwright. For each
engine it fails unless the browser executed exactly the case names `deno test` registers and
every one passed. Cases report engine behavior through `note`; the runner prints those per
engine. The bundle must contain no `node:` or LMDB import.

Name engines to run a subset: `deno task test:browser webkit`, or
`KERI_BROWSER_ENGINES=firefox,webkit`. Install once with
`npx playwright-core@1.56.1 install chromium firefox webkit`; binaries stay in Playwright's
user cache. On Linux, `scripts/ci/install-browser-deps.sh` also installs the system
libraries.

In CI the lane is the `browser-tests` job of the PR stage gate. The selection job decides
whether it runs, so an unselected PR never sets up browsers. Add `"browser":true` to the
`keri-ci` block to select it (it is optional and defaults to false), or change files it can
regress: `packages/keri/src/db/`, `packages/keri/test/browser/`, the runner, the store
contract, browser CI scripts, or the stage-gate infrastructure. `{"full":true}` and a manual
dispatch include it; release PRs do not. When selected it is required by `stage-gate`;
otherwise `stage-gate` accepts it as skipped. The Playwright browser cache is keyed on the
`playwright-core` version pinned in the runner.

````markdown
```keri-ci
{"unit":["db-web"],"interop":[],"package":false,"browser":true}
```
````

### Transport probe (local only)

`deno task test:browser:transport [engine ...]` is a second real-browser lane. It sends keri-ts's
own HTTP traffic (`FetchHttpClient`, `HTTPMessenger`, `HTTPStreamMessenger`, `Poster`,
`MailboxPoller`, mailbox administration) from a page on one origin to a KERIpy witness, a Tufa
mailbox and a small echo server on other origins, in each engine, and fails unless every result
equals the table in `packages/keri/test/browser-transport/expectations.ts`. Evidence and gaps are in
[the transport probe report](../reports/browser-transport-probe-2026-11.md).

It is not in the `browser-tests` job. The servers come from `scripts/ci/browser-transport-servers.sh`,
which runs them in Docker from the interop harness' cached KERIpy volumes (`keri-interop-keripy`,
`keri-interop-venvs`) and a named volume holding this working tree; state never leaves named
volumes. Running it in CI would need a native variant of that script: the pinned KERIpy peer from
`.github/actions/setup-keripy-main-peer`, the LMDB rebuild of `deno task setup:compat-lmdb`, and
two background processes with a readiness wait, before several more minutes of probes in
three engines. Selecting `"browser":true` still runs only the store-contract lane. Firefox does
not launch on the macOS host; run it from a Linux container (the report says how).

### Browser wallet scenario (local only)

`deno task test:browser:wallet [engine ...]` opens a wallet with `openWebWallet` in a real browser and
runs a named-step scenario against real peers: incept with a KERIpy witness and collect its
receipt, authorize a Tufa mailbox, exchange OOBIs with a Tufa counterparty, receive and issue a
v2 DH credential, close and reopen the wallet in the same page, rotate, and release the store
lock. Each step is asserted through the library's status reads and timed; a per-engine table is
printed and any failed or skipped step fails the run. Steps are in `packages/keri/test/browser-wallet/`
(page side `steps.ts`, scenario `scenario.ts`); results are in
[the wallet end-to-end report](../reports/browser-wallet-e2e-2026-11.md).

It is not in the `browser-tests` job, for the reasons the transport probe lists, plus a Tufa
counterparty and a second Docker server. `scripts/ci/browser-wallet-servers.sh` starts the witness
(served at KERI v2), the mailbox and a counterparty control server in one Docker network namespace
over the named volume `keri-ts-browser-pr15b`, publishing ports on 127.0.0.1; no host directory is
mounted and no LMDB store is opened on the host. Firefox runs in a Linux container that joins that
namespace: `bash scripts/ci/browser-wallet-firefox.sh`. Selecting `"browser":true` still runs only
the store-contract lane.

### Group wallet lanes (local only, written, not yet run)

`deno task test:browser:wallet:group [engine ...]` (lane 15c) makes the browser wallet one member of a 2-of-3 group with
two Tufa CLI members on the shared mailbox and witness: group inception proposed by Tufa and approved through
`proposals`, the group's mailbox role, a group registry, a v2 DH issuance to a Tufa holder with a Tufa custodian and the
browser consenting, a tab reload between the browser's consent and the issuance's completion, and a group rotation the
browser proposes. `deno task test:browser:wallet:keripy-member [engine ...]` (lane 15d) starts from a browser plus Tufa
group with one issued credential; its KERIpy half is a scaffold whose steps fail with the list of missing harness. Both
default to Chromium, use the servers of the wallet scenario above, and are in no CI job. Neither has been executed: they
were written under a no-browser rule, type-checked only, and first run in the qualification phase. Steps are in
`packages/keri/test/browser-wallet/` (`group-steps.ts` page side, `group-scenario.ts`, `keripy-member-scenario.ts`);
see the report's "Group lanes: written, not yet run".

## Browser bundle gate (package smoke)

Selecting `"package": true` also runs `scripts/npm/check_browser_bundle.mjs` inside the
installed-package smoke. It bundles a consumer of `cesr-ts`, `keri-ts`, `keri-ts/runtime`,
`keri-ts/db` and `keri-ts/db/indexeddb` from the installed packages with esbuild
(`platform: "browser"`, `conditions: ["browser"]`) and fails on bundle errors, any Node
builtin, `lmdb`, `@deno/shim-deno` or DNT polyfill/shim module in the esbuild metafile, or any
external import. It seeds `keri-ts/db/lmdb` and `keri-ts/runtime/node` imports to prove the
gate rejects them, and prints the bundle size with its top contributors. `@keri-ts/wallet`
is a named known-failing entry (`TODO(wallet-web)`). To run it by hand inside an npm project
that has the packed tarballs and `esbuild` installed: `deno task check:browser-bundle <dir>`.

## Running interop locally

`scripts/ci/run-keri-test-group.ts` sets three things for interop owners:

- `KERI_TEST_FAST=1` shortens the poll intervals and cycle time of the frozen KERIpy peers (a monkeypatch,
  `scripts/ci/keripy_fast_timing.py`) for every target except `qualification`; the extended-interop workflow pins it off
  (`KERI_TEST_FAST: "0"`), and an exported `KERI_TEST_FAST` overrides either default. The readiness probes poll every 50 ms.
- It compiles the Tufa CLI once per interop run and exports it as `KERI_TEST_TUFA_BIN`; the interop helpers spawn that
  binary instead of `deno run packages/tufa/mod.ts`, which reloads the module graph on every call. An exported
  `KERI_TEST_TUFA_BIN` is used as is; without one (or if the build fails) the CLI runs from source.
- Owners whose files share no fixed ports or process-global state run two files at a time as separate child processes
  (`processes: 2` in `scripts/ci/keri-test-suites.ts`): `interop-parity`, `interop-reference-profiles`,
  `interop-ipex-disclosure`, `interop-delegation`, `interop-witness-main` and `interop-oobi-bootstrap` (the suite list
  is the authority). Each child gets its own slice of the random-port range.
