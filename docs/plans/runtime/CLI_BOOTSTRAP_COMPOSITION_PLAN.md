# CLI initialization, OOBI bootstrap and option validation

Status: approved release scope, queued after maintainer documentation (13h) and command-owned query cue/KSN cuts (13h1–13h2).
Owner: [release plan cuts 13i–13k](../V2_RELEASE_COMPLETION_PLAN.md).

Refactor CLI initialization, OOBI bootstrap composition and shared option validation in keri-ts.

Respect enctx/adrs/ten-constraints.md, SOLID, ADR-0013, and the existing release plan. Refactor ownership before changing behavior. Optimize for readable, concrete KERIpy-style composition. Old keri-ts API compatibility is unnecessary; preserve protocol interoperability.

This plan was grounded in checkout 0fba1959 at:
/Users/kbull/enc/keri/core/typescript/keri-ts

Recheck current source and pinned KERIpy before each implementation cut, because other refactors are progressing. At integration on `b2e15438`, both commands still duplicate the bootstrap block and whole-agent convergence predicates described below. The shared parsing layer remains in place.

## Current evidence

- packages/keri/src/app/cli/init.ts and incept.ts duplicate the bootstrap runtime block, configuredWellKnownUrls, and assertConfiguredWellKnownAuth.
- init.ts validates unknown options with private stringOption/booleanOption helpers. incept.ts largely casts unknown values and repeats numeric conversion.
- app/cli/common/parsing.ts already owns shared CLI parsing.
- packages/tufa/src/cli/command-definitions/options.ts owns Commander option groups and argument mapping; lifecycle.ts declares init/incept flags.
- Habery.reconfigure() validates bootstrap collections and populates Baser.oobis and Baser.woobi.
- Bootstrap currently creates AgentRuntime, runs its workers, and waits for !runtimeHasPendingWork(). That includes unrelated reply escrows, delegation, queries and deliveries.
- createAgentRuntime constructs substantially more than bootstrap needs, including credential processors, EXN handlers, Poster and mailbox components.
- The bootstrap failure check examines all eoobi records. Authentication helpers accept AgentRuntime even though they only inspect Baser.
- incept.ts also has a separate runtime for delegated inception. Do not confuse that legitimate workflow with bootstrap.
- The runtime now uses WitnessInquisitor. Coordinate with [query composition](QUERY_COMPOSITION_PARITY_PLAN.md) and [command-owned query cues](QUERY_CUE_OWNERSHIP_PLAN.md). Bootstrap must build on the completed Deck/KSN cuts; do not resurrect QueryCoordinator, HTTPQuery or a Channel notification service.
- KERIpy init explicitly composes Oobiery and Authenticator. Its Oobiery constructs the KEL/reply processing it needs. Inspect current reference source before deciding our exact dependency graph.

Deliver this in three cohesive, human-reviewable PRs, with relevant tests accompanying each change.

## 13i: Separate responsibilities and remove duplication

Extract the duplicated bootstrap orchestration into one concrete finite application operation shared by init and incept. Initially preserve behavior so ownership changes are reviewable independently.

Give database inspection helpers their actual dependency, preferably Baser. Do not pass AgentRuntime or replace it with another service bundle. Consolidate only genuinely shared knowledge.

Reuse the existing CLI parsing layer for primitive option validation. Keep initialization credential policy private to initialization: choosing plaintext/passcode/AEID+seed, checking conflicts and key pairing, and confirming a new passcode. Keep hidden terminal input in the existing shared passcode module.

Tufa owns Commander declarations, flags/defaults, output and CLI-specific error presentation. Reusable application operations belong in keri. Maintain package dependency direction: keri must not import Tufa. Coordinate physical CLI relocation with the existing package-organization work rather than starting an unrelated repository-wide move.

Simplify incept’s spawn/join/one-item cue queue if it has no independent consumer or concurrency purpose. Preserve resource ownership and behavior.

## 13j: Replace full-runtime bootstrap with explicit OOBI/authentication composition

The shared operation should have a small, concrete contract, conceptually:

```typescript
yield * resolveBootstrap(hby, http, { timeoutMs: 30_000 });
```

Choose the final name/signature from actual dependencies. Do not introduce BootstrapRuntime, a generic workflow engine, dependency registry, scheduler callbacks, or another persistence system.

Determine the bootstrap work from existing Baser records and validated configuration semantics. State explicitly which queued/in-flight records are included, how existing recovery records are handled, and how multi-OOBI children or other required dependencies affect completion. Reuse existing storage and recovery mechanisms; do not add job IDs or durable tracking merely to scope this operation.

Compose Oobiery, Authenticator, and only the actual KEL/reply processing, escrow and query dependencies required by supported bootstrap behavior. Prefer KERIpy’s explicit composition. Do not merely hide createAgentRuntime behind the new function.

Resolve the required OOBIs before completing well-known authentication. Independent work may remain concurrent where justified. Preserve real dependency recovery; simply deleting workers is not sufficient.

Completion must mean the selected bootstrap work has succeeded, failed, or reached its deadline—not that the whole agent database is quiescent.

- Unrelated historical eoobi failures must not fail this invocation.
- Unrelated delegation, reply escrow or delivery work must not keep it running.
- Empty queues are not proof of success.
- Check required OOBI terminal results and successful well-known authorization.
- A previous authorization must not conceal failure of a fresh authentication attempt.
- Do not weaken protocol acceptance or silently discard relevant escrow/query work to obtain convergence.

Keep a bounded deadline, propagate infrastructure failures, and cancel/join child operations and HTTP cleanup before returning or closing stores. Expected remote outcomes should follow existing decision conventions; Tufa translates unsuccessful command outcomes into nonzero exits.

Remove the duplicated bootstrap predicates/assertions after their responsibilities are absorbed. Remove runtime helpers only when their other callers no longer need them.

Leave delegated inception and long-lived host composition intact unless a narrow dependency adjustment is necessary. Do not make global ProtocolProcessor removal a prerequisite.

## 13k: Apply consistent CLI validation

Finish the shared option contract and migrate equivalent parsing across CLI callers, grouping changes by command family if necessary for review.

- Validate unknown input at the CLI boundary, then pass concrete typed arguments.
- Share primitive string, boolean, list and numeric validation where behavior is actually identical.
- Preserve undefined versus explicit false/zero/empty values wherever option-file merging needs that distinction.
- Apply defaults after precedence is resolved.
- Reject invalid supplied values rather than silently filtering them.
- Validate numeric syntax, finiteness and integer/range requirements appropriate to each option.
- Preserve threshold syntax and existing configurable threshold limits; do not invent new protocol limits.
- Avoid redundant Number conversions, truthiness-based defaults and unchecked casts.
- Keep command-specific policy local. Do not create a schema framework or a giant generic options object.

Retain all #595 credential guarantees: hidden input, confirmation, cancellation, noninteractive failure, matching AEID/seed validation, rejection of contradictory options before store creation, and propagation of persistent-storage failures.

## Validation

Reuse and adapt existing coverage, especially:

- packages/keri/test/unit/app/oobi-runtime.test.ts
- packages/keri/test/unit/app/init-credentials.test.ts
- packages/keri/test/unit/app/incept.test.ts
- existing CLI parsing, configuration and installed-package checks.

Add focused behavioral coverage for:

- successful bootstrap and well-known authentication;
- failed resolution/authentication and bounded cancellation with joined cleanup;
- unrelated stored failures/pending work not determining bootstrap completion;
- existing multi-OOBI/dependency handling remaining functional;
- omitted versus explicit options preserving file/CLI precedence;
- invalid supplied arguments failing before mutating stores.

Use real paths where practical. Avoid tests whose only purpose is checking that deleted APIs stay absent. Reuse relevant KERIpy interop smoke coverage; this refactor does not justify a new exhaustive interop matrix.

Keep static checks and changesets current. Update only documentation whose contract changes; no play-by-play documentation.

## ESSR scope

Do not restore packages/cesr/src/parser/essr.ts or its essrRaw/essrWire wrappers. #599 correctly removed redundant streaming wrappers around resident Texter values. Preserve the current parser, qualified wire serialization, LMDB evidence storage and raw-byte reconstruction. This work does not redesign ESSR.

Report the resulting dependency graph, completion contract, scoped validation and remaining limitations. Integrate these PRs into the existing pre-release sequence; do not release as part of this task.
