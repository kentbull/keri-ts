# KLI <-> TUFA Command Parity Matrix (Gate A-G)

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

| Gate | Scenario ID             | KERIpy Command                    | TUFA Command                               | Expected Output Shape                                 | Status        | Harness Evidence                                                   |
| ---- | ----------------------- | --------------------------------- | ------------------------------------------ | ----------------------------------------------------- | ------------- | ------------------------------------------------------------------ |
| `B`  | `B-INIT`                | `kli init --name <n> ...`         | `tufa init --name <n> ...`                 | Exit `0`; no error; store initialized                 | `Implemented` | `packages/keri/test/integration/app/interop-gates-harness.test.ts` |
| `B`  | `B-INCEPT`              | `kli incept --alias <a> ...`      | `tufa incept --alias <a> ...`              | Contains `Prefix <qb64>` line                         | `Implemented` | `packages/keri/test/integration/app/interop-gates-harness.test.ts` |
| `B`  | `B-EXPORT-KEL`          | `kli export --alias <a>`          | `tufa export --alias <a>`                  | CESR KEL stream parity after timestamp normalization  | `Implemented` | `packages/keri/test/integration/app/interop-gates-harness.test.ts` |
| `B`  | `B-LIST-BEFORE`         | `kli list`                        | `tufa list`                                | Empty identifier set before first incept              | `Implemented` | `packages/keri/test/integration/app/interop-gates-harness.test.ts` |
| `B`  | `B-LIST-AFTER`          | `kli list`                        | `tufa list`                                | Includes `alias (prefix)` after incept                | `Implemented` | `packages/keri/test/integration/app/interop-gates-harness.test.ts` |
| `B`  | `B-AID`                 | `kli aid --alias <a>`             | `tufa aid --alias <a>`                     | Returns same prefix as `incept`                       | `Implemented` | `packages/keri/test/integration/app/interop-gates-harness.test.ts` |
| `C`  | `C-KLI-STORE-OPEN`      | `kli init/incept` then `kli list` | `tufa list --compat` / `tufa aid --compat` | Existing KLI store opens and identifiers are visible  | `Implemented` | `packages/keri/test/integration/app/interop-gates-harness.test.ts` |
| `D`  | `D-ENCRYPTED-SEMANTICS` | `kli init --passcode`             | `tufa init --passcode`                     | Successful encrypted store open/reopen/decrypt parity | `Pending`     | `packages/keri/test/integration/app/interop-gates-harness.test.ts` |
| `E`  | `E-ENDS-ADD`            | `kli ends add ...`                | `tufa ends add ...`                        | Endpoint role auth persists in DB                     | `Blocked`     | `packages/keri/test/integration/app/interop-gates-harness.test.ts` |
| `E`  | `E-OOBI-GENERATE`       | `kli oobi generate ...`           | `tufa oobi generate ...`                   | Deterministic OOBI output shape                       | `Blocked`     | `packages/keri/test/integration/app/interop-gates-harness.test.ts` |
| `E`  | `E-OOBI-RESOLVE`        | `kli oobi resolve ...`            | `tufa oobi resolve ...`                    | Resolve success and persisted OOBI records            | `Blocked`     | `packages/keri/test/integration/app/interop-gates-harness.test.ts` |
| `F`  | `F-DIRECT-COMMS`        | `kli` direct message flow         | `tufa` direct message flow                 | Message send/receive parity and persisted EXN state   | `Blocked`     | `packages/keri/test/integration/app/interop-gates-harness.test.ts` |
| `F`  | `F-MAILBOX-COMMS`       | `kli` mailbox flow                | `tufa` mailbox flow                        | Mailbox topic+message parity                          | `Blocked`     | `packages/keri/test/integration/app/interop-gates-harness.test.ts` |
| `G`  | `G-CHALLENGE-GEN`       | `kli challenge generate`          | `tufa challenge generate`                  | Word list shape parity                                | `Blocked`     | `packages/keri/test/integration/app/interop-gates-harness.test.ts` |
| `G`  | `G-CHALLENGE-RESPOND`   | `kli challenge respond`           | `tufa challenge respond`                   | Response acceptance shape parity                      | `Blocked`     | `packages/keri/test/integration/app/interop-gates-harness.test.ts` |
| `G`  | `G-CHALLENGE-VERIFY`    | `kli challenge verify`            | `tufa challenge verify`                    | Verify success/failure shape parity                   | `Blocked`     | `packages/keri/test/integration/app/interop-gates-harness.test.ts` |

## Notes

1. Gate A is infrastructure-level and tracked primarily in
   `DB_LAYER_PARITY_MATRIX.md` plus the Gate A-G K/V worklist CSV.
2. This matrix is intentionally command/output focused; DB K/V parity remains
   tracked in the DB-layer artifacts.
3. Gate C was promoted to `Implemented` on 2026-03-17 after
   `interop-gates-harness.test.ts` passed live against a KLI-created encrypted
   store via `tufa list --compat` / `tufa aid --compat`.
4. Gate D remains `Pending` because the repo now proves compat-store visibility
   and AEID association boundaries, but it still does not prove true
   decrypt/re-encrypt parity or reliable signator reopen behavior.
5. Gate F remains `Blocked` because the top-level transport command surface is
   still absent from `tufa --help`, even though the gate is already modeled in
   the harness.
