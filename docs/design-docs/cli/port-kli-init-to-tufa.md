# Plan: Port KERIpy kli init + Single-Sig kli incept into keri-ts (tufa)

## Summary

We will implement this in strict parity-first order with KERIpy behavior,
starting from tufa init and only then exposing top-level tufa incept for
single-sig, no-witness/no- delegation mode.

The key architectural fact is:

kli init in KERIpy already depends on inception-capable internals because
Habery.setup() creates Signator, and Signator creates hidden **signatory** Hab
via local inception (Hab.make(...)).

So phase 1 must include enough Manager + Habery + Hab to support hidden local
inception before public incept command work.

Maintainer note (2026-04-03):

- This document is now historical bootstrap context, not the active sequencing
  source of truth.
- The later shared-runtime/OOBI work changes two earlier assumptions here:
  - `tufa init` should now host command-local runtime work when config-seeded
    OOBIs exist, not stop at DB preload.
  - "single-sig local phase" should now be read as a local-creation default,
    not as a permanent refusal to consume accepted remote transferable state
    that the shared runtime has already resolved honestly.
- Active sequencing now lives in:
  - `docs/plans/keri/INIT_INCEPT_RECONCILIATION_PLAN.md`
  - `docs/plans/keri/GATE_E_AGENT_RUNTIME_OOBI_PLAN.md`

## Public APIs / Interfaces / Types To Add

1. packages/keri/src/app/keeping.ts

- Algos enum: randy | salty | group | extern (parity values)
- Manager class with:
- setup, updateAeid, incept, move, rotate (rotate internal, CLI use deferred)
- getters/setters for aeid, pidx, algo, salt, tier
- passcode/bran -> seed/aeid derivation parity path
- PrePrm, PreSit, PubLot, PubSet records

2. packages/keri/src/app/habbing.ts

- Habery with setup, loadHabs, makeHab, signator property
- Hab with make and local event processing for inception
- Signator + SIGNER = "**signatory**" using hidden non-transferable Hab

3. packages/keri/src/app/configing.ts

- minimal Configer for init --config-dir/--config-file parity loading of OOBI
  seeds (storage now, resolver later)

4. packages/keri/src/db/keeping.ts

- Keeper LMDB wrapper with required subdbs for init+single-sig:
- gbls., pris., pres., prms., sits., pubs. (plus prxs., nxts. placeholders)
- binary key/value parity-friendly interfaces

5. packages/keri/src/db/basing.ts extension

- add minimal subdbs needed by Habery/Hab/Signator:
- habs., names., hbys. and event storage already present (evts.)

6. CLI additions

- rewrite packages/keri/src/app/cli/init.ts from stub to real flow
- add packages/keri/src/app/cli/incept.ts (top-level command)
- add packages/keri/src/app/cli/common/parsing.ts and existing.ts parity helpers
- register top-level incept in packages/keri/src/app/cli/command-definitions.ts
- remove experimental incept dependency path for this command

## Phased Implementation

## Phase 0: Parity Trace Lock (No Behavior Changes)

1. Freeze reference behavior from current KERIpy (keripy/src) for:

- init.py, incept.py, existing.py, habbing.py, keeping.py

2. Create parity notes with exact call chain:

- tufa init target chain: CLI -> Habery -> Manager.setup -> Signator -> hidden
  Hab.make
- tufa incept target chain: CLI arg merge -> existing Habery open ->
  Habery.makeHab

3. Add deterministic fixtures from KERIpy tests for salts/passcodes/prefixes.

Exit criteria:

- A single “parity matrix” document in repo mapping each CLI flag and side
  effect.

## Phase 1: Keystore Core + Manager + Hidden Signator Inception

1. Implement Keeper and keystore records/subdb contracts.
2. Implement Manager with AEID encryption flow and bran derivation parity.
3. Implement Habery.setup() creating Manager then Signator.
4. Implement Signator hidden Hab creation (transferable=false, hidden record
   behavior).
5. Implement minimal local event creation/signing path needed for hidden Hab
   inception only.

Exit criteria:

- Constructing Habery with init semantics creates keystore/db, has mgr, and
  signator can sign/verify.
- **signatory** is persisted in hbys. mapping and not listed as user Hab.

## Phase 2: Real tufa init (Parity-First)

1. Replace stub logic in init.ts with:

- required name
- passcode prompt when !nopasscode && !passcode
- optional salt, aeid, seed, config file/dir

2. Instantiate real Habery and minimal Regery equivalent placeholder path print
   (or explicit “credential store not yet enabled” if not implemented).
3. Preserve output shape parity:

- keystore path, db path, credential store path line
- print aeid when present

4. Load config OOBIs into db if config exists; do not run async network OOBI
   resolver yet.
5. Preserve local npm CLI fallback semantics when `/usr/local/var/...` is not
   writable: `PathManager` must treat Node-shape `EACCES` / `EPERM` mkdir
   failures from `@deno/shim-deno` the same as `Deno.errors.PermissionDenied` so
   init rehomes into `~/.tufa/...`.

Exit criteria:

- tufa init --name X --nopasscode --salt <salt> works end-to-end without stubs.
- tufa init with passcode derives deterministic seed/aeid parity behavior.

## Phase 3: Single-Sig Top-Level tufa incept (No Witness/Delegation Yet)

1. Add top-level incept command (not experimental).
2. Implement KERIpy-style file+arg merge behavior:

- --file JSON options merge with CLI, CLI wins
- required arg checks when no file

3. Open existing Habery with passcode retry path (existing.setupHby parity).
4. Create Hab via makeHab for single-sig local inception.
5. Print parity outputs:

- Prefix <pre>
- public key list

Scope rules in this phase:

- Allowed: single-sig transferable/non-transferable,
  isith/nsith/icount/ncount/toad/data/est-only local state.
- Not allowed yet: witness receipt orchestration, mailbox director, delegation
  anchoring/proxy flows.
- If wits, endpoint, proxy, or delpre requires network orchestration, return
  explicit “not in single-sig local phase” error.

Exit criteria:

- tufa incept creates local AID and persists Hab records.
- deterministic vectors match KERIpy for no-witness sample inputs.

## Phase 4: KERIpy Integration Test Harness (Gate Before Witness Work)

1. Add integration harness under packages/keri/test/integration/interop/:

- run equivalent KERIpy commands and tufa commands for same inputs
- compare deterministic outputs: prefix, key set, sequence/state snapshots

2. Test matrix:

- init unencrypted with fixed salt
- init passcode-derived AEID path
- incept non-transferable single-sig
- incept transferable single-sig
- est-only single-sig inception acceptance

3. Add CI task alias for interop suite (skippable if Python env missing,
   hard-fail in dedicated interop job).

Exit criteria:

- green interop suite for init + single-sig incept parity vectors.

## Phase 5: Witness/Delegation Follow-On (Planned, Not Implemented in This Scope)

1. Add orchestration modules equivalent to:

- Receiptor, WitnessReceiptor, MailboxDirector, Anchorer, Poster

2. Enable incept witness receipt waits and delegator approval paths.
3. Extend interop tests with witness-enabled inception scenarios.

Exit criteria:

- only after Phase 4 is stable.

## Test Cases and Scenarios

1. Unit: Manager.setup initializes defaults and AEID transitions correctly.
2. Unit: bran(passcode) -> seed/aeid deterministic vector matches KERIpy.
3. Unit: Signator.sign/verify with persisted **signatory** key.
4. Unit: Hab.make single-sig transferable and non-transferable.
5. CLI integration: tufa init required name validation and path outputs.
6. CLI integration: tufa incept file+arg merge semantics.
7. Interop integration: KERIpy vs tufa deterministic parity snapshots for
   single-sig, no-witness.

## Assumptions and Defaults

1. Parity baseline is current keripy/src behavior.
2. Implementation strategy is hybrid with signify-ts patterns reused where
   useful, but code lands in keri-ts.
3. incept is top-level tufa incept once single-sig local path is complete.
4. Witness/delegation orchestration is explicitly deferred until after
   init+single-sig interop is green.
5. Initial interop target is behavior parity (derived identifiers/events), not
   direct cross-language LMDB file compatibility.
