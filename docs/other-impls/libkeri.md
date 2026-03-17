# libkeri Implementation Assessment (Snapshot)

Date: 2026-03-10

## Scope

This document captures a code-level inventory of `libkeri` in
`/Users/kbull/code/keri/kentbull/libkeri`, using KERIpy as the authoritative
behavioral baseline in `/Users/kbull/code/keri/kentbull/keripy`.

The focus is resolver-relevant capability:

- CESR parser and attachment handling
- keystore/key-manager behavior
- KEL eventing (`icp`, `rot`, `ixn`, delegation, receipts, escrow)
- single-sig and multi-sig support
- exchange (`exn`) and reply/query routing
- DB/state surfaces needed for did:webs resolution

## Executive Summary

- `libkeri` has substantial breadth and non-trivial KERI eventing code.
- Core parsing and key-event paths exist, including many attachment group types.
- Several resolver-critical paths are partial or stubbed (`todo!`/placeholders),
  especially escrow, delegation, and attached-receipt processing.
- There are concrete correctness defects (duplicate parser arm,
  witness-threshold boolean logic issue, likely receipt lookup condition bug).
- Exchange routing is wired in parser but no concrete exchanger implementation
  is present; `BaseHab.exchange()` is not implemented.
- Reply (`rpy`) routing via `Revery` is comparatively strong and includes
  acceptance/escrow logic.
- The crate-level public API currently exposes very little from core KERI
  modules (`lib.rs` exports `init` and `Matter`, with private `mod keri`).

## Capability Inventory

| Area                        | Status in libkeri                                                                                                               | Evidence                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| CESR primitives/codex       | Broad set present (`Matter`, counters, indexers, signer/verfer, tholder, etc.)                                                  | `src/cesr/mod.rs`, `src/cesr/tholder.rs`, `src/cesr/signing/*`                       |
| Parser message taxonomy     | Broad message coverage (KEL events, receipts, query/reply, EXN, TEL, ACDC)                                                      | `src/keri/core/parsing.rs` `Message` enum and `process_message`                      |
| Parser dispatch plumbing    | Dispatches to `kevery`, `revery`, `exchanger`, `tevery`, `verifier` handlers                                                    | `src/keri/core/parsing.rs` `dispatch_message(...)`                                   |
| Attachment parsing breadth  | Supports many counters: controller/witness sigs, trans groups, source seals, first-seen, SAD path groups, pathed material, ESSR | `src/keri/core/parsing.rs` `process_attachments(...)`                                |
| Parser correctness          | Duplicate match arm for `NON_TRANS_RECEIPT_COUPLES` (unreachable branch likely meant trans receipt quadruples)                  | `src/keri/core/parsing.rs` around lines 859/867                                      |
| Parser parity TODO          | Explicit KERIpy parity TODO in SAD path root/subpath handling                                                                   | `src/keri/core/parsing.rs` around line 1558                                          |
| Kever lifecycle             | `update` handles `rot/drt/ixn`; signature threshold and key-state updates present                                               | `src/keri/core/eventing/kever.rs`                                                    |
| Delegation                  | Explicitly not implemented in `validate_delegation` when `delpre` is set                                                        | `src/keri/core/eventing/kever.rs` around line 1170                                   |
| Kever escrow methods        | Several escrow methods are `todo!` (`mf`, `ps`, `pw`, `delegable`)                                                              | `src/keri/core/eventing/kever.rs` around lines 1039-1082                             |
| Kevery event processor      | `process_event` exists with in-order/out-of-order/duplicitous flow                                                              | `src/keri/core/eventing/kevery.rs`                                                   |
| Kevery escrow/state helpers | `fetch_witness_state`, `escrow_oo_event`, `escrow_ld_event` are `todo!`                                                         | `src/keri/core/eventing/kevery.rs` around lines 576-598                              |
| Attached receipt handlers   | `process_attached_receipt_couples` and `_quadruples` are stubs returning `Ok(())`                                               | `src/keri/core/eventing/kevery.rs` around lines 751-769                              |
| Receipt escrow placeholders | `escrow_u_receipt`, `escrow_uw_receipt`, query-not-found escrow are logging placeholders                                        | `src/keri/core/eventing/kevery.rs` around lines 941-975 and 1337-1355                |
| Witness-threshold check     | Boolean expression uses `!wigs.len() < toad` (likely incorrect) in two modules                                                  | `src/keri/core/eventing/kevery.rs` line ~1330, `src/keri/db/basing/mod.rs` line ~663 |
| Receipt processing risk     | `process_receipt` appears to invert empty check before indexing first value                                                     | `src/keri/core/eventing/kevery.rs` around lines 815-819                              |
| Key manager                 | Inception/rotation/replay/move/sign/decrypt paths present                                                                       | `src/keri/app/keeping/manager.rs`                                                    |
| Manager sign fallback       | `sign` path with no `pubs` and no `verfers` uses `unimplemented!()`                                                             | `src/keri/app/keeping/manager.rs` around line 1571                                   |
| Manager parity TODO         | Explicit TODO: ingest/reply parity from KERIpy                                                                                  | `src/keri/app/keeping/manager.rs` around line 1809                                   |
| Hab high-level ops          | Incept/rotate/interact/sign/query/receipt/replay/reply helpers present                                                          | `src/keri/app/habbing.rs`                                                            |
| Exchange at Hab layer       | `BaseHab.exchange()` not implemented                                                                                            | `src/keri/app/habbing.rs` around lines 891-893                                       |
| Cue handling                | Multiple cue kinds listed but unhandled (`TODO` block)                                                                          | `src/keri/app/habbing.rs` around line 2611                                           |
| Reply routing               | `Revery` has SAID verification, route dispatch, BADA-like acceptance, reply escrow/unescrow                                     | `src/keri/core/routing/revery.rs`                                                    |
| Exchange implementation     | Parser classifies/dispatches EXN, but no concrete exchanger implementation symbol found in `libkeri` source                     | `src/keri/core/parsing.rs`, repo-wide symbol scan                                    |
| Multisig architecture       | No `GroupHab`, `makeGroupHab`, `joinGroupHab`, `Counselor`, `Multiplexor` symbols in `libkeri`                                  | repo-wide symbol scan                                                                |
| DB setup consistency        | `states`, `ends`, and `locs` all opened under `"stts."` prefix (potential keyspace overlap)                                     | `src/keri/db/basing/mod.rs` around lines 563/566/569                                 |
| Sealing-event lookup        | `fetch_all_sealing_event_by_event_seal` currently returns `Ok(false)` placeholder                                               | `src/keri/db/basing/mod.rs` around lines 669-675                                     |
| Crate API exposure          | Core `keri` module is private from `lib.rs`; external consumers get minimal surface                                             | `src/lib.rs`                                                                         |

## Test/Build Signal

- Running `cargo test -q` in `libkeri` produced:
  - `255` total tests
  - `188` passed
  - `67` failed
- Most failures in this environment were permission-related filesystem/LMDB
  setup issues (`Operation not permitted`) rather than semantic assertion
  failures.
- Compiler warnings include an unreachable parser pattern for the duplicate
  attachment counter arm.

## KERIpy Baseline Delta (Authoritative Reference)

KERIpy contains complete implementations for several domains where `libkeri` is
currently partial:

- Parser orchestration/dispatch breadth:
  - `keripy/src/keri/core/parsing.py`
- Kevery core + escrow families:
  - `processEvent`, `processReceipt`, `processAttachedReceiptCouples`,
    `processAttachedReceiptQuadruples`
  - `processEscrows` and full escrow processors
  - `keripy/src/keri/core/eventing.py`
- Exchange implementation:
  - `Exchanger.processEvent`, escrow handling, `exchange`, `verify`, `lead`
  - `keripy/src/keri/peer/exchanging.py`
- Multisig architecture:
  - `GroupHab` and group signing paths
  - `Habery.makeGroupHab` / `joinGroupHab`
  - `Counselor` / `Multiplexor`
  - `keripy/src/keri/app/habbing.py`, `keripy/src/keri/app/grouping.py`

## did:webs Resolver Implications

For a verification-grade resolver (walk KEL, validate state transitions,
threshold signatures, delegation, and resolver-relevant replies/exchanges):

- `libkeri` is materially ahead in breadth over current `keri-ts`
  `packages/keri` surfaces, but requires hardening of known blockers.
- `keri-ts` parser maturity is high (formal parser `GO` in project learnings),
  but KEL/eventing/multisig/exchange implementation breadth is not yet on par
  with what resolver-grade verification needs.

If selecting `libkeri` as the resolver base, first hardening targets should be:

1. Parser duplicate-arm fix and attachment parity checks.
2. Witness threshold boolean fix.
3. Attached receipt couples/quadruples implementation.
4. Delegation validation path implementation (or explicit unsupported policy).
5. Exchange implementation decision (implement or scope out for v1 resolver).
6. Public crate API exposure for external resolver integration.
