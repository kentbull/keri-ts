# Runtime maintainer documentation

Status: documentation and source review complete. Documentation only; executable behavior and signatures remain unchanged.
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

## Review findings retained outside this documentation change

- **Local cursor finding resolved by [#554](https://github.com/kentbull/keri-ts/pull/554).**
  Local collection now proposes cursor positions; pollDo publishes them only after
  the entire batch consumer succeeds. Read failure, consumer failure and cancellation
  retain the previous positions for a restarted worker on the same poller, with
  possible duplicate processing. Regressions cover both consumer forms, joined
  cancellation, multi-topic/prefix progress and partial collection failure.
- `positiveTimeoutMs` floors positive fractional input, so values below one
  millisecond become zero; downstream SSE validation can reject them. A separate
  policy change should either reject fractions or clamp positive values to one.
  No validation policy is changed here.

## Delivery and verification record

The first four phases were delivered sequentially in
[HTTP #549](https://github.com/kentbull/keri-ts/pull/549),
[TCP #550](https://github.com/kentbull/keri-ts/pull/550),
[cue/protocol #551](https://github.com/kentbull/keri-ts/pull/551), and
[mailbox/composition #552](https://github.com/kentbull/keri-ts/pull/552).
Phase 5 closes this ledger and reconciles the existing runtime, cue, query,
ADR and learning-document sections; it creates no replacement architecture guide.
Each PR carries an empty changeset and explicit documentation-only CI scope.

Coverage was checked against the cumulative diff and each non-merge refactor
commit, then reviewed against current declarations and regression tests. The
ledger distinguishes retained comments from expanded contracts and provides the
five maintainer reading paths. Class rows include their attributes; named local
helpers and significant callbacks are reviewed with their owner. No documentation
checker or framework was added to the repository.

The reference comparisons were checked against local KERIpy source at `71438328`
and GLEIF-IT `b8626e1d58770a4a480ea72a01acc5580278a9f2`, particularly
`directing.py` and `agenting.py`. TypeScript owns listener/connection work in Tufa
functions and uses concrete messenger operations, not a Directant class or HIO
queue/worker clones. The [cue refactor](cue-delivery-refactor.md) retains the
original reference matrix and behavioral differences.

Validation compares comment-free TypeScript syntax against baseline `281fa5f7`,
checks compiler/linter directives for preservation, and uses existing formatting,
lint, quality/type, changeset and local Markdown-link checks. Runtime tests,
interoperability and installed-package execution are intentionally not rerun for
prose; their existing assertions supply review evidence, not fresh qualification.
Required CI static checks and the ENCTX maintenance workflow apply to every handoff.

The final review removed stale claims that Poster lacks retained failures or
stops after a recognized refusal. It also made Hab's low-level Deck consumption,
remote versus local mailbox cursor advancement, and finite-host Date.now deadlines
explicit. The findings above track their separate behavioral follow-ups; the original documentation pass changed neither behavior.
