# keri-ts Working Instructions

## Purpose

Keep agent sessions consistent, low-drift, and decision-traceable across CESR,
KELS, ACDC, crypto, and infra work.

## Session Start Protocol (Required)

At the start of each new task thread, read these files first:

1. `AGENTS.md` (this file)
2. `.agents/PROJECT_LEARNINGS.md` (top-level index)
3. Task-relevant topic learnings docs listed under "Current Focus" in
   `.agents/PROJECT_LEARNINGS.md`
4. Any task-specific contract/ADR/plan docs referenced by those topic docs
5. As needed, remember to refer, on a task by task basis, to the KERIpy python
   reference implementation stored at `$HOME/code/keri/kentbull/keripy` for
   planning a given topic and shoring up reasoning about what expected behavior
   and interoperability needs to be. KERIpy is currently the gold standard for
   KERI, ACDC, and CESR implementations.

Then produce:

1. A 10-bullet current-state summary
2. A concise implementation plan for the requested task

## End-of-Task Handoff (Required)

For tasks where significant changes have been made, before final response,
update:

1. The appropriate topic learnings doc(s) for the task context
2. `.agents/PROJECT_LEARNINGS.md` with a concise cross-topic summary
3. Relevant ADRs, architectural, or design docs from `docs/adr`,
   `docs/design-docs`, or otherwise.

Use the handoff templates in `.agents/PROJECT_LEARNINGS.md`.

## Learnings Document Policy

Use a hierarchical memory model:

1. `.agents/PROJECT_LEARNINGS.md`: index, current focus, cross-topic
   summary, routing.
2. `.agents/learnings/PROJECT_LEARNINGS_*.md`: deeper topic-specific
   learnings and handoff log.

Split guideline:

- If a topic learnings doc grows beyond ~250 lines, split further by subtopic.
- Caveat: do not split when notes are tightly coupled and splitting would reduce
  clarity.
- Avoid duplication: keep deep detail in topic docs and concise rollups in the
  top-level index.

## Parser Contract Rule

For parser lifecycle changes:

- Treat `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md` as normative.
- Keep the contract-to-test matrix in sync with behavior changes.
- Update parity vectors/docs when behavior contracts change.

## Maintainer Docstrings Rule

For new modules/classes/functions introduced during feature work:

- Add concise, maintainer-oriented docstrings at class and function boundaries.
- Document responsibilities, invariants, and boundary contracts; avoid
  tutorial-level commentary.
- Prefer short comments that make control-flow intent and lifecycle semantics
  reviewable.
- When porting or introducing a class that corresponds to a KERIpy class, port
  the class documentation in the same change. A behavior port without its
  maintainer-facing source documentation is considered incomplete.
- Mirror KERIpy documentation meaning-first, not verbatim: preserve
  responsibilities and invariants, but rewrite for `keri-ts` maintainers and
  call out any TypeScript or runtime divergences explicitly.

## Scope Guardrails

- Prefer readability-first implementation unless roadmap phase explicitly says
  otherwise.
- Do not introduce perf-oriented complexity unless tied to an approved perf
  plan/phase.
- Until `keri-ts` reaches 1.0 KERIpy parity, prefer KERIpy compatibility over
  compatibility with prior `keri-ts` versions.
- Do not add backward-compatibility shims for old `keri-ts` storage/layout/API
  behavior unless they are explicitly required for KERIpy interop or the task
  request says to preserve them.
- Treat exact KERI CBOR byte parity as a project rule. Do not import `cbor-x`
  directly in KERI/CESR source for protocol or storage encoding/decoding; route
  through the shared CESR CBOR codec so map-size and tag behavior stay aligned
  with KERIpy `cbor2`.

## Design Bias (Learner/Maintainer First)

- Treat learner/maintainer comprehension as a primary design objective for
  parser and codex work. Favor explicit, reviewable structure over cleverness.
- In TypeScript, prefer compile-time typed contracts and exhaustive mappings
  over runtime string indirection or implicit introspection.
- For low-level CESR/TLV parsing, prioritize deterministic behavior and explicit
  invariants. Flexibility should be policy-gated and intentional, not an
  emergent side effect of dynamic dispatch.
