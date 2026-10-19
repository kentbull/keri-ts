# ADR-0004: Cue ownership across local and hosted processing

- Status: Accepted; cue production and queued delivery simplified
- Date: 2026-03-29
- Scope: Protocol cues, interpretation and host routing

## Decision

Cues are ordinary typed records, not payload ownership handles or executable
commands. Preserve their meanings while using concrete KERIpy-shaped owners.

There are three relevant scopes:

1. Habery.kevery has a local Deck for habitat processing that can occur without
   a runtime.
2. Runtime protocol processors share a separate producer Deck. Reactor captures
   direct request replies before publishing remaining records to the application.
3. AgentRuntime.cues is the application Deck routed by composition to query,
   mailbox and reply owners. Oobiery can publish its committed lifecycle facts
   directly there.

A Deck is not broadcast. Composition defines the consumer and any required
fanout; do not create a general event bus or root-owned delivery framework.
Kever describes follow-up cues in decisions; Kevery applies decisions and
publishes them after its owning writes commit.

## Interpretation and delivery

Hab.processCuesIter yields raw wire constructed by the controller that can
honestly sign. Typed cue kin values route queries, streams and observations to
their existing owners without an emission wrapper. Network waits belong to
concrete output operations, outside protocol transactions.

The application router sends routed query records to QueryCoordinator and stream
records to MailboxDirector. Respondant interprets and publishes other
reply/receipt/replay output. Respondant eagerly constructs complete local replay
batches and correlated pairs before atomic publication. Poster owns FIFO delivery,
endpoint selection, forwarding, retained whole-event failures, cancellation and
joined cleanup, including authorized local forwarding. Routed queries select
an explicit local signer, a configured Hab, or the sole local Hab. An unavailable
explicit signer stays unresolved; the runtime never guesses among local identities.

Publish or transfer successfully before removing source records. Preparation
failure retains the source, and a finite pass processes its initial extent.
Notify-only records need not produce wire bytes. Ordinary records have no
retain/release lifecycle. Request SAID reservations provide correlation, not capacity.

## Local state and notifications

Local location/role changes are signed replies accepted through Reactor/Revery,
not direct endpoint-table writes. They do not require a long-lived host.

Noter/Notifier durable notices and Signaler transient hints are a separate
application observation path. Do not add cue variants for UI notifications that
have no protocol convergence meaning. Publish hints after the durable notice
mutation; a later hint failure does not roll back the notice.

## Execution and qualification

CLI and hosts run the same component workers with different completion/deadline
conditions. Serial runtime and finite mailbox pumps, CueSink hooks, delivery
wrappers and callback-based reply admission are removed.

The [cue delivery plan](../plans/runtime/cue-delivery-refactor.md) first moved
execution ownership to Poster. All sends now use its independently running queue;
HTTP and witness ingress publish without driving delivery. Producers construct
signed messages and callers await identity-matched sent/failed outcomes when
transmission gates their workflow. Ordinary event and target loops replace reply
cursors and cross-batch scheduling. Refusals attempt remaining destinations and
retain failed events without automatic retry. Explicit retry preserves the signed
source message but rebuilds routing and outer wire; duplicates are possible.
HTTP completion requires successful body EOF. Transmit-only TCP completion is
local drain followed by joined cleanup; duplex preserves receive processing.
Concrete network failures are retained without disguising construction or cleanup
failures. Deferred reliability features
have a separate [roadmap](../plans/runtime/cue-reliability-roadmap.md).

The [cue design](../design-docs/runtime/CUES.md) explains the current graph and
KERIpy correspondence. The [runtime contract](../design-docs/runtime/INGRESS_AND_EGRESS.md)
owns operational invariants; the [roadmap](../plans/PARITY_ROADMAP.md) owns future
regression standards. The [release report](../reports/parity/CLEANUP_RELEASE_2026-10-16.md)
records completed 1.0.0 qualification. Broader parity requires its own evidence.
