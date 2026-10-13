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
The manual workflow allows four hours, retains timings and provenance with raw
logs, and provides `qualification` to run all KERI files. Individual scenario
timeouts remain in their test bodies. The separate `essr-qualification` workflow
target owns the large parser benchmark and is never a required PR check.

## Verified KERIpy selection

The historical default CLI runtime is commit
`98b88cf73a746813a8719f05264400467a474c05`. Historical table-source and witness
fixture pins are independent data provenance, not claims about the live peer.
No test silently switches to a sibling checkout, PATH `kli`, or another Python.

For current main qualification, select an exact source checkout and interpreter:

```bash
export KERIPY_INTEROP_ROOT=/Users/kbull/enc/keri/core/python/keripy
export KERIPY_INTEROP_EXPECTED_COMMIT=927c0cb8794d7c84fc17143c67df64aab9deda6c
export KERIPY_INTEROP_PYTHON="$KERIPY_INTEROP_ROOT/venv/bin/python"
export LMDB_DATA_V1=true
export KERI_TEST_TIMINGS_DIR=/tmp/keri-main927-qualification

deno task setup:compat-lmdb
deno task test:qualification
```

The helper executes [`probe-keripy.py`](../../../scripts/ci/probe-keripy.py) before
creating scenario state. It checks exact Git/distribution SHA, actual imported
module path and tracked source cleanliness; it records Python/dependency
versions. A test-owned CLI launcher uses that same interpreter and observed CLI
module. Auxiliary verifier and alignment scripts use the identical interpreter.
Wrong SHAs or imports fail before running scenarios. The manual workflow checks
out this exact main commit and uses the same override contract.

DID Webs has its own pinned resolver checkout
`8395277f32b37129fa6ef734c9f3902bb6cbbcbc` and Python 3.13 environment, currently
using KERI 1.2.13 and hio 0.6.14. Its executed probe checks resolver HEAD and actual
`dws` import path and records the embedded KERI runtime separately. Selecting
main927 for KLI does **not** upgrade or establish main927 compatibility for the
resolver's embedded dependency. Preserve this limitation in qualification
reports. Runtime setup also requires libsodium and a checkout-local LMDB addon
built with `LMDB_DATA_V1=true`; missing native setup is an environment failure,
not a protocol regression.
