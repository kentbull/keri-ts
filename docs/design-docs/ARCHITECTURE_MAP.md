# keri-ts Architecture Map

## Purpose

This map defines current module boundaries, public API surfaces, and
internal-only implementation areas so refactors can preserve stable contracts.

## Top-Level Boundaries

- `mod.ts`
  - Runtime entry point for CLI execution under Effection.
  - Not a library export surface.
- `src/**`
  - Application + database runtime concerns for `keri-ts` CLI/server.
- `packages/cesr/**`
  - Reusable CESR library package (parser, primitives, annotations).
- `src/cesr/**`
  - Compatibility bridge re-exporting CESR package APIs into app namespace.

## Public API Surfaces (Current)

### App/Runtime

- `src/app/index.ts`
  - Exports CLI and server symbols.
- `src/app/cli/index.ts`
  - Exports `kli` and `initCommand`.
- `src/db/index.ts`
  - Exports `Baser` and DB abstractions from `src/db/basing.ts`.

### CESR Package

- `packages/cesr/mod.ts`
  - Package entrypoint.
- `packages/cesr/src/index.ts`
  - Broad export barrel for parser, primitives, adapters, tables, and annotate
    APIs.

## Internal-Only Zones (Should Not Be Required by Typical Consumers)

- `src/db/core/*`
  - LMDB/path internals and key encoding details.
- `src/app/cli/*` (except exported command interfaces)
  - CLI wiring/parsing and terminal I/O behavior.
- `packages/cesr/src/tables/*.generated.ts`
  - Generated code tables.
- `packages/cesr/scripts/*`
  - Build/generation utilities.
- `packages/cesr/src/router/router-stub.ts`
  - Stub integration utility (not protocol core).

## Core Layering (Desired Direction)

### Application Stack

1. CLI/Server composition (`src/app/**`)
2. Domain services (`src/db/basing.ts` and future event processors)
3. Infrastructure adapters (`src/db/core/**`)

### CESR Stack

1. Public API (`packages/cesr/src/index.ts`)
2. Parser orchestration (`core/parser-engine.ts`, parser dispatch)
3. Primitive parsers + table codex
4. Adapters (`async-iterable`, `effection`) and tooling (`annotate`)

## Cross-Cutting Concerns

- Error model: currently mixed (`ParserError` typed in CESR, generic `Error`
  elsewhere).
- Logging: currently direct `console.*` in core and app layers.
- Config/runtime flags: spread between task definitions and module constants.

## Refactor Invariants

- Do not break `deno task kli ...` and `deno task cesr:annotate ...` UX.
- Keep CESR parser behavior and fixture/test parity stable.
- Treat `packages/cesr/mod.ts` and app exports as compatibility boundaries.

## Ownership Heuristics

- CESR correctness or stream semantics:
  - `packages/cesr/src/core`, `packages/cesr/src/parser`,
    `packages/cesr/src/primitives`
- Human-readable stream output:
  - `packages/cesr/src/annotate`
- Runtime persistence/LMDB:
  - `src/db/core`, `src/db/basing.ts`
- CLI/server orchestration:
  - `src/app/**`
