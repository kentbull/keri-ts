# Port Single-Sig `tufa interact`

## Summary
- Verdict: `keri-ts` already has the hard state-machine substance for `ixn`. The real missing seam is local authoring plus CLI and witness orchestration.
- Verdict: The wrong port would be to copy KERIpy's doer topology. Port the behavior instead: author `ixn`, accept it locally through typed decisions, optionally converge witness receipts, then print KLI-shaped output.
- Verdict: KERIpy `kli interact` has witness/auth branches, but no proxy or delegator-publication branch. Treating `interact` like delegated `rotate` would be a false parity model.

## Current State
- `ixn` validation is already implemented in `packages/keri/src/core/kever.ts` via `evaluateInteraction(...)`, including `estOnly`, sequence, prior-digest, threshold, and witness checks.
- Event orchestration is already implemented in `packages/keri/src/core/eventing.ts` via `Kevery.decideEvent()/applyDecision()` with typed `accept`, `duplicate`, `escrow`, and `reject`.
- CESR parsing is already decoupled from routing, so no parser architecture work is needed for `interact`.
- Query/replay already understands interaction events, including anchor-oriented log queries and cloned KEL replay.
- Witness infrastructure is real in `packages/keri/src/app/witnessing.ts`: `/receipts` host handling, `Receiptor`, `WitnessReceiptor`, catchup, receipt fanout, and auth-header support already exist.
- `tufa incept` and `tufa rotate` already reuse that witness infrastructure after local acceptance.
- `Hab` already has the right adjacent seams in `packages/keri/src/app/habbing.ts`: local builders, `acceptLocally(...)`, `sign(...)`, `receipt(...)`, and `witness(...)`.
- There is no production `Hab.interact(...)` or `makeInteractRaw(...)`; current production code only has test-local `ixn` builders.
- The CLI gap is still real: `interact` is only an experimental placeholder in `packages/keri/src/app/cli/command-definitions/tooling.ts` and `packages/keri/src/app/cli/command-definitions/handlers.ts`.
- Some rotate/incept comments still understate witness maturity, so docs need a truth pass while this lands.

## KERIpy Trace
- `kli interact` flows `cli/commands/interact.py` -> `InteractDoer.interactDo()` -> `hab.interact(data=...)` -> `eventing.interact(pre,dig,sn,data)` -> sign -> `messagize(...)` -> `kvy.processEvent(...)` -> print output.
- After local acceptance, KERIpy chooses `Receiptor.receipt(...)` for `--receipt-endpoint` or `WitnessReceiptor` for full convergence. That is the operator-facing behavior to preserve.
- KERIpy also starts `MailboxDirector`, but that is Python runtime scaffolding, not the essence of `interact`. In `keri-ts`, the existing witness helpers already own the needed ingress and receipt settling.
- In KERIpy `Kever.update(...)`, the `ixn` branch reuses current keys, thresholds, and witnesses, validates attachments, logs the event, and advances accepted state. `keri-ts` already matches that substantively.
- Delegation nuance: KERIpy treats `ixn` as non-delegable for source-seal persistence. There is no `--proxy`, no `Anchorer`, and no delegator-post step in `kli interact`.

## Approach
- Add a real top-level `tufa interact` command in `packages/keri/src/app/cli/command-definitions/lifecycle.ts` and `packages/keri/src/app/cli/command-definitions/handlers.ts`, and retire or repoint the experimental placeholder in `packages/keri/src/app/cli/command-definitions/tooling.ts`.
- Implement `Hab.interact({ data?: unknown[] }): Uint8Array` in `packages/keri/src/app/habbing.ts` beside `Hab.rotate(...)`.
- Add internal `makeInteractRaw(pre, priorSaid, sn, data)` in `packages/keri/src/app/habbing.ts` using the exact KERIpy SAD shape `{ t: "ixn", i, s, p, a }` and `sn >= 1`.
- Keep local authoring simple: no manager rotation or keeper mutation, only current accepted key state, `Hab.sign(...)`, `acceptLocally(...)`, and `buildEventMessage(...)`.
- Parse `--data` with the existing CLI `parseDataItems(...)` seam so repeatable JSON and `@file` inserts land verbatim in `a`.
- Reuse the existing witness branch from `incept` and `rotate`: if witnesses exist, use `Receiptor.receipt(...)` for `--receipt-endpoint`, otherwise `WitnessReceiptor.submit(...)`; if no witnesses exist, `--receipt-endpoint` is a no-op.
- Do not port KERIpy exception flow. Ordinary live outcomes stay on ADR-0005 and ADR-0008 typed decisions.
- Do not port KERIpy parser coupling. Keep local accept on the existing `Kevery.processEvent(...)` seam and keep receipt ingress inside the witness helpers.
- Support delegated single-sig identifiers only in the true KERIpy sense: delegated `ixn` is allowed, uses current delegated state, may publish to witnesses, and does not introduce proxy or delegator-publication logic.
- Update the maintainer doc to cover interact and anchor semantics, explicitly calling out that later ACDC work depends on exact `a`-seal authoring and anchor-query behavior, not on copying Python doers.

## Test Plan
- Unit: `Hab.interact(...)` increments `sn`, updates `p` and `d`, appends the event to `kels.` and `fels.`, and returns a non-empty attached event message.
- Unit: interaction `data` survives exact round-trip in `serder.ked.a`, including seal-shaped entries used later by TEL and ACDC anchoring.
- Unit: `estOnly` AIDs reject local `ixn` and leave accepted state unchanged.
- Unit: delegated `ixn` accepts without source-seal input and does not write `aess` for the new event.
- CLI: `tufa interact` prints KLI-shaped success output and honors `--data`, `--receipt-endpoint`, `--authenticate`, `--code`, and `--code-time`.
- Integration: extend witness CLI and KERIpy-witness interop suites so `tufa interact` reaches full receipt convergence and includes at least one anchor-carrying `ixn` scenario.

## Assumptions
- Scope is single-sig local Habs only; multisig and prebuilt partial-signature interact flows stay out of this slice.
- "Full parity" here means full KERIpy `kli interact` parity, not rotate-style delegation proxy parity.
- No ADR update is needed unless implementation uncovers a real architecture gap; ADR-0003, ADR-0004, ADR-0005, ADR-0008, ADR-0009, and ADR-0010 already describe the intended ownership model.
- The right docs update is a maintainer-guide expansion, not a new ADR, unless the port changes a public contract.
