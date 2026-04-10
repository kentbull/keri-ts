# keri-ts Architecture Map

## Purpose

This map defines current module boundaries, public API surfaces, and
internal-only implementation areas so refactors can preserve stable contracts.

## Relevant ADRs

- `docs/adr/adr-0001-parser-atomic-bounded-first.md`
- `docs/adr/adr-0011-three-package-architecture.md`

## Top-Level Boundaries

- Dependency graph:
  - `tufa -> keri-ts -> cesr-ts`
- `mod.ts`
  - Repo-root runner for the `tufa` application package.
- `packages/keri/mod.ts`
  - Browser-safe default library surface for `keri-ts`.
- `packages/keri/runtime.ts`
  - Explicit non-browser-safe runtime surface for `keri-ts`.
- `packages/keri/db.ts`
  - Explicit LMDB-backed persistence surface for `keri-ts`.
- `packages/tufa/**`
  - CLI/application package boundary.
- `packages/tufa/src/host/**`
  - Active shared host kernel plus Deno/Node/TCP listener ownership.
- `packages/tufa/src/http/**`
  - Active Hono shell, Stage 4 middleware policy, and HTTP route composition
    ownership.
- `packages/tufa/src/roles/**`
  - Active mailbox and witness role-host composition ownership.
- `packages/tufa/src/cli/**`
  - Active CLI runtime, command tree, dispatch plumbing, and long-lived host
    command ownership.
- `packages/keri/src/**`
  - Core, runtime, DB, and the remaining non-host command implementations for
    `keri-ts`.
- `packages/cesr/**`
  - Reusable CESR library package (parser, primitives, annotations).

## Public API Surfaces (Current)

### `keri-ts`

- `packages/keri/mod.ts`
  - Narrow browser-safe default library surface. This is one of exactly three
    supported `keri-ts` entrypoints.
- `packages/keri/runtime.ts`
  - Explicit runtime surface for runtime/file/network concerns. This is one of
    exactly three supported `keri-ts` entrypoints.
- `packages/keri/db.ts`
  - Explicit LMDB-backed persistence surface. This is one of exactly three
    supported `keri-ts` entrypoints.

### `tufa`

- `packages/tufa/mod.ts`
  - Runnable CLI entrypoint under Effection.
- `packages/tufa`
  - Application package that owns the `tufa` binary boundary.
- `packages/tufa/src/host/*`
  - Internal shared host kernel and listener adapters.
- `packages/tufa/src/http/*`
  - Internal Hono edge, app policy middleware/error mapping, and protocol-route
    composition.
- `packages/tufa/src/roles/*`
  - Internal mailbox/witness role-host composition over the shared kernel.
- `packages/tufa/src/cli/*`
  - Internal CLI runtime, command registration, dispatch helpers, and active
    long-lived host commands.

### CESR Package

- `packages/cesr/mod.ts`
  - Package entrypoint.
- `packages/cesr/src/index.ts`
  - Broad export barrel for parser, primitives, adapters, tables, and annotate
    APIs.

## Internal-Only Zones (Should Not Be Required by Typical Consumers)

- `packages/keri/src/db/core/*`
  - LMDB/path internals and key encoding details.
- `packages/keri/src/app/cli/*`
  - Transitional source location for the remaining reusable non-host command
    implementation bodies only; the active runnable CLI, command tree, dispatch
    plumbing, and long-lived host commands live in `packages/tufa/src/cli/*`.
- `packages/tufa/test/*`
  - Canonical package-surface CLI, server, host, and HTTP edge validation.
- `packages/keri/test/*`
  - Canonical library/runtime/DB/protocol validation, even when some tests use
    Tufa helpers as scaffolding.
- `packages/cesr/src/tables/*.generated.ts`
  - Generated code tables.
- `packages/cesr/scripts/*`
  - Build/generation utilities.
- `packages/cesr/src/router/router-stub.ts`
  - Stub integration utility (not protocol core).

## Core Layering (Desired Direction)

### Application Stack

1. Application composition (`packages/tufa/**`)
2. Domain/runtime services (`packages/keri/src/app/**`,
   `packages/keri/src/db/**`)
   - `Manager` orchestrates creators, keeper state, AEID policy, and replay.
   - concrete signing/verification should stay on CESR primitives.
3. Infrastructure adapters (`packages/keri/src/db/core/**`)

### CESR Stack

1. Public API (`packages/cesr/src/index.ts`)
2. Parser orchestration (`core/parser-engine.ts`, parser dispatch)
3. Primitive parsers + table codex
   - executable crypto primitives live here as well: `Signer.sign()`,
     `Verfer.verify()`, and `Salter.signer()` are the public behavior seams.
   - executable sealed-box primitives live here too: `Cipher.decrypt()`,
     `Encrypter.encrypt()`, `Encrypter.verifySeed()`, `Decrypter.decrypt()`, and
     `Streamer` are CESR-owned behavior seams.
   - Signer/verifier suite dispatch belongs on the primitives themselves:
     `Signer` and `Verfer` are the only places that should import concrete curve
     implementations for signer/verifier work.
   - Variable-family size/code promotion belongs in the shared `Matter`
     encoding/parsing layer, not in ad hoc subclass-local normalization logic.
   - Base derivation-code semantics such as `transferable`, `digestive`,
     `prefixive`, `special`, and `composable` belong on `Matter`; do not hide
     them in verifier-local helpers. `Signer.transferable` is the intentional
     exception because seed codes do not encode transferability on their own.
4. Adapters (`async-iterable`, `effection`) and tooling (`annotate`)

## Cross-Cutting Concerns

- Error model:
  - CESR still owns its typed parser errors.
  - `packages/tufa/src/http/*` now owns app-level HTTP error mapping for
    unhandled transport-edge failures.
- Logging:
  - `packages/tufa/src/http/*` now uses injected `Logger` middleware for request
    logging and edge-failure reporting.
  - core and runtime layers still mostly use the shared console-backed logger.
- Config/runtime flags: spread between task definitions and module constants.

## Refactor Invariants

- Do not break `deno task kli ...` and `deno task cesr:annotate ...` UX.
- Keep CESR parser behavior and fixture/test parity stable.
- Treat `packages/cesr/mod.ts`, `packages/keri/mod.ts`,
  `packages/keri/runtime.ts`, and `packages/keri/db.ts` as compatibility
  boundaries.
- Keep KEL/reply/runtime verification primitive-driven: higher layers should
  call `Verfer.verify()`, and higher-layer signing should flow through
  `Signer.sign()` or `Manager` orchestration rather than importing concrete
  curve code or suite helpers directly.
- Keep sealed-box encryption primitive-driven too: higher layers should call
  `Cipher` / `Encrypter` / `Decrypter` rather than reimplementing
  libsodium/X25519 behavior in app or keeper code.
- Treat `Manager.sign({ pre, path })` as keeper-state addressing, not as a raw
  derivation-string passthrough. `path` identifies a managed key lot by
  `(ridx, kidx)`; `salty` managers may reconstruct it from persisted derivation
  parameters, while `randy` managers can only resolve it back to stored signers.
- Treat `packages/keri/src/core/keeper-crypto.ts` as a compatibility wrapper,
  not a true ownership layer. New encryption/decryption behavior belongs in CESR
  primitives first.

## Ownership Heuristics

- CESR correctness or stream semantics:
  - `packages/cesr/src/core`, `packages/cesr/src/parser`,
    `packages/cesr/src/primitives`
- Human-readable stream output:
  - `packages/cesr/src/annotate`
- Runtime persistence/LMDB:
  - `packages/keri/src/db/core`, `packages/keri/src/db/basing.ts`
- CLI/server orchestration:
  - `packages/tufa/**`
