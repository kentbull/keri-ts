---
"@keri-ts/tufa": minor
---

Complete the TypeScript KF boot service's routes: `/onboarding/account/create`, idempotent `/onboarding/complete` (also on a completed session, which recovery relies on), and the account surface: `/account/services` with registrar/observer enrollment of the accepted public KEL and an exact acknowledgement check, `/account/witnesses`, `/account/watchers`, `/account/watchers/status` (backend status plus derived resource status), and the witness, watcher and account deletes. Expiry is checked on access.
