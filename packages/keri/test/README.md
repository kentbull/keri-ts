# keri-ts tests

Test bodies cover library, runtime and database behavior. Tufa's package owns its
public CLI and HTTP host surface. Protocol v1/v2 fixtures and cross-language
scenarios remain supported; old keri-ts aliases are not a compatibility target.

## Commands and ownership

Run these commands from the repository root after `deno task setup:compat-lmdb`:

| Command                        | Coverage                                                        |
| ------------------------------ | --------------------------------------------------------------- |
| `deno task test:audit`         | Reject missing, duplicate and unowned KERI test files.          |
| `deno task test:unit`          | Required KERI runtime suites, Tufa and CESR, once each.         |
| `deno task test:interop`       | Required representative KERIpy parity.                          |
| `deno task test:quality`       | Exactly the required unit/runtime and parity coverage.          |
| `deno task test`               | All functional KERI/Tufa/CESR tests, including DID Webs.        |
| `deno task test:qualification` | All functional tests plus both manual endurance scenarios.      |
| `deno task test:package-tools` | Packaging helper tests, also required before npm smoke/release. |

`deno run -A scripts/ci/run-keri-test-group.ts <target> --list` prints exact file
selection and any manual opt-in environment. Package-local `deno task test` and
`test:quality` select only KERI. The authoritative file lists are
[`scripts/ci/keri-test-suites.ts`](../../../scripts/ci/keri-test-suites.ts).
There are no source-comment tags or per-test name filters.

The DB/core/app suites already known to permit parallel processes use a pool of
at most two workers. `KERI_TEST_JOBS=1` lowers that limit; larger requests never
raise it. Native state, process-global state, runtime and interop suites retain
separate child processes per file. The entire forwarding file has one isolated
owner; the mailbox and keystore scenarios have separate descriptive files.

Full qualification requires a clean committed checkout. Every timing record includes
the exact Git HEAD and dirty status. The runner completes independent selected files after failures and reports a
nonzero status if any child failed. It always writes exact commands, exit codes,
per-command durations, total wall time, actual loaded LMDB addon path/hash and
observed data-file version to `.test-timings/`, or to
`KERI_TEST_TIMINGS_JSON`/`KERI_TEST_TIMINGS_DIR`. Raw Deno logs carry pass/fail/skip
counts. A timing file does not establish protocol correctness or a speedup.

## External and manual targets

Every target below is available as `deno task test:quality:keri:<target>` and in
the manual **KERI Extended Interop** workflow. `extended-interop` includes every
external matrix; `full` adds the required KERI suites. Neither hides ignored
endurance cases.

| Target                     | Scenario boundary                                           |
| -------------------------- | ----------------------------------------------------------- |
| `interop-parity`           | Annotation, SAID, KEL/query and representative ACDC parity. |
| `interop-keystore-parity`  | Bidirectional initialization and list parity.               |
| `interop-keystore-storage` | Compatibility-open and encrypted-store behavior.            |
| `interop-oobi-bootstrap`   | Endpoint/OOBI bootstrap parity.                             |
| `interop-acdc-verifier`    | Credential verification workflow.                           |
| `interop-acdc-extended`    | Tufa issuer to KLI holder.                                  |
| `interop-acdc-deep`        | Both existing deep mixed-credential chains.                 |
| `interop-delegation`       | Existing single/group cross-language delegation.            |
| `interop-witness-main`     | Existing live witness matrix.                               |
| `interop-witness-cli`      | Witness CLI behavior.                                       |
| `interop-mailbox`          | Both existing mailbox directions.                           |
| `interop-did-webs`         | All four DID Webs resolver matrix scenarios.                |
| `manual-delegation`        | Three delegators, six changing delegate members, 64 events. |
| `manual-witness-soak`      | Six witnesses, threshold six, inception and two rotations.  |

Manual files live in `test/manual/`; normal PR checks never select them. The
runner supplies `KERI_LONG_MULTISIG_DELEGATION=1` for the delegation target.
Direct execution without that opt-in fails clearly instead of silently skipping.
Each manual workflow job has a 15-minute limit and retains timings, provenance,
and raw logs. Select individual targets when the complete `qualification` group
does not fit that limit; local qualification still runs every KERI file.
Individual scenario timeouts remain in their test bodies. The separate
`essr-qualification` target runs one benchmark sample per 15-minute job, with
a 600-second process limit and at most two jobs running concurrently. Its full
108-sample matrix remains manual-only and is never a required PR check. Manual workflows are dispatched explicitly by the maintainer.

## Verified KERIpy selection

The default CLI runtime is the published `kentbull/keripy` mailbox fork
`23af39bf99383be0dea061a4ea60b184268f3529`, based on upstream main
`927c0cb8794d7c84fc17143c67df64aab9deda6c` plus mailbox commands, admission
checks, explicit protocol/genus selection for mailbox startup and authorization,
the transferable receipt-table lookup repair, and explicit VC export genus
selection, and JSON mailbox queries for topic names that cannot be native CESR
labels. Credential commands expose explicit anchor, grant, admit, and mailbox
consumption versions; admit rehydrates embedded KERI/ACDC bodies with the
protocol-specific serder. Explicit query encodings and CLI protocol defaults
remain unchanged. Legacy pathed IPEX grants still do not support protocol v2;
these existing credential scenarios explicitly select v1.
This is fork-on-main qualification, not pure upstream parity. Historical
table-source pins are independent data provenance, not claims about the live peer.
No test silently switches to a sibling checkout, PATH `kli`, or another Python.

Existing Tufa CLI parity fixtures select KERI 1.0 explicitly at KLI call sites
that expose protocol selection. Body protocol and attachment genus remain
independent: an explicit v1 body does not force a v1 replay enclosure. Keep
same-version byte parity distinct from mixed-version parsing checks. Export tests
compare exact v1 Tufa bytes with an explicitly v1 Python clone and exact default
v2 KLI bytes with a v2 clone, then compare complete ordered signature evidence.
KLI event export carries no genus selector, so parsing uses known external v2
context. The v1 credential fixture selects `vc export --version 1.0` explicitly.
The CESR v1/v2 vectors remain independent coverage. Mailbox fixtures use
`mailbox add --version 1.0` and `mailbox start --protocol-version 1.0`;
`mailbox start --version` still prints the Python distribution version.

Witness fixtures use an explicit public test passcode throughout initialization,
inception, startup, and compatibility inspection. Every scenario owns a fresh
temporary home; clearing personal KERI stores is neither required nor permitted
by this harness. The six-node resolver demo has a separate 60-second startup
budget for its sequential cold key derivation; protocol deadlines are unchanged.

For the maintained mailbox-on-main qualification, select its exact checkout and interpreter:

```bash
export KERIPY_INTEROP_ROOT=/Users/kbull/enc/keri/worktrees/keripy/mailbox-main-interop
export KERIPY_INTEROP_EXPECTED_COMMIT=23af39bf99383be0dea061a4ea60b184268f3529
export KERIPY_INTEROP_PYTHON="$KERIPY_INTEROP_ROOT/venv/bin/python"
export LMDB_DATA_V1=true
export KERI_TEST_TIMINGS_DIR=/tmp/keri-mailbox-main-qualification

deno task setup:compat-lmdb
deno task test:qualification
```

The helper executes [`probe-keripy.py`](../../../scripts/ci/probe-keripy.py) before
creating scenario state. It checks exact Git/distribution SHA, actual imported
module path and tracked source cleanliness; it records Python/dependency
versions. A test-owned CLI launcher uses that same interpreter and observed CLI
module and preserves `main()`'s exit status through `SystemExit`; invoking the
module with `python -m` would discard handled error returns. Auxiliary verifier
and alignment scripts use the identical interpreter.
Wrong SHAs or imports fail before running scenarios. The manual workflow checks
out this exact fork commit and uses the same override contract.

DID Webs has its own pinned resolver checkout
`8395277f32b37129fa6ef734c9f3902bb6cbbcbc` and Python 3.13 environment. Its executed
probe checks resolver HEAD and actual `dws` import path and records the embedded
KERI runtime and dependency versions separately. Selecting
the mailbox-on-main fork for KLI does **not** upgrade or establish that fork's compatibility for the
resolver's embedded dependency. Preserve this limitation in qualification
reports. Runtime setup also requires libsodium and a checkout-local LMDB addon
built with `LMDB_DATA_V1=true`; missing native setup is an environment failure,
not a protocol regression.
