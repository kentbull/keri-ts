# CESR Parser Readability Improvement Plan

## Status

- Created: 2026-02-27
- Priority: high
- Scope:
  - `packages/cesr/src/core/parser-engine.ts`
  - `packages/cesr/src/parser/group-dispatch.ts`
  - `packages/cesr/src/parser/attachment-parser.ts`
  - `packages/cesr/src/primitives/mapper.ts`
  - parser types, errors, and tests in `packages/cesr`

## Purpose

This plan defines ten concrete parser-readability improvements for `keri-ts` CESR parsing, with emphasis on:

- human comprehensibility for maintainers
- defensible design decisions aligned with SOLID and clean-code principles
- preserving real-world CESR compatibility behavior while making that behavior explicit

The plan is informed by comparison against `keripy` main (`keripy/src/keri/core/parsing.py`), while keeping the `keri-ts` architectural advantage of parse-only responsibilities and no direct event-processing side effects.

## Design Principles

- Single Responsibility: parsing, boundary policy, version fallback, and semantic interpretation should not be interleaved.
- Open/Closed: new CESR codes and parser policies should be addable without rewriting core control flow.
- Liskov/Interface Segregation: smaller parser interfaces should isolate behavior (body parse vs attachment parse vs boundary policy).
- Dependency Inversion: policy choices should be injected, not hard-coded in control branches.
- Clean Code: explicit invariants, minimal hidden state, predictable naming, and typed domain models.

## Ten-Point Plan

### 1) Publish an explicit parser state machine contract

Document and codify parser states, transitions, and emission rules currently spread across:

- `drain()`
- `parseFrame()`
- `resumePendingFrame()`
- `flush()`

Deliverables:

- state diagram and transition table in docs
- code comments that state invariant per transition
- removal of parser TODO ambiguity in control flow

Why:

- highest readability gain per line changed
- reduces maintainers needing to infer behavior from nested branches

### 2) Decompose `CesrParser` into focused collaborators

Refactor `CesrParser` orchestration to delegate responsibilities to small units:

- stream/cursor state management
- frame start parsing (message, native, wrapped body groups)
- attachment continuation/collection
- version context management

Deliverables:

- reduced method size and branch fan-out in `parser-engine.ts`
- collaborator interfaces with tight responsibilities

Why:

- keeps the top-level parser readable as control logic rather than implementation details

### 3) Replace boolean policy branching with strategy interfaces

Current behavior gates (`framed`, compat/strict fallback handling) should become injected policy objects:

- `FrameBoundaryPolicy`
- `AttachmentVersionFallbackPolicy`

Deliverables:

- elimination of policy condition scattering
- one policy implementation for current behavior; additional policies addable without parser core edits

Why:

- makes behavior choices explicit and testable in isolation

### 4) Replace `unknown[]` attachment payloads with discriminated types

`AttachmentGroup.items: unknown[]` should become typed structures keyed by attachment kind/code.

Deliverables:

- discriminated union for parsed attachment payloads
- explicit shape for tuple/repeated/wrapper groups
- compatibility-preserving raw-bytes access remains available

Why:

- readers and downstream users can understand payload meaning from types, not source spelunking

### 5) Convert dispatch definitions to a single declarative spec

Keep table-driven dispatch, but define groups from one source of truth (descriptor table), then derive maps.

Deliverables:

- descriptor schema for group code, version, parser kind, and semantic shape
- generated or mechanically built dispatch maps from descriptors

Why:

- minimizes repetition and drift risk in large manual maps
- eases code review for new CESR code additions

### 6) Make recovery behavior explicit, configurable, and observable

Current fallback/recovery behavior (mixed-version compat, opaque wrapper tails) should be governed by explicit policy and emitted as structured diagnostics.

Deliverables:

- `RecoveryPolicy` modes (strict/compat/permissive)
- structured hooks/telemetry events for fallback and opaque recovery
- no direct `console.warn` in parser core

Why:

- operationally safer and easier to justify in ecosystem integration

### 7) Separate syntax parsing from semantic interpretation

Split token-level extraction from semantic interpretation (ilk/said/labels/native metadata).

Deliverables:

- syntax pass produces typed parse artifacts
- semantic pass derives metadata from artifacts
- clearer error classes for syntax failures vs semantic interpretation failures

Why:

- cleaner reasoning and simpler debugging
- avoids hidden coupling between tokenization and semantic guesses

### 8) Add parity-oriented behavioral lock tests against `keripy`

Add vectors and property-like split tests that validate behavior in areas where parser logic is subtle.

Target cases:

- genus-version counters and version stack behavior
- BodyWithAttachmentGroup nesting
- generic group nesting and re-entry
- mixed-version wrapper payloads
- attachment continuation across chunk boundaries

Deliverables:

- fixture set and expected outputs documented
- tests grouped by behavior contract, not just method under test

Why:

- provides maintainers high confidence that readability refactors preserve semantics

### 9) Apply naming and terminology normalization pass

Standardize terms used in code and docs:

- frame vs message
- body-group vs attachment-group
- annotation byte handling
- pending/incomplete frame lifecycle

Deliverables:

- terminology glossary in parser docs
- renamed identifiers where ambiguity exists

Why:

- naming clarity lowers future cognitive load more than micro-optimizations

### 10) Gate performance optimization behind readability-first abstractions

Apply buffer optimizations only after state contracts and decomposition are complete.

Deliverables:

- use and extend deferred perf plan:
  - `docs/plans/cesr-parser-buffer-perf-plan.md`
- ensure optimized internals remain hidden behind readable abstractions

Why:

- avoids introducing low-level complexity before behavior is fully legible and verified

## Non-Goals

- no immediate change to public parser behavior in this plan itself
- no mandatory replacement of compatibility recovery behavior; only explicitness and policy control
- no optimization work that reduces readability without benchmark evidence

## Acceptance Criteria

- parser behavior is preserved or changes are explicitly documented and tested
- code paths for frame boundaries and fallback behavior are explainable from docs without deep source reading
- dispatch and payload representations are strongly typed and reviewable
- maintainers can map each behavior to tests and policy choices

## Related Docs

- `docs/plans/cesr-parser-buffer-perf-plan.md`
- `packages/cesr/test/unit/parser.test.ts`

