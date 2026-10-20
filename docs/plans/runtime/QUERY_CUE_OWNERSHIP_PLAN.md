# Command-owned query cues and saved-KSN semantics

Status: approved release scope, queued as 13h1–13h2 after maintainer docs (13h), before CLI bootstrap ownership (13i).
Owner: [release completion plan](../V2_RELEASE_COMPLETION_PLAN.md).

Refactor keri-ts query observation toward KERIpy’s Deck-and-cue model. Remove Effection Channels from this flow. We have no evidenced production requirement for multiple noticers receiving the same publication; the simultaneous-observer test does not establish that requirement.

Follow enctx/adrs/ten-constraints.md, SOLID and ADR-0013. Refactor ownership first, then correct behavior. Do not preserve old keri-ts APIs through compatibility wrappers.

Baseline: `b2e15438`, with ongoing query/transport documentation edits. Reinspection for plan integration confirms Channel ownership in AgentRuntime/cue-runtime and keyStateSaved production in both received-KSN handling and ordinary Kevery acceptance. Reinspect again before implementation and preserve the current work rather than overwriting it.

## Reference behavior

Inspect KERIpy main’s:

- app/querying.py: QueryDoer, KeyStateNoticer and LogQuerier
- core/eventing.py: saved key-state notice publication
- cli/commands/query.py and contacts/query.py: command-local composition

Also retain interoperability with the maintained v1 peer profiles.

KERIpy’s noticer pulls a cue, explicitly matches its kind and subject, and appends unrelated cues back. It does not broadcast. A saved remote notice supplies the catch-up target; accepted local KEL state determines completion.

Implement two cohesive PRs.

## 13h1: Replace broadcast with explicit cue ownership

1. Remove AgentRuntime.keyStateUpdates, its Channel construction/cleanup, channel sends, and the noticer’s Stream/subscription dependency.

2. Use the existing synchronous Deck implementation. Do not replace Channel with Signal, an observable, subscriber registry, callback fanout, or a custom channel wrapper.

3. Give the query command one command-scoped cue Deck and one KeyStateNoticer consumer. Wire that Deck before starting the query sender or receiver.

   With the current composition, use a small explicit routing branch in the existing cue owner to transfer saved key-state cues into this Deck. Transfer each record once; do not copy it to multiple observers.

   Pass the Deck explicitly through the relevant composition boundary. Do not install another always-present runtime-wide notification service or create queues for hypothetical consumers.

4. Preserve a clear ownership chain:
   protocol processing → existing application cue owner → query cue Deck → KeyStateNoticer.

   The runtime cue worker must not discard records intended for the noticer. The noticer must not compete blindly with the runtime over its input Deck.

   Preserve existing receipt, reply, replay, mailbox and recovery-query routing. Audit processCuesOnce and drainWitnessCues so removing publication does not inadvertently change their other responsibilities. Do not make a broad change to unknown-cue handling.

5. Implement ordinary KERIpy-style pull/match/append behavior:
   - Check cue kind and subject explicitly.
   - Preserve unrelated cues rather than swallowing them.
   - Preserve a relevant notice while required local state is unavailable.
   - Yield cooperatively between processing turns; never spin indefinitely over a requeued item.
   - Do not search the whole Deck for a matching predicate or repeatedly drain and refill it.

6. Express the noticer’s actual transitions directly: request KSN, inspect a matching saved notice, request logs when behind, and wait for accepted catch-up. Remove subscription-specific races and stream-closure handling.

   Review the current “higher notice replaces the catch-up task” behavior against KERIpy and real callers. Do not retain generalized observer scheduling merely because the broadcast implementation introduced it.

7. Update Tufa query composition, public declarations and installed-consumer fixtures. Keep deadline supervision, cancellation and joined cleanup. Preserve the independent sender and mailbox/TCP receive owners.

8. Remove the simultaneous-noticer broadcast test as an unsupported product contract. Replace it with tests of the actual single-owner cue handoff. Do not add tests whose sole purpose is proving Channels remain absent.

## 13h2: Restore the meaning of keyStateSaved

Our current Kevery emits keyStateSaved both for saved remote KSN replies and ordinary KEL acceptance. KERIpy uses this cue for the saved remote notice. Correct this separately from the ownership refactor.

1. Retain keyStateSaved after successful validation and persistence of a received KSN.

2. Remove its production from ordinary KEL acceptance. Audit every consumer and affected assertion first. Do not invent a replacement event unless an actual production consumer requires one.

3. Ensure ordinary KEL ingestion alone cannot satisfy a noticer that is waiting for a remote notice.

4. Once a valid notice establishes a target, use accepted local KEL state to determine whether catch-up has completed. Queue emptiness, HTTP success and transmission completion are insufficient.

5. Preserve KERIpy’s queued-cue semantics. Do not introduce request IDs, timestamps, subscription epochs or “freshness” filtering to simulate the removed channel. A saved notice is not inherently correlated to a particular request, and neither implementation should claim otherwise.

## Validation

Use existing querying, Kevery KSN, cue-routing, transport and CLI tests. Add or adapt a small number of meaningful cases:

- An accepted matching KSN completes an already-current query.
- An ahead KSN triggers log recovery and completes only after accepted catch-up.
- Ordinary KEL acceptance before a KSN does not complete the query.
- Unrelated cues survive with the intended FIFO/requeue behavior.
- Invalid KSN evidence cannot produce successful query completion.
- Immediate delivery is retained because the Deck is wired before sending.
- Deadline/cancellation joins the workflow and I/O before stores close.

Prefer signed input through the real receiver for the evidence-boundary cases. Avoid relying entirely on manually injected keyStateSaved records.

Reuse the existing real KERIpy query/mailbox interoperability checks, including the current maintained peer profiles where affected. Do not create an exhaustive new matrix solely for replacing notification plumbing.

## Documentation and scope

Update the existing QUERY_COMPOSITION_PARITY_PLAN.md so its simultaneous-observer language is no longer treated as a requirement.

Make concise corrections to the owning runtime contract, cue-flow reference, runtime learnings and 2.0 migration guide where they currently prescribe keyStateUpdates or Effection Channels. Record that future adoption of Channels requires a separately justified production use.

Keep normal Effection operations, scopes, tasks and I/O. This is not an Effection removal project or a repository-wide collection rewrite.

Do not restore QueryCoordinator, HTTPQuery, retries, outboxes or subscriber infrastructure. Do not make global ProtocolProcessor removal a prerequisite.

Include appropriate changesets, static checks and installed-package validation. Report the resulting cue ownership, KSN completion contract and actual verification. Integrate the work before final release qualification; do not release as part of these PRs.
