# Explicit runtime dependencies

Status: execution authorized; Phase 1 implemented; 77 focused tests and static checks passed. Phases 2–4 remain.
Source baseline: clean local `master` at `137e23d756f4b8fc1a9996517d576827bfcefb51`,
reviewed 2026-10-19. Recheck the implementation baseline before starting.

## Objective and constraints

Remove RuntimeServices and dependency-bearing services options throughout keri-ts.
Require the actual HTTP, clock, store, processor and cue collaborators in the
affected constructor/function contracts. Composition selects implementations and
wires them directly. Correct VerifierAgent's inconsistent time source in a separate
behavioral phase after the structural migration.

Follow [ADR-0003](../../adr/adr-0003-agent-runtime-composition-root.md),
[ADR-0013](../../adr/adr-0013-simple-component-flows.md), SOLID and ENCTX's
`adrs/ten-constraints.md`: separate composition, protocol, transport and workflow
responsibilities; depend on the existing narrow contracts; refactor ownership
before changing behavior. No replacement service container, dependency bag,
registry, factory hierarchy, logging wrapper or compatibility alias.

Implementation, cohesive commits, sequential PR publication and merging are now
authorized in the existing local checkout. The implementation PR boundaries below
remain the delivery units; update qualification evidence as each phase lands.

## Verified starting point

1. RuntimeServices combines HttpClient and RuntimeClock, although their consumers
   do not consistently need both.
2. resolveRuntimeServices merges partial root overrides with production defaults.
3. Authenticator and Oobiery use only HTTP but keep the whole bundle and default it
   inside their constructors.
4. Poster, QueryCoordinator and receipt owners already require their services
   argument, but that argument still hides two dependencies.
5. Anchorer and MailboxPoller mix collaborators and settings in constructor options.
6. MailboxPollTransportRequest carries services inside its request record.
7. TCP output and mailbox SSE independently hide optional clocks in their options
   and choose production defaults below composition.
8. VerifierAgent requires services; its constructor does not silently default it.
   Its stores, Reactor and cue Deck are also inside VerifierAgentOptions.
9. Verifier local admission Daters use system time, while webhook headers and
   expiration use the injected clock. Existing fixed-clock tests miss this mismatch.
10. CLI/host roots, standalone exchange sends, public runtime exports and test fakes
    all participate in this contract; changing the component classes alone is insufficient.

## Final contracts

Keep HttpClient in `app/http-client.ts`; import it directly and remove the
RuntimeHttpClient alias. Move RuntimeClock, RuntimeTimer and the existing production
clock implementation into `app/runtime-clock.ts`. Keep the clock's current
now/setTimeout/clearTimeout behavior; name the production value `systemClock`.
Do not split this cohesive timer contract into a new interface hierarchy.

HTTP-only owners receive HttpClient. VerifierAgent receives HttpClient and a
required `now: () => number`, because it never schedules timers. Compose that
function as `() => clock.now()`; passing an unbound method breaks clocks that use
instance state. Production roots construct/select FetchHttpClient and systemClock
once per host or command, then reuse them. No subordinate component selects either.

Representative final constructor contracts are below. Required collaborators
precede the final configuration argument. Explicit null denotes an existing absent
capability; it must not trigger hidden construction or discovery.

| Owner            | Required collaborators                                  | Remaining configuration                            |
| ---------------- | ------------------------------------------------------- | -------------------------------------------------- |
| Authenticator    | `hby, http`                                             | None; remove its empty options type                |
| Oobiery          | `hby, reactor, rvy, http, cues`                         | Remove options if nothing remains                  |
| Poster           | `hby, mbx, protocol, http, clock`                       | Existing per-event delivery choices stay on events |
| QueryCoordinator | `hby, protocol, http, clock`                            | Preserve its explicit optional signer selection    |
| Anchorer         | `hby, postman, querying, protocol, http, clock`         | Preserve current protocol-null behavior            |
| Receiptor        | `hby, protocol, http, clock`                            | Existing operation-specific receipt choices        |
| WitnessReceiptor | `hby, protocol, http, clock`                            | `{ force }`                                        |
| MailboxPoller    | `hby, mailboxDirector, http, clock, pollTransport`      | `{ timeouts }`                                     |
| VerifierAgent    | `hby, reger, cdb, reactor, cues, http, now, validators` | `{ hook, gvrsn, timeoutMs, requireKnownSchemas }`  |

Verifier validators are callable business collaborators: pass their existing
schema-keyed table explicitly, using an empty table where none are configured.
Keep the current copy-on-construction behavior. Do not hide the longer signature
in a renamed VerifierAgentDependencies object or add forwarding facades just to
shorten it. The separate stores, input owner and cue consumer remain real responsibilities.

The final runtime construction call is:

```ts
createAgentRuntime(hby, http, clock, pollTransport, options);
```

HttpClient, clock and the existing mailbox polling implementation are required.
Root options retain existing optional store acquisition and protocol policy choices;
they contain neither services nor mailboxPollTransport. The root may retain
readonly `http` and `clock` references for application composition, replacing
`runtime.services.http/clock`. Lower owners never receive AgentRuntime to retrieve them.
Existing borrowed/owned store semantics remain unchanged.

Keep the existing MailboxPollTransport seam, which has production and deterministic
test implementations. Its operation takes `http, clock, request, consume` explicitly.
Remove services from MailboxPollTransportRequest. Expose the existing concrete
production implementation as `httpMailboxPollTransport` for composition; introduce
no new class, interface or forwarding adapter. MailboxPoller receives the chosen
implementation explicitly and forwards HTTP/clock to the subordinate poll operation;
it does not itself execute HTTP requests or clock operations. This retains the
existing stateless transport design without adding a binding wrapper.

TCP and SSE operations take a required clock argument before configuration/options.
Keep cancellation signals, durations, framing choices and chunk sizes as operation
settings. sendWitnessMessage, sendExchangeMessage and mailbox fetch helpers receive
their actual required HTTP/clock/protocol arguments before optional choices. Move
optional authorization after required dependencies rather than adding undefined
placeholders at every call site.

## Phase 0 — Freeze scope and baseline

Before implementation, refresh current master, worktree state, applicable instructions
and the caller inventory. Preserve unrelated work. Record the selected baseline and
map affected tests to the maintained [suite inventory](../../../scripts/ci/keri-test-suites.ts).

Read existing targeted tests first; run the smallest relevant baseline checks.
No full-suite baseline is needed for this signature migration. This plan's current
review is source evidence, not evidence that those tests have passed.

Exit: each collaborator has a named caller and owner; configuration is separate;
the following phase boundaries can compile without temporary overloads or aliases.

## Phase 1 / PR 1 — Explicit HTTP consumers and verifier construction

- Move the existing clock contract/implementation to its clock-named module and
  update imports. Remove RuntimeHttpClient in favor of HttpClient, including DID
  resolution, messenger signatures, public exports and test client implementations.
- Change Authenticator and Oobiery to the explicit contracts above. Composition
  supplies the shared cue Deck and HTTP client; standalone callers supply their own.
- Move every VerifierAgent collaborator out of its options argument. The configuration
  object contains policy values only; the validator table is passed separately.
- Adapt `agent-runtime.ts`, verifier CLI and affected tests in the same cut. The
  existing root services object may still supply individual arguments while its
  other consumers await Phases 2–3. Add no new bundle or compatibility path.
- Preserve verifier timestamp behavior here: existing header/expiry reads use the
  new now function; local Dater creation still uses its old source until Phase 4.

Validate auth/OOBI/schema/DID and verifier tests, direct messenger type consumers,
and current HTTP cancellation/early-return behavior. Check both customized HTTP
and production composition. Do not substitute successful response-body EOF for
the existing status-only authentication/webhook contract.

Exit: these owners have no services field/default/options; their observable behavior
and actual dependency sharing remain unchanged.

## Phase 2 / PR 2 — Explicit delivery, mailbox and transport dependencies

- Migrate Poster, QueryCoordinator, Anchorer and both receipt owners together with
  their constructors, subordinate calls and standalone construction sites.
- Migrate MailboxPoller and its existing transport contract. Keep request data apart
  from HTTP/clock collaborators; wire the concrete transport at composition.
- Remove clock properties/defaults from TcpSendOptions, TcpSocketWriteOptions and
  MailboxSseOptions. Thread the required clock through socket opening, output,
  drain completion, SSE consumption and diagnostic SSE reading.
- Migrate sendWitnessMessage, mailbox fetch/header-timeout helpers, and
  sendExchangeMessage. Exchange/OOBI-sharing/challenge callers select dependencies
  at their CLI roots. Preserve standalone Poster worker startup, matching outcome
  waits, cancellation and joined close.
- Update host socket writers, DID/receipt/delegation/multisig callers and tests
  wherever their immediate callee changes. The old bundle may remain only in
  root composition and test setup pending Phase 3, never in migrated components.

Validate FIFO/retained failures, query response intake, delegation send gates,
mailbox cursor/timeouts, witness receipts, TCP drain/half-close/late reset and
cleanup before store closure. Retain existing timer values, worker order, HTTP
media fallback, finite/streaming response selection and protocol participant topology.

Exit: no non-composition owner receives RuntimeServices or chooses a fallback HTTP
client/clock; transport settings contain no dependency defaults.

## Phase 3 / PR 3 — Finish composition and delete the bundle

- Require `http, clock, pollTransport` in createAgentRuntime. Update every production,
  CLI, host, integration, test and example caller, including `cli/common/context.ts`,
  direct CLI runtime construction, the Tufa host kernel and direct mailbox tools.
- Remove AgentRuntimeOptions.services and mailboxPollTransport, and replace
  AgentRuntime.services with explicit readonly HTTP/clock references needed by
  application callers. Compose all existing owners from those exact inputs.
- Remove RuntimeServices, defaultRuntimeServices, defaultRuntimeHttpClient,
  resolveRuntimeServices and `runtime-services.ts` itself. Complete public exports
  from their actual modules; export the concrete mailbox transport used by callers.
- Remove fakeRuntimeServices. Keep independent HTTP, manual-clock and poll-transport
  fakes in appropriately named test support modules. Tests explicitly choose each
  collaborator; HTTP-only injection must not silently pick a clock or vice versa.
- Adapt existing CLI factory replacement tests to the required signature. Do not
  expand their existing test seam into another services/options override mechanism.

Use repository-wide searches to verify the removed identifiers and `runtime.services`
are absent from executable source, tests and examples. Review matches in historical
documents as history, not a reason to retain aliases. Search for renamed dependency
bags and lower-level production default selection as well as exact old names.

Validate real borrowed-store lifetime assertions; remove the test that merely
compares services object identity. Exercise a nondefault HTTP client and stateful
manual clock through actual composed operations. Run KERI/Tufa public declaration,
CLI and installed-package checks: these exported signature removals affect consumers.
The current construction-failure test throws from an options.mailboxPollTransport
getter after stores open. With a positional argument that getter would run before
acquisition; move the fault to a real later construction step and preserve its
owned-store cleanup and borrowed-Habery assertions.

Exit: every call path selects concrete implementations at composition; no aggregate
or parallel default resolution path remains. This phase changes wiring only.

## Phase 4 / PR 4 — Use one verifier wall clock

- Make local workflow Dater construction take explicit milliseconds from the
  required now function, preserving the existing Dater encoding. Apply it to
  accepted issuance, revocation cues and persisted-revocation recovery.
- Use that same function for webhook sally-timestamp and expiry. Sample at the
  relevant operation: an admitted record keeps its original timestamp, while each
  later webhook attempt gets current time.
- Preserve epoch wall time for persisted records and reopen behavior. Do not use
  monotonic process time or rewrite historical records.
- Keep the existing `elapsed > timeoutMs` boundary and send-before-expiry behavior.
  Keep issueTimestamp from the credential and revocationTimestamp from accepted TEL
  evidence. Do not redesign repeated scans, terminal expiry or retry policy.

Extend the existing verifier tests with a mutable time source far from system time.
After a refused webhook, assert the actual retained recv/revk Dater uses admission
time. At the exact timeout boundary, refusal retains the row; one millisecond later
it removes it. Assert the request header advances while the admission key stays fixed.
Cover both cue-driven and persisted-rescan revocations through their existing actual
TEL fixtures. Preserve source timestamp, success, acknowledgement and duplicate assertions.

Run `verifier-agent.test.ts` and the maintained `interop-acdc-verifier` workflow.
Do not add private-method tests, real-time sleeps or global Date patches to prove
injected time. The established scan policy can rediscover expired work; this clock
fix makes no new terminal-expiry or retry guarantee.

Exit: all local verifier timing uses its supplied wall clock; accepted protocol
timestamps and workflow ordering remain unchanged.

## Validation, documentation and delivery gates

Reuse existing owner tests, selected for each phase rather than run indiscriminately:

- HTTP/OOBI/verifier: `verifier-agent`, `oobi-local-state`, `schema-oobi`, `oobi-runtime`,
  existing authentication/DID cases and the HTTP client/egress tests.
- Delivery: `poster-queue`, `exchange-messaging`, `forwarding`, `witness-transport`,
  `querying`, `query-delivery`, `query-transport` and delegation tests.
- Composition/mailbox: `runtime-store-ownership`, `mailbox-poller-runtime`, CLI
  context tests and Tufa's `runtime-bridge.test.ts`.

The existing app-fast-parallel, runtime-medium and runtime-slow owners cover these
groups. Select relevant witness, mailbox/KRAM, delegation, DID and verifier interop
owners when their wiring changes. Scope PR checks with [PR_TEST_SCOPE](../../reference/PR_TEST_SCOPE.md);
credit local results only for the tested revision and report skipped lanes honestly.
Run formatting, lint, quality/type checks and changeset checks for each implementation
PR. Removed public types/signatures require release-impacting changesets; the clock
behavior fix merits its own release note. Publishing a release is outside this plan.

Use the four implementation PRs above, with cohesive commits and no transitional
public shims. Keep a phase and all of its callers together. Run the full maintained
battery only after the final implementation PR is merged, then repair regressions
before declaring the refactor complete. Narrow green checks do not establish full
qualification.

As phases land, update ADR-0003/0013, INGRESS_AND_EGRESS, runtime learnings and
the public composition examples. Mark the older messenger plan's instruction to
retain RuntimeServices as superseded; keep historical HTTP-plan inventories labeled
with their original baseline. Update this plan's status and routing accurately.

Document touched classes, member attributes, public/private functions and meaningful
control-flow steps for human reviewers. Explain collaborator roles, borrowing,
null capability meanings and clock units without narrating obvious assignments.
Add no documentation tests or new lint rules for this requirement.

After final file/Git changes at each handoff, run the prescribed ENCTX index
maintenance workflow and require a healthy result with no stale sources.

## Scope limits

Preserve Reactor's actual verifier artifact-input role, existing protocol processing,
signed wire bytes, CESR compatibility, retry policy and resource cleanup. No HTTP
client redesign, successful send-response body processing, generalized time-source
rewrite, new transport classes or wholesale conversion of unrelated options types.
Independent optional store acquisition remains composition policy. This refactor
does not revisit the overall responsibilities of VerifierAgent merely because its
honest constructor has several arguments.
