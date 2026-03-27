# ADR-0002: `PathManager` As The Local `Filer`-Equivalent Path Lifecycle Seam

- Status: Accepted
- Date: 2026-03-27
- Scope: `packages/keri` path lifecycle for DB and config resources
- Related:
  - `packages/keri/src/db/core/path-manager.ts`
  - `packages/keri/src/db/core/lmdber.ts`
  - `packages/keri/src/app/configing.ts`

## Context

In HIO, `Filer` is the shared path/resource base used by higher-level classes
such as KERIpy `LMDBer` and `Configer`. Its job is not "database logic" or
"config serialization"; its job is filesystem policy:

- derive persistent, clean, alt-home, and temp paths
- validate `name` / `base` path components
- support `reuse`, `clear`, and `clean` lifecycle choices
- fall back from a preferred system path to an alternate home path
- optionally own an opened file handle when a subclass wants that shape

`keri-ts` needs the same path-policy seam, but the runtime shape is different:

- `LMDBer` owns an LMDB environment, not a generic file handle
- `Configer` uses stateless atomic write-by-rename semantics, not
  seek/truncate/write on one long-lived open file
- lifecycle entrypoints are Effection operations, so constructors cannot
  silently perform the full open/reopen path
- npm/Node execution via `@deno/shim-deno` can surface permission errors with
  Node-style `code` values like `EACCES` / `EPERM`

## Decision

`PathManager` is the local `keri-ts` equivalent of the `Filer` responsibility
boundary.

Concretely:

- `PathManager` owns path derivation, primary-vs-alt fallback, temp/clean
  variants, and `reuse` / `clear` policy
- `LMDBer` and `Configer` compose `PathManager` instead of inheriting a shared
  base class
- owner classes inject their own tail/default paths, analogous to how KERIpy
  subclasses specialize `Filer`
- actual resource ownership stays with the resource owner:
  - `LMDBer` owns LMDB env open/close/version lifecycle
  - `Configer` owns config-file naming, JSON serialization, and atomic writes

## Similar Responsibilities To HIO `Filer`

- one shared place to derive persistent, clean, alternate-home, and temporary
  resource roots
- one shared place to validate relative path components and naming constraints
- one shared place to implement primary-path then alt-home fallback semantics
- one shared place to honor `reuse`, `clear`, and reopen-style lifecycle policy

## Substantive Differences And Why They Exist

1. Composition instead of inheritance.
   `Filer` is a Python base class; `PathManager` is a helper owned by
   `LMDBer` and `Configer`. This keeps path policy reusable without forcing the
   rest of the Python class hierarchy or coupling unrelated resource lifecycles
   together.

2. Path policy only, not handle policy.
   `Filer` may also own a file handle. `PathManager` does not. In `keri-ts`,
   path preparation is the shared concern, but LMDB env lifecycle and config
   file I/O are meaningfully different enough to stay in their owning classes.

3. Explicit Effection reopen/close lifecycle.
   `Filer` may reopen from `__init__`. `PathManager.reopen()` is an Effection
   `Operation` invoked explicitly by callers/factories. This matches
   structured-concurrency rules and avoids hiding side effects in constructors.

4. Cross-runtime permission normalization.
   `PathManager` treats Deno permission errors and Node-style mkdir errors
   (`EACCES`, `EPERM`) as the same fallback signal. That preserves the same
   primary-to-alt behavior across Deno and npm/Node runtimes.

5. Narrower live usage than full `Filer` parity.
   `PathManager` keeps some `Filer`-shaped vocabulary, but current `keri-ts`
   call sites use it as a directory/root-path seam. They do not rely on it as a
   general opened-file abstraction, and maintainers should not assume that it
   provides full `Filer` file-handle semantics.

## Consequences

- Changes to root-path layout, temp/clean naming, or fallback behavior belong in
  `PathManager`.
- Changes to LMDB env ownership belong in `LMDBer`.
- Changes to config file naming/serialization/durability belong in `Configer`.
- When porting a KERIpy class that currently inherits `Filer`, first decide
  whether `keri-ts` needs shared path policy only or a new resource owner with
  its own lifecycle. Do not reintroduce Python-style inheritance by reflex.
