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

- `packages/keri/src/cli/tools/sign.ts`
  - CLI surface for signing UTF-8 text or `@file` contents.
- `packages/keri/src/cli/tools/verify.ts`
  - CLI surface for verifying indexed signatures against locally accepted state.
- `packages/keri/src/cli/commands/query.ts`
  - Bounded command runtime that drives query continuations, transport, mailbox
    polling, and optional catch-up replay fallback before printing state.
- `packages/keri/src/cli/identity/interact.ts`
  - CLI surface for authoring one local `ixn` and optionally converging witness
    receipts.
- `packages/keri/src/app/queries/querying.ts`
  - Query correspondence layer: `KeyStateNoticer`, `LogQuerier`, `SeqNoQuerier`,
    `AnchorQuerier`, and `QueryCoordinator`.
- `packages/keri/src/app/identity/habbing.ts`
  - `Hab.rotate(...)`, `Hab.interact(...)`, event builders, local acceptance,
    and keeper rollback.
- `packages/keri/src/app/protocol/reactor.ts`
  - Awaited source/byte ingress, including mailbox and OOBI intake.
- `packages/keri/src/app/protocol/protocol-processing.ts`
  - Serialized dispatch, reply capture, escrow advancement and cue publication.
- `packages/keri/src/app/transport/http-messenger.ts` and `tcp-messenger.ts`
  - Request-owned response intake through an input-specific parser and Kevery.
- `packages/tufa/src/http/protocol-handler.ts`
  - HTTP ingress and request-owned replies; queued output is delivered by Poster.

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
- parser ingress uses CESR frames/envelopes plus `dispatchEnvelope(...)` instead
  of KERIpy's monolithic `Parser` object model.

## Query / Reply / Escrow Flow

`verify` is intentionally local-state only. It does not fetch key state. That is
why the stale-key interop proof matters: if a remote controller rotates, another
store should fail to verify signatures from the new key until it learns the new
state.

The query path is:

1. `tufa query` opens a local runtime and registers a continuation.
2. `QueryCoordinator` turns continuations into honest outbound `qry` messages.
3. a concrete messenger sends the query and owns immediate response intake with
   its input-specific parser and Kevery. Mailbox and OOBI intake use awaited Reactor
   operations over the same protocol state.
4. `ProtocolProcessor` serializes dispatch through the semantic handlers and
   captures correlated replies before publishing application cues.
5. recoverable proof dependencies remain with Revery's reply escrows and Kevery's
   KEL escrows; transport completion alone does not establish accepted state.
6. the shared escrow worker advances those dependencies while query continuations
   observe accepted state, until convergence or the command deadline.

The recoverability model is conceptually the same as KERIpy's
`UnverifiedReplyError` handling:

- a `/ksn` reply can be authentic in intent but still unverifiable because the
  establishment event material needed to trust it has not landed locally yet
- that should trigger retry/escrow behavior, not permanently abort ingress

`keri-ts` expresses that differently:

- Revery evaluates reply proofs and persists recoverable evidence instead of
  relying on an ingress exception catcher.
- `ProtocolProcessor.processEscrowsOnce()` advances the composed protocol escrows
  under the same serialization as dispatch.
- `KeyStateNoticer` requests logs when a saved remote key state is ahead; accepted
  KEL intake, rather than receipt of the key-state notice, completes the follow-on.
- The bounded CLI can request controller OOBI catch-up if correspondence has not
  converged. The HTTP handler does not synthesize mailbox replay after a `ksn` reply.

Ordinary queries select one random endpoint within the first eligible controller,
agent or witness role, as in the pinned KERIpy reference. Explicit attesters and
witness alternatives retain their separate contracts. See
[query ownership](../runtime/QUERY_REPLY.md) for signer, subject and attester distinctions.

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

## Delegated rotation

`rotate.ts` resolves the delegation communication habitat, begins the latest
delegated workflow and runs bounded runtime/query/mailbox turns until completion
or its turn limit. It closes that runtime in finally and reports workflow status.
Witness receipt-endpoint and authentication-code flows also exist for rotate,
interact and witness submit.

The maintained `interop-delegation-kli-tufa.test.ts` exercises explicit-proxy
inception and rotation in both directions. This source boundary supersedes the
old claim that delegated publication is entirely missing; it does not qualify
untested participant topologies or replace the full qualification run.

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
