# PROJECT_LEARNINGS_ACDC

## Purpose

Persistent ACDC memory for `keri-ts`.

Keep this file focused on durable ACDC rules, not step-by-step task history.

## Current State

1. ACDC-specific memory is still much smaller than CESR/KEL memory; most recent
   ACDC progress came through shared serder/native work rather than a long
   standalone credential implementation lane.
2. `SerderACDC` parity now depends on section-label-aware identifier handling:
   schema sections compute `$id`, ordinary saidive sections compute `d`, and
   aggregate sections compute and verify `agid`.
3. Compactable top-level ACDCs and partial section-message ilks are different
   verification lanes: compactive ilks hash over the most compact section form,
   while partial section messages keep the visible section expanded but still
   require embedded identifiers to be correct.
4. Native ACDC support now rides the shared native support matrix in
   `packages/cesr/src/serder/native.ts`; future parity work should extend that
   matrix and its field-family helpers instead of adding ACDC-only sidecar
   parser or serder branches.
5. ACDC storage/indexing work should inherit the same DB invariants used by the
   rest of the project; duplicate-order and idempotence assumptions live in the
   shared DB architecture contract, not in ad hoc credential-local lore.
6. The registry-backed IPEX route family now exists in `app/ipexing.ts` with
   KERIpy route graph validation, `erpy` one-response-per-prior enforcement,
   KERIpy notifier payloads, and v1 EXN builders for apply/offer/agree/grant/
   admit/spurn.
7. Parser/runtime VDR dispatch is now fakeable: TEL ilks route through injected
   `tvy.processEvent` with the last `SealSourceCouples` source, ACDC bodies
   route through injected `vry.processACDC` with the last `SealSourceTriples`
   source, and `Reactor` runs optional TEL/verifier escrow turns.
8. The first concrete registry-backed `Tevery`/`Tever` and `Verifier` exist
   behind that seam. TEL processing covers registry inception, backer rotation,
   issue, revoke, out-of-order and anchorless reprocessing, and KERIpy Reger
   state persistence; verifier processing validates cached JSON schemas, saves
   direct revoked credentials, rejects revoked chains, applies `I2I`/`NI2I`
   defaults, fails `DI2I` explicitly, writes KERIpy `saved`/`issus`/`schms`/
   `subjs` indexes, and replays `mce`/`mse`/`mre` escrows in KERIpy order.
9. Issuer-side single-sig credential orchestration now lives in
   `vdr/credentialing.ts`: `Regery`, `Registry`, `Registrar`, and `Credentialer`
   compose `Reger`, `Tevery`, and `Verifier`; ACDC construction keeps KERIpy's
   subject-level `d`/`dt` handling; local issue/revoke writes TEL completion
   markers and verifier wallet indexes.
10. Multisig credential coordination is an EXN-indexing layer, not a VDR state
    fork: `/multisig/*` proposals group wrappers by the saidified embedded
    section SAID in `meids.` and sender AIDs in `maids.`, while actual approval
    remains an ordinary group-signature path over the embedded business EXN.
11. The Sally-like verifier agent must treat `Notifier` as visibility only:
    durable work is discovered from accepted `/ipex/grant` EXNs, VDR state,
    exchange pathed artifacts, and TEL `revoked` cues; webhook retry/ack state
    belongs in a separate verifier cue sidecar.
12. Credential presentation proof attachments must not conflate `cancs` and
    `ancs`: `cancs` stores the ACDC source seal triple from the TEL issue
    event, while `ancs` stores the KEL anchor for that TEL event.
13. Verifier delivery and webhook target behavior are separate components:
    `tufa verifier run` is the Sally-like verifier sender, while `tufa hook
    demo` is only a Sally `hook demo`-style sample webhook receiver.

## Use This Doc For

1. Credential data-model and compactification rules.
2. Issuance/presentation serialization and verification assumptions.
3. ACDC-specific parity or interoperability findings.

## Key Reference

1. `docs/design-docs/db/db-architecture.md`

## Current Follow-Ups

1. Grow ACDC-native coverage only through the shared native support matrix.
2. Keep compactification and partial-section verification as explicitly separate
   lanes; do not collapse them into generic "map in, map out" serder behavior.
3. Revisit ACDC-specific DB mappings once later DB parity work reaches the
   credential-indexing layers.
4. Extend the registry orchestration services from the local single-sig path to
   KERIpy's full witness/multisig dissemination escrows, and add the VC/IPEX
   CLI command surfaces that drive them.
5. Expand KLI interop beyond the proven KLI issuer -> Tufa holder -> Tufa
   verifier direction into bilateral holder/verifier, chain, revocation, and
   byte-level fixture parity.

## Milestone Rollup

### 2026-03-03 - Shared DB Invariants Became Explicit

- ACDC task threads now route through the shared DB architecture contract so
  credential indexing and duplicate-order reasoning do not drift away from the
  rest of `keri-ts`.

### 2026-03-17 - ACDC Compactification And Native Parity Became Explicit

- `SerderACDC` now treats section identifiers by family (`$id`, `d`, `agid`)
  instead of generic saidive handling.
- Top-level compactable ACDCs and partial section messages are now recognized as
  separate verification modes.
- Native ACDC handling moved under the same matrix-driven support layer used by
  the broader CESR-native serder path.

### 2026-06-06 - IPEX Routes And VDR Dispatch Seam Landed

- IPEX route handling now mirrors KERIpy `vc/protocoling.py` for builders,
  previous-route validation, duplicate-response prevention, and notifier
  payload shape.
- Parser/runtime VDR handoff now has typed fakeable TEL and ACDC dispatch
  surfaces, preserving KERIpy's last-source-seal selection while deferring the
  concrete `Reger`/`Tevery`/`Verifier` implementations.

### 2026-06-06 - Registry-Backed Verifier Core Landed

- `vdr/eventing.ts` now owns the first concrete `Tever`/`Tevery` port for TEL
  registry inception, rotation, issue, revoke, accepted-state persistence, and
  anchorless/out-of-order escrow replay.
- `app/verifying.ts` now owns the KERIpy-compatible verifier core for cached
  schema validation, credential save indexes, missing registry/schema/chain
  escrows, direct-revoked save behavior, revoked-chain rejection, and
  `I2I`/`NI2I`/explicit-`DI2I` chain policy.
- This is still below the Sally-like verifier-agent layer: grant artifact
  extraction, verifier-specific webhook state, business validators, revocation
  webhook delivery, and `tufa verifier` remain follow-up work.

### 2026-06-06 - Local Single-Sig Credentialing Landed

- `vdr/credentialing.ts` now provides the first issuer-side single-sig path:
  registry inception, local TEL anchoring, credential construction, issue,
  revoke, completion markers, credential proof serialization, and a wallet view
  backed by verifier indexes.
- The module intentionally does not hide remaining KERIpy parity gaps: witness
  receipt dissemination, multisig counselor flows, operational `vc` CLI
  commands, grant/admit artifact streaming, and KERIpy golden fixtures remain
  active follow-up work.

### 2026-06-06 - Multisig IPEX Coordination Landed

- `app/grouping.ts` now mirrors KERIpy's `/multisig/icp|rot|ixn|vcp|iss|rev|rpy|exn`
  route family, builder payloads, `Multiplexor` `meids.`/`maids.` indexing,
  and notifier wakeups for remote submitters.
- Group-coordinated IPEX remains two-stage: `/multisig/exn` records the
  proposal by embedded-section SAID; `ipex join --auto` adds the local member's
  group-index signature to the embedded `/ipex/*` EXN and reports whether the
  embedded exchange is accepted or still escrowed.
- External delivery must use lead election over the lowest collected group
  signature index; single-sig habitats are always lead.

### 2026-06-06 - Sally-Like Verifier Agent Landed

- `db/verifier-cueing.ts` ports Sally's cue sidecar shape (`snd`, `iss`, `rev`,
  `recv`, `revk`, `ack`) outside the KERIpy `Reger` namespace so webhook state
  does not disturb VDR fixture comparisons.
- `app/verifier-agent.ts` drives verifier progress from accepted grants and
  TEL revocation cues, reconstructs grant-embedded `anc`/`iss`/`acdc` artifacts
  from exchange storage, waits on shared verifier/TEL state, and posts normalized
  issuance/revocation webhook payloads with durable retry/ack markers.
- `tufa verifier run --hook ... --once` is the bounded operational surface for
  tests and cron-style verifier jobs; omitting `--once` runs the same bounded
  turn in a loop.

### 2026-06-07 - Verifier CLI Workflow Gate Landed

- `VerifierAgent` must not rely only on volatile runtime revocation cues. CLI
  import and `verifier run --once` commonly happen in separate processes, so the
  agent now rescans persisted saved credentials and TEL state for revoked
  credentials tied to accepted grants.
- Revocation webhook idempotence needs a distinct durable ack marker. Issuance
  `ack` cannot suppress later revocation, and revocation `rack` prevents the
  same persisted revoked credential from emitting a webhook every bounded run.
- The operational ACDC workflow gate now exercises public `tufa` commands from
  issuer to holder to verifier: schema import, registry inception, credential
  create/import, holder IPEX grant, verifier webhook issuance, revoke/import,
  verifier webhook revocation, and idempotent repeat processing.

### 2026-06-07 - KLI Issuer Interop Gate Landed

- `tufa saidify` now matches KLI in-place JSON SAD saidification for ordinary
  `d` and schema `$id` labels.
- KERIpy-issued credential exports revealed the proof split: the verifier must
  serialize the TEL source seal from `cancs` and replay the issuer KEL anchor
  from `ancs`; treating the two as the same seal breaks KLI interoperability.
- The live interop gate now proves KLI issuer -> Tufa holder -> Tufa verifier
  for schema import, credential import, holder grant artifact generation,
  verifier grant import, verifier acceptance, and webhook delivery to a
  separate `tufa hook demo` target.
