# Move the verifier application into Tufa

Status: accepted supplement to the active 2.0.0 release goal, at Kent's explicit
request. The main release plan schedules this work as PRs 30a–30b before final
ownership assessment, package organization and qualification. This file alone
does not grant authorization beyond that goal.

## Decision and scope

Keep the protocol `Verifier` in `packages/keri`. Move the Sally-style application
that consumes verified credentials, applies business rules, and sends webhooks
into `packages/tufa`.

The distinction is responsibility, not the word “verifier” or whether a function
first appeared in Sally. KERI/ACDC/CESR verification determines whether protocol
evidence is valid. The verifier application decides what that evidence means to
its operator and whether to notify a configured business endpoint.

This is a package-ownership refactor. Preserve the current command and workflow
behavior before making any separate behavior changes. Do not combine the move
with native-v2 verifier support, a new delivery guarantee, a storage migration,
or a general CLI extraction.

Apply the [ten constraints](../../../../../../../enctx/adrs/ten-constraints.md)
and [ADR-0013](../../adr/adr-0013-simple-component-flows.md): move cohesive
responsibilities first, keep concrete dependencies, and add no plugin system,
repository hierarchy, universal notification service, or dependency container.
Use existing storage and HTTP contracts instead of introducing interfaces solely
to make the move look abstract.

## Source-grounded assessment

Inspection baseline: keri-ts HEAD `c5cbca16b0fdf618fc3bc98bdb346ec73173940d`,
with concurrent main-thread edits. Recheck paths, exports, and lifecycle contracts
at implementation time; the main thread is already working on database closure.
Do not overwrite its changes or use this snapshot as release qualification.

Reference sources inspected:

- KERIpy `7143832813cac6a394ab1faf9be83bb3372be87c`,
  `src/keri/vdr/verifying.py`: protocol verification, missing-evidence escrows,
  saved credentials, chain checks, and protocol cues.
- Sally `ed789de4aa5f536d5838b4ff0d4d48a4e9dbf525`,
  `src/sally/core/basing.py` and `src/sally/core/handling.py`: application
  communication state, business acceptance rules, and webhook delivery.
- Local implementations and tests listed below, plus both packages' exports,
  Tufa command dispatch, npm build mappings, and CI suite ownership.

The inspected Python files had no local modifications. These are reference
snapshots, not claims about the latest upstream releases.

Findings:

1. `app/verifying.ts` already declares the right boundary: protocol validation,
   indexing, and VDR escrows belong there; webhook/application policy does not.
2. `app/verifier-agent.ts` orchestrates accepted grants, optional issuer/schema
   business rules, workflow expiry, and HTTP notifications. It does not belong
   in the reusable protocol runtime.
3. `db/verifier-cueing.ts` owns a separate application database. Its `snd.`,
   `iss.`, `rev.`, `recv`, `revk`, `ack`, and `rack` records are workflow state,
   not KEL/TEL evidence or protocol receipts.
4. The implementation is Sally-inspired, not an exact Sally port. In particular,
   the inspected Sally CueBaser has no `rack` table, and its acknowledgement
   processing differs. Do not describe relocation as establishing Sally parity.
5. `processCredentialPresentationArtifacts`, `storedGrantArtifacts`, and
   `credentialSaidFromGrant` are reusable IPEX evidence operations. They must
   remain in keri-ts even though this application consumes them.
6. The command explicitly requires `runtime.vdr`; its state lookup uses legacy
   `Reger.tevers.vcState`. Genus-1/genus-2 attachment tests do not establish
   native-v2 ACDC registry/disclosure support.
7. The application is exported from `keri-ts/runtime`, while its command is
   exported from `keri-ts/cli`. Both ownership leaks must be removed.
8. Tufa already owns command registration, the demonstration webhook target,
   HTTP hosts, and operator workflows. It is the appropriate application home.
9. Several imports work today only because all code is inside one package.
   Moving files without addressing public APIs and npm mappings is insufficient.
10. Existing tests span protocol and application concerns. Move the application
    tests and CI ownership together; retain protocol tests in keri-ts.

## Exact responsibility boundary

| Responsibility                                                                                                    | Owner after the move                                         | Reason                                                                            |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Credential SAID/schema checks, proof and chain validation, missing-evidence escrows, accepted credential indexing | `keri-ts` protocol `Verifier`, schemas, and VDR/ACDC modules | Determines protocol validity independently of a business application              |
| KEL/TEL processing, current credential state, native-v2 verification                                              | Existing keri-ts protocol owners                             | Shared evidence authority; do not duplicate it in Tufa                            |
| IPEX exchange authentication, grant artifact reconstruction and ingestion                                         | Existing keri-ts IPEX/runtime helpers                        | Also used by holder/admit and other protocol workflows                            |
| Saved/revoked/query/proof cues and generic Deck/HTTP/LMDB primitives                                              | Existing keri-ts public APIs                                 | Reusable facts and mechanisms, without webhook policy                             |
| Scanning accepted grants to select business notifications; recovering notification work from saved revocations    | Tufa verifier agent                                          | Application scheduling and projection of protocol state                           |
| Approved-issuer rules and `requireKnownSchemas`                                                                   | Tufa verifier policy                                         | Business trust decision, distinct from validating a credential against its schema |
| Workflow age, notification suppression, pending/ready/delivered records                                           | Tufa verifier agent and cue store                            | Local application state, not protocol consensus                                   |
| JSON payload shape, `sally-resource`/`sally-timestamp`, destination URL, interpreting HTTP success                | Tufa verifier webhook module                                 | Application integration contract                                                  |
| Flags, config-file reading, console output, loop/once selection and resource composition                          | Tufa verifier command                                        | Operator entrypoint                                                               |
| Hook demo server                                                                                                  | Existing Tufa hook command                                   | Already correctly placed                                                          |

Protocol acceptance must remain true even when business policy refuses a
notification. A failed webhook must not revoke or invalidate a credential.
Conversely, business acceptance must never bypass protocol validation.

## Target organization

Use a cohesive feature directory with four implementation files:

```text
packages/tufa/src/verifier/
  agent.ts       # workflow sequencing, grant/revocation discovery and expiry
  cue-store.ts   # existing VerifierCueBaser tables and their LMDB lifecycle
  policy.ts      # business-validator types, config mapping and acceptance checks
  webhook.ts     # application payloads, headers and scoped HTTP delivery
packages/tufa/src/cli/verifier.ts
```

Keep small local helpers with their owner. Do not add a file per method, a
`VerifierRepository` abstraction, a storage provider interface, or a common
“services” bundle. Existing LMDB inheritance can remain during relocation;
redesigning all database owners is outside this change.

Concrete move map:

| Current artifact under `packages/keri`                                                     | Destination or disposition                                 |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `src/app/verifier-agent.ts`                                                                | Split by the four responsibilities above; remove original  |
| `src/db/verifier-cueing.ts`                                                                | `packages/tufa/src/verifier/cue-store.ts`; remove original |
| `src/app/cli/verifier.ts`                                                                  | `packages/tufa/src/cli/verifier.ts`; remove original       |
| `src/runtime/index.ts` application-agent export block                                      | Remove; keep protocol `Verifier` and `VerifierCue` exports |
| `src/app/cli/index.ts` `verifierRunCommand` export                                         | Remove; no forwarding shim                                 |
| `test/unit/app/verifier-agent.test.ts`                                                     | `packages/tufa/test/verifier/agent.test.ts`                |
| `test/integration/app/acdc-verifier-workflow.test.ts`                                      | `packages/tufa/test/integration/verifier-workflow.test.ts` |
| `test/unit/app/verifying.test.ts`, `ipex-credentialing.test.ts` and protocol interop tests | Keep in keri-ts                                            |

Split policy/webhook tests only where independent behavior warrants them.
Put any small verifier fixture helper under `packages/tufa/test/verifier/`.
Do not import `packages/keri/test/support` from the relocated tests. Use public
runtime contracts and small Tufa-owned fixtures, or existing Tufa test utilities.
Preserve the real issuer/holder/verifier topology of the CLI workflow.

## Public API and dependency plan

The direction is Tufa -> public keri-ts APIs -> cesr-ts. No keri-ts source or
test should import the relocated application. No Tufa production or test import
should reach into sibling package `src` trees to compensate for missing exports.

Use existing entrypoints:

- `keri-ts/runtime`: Habery, protocol/runtime owners, HTTP contracts, credential
  state types, shared IPEX operations, and runtime clock contracts.
- `keri-ts/db`: LMDBer, its options, CesrSuber, SerderSuber, and Reger.
- `keri-ts`: suitable already-public core errors/records where available.
- `cesr-ts`: Dater, SerderACDC, Prefixer, Ilks and Versionage.
- Tufa's existing `cli/support/context.ts`: current `withAgentRuntime` lifecycle.
  Its public `keri-ts/cli` dependency is transitional but already established;
  this task must not create another command driver or move every CLI helper.

Specific gaps at the inspection baseline:

1. Export `credentialSaidFromGrant` and `storedGrantArtifacts` explicitly from
   `keri-ts/runtime`, alongside the already-exported
   `processCredentialPresentationArtifacts`. These are protocol operations,
   not application callbacks.
2. Export the existing `IPEX_GRANT_ROUTE` constant through the same entrypoint.
   Do not use the position of an entry in `IPEX_ROUTES` as its identity.
3. The command's `parseGvrsn` currently comes from a private core file. Expose
   the existing parser narrowly through `keri-ts/cli` for transitional command
   consumers. Avoid copying parsing rules or moving unrelated genus logic.
4. Avoid a new export for `encodeDateTimeToDater`: the public CESR Dater accepts
   `dts`. Use `new Dater({ dts: makeNowIso8601(new Date(now())) })`, preserving the
   explicit clock and timestamp representation. Verify equivalence with the
   current clock/expiry test.
5. Map `../keri/db.ts` to npm dependency `keri-ts` subpath `db` in Tufa's
   `dntPackageMappings`. The current build maps CLI/runtime/CESR but not DB.
   Add root mapping only if the actual imports require it. Retain the build's
   ban on bundled sibling source and direct native `lmdb` dependencies.

Expose the application through the existing `@keri-ts/tufa/runtime` entrypoint
for programmatic embedding: `VerifierAgent`, its public options/result types,
business-validator and webhook-body types, `createVerifierCueBaser`, and the
store/options types needed to compose it. Keep helper functions and tables'
implementation details out of the export list unless an actual caller needs them.
Do not create a new package/subpath or add application exports to Tufa's minimal
root. Do not re-export these symbols from keri-ts for backward compatibility.

ProtocolProcessor may be removed by the main release work. Do not preserve or
reintroduce it for this application. Use whichever concrete public protocol
operations survive that work, with explicit dependencies. Do not duplicate
grant parsing, protocol escrow progression, or runtime construction in Tufa.

## Behavior and lifetime rules during relocation

- Preserve the CLI name, flags, hook headers and payloads, application timestamps,
  expiry rules, and current notification suppression semantics.
- Preserve current storage paths and table encoding for this structural move.
  Package ownership does not require changing an operator's disk location.
  Add no migrations, discovery fallbacks or compatibility readers.
- Keep application records out of Baser/Reger. The cue store remains a separate
  Tufa-owned database built on ordinary keri-ts storage primitives.
- HTTP `response.ok`, after response cleanup, currently triggers `ack`/`rack`.
  These are local delivery markers, not verified business receipts or KERI
  acknowledgements. The multi-step storage updates do not establish exactly-once
  delivery or a transaction spanning the protocol and application databases.
- Preserve existing pending-work handling without adding retries, backoff,
  durable outboxes, delivery receipts, or transactional delivery guarantees.
  Document the existing application records narrowly; do not use them as an
  exception permitting these mechanisms in the protocol runtime.
- Keep `Notifier` independent: the application currently scans accepted grants
  without consuming operator notifications.
- A shared cue Deck is not broadcast. Preserve the finite revocation pass and
  restoration of unrelated/failed cues. Do not broaden which records it consumes
  or introduce another consumer without explicit composition.
- The application borrows Habery/Reger/protocol/HTTP/clock dependencies. The
  command owns the cue store and closes it before the enclosing runtime/Habery.
  Integrate the main thread's agreed close contract; do not copy the old error
  suppression or print final success before required cleanup completes.
- Keep the workflow's present legacy-Reger profile explicit. Future native-v2
  application support is a behavior change; do not conflate it with the release
  plan's separate native-v2 protocol/CLI qualification.

Potential shortcomings observed, not authorized fixes in the move: `rejected`
does not appear to be incremented; failed/expired work may be rediscovered;
cue routing and protocol progress need composed-runtime verification. Preserve
behavior and record any reproduced defect for a small follow-up rather than
silently changing semantics while moving files.

## Human-reviewable implementation sequence

Keep one implementation PR active. The main release plan incorporates this
supplement as PRs 30a–30b, after credential feature work and before final ownership
assessment, package organization and qualification. Recheck current exports and
skip work already supplied by those earlier PRs.

### PR A — expose the protocol operations the application needs

Add the narrow IPEX and transitional CLI exports above. Verify their existing
tests through public imports where useful. Do not change protocol semantics.
Check the installed keri-ts declaration surface and browser-safe root boundary.

Read order: runtime/CLI export diff, direct consumer test, changeset.
This PR is small and independently reviewable; no verifier application moves yet.
If the main thread already supplies an export, reuse it rather than duplicating it.

### PR B — move the complete application and its execution path

Move/split the application, its workflow store, and command into Tufa. Remove old
files and exports in the same PR; no temporary cross-package source imports.
Keep the workflow sequence recognizable while extracting policy and webhook
functions by responsibility.

Change `registerVerifierCmds` in Tufa's `command-definitions/credentials.ts` from
`registerKeriCliCommand` to `registerDispatchedCommand` with a lazy import of
`../verifier.ts`. Preserve CLI selection and lightweight help/version startup.
Leave `hook.demo` in its current Tufa location.

Update Tufa runtime exports, DNT package mappings, moved tests and test fixtures,
CI ownership, installed-package checks, and the breaking-change entry together.
These are required parts of the move, not deferred follow-ups.

Read order: package/command wiring, agent sequence, cue store, policy/webhook
modules, relocated tests, npm/CI changes. Prefer an atomic move over extra PRs
that temporarily leave keri-ts depending on Tufa. Minimize unrelated formatting.

Both PRs follow the repository changeset discipline. The completed move is a
breaking keri-ts API change and a Tufa API addition. Record the final import
replacement prominently in the coordinated v2.0.0 release notes and breaking
changes document. Old keri-ts API compatibility is not required.

## Verification and CI ownership

This plan is based on source inspection; no runtime tests were run for planning.
During implementation, use disposable databases and the established Docker
environment if host native resources are unhealthy. Do not mask native failures.

Minimum behavior evidence:

1. Retain the protocol `Verifier` and IPEX artifact tests in keri-ts. Demonstrate
   that they pass without importing any Tufa application.
2. Move all five existing agent cases: issuance for attachment genus 1 and 2,
   revocation cues, recovery from persisted revocation after cue loss, and the
   common wall clock for admission/header/expiry. Preserve their assertions.
3. Add or adapt one boundary regression: a protocol-valid, saved credential
   rejected by configured business policy produces no issuance webhook and
   remains valid/saved in the protocol store.
4. Add or reuse one unsuccessful HTTP case showing no delivered marker, plus
   one scoped cleanup failure case showing the original failure propagates and
   is not converted to successful delivery. No large fault-injection matrix.
5. Move the existing issuer -> holder -> verifier CLI workflow with issuance
   and revocation webhooks and a subsequent no-duplicate invocation. Its separate
   command invocations exercise reopening; keep real LMDB and the loopback hook.
6. Verify lazy dispatch executes the Tufa-owned command, not just that help lists
   it. Keep `--gvrsn` selection and representative validation behavior.

The current `interop-acdc-verifier` suite is a local Tufa CLI workflow, not an
independent Python-peer test. Do not claim it establishes KERIpy interoperability.
Keep actual KERIpy IPEX/credential tests under their existing protocol owners;
run the affected established peer case if shared helper behavior changes.
No new broad Sally or Python matrix is required for a behavior-preserving move.

CI changes must occur with the file moves:

- Remove the old agent path and CLI workflow owner from
  `scripts/ci/keri-test-suites.ts`. Update groups, PR-scope references and
  `.github/workflows/keri-extended-interop.yml` so nothing targets a deleted suite.
- Add an explicit Tufa `test:verifier` task for its application tests and CLI
  workflow. Ensure the Tufa PR/release/qualification route actually invokes them
  and type-checks the new nested test files. Avoid running the same workflow
  twice merely because both recursive discovery and a named task include it.
- Run the existing KERI suite ownership audit after removal. Do not broaden the
  runner into a generic cross-package framework to accommodate two moved files.
- Update fixtures' repository/package-root resolution after moving the workflow.
  They must work independently of the shell's current directory.

Installed-package evidence is mandatory:

- Build and install the coordinated cesr-ts, keri-ts, and Tufa tarballs in an
  isolated consumer. No workspace-source resolution may rescue missing exports.
- Assert that keri-ts runtime still exports the protocol `Verifier` and no longer
  exports the application `VerifierAgent`; keri-ts CLI no longer owns its command.
- Import Tufa's runtime application API, open/close its real cue store, and perform
  one real `tufa verifier run --once` issuance-to-loopback-webhook exercise.
  Reuse the CLI fixture instead of inventing a parallel qualification harness.
- Check emitted declarations with normal strict consumer resolution and confirm
  the package has no bundled `keri/src`/`cesr/src`, private sibling imports, or
  direct native LMDB dependency. The existing build guards must remain enabled.

Run scoped format/lint/type/docs/changeset checks and relevant package tests.
Repeat full release qualification only after this move and the other scheduled
implementation/organization work are complete, using the final source state.

## Completion criteria

- The protocol `Verifier`, proof/schema/chain checks, evidence stores, and IPEX
  processing remain in keri-ts and are usable without the Tufa application.
- No Sally-style webhook policy, verifier communication store, application-agent
  export, or verifier command implementation remains in keri-ts.
- Tufa owns and runs the cohesive verifier feature through public package APIs.
- Existing application behavior and store representation are preserved, except
  independently approved lifecycle corrections from the main thread.
- Unit, CLI workflow, package-boundary, installed-native-store, and required
  regression checks pass; moved tests have an explicit maintained execution path.
- Public API removals are recorded as v2.0.0 breaking changes. Documentation is a
  short ownership/import update, not an execution diary.
- No native-v2 verifier application parity, exactly-once notification delivery,
  or new Sally interoperability is claimed without separate evidence.

The completion report should list moved/removed artifacts, final public imports,
test results, and any remaining behavior defects separately from this ownership
refactor. This supplement does not execute or publish the release.
