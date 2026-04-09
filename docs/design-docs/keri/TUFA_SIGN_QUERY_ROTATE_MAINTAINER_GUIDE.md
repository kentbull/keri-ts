# Tufa Sign / Query / Rotate / Interact Maintainer Guide

## Purpose

This document is the maintainer-oriented map for the `tufa sign`, `tufa verify`,
`tufa query`, `tufa rotate`, and `tufa interact` parity slice. It explains the
mental model we borrow from KERIpy, the places where `keri-ts` is intentionally
different, and the invariants that make the current interop proof honest.

This guide is deliberately narrower than a general `Hab`/runtime guide. It is
about the parity path that starts with a locally controlled single-sig
identifier, rotates or interacts it, and then proves that another store must
query before it can verify signatures from the newly active key state.

## Module Map

- `packages/keri/src/app/cli/sign.ts`
  - CLI surface for signing UTF-8 text or `@file` contents.
- `packages/keri/src/app/cli/verify.ts`
  - CLI surface for verifying indexed signatures against locally accepted state.
- `packages/keri/src/app/cli/query.ts`
  - Bounded command runtime that drives query continuations, transport, mailbox
    polling, and optional catch-up replay fallback before printing state.
- `packages/keri/src/app/cli/interact.ts`
  - CLI surface for authoring one local `ixn` and optionally converging witness
    receipts.
- `packages/keri/src/app/querying.ts`
  - Query correspondence layer: `KeyStateNoticer`, `LogQuerier`,
    `SeqNoQuerier`, `AnchorQuerier`, and `QueryCoordinator`.
- `packages/keri/src/app/habbing.ts`
  - `Hab.rotate(...)`, `Hab.interact(...)`, event builders, local acceptance,
    and keeper rollback.
- `packages/keri/src/app/reactor.ts`
  - Parser ingress plus escrow retry seam for recoverable reply failures.
- `packages/keri/src/app/server.ts`
  - Runtime cue draining plus mailbox replay publication used by query catch-up.

## KERIpy Correspondence

The closest KERIpy reference points are:

- `keri.cli.commands.sign`
- `keri.cli.commands.verify`
- `keri.cli.commands.query`
- `keri.cli.commands.rotate`
- `keri.cli.commands.interact`
- `keri.app.querying`
- `keri.app.habbing`
- `keri.core.routing`
- `keri.core.parsing`

The important rule is: port the behavioral contract, not the HIO architecture.

What stays the same:

- `sign` signs current accepted local keys and prints indexed signatures.
- `verify` verifies against current accepted local key state only.
- `query` is bounded correspondence work that tries to converge local accepted
  state before printing external state.
- `rotate` advances local keeper state, emits a rotation event, accepts it
  locally, and only then considers the new keys authoritative.
- `interact` authors one `ixn`, accepts it locally, and then optionally
  converges witness receipts over the already-existing receiptor helpers.
- unverifiable replies are recoverable work when they are escrow-worthy, not
  necessarily fatal protocol corruption.

What is intentionally different in `keri-ts`:

- Effection operations replace KERIpy's HIO doers.
- query transport and mailbox polling are composed explicitly per command
  instead of being mostly ambient long-lived runtime behavior.
- attester selection is deterministic instead of randomized.
- parser ingress uses CESR frames/envelopes plus `dispatchEnvelope(...)`
  instead of KERIpy's monolithic `Parser` object model.

## Query / Reply / Escrow Flow

`verify` is intentionally local-state only. It does not fetch key state. That is
why the stale-key interop proof matters: if a remote controller rotates, another
store should fail to verify signatures from the new key until it learns the new
state.

The query path is:

1. `tufa query` opens a local runtime and registers a continuation.
2. `QueryCoordinator` turns continuations into honest outbound `qry` messages.
3. transport sends the query and ingests any immediate CESR reply bytes.
4. `Reactor` parses ingress and dispatches envelopes through `Revery`,
   `Kevery`, and `Exchanger`.
5. if a reply is not yet verifiable, it may be recoverable and escrowed rather
   than treated as terminal failure.
6. later turns retry reply/KEL escrow processing until accepted state
   converges or the bounded command time expires.

The recoverability model is conceptually the same as KERIpy's
`UnverifiedReplyError` handling:

- a `/ksn` reply can be authentic in intent but still unverifiable because the
  establishment event material needed to trust it has not landed locally yet
- that should trigger retry/escrow behavior, not permanently abort ingress

`keri-ts` expresses that differently:

- `Reactor.processOnce()` treats `UnverifiedReplyError` as recoverable ingress
  work
- `Reactor.processEscrowsOnce()` performs the later retry pass
- `server.ts` can publish replay catch-up material into mailbox topics after a
  successful `ksn` reply so later polling turns have the actual KEL material
  needed to update local accepted state

## Rotate Flow

`Hab.rotate(...)` is the center of truth for local rotation success. The CLI
does not own key-state mutation.

Rotation ordering is intentionally strict:

1. read current accepted state and prior keeper sit.
2. prefer replayed pre-rotated material; if none exists, generate fresh next
   keys through `Manager.rotate(...)`.
3. derive thresholds, witness math, and `toad`.
4. build the rotation or delegated-rotation event.
5. sign with the newly active current keys.
6. accept the event locally through the same accepted-state machinery used for
   other events.
7. only after successful acceptance, erase stale old private keys.
8. on failure, roll keeper sit state back.

That ordering matters. If old keys were erased or new keys were treated as
authoritative before local acceptance, the interop story would become a local
storage trick instead of a truthful accepted-state transition.

## Interact Flow

`Hab.interact(...)` is intentionally simpler than rotation:

1. read current accepted state.
2. build an `ixn` with `{ t, d, i, s, p, a }` from current prefix, prior SAID,
   next sequence number, and committed anchor data.
3. sign with the current accepted controller keys.
4. accept the event locally through `Kevery`.
5. optionally converge witness receipts through `Receiptor` or
   `WitnessReceiptor`.

The important negative rule is just as important as the positive one:

- do not port KERIpy's doer stack or exception-flow shape here.
- do not invent a delegated publication/proxy branch for `interact`.

KERIpy `kli interact` does not run the delegated-rotation publication path. In
`keri-ts`, delegated single-sig `ixn` is just another local event that is
validated through the accepted-state machine and then receipted like other
events.

## Failure Before Query, Success After Query

The interop proof is meant to demonstrate one real protocol fact:

- a signature from the newly rotated key should fail verification in another
  store while that store still has stale accepted key state
- after the stale store queries and learns the new key state, the exact same
  signature should verify successfully

The proof is not:

- export/import magic
- manual DB surgery
- direct keeper sharing

It is specifically about accepted-state convergence.

Maintainer reading of the test:

- `sign` proves the latest local key can produce a valid indexed signature
- `verify` proves that validity is relative to local accepted key state
- `query` proves the store can update accepted state from remote protocol data
- the replay catch-up path proves that a successful key-state notice can lead to
  later accepted-state convergence instead of being a dead end

## Unsupported Advanced Rotate Flows

Current `tufa rotate` parity is intentionally incomplete only for the delegated
publication/proxy flow. Witness receipt-endpoint and witness authentication-code
flows are now real for `rotate`, `interact`, and `witness submit`.

The remaining rule is:

- do not document delegated publication/proxy follow-on behavior as implemented
  until the runtime orchestration exists and interop evidence proves it.

## Maintainer Rules of Thumb

- If you change `verify`, ask whether stale-key failure-before-query is still
  true.
- If you change `query`, ask whether it still converges via accepted-state
  machinery instead of side-channel state mutation.
- If you change `rotate`, ask whether keeper rollback and stale-key erasure
  still happen in the right order.
- If you change `interact`, ask whether local `ixn` authoring still lands on
  `Hab.interact(...)`, local `Kevery` acceptance, and the shared witness
  receipting seam instead of splitting those responsibilities again.
- If you change reply handling, ask whether recoverable `/ksn` work still
  behaves like escrow/retry work instead of fatal ingress corruption.
