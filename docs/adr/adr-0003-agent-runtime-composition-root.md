# ADR-0003: AgentRuntime composes component-owned workers

- Status: Accepted; refined by [ADR-0013](adr-0013-simple-component-flows.md)
- Date: 2026-03-28
- Scope: KERI runtime construction and host lifetime

## Decision

AgentRuntime constructs concrete components, connects their data flows and owns
its acquisitions and worker lifetime. It is not a container passed down so a
child can discover siblings. One runtime serves a Habery or command invocation.

| Owner                           | Responsibility                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Reactor                         | Buffered protocol intake, routing, dispatch/escrow ordering and reply capture   |
| Oobiery                         | Durable introduction jobs and joined retrieval/intake                           |
| Authenticator                   | Well-known authorization retrieval                                              |
| QueryCoordinator                | Query correspondence, selected signer/attester, signed packets and response I/O |
| Respondant / Poster             | Reply/replay interpretation, routing, exact retry bytes and actual delivery     |
| MailboxDirector / MailboxPoller | Provider response correlation and continuous client polling                     |
| Regery owners                   | Distinct legacy VDR and v2 registry processing/storage                          |

The root retains references needed for composition and application orchestration.
Mutable subsystem state stays with its owner: durable OOBI jobs stay in their DB
families, query work stays with QueryCoordinator, and provider messages stay in
Mailboxer. A class name matching KERIpy does not justify a forwarding-only facade.

## Host and command execution

runAgentRuntime starts the existing workers and suspends under their supervision.
runAgentRuntimeUntil uses those same workers until accepted state satisfies the
caller's predicate or its elapsed deadline expires. Both join children before
caller/store teardown. Commands select their required mailbox polling and signer;
there is no serial whole-runtime or finite mailbox turn API.

Direct protocol intake and phase-specific tests call the actual operation. They
do not run unrelated OOBI, mailbox and delivery work to settle a signed endpoint
record. Do not add a renamed test pump or another scheduler.

## Construction and lifetime

Choose actual processors and clock/HTTP dependencies at construction. Provider
storage is an explicit capability, not a runtime mode. Readonly Haberies acquire
no implicit writable registry. Defaults are owned; injected stores remain borrowed.
Acquire stores before their consumers so reverse teardown joins output first.

Only existing protocol durability belongs here: escrows, accepted evidence,
mailbox storage/cursors and replay state. No application accounting, outbox or
unsupported delivery acknowledgement is introduced by composition.

## KERIpy correspondence

A KERIpy Doer corresponds to an Effection operation such as msgDo, escrowDo or
oobiDo. A stateful component can expose several such operations, like a DoDoer.
The host assembles them; it does not replace them with a generic actor framework.
KERIpy also shares domain objects and uses direct subordinate calls.

The [runtime contract](../design-docs/runtime/INGRESS_AND_EGRESS.md) owns exact
input, output, cleanup and store boundaries. The [roadmap](../plans/PARITY_ROADMAP.md)
owns remaining qualification and releases. Earlier migration chronology remains
in Git; it is not preservation authority.
