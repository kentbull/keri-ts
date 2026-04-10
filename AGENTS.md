# keri-ts Working Instructions

## Purpose

Keep agent sessions low-drift, easy to rehydrate, and aligned with current
`keri-ts` parity rules.

## Session Start Protocol (Required)

At the start of each new task thread, read:

1. `AGENTS.md`
2. `.agents/PROJECT_LEARNINGS.md`
3. Only the task-relevant topic learnings docs from that index
4. Only the task-relevant ADRs, contracts, or plan docs those topic docs point
   to
5. KERIpy at `$HOME/code/keri/kentbull/keripy` whenever parity or expected
   behavior is uncertain

Then produce:

1. A 10-bullet current-state summary
2. A concise plan for the requested task

## End-of-Task Handoff (Required)

For significant changes, update:

1. The relevant topic learnings doc(s)
2. `.agents/PROJECT_LEARNINGS.md` with the cross-topic takeaway if one exists
3. Any ADR/design doc whose contract changed

Use the templates in `.agents/PROJECT_LEARNINGS.md`.

## Learnings Policy

Use a hierarchical memory model:

1. `.agents/PROJECT_LEARNINGS.md` is the routing layer and cross-topic memory
2. `.agents/learnings/PROJECT_LEARNINGS_*.md` hold topic-specific durable rules

Compaction rules:

- Treat learnings as rehydration memory, not audit history
- Prefer rewrite-in-place over append-only growth
- Update `Current State` and `Current Follow-Ups` before adding milestones
- Add milestones only for durable changes in ownership, invariants, parity
  rules, architecture boundaries, or remaining-work shape
- If a doc grows noisy, compact it before splitting it
- If a topic doc grows past roughly 250 lines, split only when doing so improves
  clarity

Do not store routine file inventories, test transcripts, or micro-step
chronology unless they are themselves durable operational knowledge.

## Normative Rules

### Parser Contract

- `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md` is normative
  for parser lifecycle work
- Keep contract, tests, and parity vectors in sync when parser behavior changes

### State-Machine Control Flow

For `Kever`, `Kevery`, escrows, and similar processors:

- `docs/adr/adr-0005-kel-decision-control-flow.md` is normative
- Normal remote-processing outcomes should be typed decisions, not thrown
  exceptions
- `Kever`/future state machines decide validity
- `Kevery`/future orchestrators own routing, escrow persistence, duplicate
  handling, and post-acceptance side effects
- Prefer the explicit decision taxonomy when it fits:
  - `accept`
  - `duplicate`
  - `escrow`
  - `reject`
- Reserve exceptions for invariant failures, corrupt durable state,
  infrastructure failures, or programmer misuse

### Maintainer Docstrings

For new modules, classes, and functions:

- Add concise maintainer-oriented docstrings
- Document responsibilities, invariants, and boundary contracts
- Port KERIpy maintainer-facing docs in the same change when porting a KERIpy
  class
- Preserve meaning, not wording; call out TypeScript/runtime divergences

### Interop Debugging

- Prefer targeted `tufa db dump` inspection over ad hoc LMDB scripts
- Use the narrowest selector that answers the question
- Treat `tufa db dump` as a comparison seam for both `.tufa` and `.keri`
  stores

### Hosted Identity Selection

- One long-lived host/runtime serves a Habery or command invocation; hosted AID
  selection is separate from listener topology
- Do not auto-host every local Hab
- Treat signatory, keeper, and AEID-related identities as non-user-facing by
  default unless the task proves otherwise

## Scope Guardrails

- Prefer readability-first implementation unless an approved perf phase says
  otherwise
- Do not add perf-oriented complexity without an explicit perf plan
- Before 1.0 parity, prefer KERIpy compatibility over prior `keri-ts`
  compatibility
- Do not add backward-compatibility shims unless interop or the task requires
  them
- Treat exact KERI CBOR byte parity as a project rule; route protocol/storage
  CBOR through the shared CESR codec rather than direct `cbor-x` use

## Design Bias

- Optimize for learner/maintainer comprehension
- Extract small domain-named helpers when they clarify real policy or
  invariants
- Do not abstract merely to reduce line count
- Prefer explicit typed contracts and exhaustive mappings over stringly runtime
  indirection
- For CESR/TLV parsing, favor deterministic behavior and explicit invariants
  over flexibility by accident
