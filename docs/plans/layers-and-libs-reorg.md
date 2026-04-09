# Plan: Reorganize Layers and Libraries Across cesr-ts, keri-ts, and tufa

## Summary

Verdict: current `keri-ts` mixes protocol library, server hosting, and CLI
concerns too much. That is the real problem.

The solution is a hard package split now:

- `cesr-ts` stays the pure codec/primitive library
- `keri-ts` becomes the protocol/runtime library and stays browser-safe by
  default
- `tufa` becomes the CLI and server application package on top of `keri-ts`

One shared host kernel must come first so mailbox, witness, and later roles
reuse one lifecycle, middleware, and runtime foundation instead of each growing
their own server stack. Hono is the only HTTP framework choice for the new
server layer, and it stays at the HTTP edge of `tufa`.

## Current Findings

1. `keri-ts` currently exposes server hosting through `startServer`.
2. `keri-ts` currently exposes CLI entry through `tufa`.
3. The recent internal `protocol-handler` refactor improved cohesion, but it is
   still an internal HTTP app layer inside `keri-ts`.
4. The current server stack has no first-class CORS or middleware layer.
5. Browser/library concerns and server/CLI concerns still share package surface
   too closely.
6. Hono has the more familiar app and middleware mental model for a future
   platform.
7. Hono has stronger app-level testing ergonomics for this use case through
   `app.request()`.
8. H3 is attractive as a minimal server kernel, but it is not the best choice
   for the platform direction here.

## Architectural Decisions

These decisions are locked for this reorganization:

1. Do a hard split now. Do not add staged compatibility shims as the main
   strategy.
2. `tufa` becomes the first-class application package.
3. `keri-ts` main surface becomes browser-safe by default.
4. Hono is used only in `tufa`.
5. Hono does not leak into `keri-ts`.
6. A shared host kernel is the first internal boundary inside `tufa`.
7. Role modules sit on top of that kernel:
   - mailbox
   - witness
   - later watcher, observer, registrar, adjudicator
8. `tufa` is an application package, not a peer library abstraction.
9. Effection is canonical for orchestration and lifecycle layers, but pure and
   synchronous protocol code remains pure.

## Target Package Topology

The intended dependency graph is:

- `tufa -> keri-ts -> cesr-ts`

Package responsibilities:

### `cesr-ts`

- pure CESR codec and primitive library
- no hosting, server, or CLI concerns

### `keri-ts`

- KERI protocol and runtime library
- browser-safe default surface
- no default Hono, Node server, or CLI hosting API

### `tufa`

- shared host kernel
- Hono app and middleware edge
- CLI commands
- operator UX
- server role modules
- adapters into `keri-ts`

## Target Internal Layering Inside `tufa`

`tufa` should be built from these layers, in this order:

### Host kernel

- Effection lifecycle
- startup and shutdown
- supervision
- runtime wiring
- request context
- shared config

### HTTP app edge

- Hono app factory
- route mounting
- CORS
- `OPTIONS`
- request logging
- structured error mapping
- common middleware

### Role modules

- mailbox host
- witness host
- future role hosts

### Adapters into `keri-ts`

- request and response translation
- cue and runtime integration
- protocol-specific handler delegation

## Hono vs H3 Decision Rationale

Verdict: use Hono and do not adopt H3 in this architecture.

Hono wins because the product direction is a general-purpose server and web
platform, not just minimal protocol hosting.

Hono gives the more standard app mental model:

- route tree
- middleware stack
- `onError`
- built-in CORS and logger middleware
- mounting and sub-app composition

Hono also has the nicer test story for app-level surfaces through
`app.request()`.

H3 is not being chosen because mixing both frameworks would increase cognitive
load without enough payoff. Its strengths as a small universal server kernel do
not outweigh the benefits of one familiar platform model for maintainers and
application developers.

## Staged Execution Plan

### Stage 1. Freeze boundaries and define package seams

- define what must leave `keri-ts`
- identify server-only and CLI-only exports
- decide the future public surfaces of `keri-ts` and `tufa`
- lock the rule that `keri-ts` default imports must remain browser-safe

### Stage 2. Extract the shared host kernel

- move shared hosting and runtime lifecycle concerns out of `keri-ts` server
  glue into a reusable kernel design
- define the kernel API around Effection lifecycle and runtime hosting
- ensure mailbox and witness can both sit on top of it

### Stage 3. Introduce `tufa`

- create the new package
- move server hosting code there
- keep the internal role behavior initially parity-preserving
- adopt Hono only at the HTTP edge
- preserve existing protocol behavior while changing package ownership

### Stage 4. Introduce Hono middleware and server policy

- add CORS
- add `OPTIONS`
- add request logging
- add structured error mapping
- add the basic middleware envelope needed for future platform use
- keep protocol and domain logic out of the middleware layer

### Stage 5. Move role servers onto the shared kernel

- mailbox server
- witness server
- preserve current behavior and tests
- do not expand into future roles yet beyond skeletal placeholders if helpful

### Stage 6. Complete `tufa` application ownership

- move remaining CLI entrypoints and command registration into `tufa`
- make the shared host kernel and role servers `tufa`-owned
- remove remaining application ownership from `keri-ts`

### Stage 7. Slim `keri-ts` to its proper library boundary

- remove default server and CLI exports from the main public surface
- keep protocol, runtime, and browser-usable APIs
- audit package exports to ensure browser safety and no accidental server
  framework leakage

### Stage 8. Future platform follow-ons

These are explicitly later work, not part of the initial hard split:

- auth middleware
- cookies and sessions if needed
- static asset serving if needed
- richer app composition for non-KERI platform consumers
- future role servers beyond mailbox and witness

## Public Interface Impact

This reorganization is intentionally breaking:

1. `keri-ts` no longer owns the main server and CLI surface.
2. `startServer` moves out of `keri-ts` main boundary into `tufa`.
3. `tufa` CLI entrypoint moves into `tufa`.
4. Role-specific server builders live in `tufa`.
5. Browser consumers should import only `keri-ts` protocol and runtime
   surfaces.

## Validation Plan

### Package boundary validation

- browser-safe import smoke checks for `keri-ts`
- no Hono or Node server imports reachable from the default `keri-ts` surface
- expected dependency graph between packages

### `tufa` validation

- Hono `app.request()` tests for:
  - CORS
  - `OPTIONS`
  - request logging wiring
  - structured error mapping
  - route precedence
- host-kernel lifecycle tests with Effection

### Role-host validation

- mailbox host parity tests
- witness host parity tests
- no regression in current Gate E, mailbox, or witness behavior

- command wiring tests
- loglevel and failure reporting tests
- end-to-end command flows through `tufa`

## Assumptions

1. Hard split now is acceptable because there are no external compatibility
   constraints.
2. Hono is the only framework choice for the new server layer.
3. H3 is intentionally not used.
4. Shared host kernel comes before broadening server-role coverage.
5. Effection is the orchestration model, not a reason to wrap pure compute.
6. `keri-ts` remains browser-safe by default and should not depend on
   server-framework surface area.
