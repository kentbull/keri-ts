# keri-ts Working Instructions

## Purpose

Keep agent sessions consistent, low-drift, and decision-traceable across CESR, KELS, ACDC, crypto, and infra work.

## Session Start Protocol (Required)

At the start of each new task thread, read these files first:

1. `AGENTS.md` (this file)
2. `docs/design-docs/PROJECT_LEARNINGS.md` (top-level index)
3. Topic learnings docs listed under "Current Focus" in `PROJECT_LEARNINGS.md`
4. Any task-specific contract/ADR/plan docs referenced by those topic docs

Then produce:

1. A 10-bullet current-state summary
2. A concise implementation plan for the requested task

## End-of-Task Handoff (Required)

Before final response, update:

1. The appropriate topic learnings doc(s) for the task context
2. `docs/design-docs/PROJECT_LEARNINGS.md` with a concise cross-topic summary

Use the handoff templates in `PROJECT_LEARNINGS.md`.

## Learnings Document Policy

Use a hierarchical memory model:

1. `docs/design-docs/PROJECT_LEARNINGS.md`:
   index, current focus, cross-topic summary, routing.
2. `docs/design-docs/learnings/PROJECT_LEARNINGS_*.md`:
   deeper topic-specific learnings and handoff log.

Split guideline:

- If a topic learnings doc grows beyond ~250 lines, split further by subtopic.
- Caveat: do not split when notes are tightly coupled and splitting would reduce clarity.
- Avoid duplication: keep deep detail in topic docs and concise rollups in the top-level index.

## Parser Contract Rule

For parser lifecycle changes:

- Treat `docs/design-docs/CESR_PARSER_STATE_MACHINE_CONTRACT.md` as normative.
- Keep the contract-to-test matrix in sync with behavior changes.
- Update parity vectors/docs when behavior contracts change.

## Scope Guardrails

- Prefer readability-first implementation unless roadmap phase explicitly says otherwise.
- Do not introduce perf-oriented complexity unless tied to an approved perf plan/phase.
