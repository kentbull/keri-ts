# ADR-0006: Manager Derived-Path Signing Uses Keeper-State Addressing

- Status: Accepted
- Date: 2026-04-02
- Scope: `packages/keri` keeper/manager signing behavior
- Related:
  - `packages/keri/src/app/keeping.ts`
  - `packages/keri/test/unit/db/keeping.test.ts`
  - `docs/ARCHITECTURE_MAP.md`
  - `keripy/src/keri/app/keeping.py`

## Context

`keri-ts` already supports signing through explicit stored key material:

- `Manager.sign(ser, pubs, ...)`
- `Manager.sign(ser, { verfers, ... })`

The remaining open seam was `Manager.sign(ser, { pre, path, ... })`.

KERIpy documents that seam in `keeping.py`, but leaves the branch stubbed. The
Python docstring is still useful because it explains the intended inputs and
their meaning:

- `pubs` take precedence over `verfers`
- `verfers` take precedence over `pre`
- `path` is a tuple of `(ridx, kidx)`
- the omitted-path default is the current `.new` key information
- `indices` and `ondices` describe indexed-signature placement

At the same time, KERIpy's actual creator and keeper-state code makes one
important constraint clear:

- deterministic path-based signer reconstruction exists for `salty`
- `randy` has stored signer secrets, but no deterministic re-derivation model

Without an explicit architectural decision, `keri-ts` had several bad options:

1. keep the branch unimplemented forever
2. treat `path` as a raw derivation string and leak low-level salty semantics
   into `Manager`
3. pretend `randy` can be re-derived deterministically
4. add new persisted state just to make the branch work

Those are all the wrong abstraction boundary.

## Decision

`keri-ts` implements `Manager.sign({ pre, path })` as **keeper-state
addressing**, not as a raw derivation-path API.

Concretely:

- `Manager.sign(...)` preserves KERIpy precedence:
  - explicit `pubs`
  - then explicit `verfers`
  - then managed `pre/path`
- `path` is modeled as:
  - `SigningPath { ridx?: number; kidx: number }`
- `SigningPath` identifies one managed key lot inside one prefix:
  - `ridx` is the rotation index of the establishment event using that lot
  - `kidx` is the zeroth key index of that lot in the full key sequence
- omitting `path` defaults to the current `.new` lot from keeper state

### Keeper-State Resolution

The `pre/path` branch resolves signer material from existing keeper state:

- `prms.` supplies `PrePrm` (`algo`, `pidx`, `salt`, `stem`, `tier`)
- `sits.` supplies the active `PreSit` (`old`, `new`, `nxt`)
- `pubs.` supplies historical public-key lots by `(pre, ridx)` when the lot is
  no longer one of `old/new/nxt`

No new LMDB state is introduced for derived-path signing.

### `salty`

For `salty` prefixes:

- the manager reconstructs signers from persisted keeper parameters
- the full derivation path remains an internal detail derived from stored
  `stem`/`pidx` plus addressed `(ridx, kidx + offset)`
- each reconstructed signer is validated by requiring
  `signer.verfer.qb64 === storedPub`

This keeps `Manager` as an orchestrator over keeper state while still allowing
deterministic signer reconstruction where the algorithm actually supports it.

### `randy`

For `randy` prefixes:

- `pre/path` resolves the addressed public-key lot
- the manager loads the corresponding stored signers from `pris.`
- no deterministic path re-derivation is attempted

This is intentionally asymmetric with `salty`. `randy` does not have a truthful
deterministic re-derivation seam, so `keri-ts` does not invent one.

### Indexed-Signature Semantics

For explicit `pubs` / `verfers`, existing coherent-list semantics remain
unchanged:

- `indices` set `Siger.index`
- `ondices` set `Siger.ondex`

For derived `pre/path` signing, `indices` have one additional meaning inferred
from KERIpy's stub comments:

- they select offsets from the addressed key lot, in caller order
- those same values are then emitted as `Siger.index` when indexed output is
  requested

`ondices` remain signature-encoding metadata only. They do not select keys.

## Rationale

### Why Not Use a Raw String Path?

Because `Manager` is not the primitive derivation API. `Salter` and `Signer`
own derivation and signing semantics. `Manager` owns keeper-state orchestration.

If `Manager.sign(...)` accepted raw derivation strings as its public contract,
it would blur:

- keeper addressing
- deterministic derivation
- algorithm-specific path construction

That would make the app-layer contract harder to review and easier to misuse.

### Why Split `salty` And `randy`?

Because the algorithms have different truth conditions.

- `salty` can reconstruct signer material from persisted derivation parameters
- `randy` cannot; it only supports lookup of already-stored signer secrets

Trying to force both algorithms through one fake “derive by path” story would be
architecturally dishonest.

### Why Reuse Existing Keeper State?

Because the needed model is already present:

- `PrePrm` tells us how the sequence was rooted
- `PreSit` tells us which public-key lots are active
- `pubs.` gives replayable historical public-key lots

Adding more durable state would increase storage drift without buying a better
model for ordinary persisted sequences.

### Why Validate Derived `salty` Signers Against Stored Pubs?

Because re-derivation is an inference from stored parameters, not a blind trust
operation.

The validation step catches:

- keeper-state corruption
- wrong suite reconstruction
- wrong transferability reconstruction
- wrong `(ridx, kidx)` addressing

Without that check, derived signing would silently turn a state-model mistake
into a signature mismatch much later in the call chain.

## Consequences

Positive:

- aligns `keri-ts` with KERIpy's documented manager mental model
- keeps `Manager` at the right abstraction layer
- avoids inventing fake deterministic behavior for `randy`
- uses existing LMDB state and therefore requires no storage migration
- keeps derived signing behavior explicit and testable

Negative:

- `keri-ts` is implementing a reasoned port of a KERIpy-documented but
  unimplemented branch, so the final behavior is guided by upstream intent
  rather than by direct line-for-line parity
- historical `pubs.`-only lots do not persist `kidx`, so caller-supplied `kidx`
  is trusted there while known `old/new/nxt` lots require an exact match
- manager code becomes somewhat more explicit because it now owns lot
  resolution and derived-branch selection rules

## Rejected Alternatives

### Keep The Branch Unimplemented

Rejected because the rest of the keeper/creator port already moved `keri-ts`
onto KERIpy's mental model. Leaving this seam stubbed would preserve an obvious
gap in the public manager contract.

### Make `path` A Raw Derivation String

Rejected because it leaks primitive-level salty mechanics into the manager API
and obscures the keeper-state model.

### Re-Derive `randy` Keys Anyway

Rejected because there is no truthful deterministic derivation contract for
`randy`. That would be fiction, not parity.

### Persist More State Just For Derived Signing

Rejected for now because ordinary persisted sequences already carry enough state
to reconstruct `salty` signers and resolve `randy` signer lots. Adding more
durable state would be storage drift first, benefit second.

## Failure Conditions And Boundaries

### `temp=true` Is Not Persisted

Derived `salty` signing only reconstructs from persisted keeper parameters.
`temp=true` is not part of `PrePrm`, so a sequence created with ephemeral
stretch settings is not fully reconstructible from keeper state alone.

This is why derived `salty` signing is guaranteed for normal persisted
sequences, not for ephemeral test derivations.

### Known Lots Versus Historical Lots

For addressed lots that match `ps.old`, `ps.new`, or `ps.nxt`:

- supplied `kidx` must match the stored lot exactly

For historical lots available only from `pubs.`:

- the public-key lot is authoritative
- caller-supplied `kidx` is accepted because `PubSet` does not persist it

## Appendix A: Maintainer Examples

### Default Current-Lot Signing

```ts
manager.sign(ser, { pre });
```

Meaning:

- resolve `pre`
- use `ps.new.ridx` and `ps.new.kidx`
- sign with the whole current key lot in stored order

### Explicit Next-Lot Signing

```ts
manager.sign(ser, {
  pre,
  path: { ridx: ps.nxt.ridx, kidx: ps.nxt.kidx },
});
```

Meaning:

- address the next public-key lot explicitly
- use that lot's signer set

### Derived Indexed Subselection

```ts
manager.sign(ser, {
  pre,
  path: { ridx: 1, kidx: 4 },
  indices: [0, 2],
});
```

Meaning:

- address the key lot rooted at `(ridx=1, kidx=4)`
- select offsets `0` and `2` from that lot
- emit indexed signatures whose `Siger.index` values are `0` and `2`

## Appendix B: Maintainer Rule

If future work touches `Manager.sign({ pre, path })`, preserve this split:

- `Signer` / `Salter` own derivation and signing behavior
- `Manager` owns keeper-state lookup, lot addressing, and signer selection

Do not collapse the manager API back into a raw derivation-string passthrough.
