# keri-ts Architecture Map

## Purpose

This map defines current module boundaries, public API surfaces, and
internal-only implementation areas so refactors can preserve stable contracts.

## Relevant ADRs

- `docs/adr/adr-0001-parser-atomic-bounded-first.md`

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
2. Domain services (`src/app/keeping.ts`, `src/db/basing.ts`, event processors)
   - `Manager` orchestrates creators, keeper state, AEID policy, and replay.
   - concrete signing/verification should stay on CESR primitives.
3. Infrastructure adapters (`src/db/core/**`)

### CESR Stack

1. Public API (`packages/cesr/src/index.ts`)
2. Parser orchestration (`core/parser-engine.ts`, parser dispatch)
3. Primitive parsers + table codex
   - executable crypto primitives live here as well:
     `Signer.sign()`, `Verfer.verify()`, and `Salter.signer()` are the public
     behavior seams.
   - executable sealed-box primitives live here too:
     `Cipher.decrypt()`, `Encrypter.encrypt()`, `Encrypter.verifySeed()`,
     `Decrypter.decrypt()`, and `Streamer` are CESR-owned behavior seams.
   - Signature-suite dispatch belongs here as well:
     `packages/cesr/src/primitives/signature-suite.ts` is the only place that
     should import concrete curve implementations for signer/verifier work.
   - Variable-family size/code promotion belongs in the shared `Matter`
     encoding/parsing layer, not in ad hoc subclass-local normalization logic.
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
- Keep KEL/reply/runtime verification primitive-driven: higher layers should
  call `Verfer.verify()`, and higher-layer signing should flow through
  `Signer.sign()` or `Manager` orchestration rather than importing concrete
  curve code or suite helpers directly.
- Keep sealed-box encryption primitive-driven too: higher layers should call
  `Cipher` / `Encrypter` / `Decrypter` rather than reimplementing libsodium/X25519
  behavior in app or keeper code.
- Treat `Manager.sign({ pre, path })` as keeper-state addressing, not as a raw
  derivation-string passthrough. `path` identifies a managed key lot by
  `(ridx, kidx)`; `salty` managers may reconstruct it from persisted derivation
  parameters, while `randy` managers can only resolve it back to stored signers.
- Treat `packages/keri/src/core/keeper-crypto.ts` as a compatibility wrapper,
  not a true ownership layer. New encryption/decryption behavior belongs in
  CESR primitives first.

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
