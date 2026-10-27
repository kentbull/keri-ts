# ADR-0011: Package Architecture

- Status: Accepted
- Date: 2026-04-09
- Scope: repo-level package boundaries across `packages/tufa`, `packages/verifier`,
  `packages/hosting`, `packages/keri`, and `packages/cesr`
- Related:
  - `docs/ARCHITECTURE_MAP.md`
  - `docs/archived-plan-docs/packaging/layers-and-libs-reorg.md`
  - `docs/adr/adr-0003-agent-runtime-composition-root.md`
  - `docs/adr/adr-0004-cue-runtime-portability.md`
  - `docs/adr/adr-0009-mailbox-architecture.md`
  - `docs/adr/adr-0010-signed-keri-http-ingress.md`

## Context

`keri-ts` previously mixed several responsibilities inside one package boundary:

- reusable protocol/runtime library concerns
- long-lived server/listener ownership
- runnable CLI ownership

That taught the wrong mental model to maintainers:

- browser-safe library surfaces and host-only concerns looked like one package
- HTTP framework and listener choices could leak into the library boundary
- public API expectations blurred together with internal application plumbing

The repo now already behaves as a split system, and plans plus architecture
notes describe that shape. What is missing is one ADR-level statement that
records the split as a durable architectural rule.

## Decision

The repo uses concrete package boundaries with a one-way dependency graph:

- `tufa -> @keri-ts/verifier -> keri-ts -> cesr-ts`
- `tufa -> @keri-ts/hosting -> keri-ts -> cesr-ts`
- Tufa also uses KERI and CESR public operations directly; both extracted
  application packages use the concrete public operations they need.

Package ownership is:

### `cesr-ts`

- owns CESR parsing, primitives, codices, serders, and CESR-native annotate or
  tooling concerns
- must remain independent of KERI protocol, runtime hosting, and CLI/server
  concerns

### `keri-ts`

- owns KERI protocol, runtime, DB-backed persistence, and reusable
  protocol/runtime helpers built on `cesr-ts`
- root/default imports must remain browser-safe
- non-browser-safe concerns must live only behind explicit subpaths:
  - `./runtime`
  - `./db`
- must not own Hono, listener startup, or runnable CLI entrypoints

### `@keri-ts/verifier`

- owns the credential verifier application, business validators, webhook
  projection and local workflow cue sidecar
- borrows public KERI runtime/DB and CESR operations without owning CLI registration,
  host/listener composition or protocol acceptance
- exposes its supported application API through `packages/verifier/mod.ts`

### `@keri-ts/hosting`

- owns the connected HTTP host/kernel, Deno/Node adapters, Hono app policy/error
  handling and protocol route composition
- preserves the existing concrete lifecycle and borrowed KERI runtime operations
- exposes supported host/app/protocol operations through `packages/hosting/mod.ts`
- does not own Tufa role/indirect-host/CLI porcelain or witness TCP composition

### `tufa`

- owns application/CLI UX, indirect-host and operator-facing role composition,
  including witness TCP; it consumes the concrete HTTP hosting package
- retains `tufa verifier run` registration, runtime composition and the full CLI
  workflow test, consuming `@keri-ts/verifier` directly
- is an application package, not a generic host framework abstraction for other
  packages

## Supported Public Entry Points

The supported package entrypoints are:

- `packages/cesr/mod.ts`
- `packages/keri/mod.ts`
- `packages/keri/runtime.ts`
- `packages/keri/db.ts`
- `packages/keri/cli.ts` (separate command-helper boundary consumed by Tufa)
- `packages/tufa/mod.ts`
- `packages/hosting/mod.ts` (HTTP host/app/protocol operations and data)
- `packages/verifier/mod.ts` (verifier application operations and data)

The runtime barrel names supported operations and data explicitly; module
wildcards must not silently expand that contract. npm exposes the named root,
runtime, db and cli entrypoints, with no app/core/db/vdr implementation patterns.
Installed-package checks use those same named surfaces.

Internal implementation zones remain internal unless deliberately exported:

- `packages/tufa/src/**` is internal application implementation, not a stable
  public library surface
- `packages/keri/src/**` and `packages/cesr/src/**` are implementation zones
  behind their package entrypoints unless explicitly exported

## Boundary Rules

- `keri-ts` must not regain CLI entry ownership
- `keri-ts` must not regain listener startup or Hono ownership
- `tufa` may depend on `@keri-ts/verifier`, `@keri-ts/hosting` and `keri-ts`;
  extracted application packages depend on public KERI/CESR surfaces and never on Tufa
- `keri-ts` may not depend on either application package
- `keri-ts` may depend on `cesr-ts`, but `cesr-ts` must remain independent of
  KERI or application hosting concerns
- package-surface tests should validate behavior at the owning package boundary:
  - `packages/tufa/test/**` for CLI, role/indirect-host composition and composed workflows
  - `packages/verifier/test/**` for verifier workflow, policy and webhook behavior
  - `packages/hosting/test/**` for HTTP host, routing, policy and joined cleanup
  - `packages/keri/test/**` for library, runtime, and DB behavior
  - `packages/cesr/test/**` for CESR behavior

## Rationale

- preserves a clean dependency graph
- makes `keri-ts` usable as a real library instead of an app/library hybrid
- prevents browser-hostile imports from leaking into the default KERI surface
- keeps HTTP framework and concrete HTTP listener ownership in `@keri-ts/hosting`
- keeps CESR reusable below KERI instead of drifting into KERI-shaped or
  application-shaped ownership
- matches the package boundaries the repo is already validating and maintaining

## Consequences

Positive:

- clearer ownership boundaries
- more stable library surfaces
- lower drift between application code and library code
- better release and test discipline at the actual package boundaries

Negative:

- more explicit coordination across package boundaries
- some reusable command-operation bodies may still physically live under
  `packages/keri/src/cli/*` even though ownership is split by package
  surface rather than source-folder location
- maintainers must resist importing internal `packages/tufa/src/**` modules as
  though they were stable public APIs

## Non-Goals

This ADR is not:

- a full source-tree walkthrough
- a release-process ADR
- a promise that every internal file already lives in its final ideal folder
- a detailed role-host design ADR beyond the package boundary itself
