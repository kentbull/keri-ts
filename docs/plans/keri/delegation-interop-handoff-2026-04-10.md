# Delegation Interop Handoff - 2026-04-10

## Purpose

Rehydrate the current state of the `keri-ts` <-> KERIpy delegation interop
debugging work without depending on stale thread context.

This document is the current source of truth for:

- what has already been fixed
- what was proven false
- what the next blocker most likely is
- how to resume debugging with the right mental model and tools

## Authority And Scope

- The only authoritative KERIpy repo for this work is
  `/Users/kbull/code/keri/kentbull/keripy` on branch `mailbox-impl`.
- Do not use `/Users/kbull/code/keri/sam/keripy` for parity claims.
- Keep the `keri-ts` delegation escrow decisions KERIpy-shaped unless there is
  a compelling reason to diverge.
- Keep standalone mailbox-provider product support intact.
- For delegation interop tests, prefer witness-mailbox combination runtimes
  only, because that matches KERIpy more closely and makes the mental model
  easier to diff.

## Current State

1. The mailbox/runtime architecture bug was real and is already fixed:
   `MailboxDirector` was incorrectly behaving like KERIpy `Respondant`.
2. Non-`stream` cues now belong to `Respondant`, while mailbox code is store and
   forward plus `mbx` stream correlation only.
3. Tufa query ingress semantics were already brought in line with KERIpy:
   `mbx` is open-ended SSE, while `logs` and `ksn` return `204`.
4. Synthetic `/ksn -> /replay` behavior was removed. `logs` answers belong on
   `/replay`, and `ksn` answers belong on `/reply`.
5. Delegation interop tests were already simplified to witness-mailbox-only
   topology.
6. The Tufa delegate side was already healthy before the latest fix: it learned
   the KLI delegator at `sn=1`, populated `aess`, and cleared `.dune`.
7. The stuck side is KLI `delegate confirm`, waiting for the delegated event to
   become locally committed after approval.
8. One real root cause was in `Kevery.decideQuery()`: witness-side query
   acceptance used only the in-memory `db.kevers` cache instead of durable
   read-through state.
9. A second real root cause was in CESR-over-HTTP framing: `splitCesrStream()`
   was cutting `/fwd` messages on raw `{` bytes inside embedded replay payloads,
   which corrupted live replay forwarding and produced HTTP `400`.
10. Both of those bugs are now fixed locally and covered by focused
    regressions.
11. Even after those fixes, the reverse interop row still times out at
    `kli delegate confirm dip` after 60 seconds.
12. Fresh evidence says the raw delegated event is present in KLI
    `delegables.`, so the remaining blocker is no longer "Tufa never published
    the delegated event."

## Verified Findings

- KERIpy `mailbox-impl` delegation approval discovery is `logs`-based, not
  `ksn`-based.
- Delegate-side anchor discovery and delegator-side `delegate confirm` both
  depend on witness-mediated `/replay`.
- In a preserved failing run, the raw delegated `dip` was present in KLI
  `delegables.`, so publication existence is no longer the leading suspect.
- The exact KLI witness-targeted `logs` query shape was accepted by a reopened
  Tufa witness and produced a `replay` cue offline.
- `keri-ts` EXN construction had drifted from KERIpy's version-1
  `exchange(...)` semantics:
  - there was no single authoritative `exchange(...)` helper
  - recipient-bearing EXNs did not project recipient into `a.i`
  - notification-style EXNs such as `/delegate/request` and `/oobis` were being
    sent with recipient fields that KERIpy omits
- The earlier suspicion that Tufa's witness-targeted query `src` field should
  have been the local communication habitat was false. KERIpy also signs with
  the local habitat while setting `qry.q.src` to the chosen witness AID.
- The earlier hypothesis that the relay host root path was ambiguous and
  causing `409` transport conflicts was false for the investigated run.
- The earlier hypothesis that the parser could not understand KERIpy
  `logs(sn)` queries was false.
- The earlier hypothesis that `processUnanchoredEscrow` was missing in
  `keri-ts` was false. The `dune -> aess -> dpub` logic exists.
- The real reason the Tufa witness did not answer one important `logs` query
  was that query acceptance depended on hot cache instead of durable state.
- The real reason one important live replay forwarding attempt failed was that
  `/fwd` was being chopped into invalid partial HTTP requests by a naive CESR
  splitter.

## The Latest Fixed Root Cause

### Symptom

KLI `delegate confirm` queried a Tufa delegate witness, but the witness emitted
no `/replay`, so KLI never locally committed the delegated event.

### What Was Actually Wrong

`Kevery.decideQuery()` used:

- `this.kevers.get(pre)` for `logs`
- `this.kevers.get(pre)` for `ksn`
- `this.kevers.has(pre)` for `mbx`

That only works when the queried identifier is already hot in the in-memory
cache.

On reopened witnesses, remote accepted identifiers may exist only in durable
`states.` until `db.getKever(pre)` reconstructs them. In that situation,
queries wrongly escrowed as `missingKever`.

### Fix

`Kevery.decideQuery()` now uses `this.db.getKever(pre)` for:

- `logs`
- `ksn`
- `mbx` existence checks

### Files Changed

- `/Users/kbull/code/keri/kentbull/keri-ts/packages/keri/src/core/eventing.ts`
- `/Users/kbull/code/keri/kentbull/keri-ts/packages/keri/test/unit/app/gate-e-runtime.test.ts`

## Regression Added

Test:

- `Gate E - reopened witness \`logs\` queries replay remote accepted KEL state via read-through \`getKever\``

File:

- `/Users/kbull/code/keri/kentbull/keri-ts/packages/keri/test/unit/app/gate-e-runtime.test.ts`

What it proves:

- a witness can hold accepted remote state durably after reopen
- `db.kevers.has(pre)` can still be false at reopen time
- a `logs` query still succeeds because `db.getKever(pre)` reconstructs state
- a `replay` emission is produced

Verification command that passed:

```sh
deno test -A packages/keri/test/unit/app/gate-e-runtime.test.ts --filter 'reopened witness `logs` queries replay remote accepted KEL state via read-through `getKever`'
```

## Current Blocker

The most recent live debug reproduction now points to a narrower failure seam.

What is already true:

1. Tufa publishes both `/delegate/request` and the raw delegated event on
   mailbox topic `/delegate`.
2. The KLI delegator does receive the delegated event into `delegables.`.
3. Tufa witnesses can answer the exact KLI `logs` query shape with a replay
   cue.
4. The previous live `/replay` forwarding corruption bug in
   `splitCesrStream()` is fixed.

That means the highest-probability remaining bugs are:

1. The live post-approval `/replay` return path is still not equivalent enough
   to KERIpy, even though offline replay cue generation works.
2. There may still be route-specific EXN shape differences after the new
   central `exchange(...)` refactor, but the previously confirmed recipient
   projection drift is now fixed locally.
3. Tufa's proxy bootstrap stream is structurally aligned with KERIpy
   `introduce(...)`, but there may still be an exact-material or ordering
   difference that KLI relies on during later mailbox or witness processing.

## Important Debugging Tools And Seams

### 1. Use `tufa db dump` First

Treat escrows and mailbox topics as the primary debugging oracle.

High-value targets:

- `baser.states`
- `baser.dune`
- `baser.aess`
- `baser.delegables`
- `baser.qnfs`
- `mailboxer.tpcs`
- `baser.kels`
- `baser.fels`
- `baser.locs`

### 2. Compat KLI Store Dumping Has A Real Footgun

For compat KLI stores under a temp home like:

`/tmp-or-var/.../home/.keri/...`

do **not** rely on `--head-dir` alone. `db dump` readonly reopen currently
prefers the primary `keri/db/...` path and only falls back to `.keri/db/...`
on create failure.

Use this pattern instead:

```sh
cd /Users/kbull/code/keri/kentbull/keri-ts/packages/tufa
HOME=/path/to/kli-temp-home \
DENO_DIR=/Users/kbull/Library/Caches/deno \
deno run --allow-all --unstable-ffi mod.ts db dump --compat \
  --name <kli-name> \
  --base <base> \
  baser.states
```

This forces compat alt-path resolution onto `~/.keri/...`, which matches the
actual KLI temp-home layout.

### 3. Escrows Matter

If a workflow is hanging, inspect the owning escrow rather than waiting for the
test to time out:

- delegate-side delegation hang: `dune`, `aess`, `delegables`
- query correspondence hang: `qnfs`
- mailbox/transport hang: `mailboxer.tpcs`

## Recommended Next Steps

1. Review the `/delegate/request` publication contract first:
   - KERIpy `delegateRequestExn()` payload is only `delpre` plus optional
     `aids`
   - the delegated event must ride in `e.evt`
   - confirm whether Tufa should omit `rp` to match KERIpy exactly
2. Review the live `/replay` forwarding path next:
   - cue creation is already proven offline
   - the remaining question is whether the replay reaches the mailbox topic and
     is processed the same way KLI expects
3. Review the proxy introduction stream:
   - sender KEL replay
   - delegation chain
   - `replyEndRole(proxy)`
   - exact ordering and byte shape still matter here
4. Treat the earlier query-`src` suspicion as closed unless new evidence
   appears. It does not match KERIpy behavior.

## Resume Commands

### Focused Regression

```sh
cd /Users/kbull/code/keri/kentbull/keri-ts
deno test -A packages/keri/test/unit/app/gate-e-runtime.test.ts --filter 'reopened witness `logs` queries replay remote accepted KEL state via read-through `getKever`'
```

### Single Interop Row

```sh
cd /Users/kbull/code/keri/kentbull/keri-ts
deno test -A packages/keri/test/integration/app/interop-delegation-kli-tufa.test.ts --filter 'Interop delegation: tufa delegate with explicit proxy is approved and rotated by a KLI delegator over witness-mailbox transport with witness-backed approval discovery'
```

### Example Compat Dump

```sh
cd /Users/kbull/code/keri/kentbull/keri-ts/packages/tufa
HOME=/var/folders/kg/kzwqkdwn55j5ytz7mpbmbbjm0000gn/T/tufa-kli-home-4ad14ce7b136f5ca \
DENO_DIR=/Users/kbull/Library/Caches/deno \
deno run --allow-all --unstable-ffi mod.ts db dump --compat \
  --name kli-delegator-28f04b94 \
  --base interop-delegation-debug-5dfb0113 \
  baser.states --limit 50
```

## Do Not Re-Litigate These Unless New Evidence Forces It

- Do not switch delegation approval discovery from `logs` to `ksn`.
- Do not reintroduce mailbox-local handling of generic `reply`/`replay` cues.
- Do not use the wrong KERIpy repo for parity reasoning.
- Do not remove standalone mailbox support from product code just because the
  interop tests were simplified to witness-mailbox topology.
