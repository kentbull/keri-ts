# ADR-0016: Held signers and pre-signed habs keep private keys out of the Keeper

- Status: Accepted
- Date: 2026-11-12
- Scope: `Manager.hold` / `Manager.release` in `packages/keri`; the companion
  `Habery.makeSignedHab` is specified here and lands in the next change
- Related: [Manager derived-path signing](adr-0006-manager-derived-path-signing.md),
  [pluggable store contract](adr-0015-pluggable-store-contract.md),
  `packages/keri/src/app/identity/keeping.ts`,
  `packages/keri/src/db/keeping.ts`,
  KERIpy `keri/app/habbing.py` (`makeSignifyHab`, `SignifyHab`)

## Context

An embedding application may derive a signing key from a user secret and must
never have that key, or its seed, at rest. A stock salty or randy hab cannot meet
that: `Manager.incept` writes the seed to `pris.` and, for salty, the derivation
salt to `prms.`.

What the Keeper stores, and what the AEID protects (`Keeper.changeEncryption`,
`db/keeping.ts`, and `Manager.updateAeid`, `app/identity/keeping.ts`):

- Encrypted under the AEID box key: `gbls.salt`, each `prms.` record's `salt`,
  every signer seed in `pris.`, and registry roots in `rroots.`.
- Plaintext whatever the AEID: public keys (`pubs.`), key situations (`sits.`),
  `pidx`, `algo`, `stem` and `tier` (`PrePrmShape`, `db/keeping.ts`), the
  group-member tables, and all of Baser.
- The AEID is a public verification key. The matching seed is process-local and
  never persisted (`Manager.seed`). Anyone holding the Keeper files and that seed
  can decrypt every stored private key; the AEID protects the files at rest only.

So "no key at rest" cannot be reached by encrypting harder. The key must not be
written at all, and the Manager must still be able to sign with it while it is
live in the process.

## Decision

Add two general mechanisms. Neither knows about any product.

1. `Manager.hold(signers)` and `Manager.release(pubs?)` (this change).
2. `Habery.makeSignedHab(name, ns, { serder, sigers, hidden? })` (next change).

### Held signers

`hold` puts live `Signer` objects in a table inside the `Manager` instance, keyed
by `signer.verfer.qb64`. The one private lookup every signature and decryption
resolves a key through, `Manager.getSignerByPub`, consults that table before
`pris.`. The table is never written to any Keeper table, so a held key leaves no
row in `pris.`, `prms.`, `sits.`, `pubs.`, `gbls.` or any other, with or without
an AEID. `release()` drops every held reference; `release(pubs)` drops those.
After release the lookup falls through to `pris.` and fails with the unchanged
`Missing prikey in db for pubkey=...` error.

Paths that resolve a private key, all through `getSignerByPub`: `Manager.sign`
with `pubs` or `verfers`, `Manager.decrypt`, `Manager.open` (ESSR), the randy
`pre/path` branch of `sign`, and the verfer lookups in `rotate` and `replay`. At
the call sites, `Hab.sign` (group member and plain), `Hab.decrypt`, witness
receipts, `signGroupEventWithLocalMembers` and `signLocalGroupEvent` all call
`Manager.sign` with `pubs`, and every Hab in a Habery shares the Habery's one
Manager. The salty `pre/path` branch re-derives from the stored prefix salt and
bypasses the lookup; no Hab caller uses it.

Held signers are borrowed. The host owns each `Signer` and its seed bytes,
including zeroing them. The Manager keeps a reference and nothing else: it copies
no seed bytes and `release` does not erase anything.

Encoding matters. The same raw Ed25519 key is `D...` when transferable and
`B...` when not, and the table is keyed by the qualified form. The host must hold
a signer built with the transferability the key list or prefix uses. A request
for the other encoding does not match and fails as a missing key.

### Why the seam is the Manager, not the Hab

Habs do not sign; they ask the Manager. The two group-signing helpers call
`member.mgr.sign` directly, and group member Habs share one Manager with the
group. A Hab override would miss those paths and every `decrypt` and `open`. The
Manager lookup covers all of them with one change and keeps Keeper rows the only
other source of keys.

### Why signing stays synchronous

`Manager.sign`, `decrypt` and `open` are synchronous, and so are many call
sites in `Hab`, endorsement and exchange code. A provider that signs asynchronously
would change `Manager.sign`, `Hab.sign` and `endorse`, so it cannot be additive.
A held `Signer` is already in memory and signs synchronously, which is all this
mechanism promises.

### `Algos.extern` stays reserved

`Algos.extern` names a future real external signer, as in KERIA, where the private
key never enters this process and signing is a remote or asynchronous request.
Holding a `Signer` is the opposite: the host has handed the process a live seed.
Reusing the name would make a later real implementation a breaking change, and
no marker is written to the Keeper for held keys (adding a field to the prefix
parameter record would change a record shape shared with KERIpy). `Algos.extern`
continues to throw as unsupported.

## Interactions

- AEID change (`updateAeid`): re-encryption reads and rewrites Keeper rows only.
  Held signers are not in the Keeper, so they are unaffected and stay usable.
- Close and reopen: holds live in one `Manager` instance. A reopened Keeper
  under a new `Manager` has none; the host calls `hold` again.
- Hold of an already-held pub replaces it. A held signer shadows a stored key
  with the same public key, which is the only way a lookup order is observable.

## What this does not protect

- A held key is in process memory. The Manager makes no claim about page memory,
  swap, core dumps, WebAssembly memory or a debugger, and zeroing is the host's.
- Whoever has the user's secret can derive the key again. Holding only avoids
  storing it.
- A compromised process can call `Manager.sign` while the key is held.
- Stored keys, including the AEID-encrypted ones of other habs, keep their
  existing protection and its limits.

## What belongs to embedders

Key derivation and its parameters, the marker saying a hab is keyless, any
escrow or recovery of secrets, group membership and threshold policy, session
lifetime and when to hold and release, and password or secret change flows. keri-ts
supplies the two mechanisms and a missing-key error; it needs no product marker.

## Consequences

- Additive: no exported name changes, no stored record changes, no wire change.
- A hab whose keys are only held cannot rotate by itself (`Manager.rotate`
  refuses an empty next lot and `Hab.rotate` needs Keeper situation state). That
  is the intended behavior for such habs and needs no new refusal code.
- Tests: `test/unit/app/identity/held-signers.test.ts` covers sign by pubs and
  verfers, both encodings, decrypt and ESSR open, precedence over a stored key,
  a byte-exact Keeper snapshot around hold and sign, release in whole and part,
  reopen, and an AEID change.
