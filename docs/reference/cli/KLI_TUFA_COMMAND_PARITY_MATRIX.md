# KLI <-> TUFA Command Parity Matrix (Gate A-G)

Historical Gate A–G inventory retained at the #168 boundary. Re-check current
source/tests before treating any row as remaining work or current qualification.
The [DB plan](../../plans/db/DB_PARITY_PLAN.md) retains its integration gates.

## Purpose

Track command-level parity expectations between KERIpy `kli` and `tufa`,
including expected output shape and Gate mapping for Phase 2.

This closes the remaining P0 requirement from
`INIT_INCEPT_RECONCILIATION_PLAN.md`:

- "Add matrix for KERIpy command parity and expected output shape."

## Status Legend

- `Implemented`: covered by automated interop harness checks.
- `Pending`: command surface and/or harness modeling exists, but the required
  live parity evidence or deeper semantics are not closed yet.
- `Blocked`: command surface not yet present in `tufa`.

## Matrix

**`B`**

- Scenario ID: `B-INIT`
- KERIpy Command: `kli init --name <n> ...`
- TUFA Command: `tufa init --name <n> ...`
- Expected Output Shape: Exit `0`; no error; store initialized
- Status: `Implemented`
- Harness Evidence: `packages/keri/test/integration/app/interop-keystore-parity.test.ts`

**`B`**

- Scenario ID: `B-INCEPT`
- KERIpy Command: `kli incept --alias <a> ...`
- TUFA Command: `tufa incept --alias <a> ...`
- Expected Output Shape: Contains `Prefix <qb64>` line
- Status: `Implemented`
- Harness Evidence: `packages/keri/test/integration/app/interop-keystore-parity.test.ts`

**`B`**

- Scenario ID: `B-EXPORT-KEL`
- KERIpy Command: `kli export --alias <a>`
- TUFA Command: `tufa export --alias <a>`
- Expected Output Shape: CESR KEL stream parity after timestamp normalization
- Status: `Implemented`
- Harness Evidence: `packages/keri/test/integration/app/interop-keystore-parity.test.ts`

**`B`**

- Scenario ID: `B-LIST-BEFORE`
- KERIpy Command: `kli list`
- TUFA Command: `tufa list`
- Expected Output Shape: Empty identifier set before first incept
- Status: `Implemented`
- Harness Evidence: `packages/keri/test/integration/app/interop-keystore-parity.test.ts`

**`B`**

- Scenario ID: `B-LIST-AFTER`
- KERIpy Command: `kli list`
- TUFA Command: `tufa list`
- Expected Output Shape: Includes `alias (prefix)` after incept
- Status: `Implemented`
- Harness Evidence: `packages/keri/test/integration/app/interop-keystore-parity.test.ts`

**`B`**

- Scenario ID: `B-AID`
- KERIpy Command: `kli aid --alias <a>`
- TUFA Command: `tufa aid --alias <a>`
- Expected Output Shape: Returns same prefix as `incept`
- Status: `Implemented`
- Harness Evidence: `packages/keri/test/integration/app/interop-keystore-parity.test.ts`

**`C`**

- Scenario ID: `C-KLI-STORE-OPEN`
- KERIpy Command: `kli init/incept` then `kli list`
- TUFA Command: `tufa list --compat` / `tufa aid --compat`
- Expected Output Shape: Existing KLI store opens and identifiers are visible
- Status: `Implemented`
- Harness Evidence: `packages/keri/test/integration/app/interop-keystore-storage.test.ts`

**`D`**

- Scenario ID: `D-ENCRYPTED-SEMANTICS`
- KERIpy Command: `kli init --passcode`
- TUFA Command: `tufa init --passcode`
- Expected Output Shape: Successful encrypted store open/reopen/decrypt parity
- Status: `Implemented`
- Harness Evidence: `packages/keri/test/integration/app/interop-keystore-storage.test.ts`

**`E`**

- Scenario ID: `E-LOC-ADD`
- KERIpy Command: `kli location add ...`
- TUFA Command: `tufa loc add ...`
- Expected Output Shape: Accepted location reply persists in DB
- Status: `Implemented`
- Harness Evidence: `packages/keri/test/integration/app/interop-oobi-bootstrap.test.ts`

**`E`**

- Scenario ID: `E-ENDS-ADD`
- KERIpy Command: `kli ends add ...`
- TUFA Command: `tufa ends add ...`
- Expected Output Shape: Endpoint role auth persists in DB
- Status: `Implemented`
- Harness Evidence: `packages/keri/test/integration/app/interop-oobi-bootstrap.test.ts`

**`E`**

- Scenario ID: `E-OOBI-GENERATE`
- KERIpy Command: `kli oobi generate ...`
- TUFA Command: `tufa oobi generate ...`
- Expected Output Shape: Deterministic mailbox OOBI output shape
- Status: `Implemented`
- Harness Evidence: `packages/keri/test/integration/app/interop-oobi-bootstrap.test.ts`

**`E`**

- Scenario ID: `E-OOBI-RESOLVE`
- KERIpy Command: `kli oobi resolve ...`
- TUFA Command: `tufa oobi resolve ...`
- Expected Output Shape: Resolve success and persisted bootstrap OOBI records
- Status: `Implemented`
- Harness Evidence: `packages/keri/test/integration/app/interop-oobi-bootstrap.test.ts`

**`F`**

- Scenario ID: `F-DIRECT-COMMS`
- KERIpy Command: `kli` direct message flow
- TUFA Command: `tufa` direct message flow
- Expected Output Shape: Message send/receive parity and persisted EXN state
- Status: `Blocked`
- Harness Evidence: No implemented matrix scenario

**`F`**

- Scenario ID: `F-MAILBOX-COMMS`
- KERIpy Command: `kli` mailbox flow
- TUFA Command: `tufa` mailbox flow
- Expected Output Shape: Mailbox topic+message parity
- Status: `Blocked`
- Harness Evidence: No implemented matrix scenario

**`G`**

- Scenario ID: `G-CHALLENGE-GEN`
- KERIpy Command: `kli challenge generate`
- TUFA Command: `tufa challenge generate`
- Expected Output Shape: Word list shape parity
- Status: `Blocked`
- Harness Evidence: No implemented matrix scenario

**`G`**

- Scenario ID: `G-CHALLENGE-RESPOND`
- KERIpy Command: `kli challenge respond`
- TUFA Command: `tufa challenge respond`
- Expected Output Shape: Response acceptance shape parity
- Status: `Blocked`
- Harness Evidence: No implemented matrix scenario

**`G`**

- Scenario ID: `G-CHALLENGE-VERIFY`
- KERIpy Command: `kli challenge verify`
- TUFA Command: `tufa challenge verify`
- Expected Output Shape: Verify success/failure shape parity
- Status: `Blocked`
- Harness Evidence: No implemented matrix scenario

## Notes

1. Gate A is infrastructure-level and tracked primarily in
   `DB_LAYER_PARITY_MATRIX.md` plus the Gate A-G K/V worklist CSV.
2. This matrix is intentionally command/output focused; DB K/V parity remains
   tracked in the DB-layer artifacts.
3. Gate C was promoted to `Implemented` on 2026-03-17 after
   `interop-gates-harness.test.ts` passed live against a KLI-created encrypted
   store via `tufa list --compat` / `tufa aid --compat`.
4. Gate D was promoted to `Implemented` on 2026-03-17 after the repo landed
   libsodium-backed keeper encryption, AEID decrypt/re-encrypt coverage,
   wrong-passcode failure assertions, and encrypted signator reopen tests, with
   corresponding live harness evidence.
5. Gate E was promoted to `Implemented` on 2026-04-03 after the harness landed
   live parity evidence for `tufa loc add`, `tufa ends add`, and mailbox OOBI
   generate/resolve against KERIpy, with additional shared-runtime tests
   covering controller, witness, agent, and config-preload bootstrap paths.
6. Gate F remains `Blocked` because the top-level transport command surface is
   still absent from `tufa --help`, even though the gate is already modeled in
   the harness.
