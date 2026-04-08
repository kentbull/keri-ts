# `lmdb-js` Deno Cleanup-Hook Notes

## Scope

This note documents the smallest upstream candidate patch we want to propose to
`lmdb-js` for Deno compatibility.

The upstream patch is intentionally limited to cleanup-hook lifecycle handling
in:

- `src/env.cpp`
- `src/lmdb-js.h`

It does not include any lock-semantics changes.

## Problem Statement

Under Deno, `lmdb-js` can panic in Node-API cleanup-hook handling with errors
equivalent to:

- `Cannot remove cleanup hook which was not registered`
- `Cannot register cleanup hook with same data twice`

`lmdb-js` currently registers cleanup hooks in two places:

- per `EnvWrap` using `cleanup(this)`
- per thread-local `openEnvWraps` bookkeeping using `cleanupEnvWraps(nullptr)`

The second registration reuses the same `(fun, arg)` pair across repeated
registrations because the `arg` is always `nullptr`.

## What We Verified Locally

- the cleanup-hook failures were reproducible in Deno against `lmdb@3.5.3`
  with `LMDB_DATA_V1=true`
- the failures matched the Node-API cleanup-hook contract problems we saw in
  `lmdb-js`:
  - duplicate registration of the same `(fun, arg)` pair
  - removal of a hook that is no longer registered
- a separate macOS resource-exhaustion condition can also happen during long,
  high-churn local sessions, but that is a different issue
- forcing `MDB_NOLOCK` / `noLock` was tested and is not a valid fix:
  - it caused real mailbox/interoperability breakage in `keri-ts`
  - once removed, the lock-path suite passed again

So the upstream story should stay tightly scoped: fix cleanup-hook lifecycle
correctness, and keep lock behavior unchanged.

## Upstream Candidate Patch

### Per-`EnvWrap` hook

- add `cleanupHookRegistered` to `EnvWrap`
- initialize it to `false`
- only register `cleanup(this)` when not already registered
- in `cleanup(void* data)`, clear the flag before `closeEnv()`
- in explicit `closeEnv()`, only remove the hook when the flag says it is
  currently registered

This keeps the existing cleanup behavior while making add/remove balanced and
explicit.

### `cleanupEnvWraps`

- keep the bookkeeping
- register `cleanupEnvWraps` with `openEnvWraps` as the hook `arg`
- update `cleanupEnvWraps(void* data)` to delete the exact vector passed in
- if the current thread-local `openEnvWraps` matches that pointer, null it out

This preserves teardown behavior while making each hook registration unique by
`arg`.

## Explicitly Out Of Scope

`MDB_NOLOCK` is not part of the upstream cleanup-hook patch.

Reason:

- it changes LMDB concurrency and locking semantics
- it only appeared attractive because of a separate macOS
  `LMDB_DATA_V1`/resource-exhaustion problem
- it is not the smallest or best-justified response to the cleanup-hook bug
- in our local verification, it made real cross-process interop behavior worse

If macOS still reproduces `ENOSPC` on open after the cleanup-hook fix, that
should be documented and addressed as a second issue.

## Patch Mapping

The local `keri-ts` patch set that corresponds to this upstream candidate is:

- [`lmdb-deno-cleanup-hook.patch`](/Users/kbull/code/keri/kentbull/keri-ts/packages/keri/scripts/patches/lmdb-deno-cleanup-hook.patch)
  Adds `cleanupHookRegistered`, initializes it, guards cleanup-hook
  registration, and clears the flag in the cleanup callback.
- [`lmdb-deno-cleanup-closeenv.patch`](/Users/kbull/code/keri/kentbull/keri-ts/packages/keri/scripts/patches/lmdb-deno-cleanup-closeenv.patch)
  Guards `napi_remove_env_cleanup_hook(...)` behind the explicit registration
  flag.
- [`lmdb-deno-cleanup-envwraps.patch`](/Users/kbull/code/keri/kentbull/keri-ts/packages/keri/scripts/patches/lmdb-deno-cleanup-envwraps.patch)
  Makes `cleanupEnvWraps(void* data)` act on the exact vector pointer passed to
  the hook instead of relying on ambient thread-local state.
- [`lmdb-deno-cleanup-envwraps-register.patch`](/Users/kbull/code/keri/kentbull/keri-ts/packages/keri/scripts/patches/lmdb-deno-cleanup-envwraps-register.patch)
  Registers `cleanupEnvWraps` with `openEnvWraps` as the hook `arg` instead of
  `nullptr`.

Those four changes are the intended upstream patch. Nothing related to
`noLock`, warning suppression, or lock-semantics changes should be included.
