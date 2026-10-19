# Runtime maintainer documentation

Status: in progress. Documentation only; executable behavior and signatures remain unchanged.
Baseline: master `281fa5f7`; historical coverage starts at `6c8e5971`.

## Contract and coverage

Explain responsibilities, actual dependencies, owned/borrowed state, completion,
refusal/exception distinctions, cancellation and joined cleanup. Every covered
function receives meaningful parameter documentation; document return values,
stream items and failure contracts where relevant. Private helpers, constructors,
class members and contract fields are included. Inline comments explain consequential
ordering rather than narrating statements. Preserve compiler directives.

The [coverage ledger](runtime-maintainer-documentation-coverage.md) identifies
surviving declarations from the historical diff and complete supporting owners.
Unrelated members of large protocol classes are excluded. Deleted ReplyCursor,
CueEmission, RuntimeServices and tcp-conversation APIs remain retired.

## Delivery phases

1. HTTP: CESR framing, finite/scoped responses, media fallback, source and cleanup helpers.
2. TCP: messenger, egress, socket readers, listener/connection ownership and half-close.
3. Protocol: cue production, Poster delivery, ingress/dispatch, query correlation and replay.
4. Application: mailboxes/SSE, explicit composition, workflows and CLI completion gates.
5. Review: trace five complete flows and reconcile authoritative runtime documentation.

Each phase is one documentation PR with an empty changeset, a reading order,
and explicit documentation-only CI scope. One PR is active at a time. No new
documentation tests, lint rules or framework. Implementation defects discovered
while reviewing are recorded separately; this pass does not fix or conceal them.

## Acceptance

Review each declaration against current source and relevant tests. Check every
parameter's identifier meaning, units, ownership and defaults when applicable.
Distinguish admission, local transmission, response processing and protocol acceptance.
Review finite command shutdown and resource release after child I/O joins.

Run existing formatting, lint, quality/type, changeset and local-link checks.
Compare comment-free TypeScript syntax trees with each phase's baseline to detect
accidental executable changes. Do not claim skipped runtime tests ran; no full
interop battery is required for prose. Follow human-oriented commit and ENCTX
index maintenance workflows before phase handoffs.

Final review follows cue delivery, query/reply processing, mailbox polling,
request-owned ingress responses, and finite CLI worker/store teardown. Completion
requires every ledger entry reviewed and source/design docs consistent.
