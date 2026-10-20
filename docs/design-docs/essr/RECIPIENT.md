# ESSR recipient processing

`EssrRecipient` verifies and decrypts accepted exchange evidence for one explicitly
hosted `Hab`. Construct it with that habitat and call `recipient.decrypt(said)`.
The operation is synchronous: LMDB evidence and sealed-box crypto already expose
finite bytes. It creates no files, durable plaintext, queues or storage owners.

Handle the decision exhaustively:

- `accept`: `message` contains the authenticated sender, selected recipient and
  inner CESR `body` as a caller-owned `Uint8Array`. Its lifetime belongs to the
  caller; it is never persisted automatically. Mutating it cannot change stored
  ciphertext or subsequent decryption results.
- `refuse/unaccepted`: the EXN is not durably accepted.
- `reject/envelope`, `digest`, `decrypt` or `framing`: the selected exchange or
  evidence failed its respective authentication/framing check.

The recipient loads the accepted EXN, checks `/essr/req`, signed `q.src` and
`q.dest`, the explicitly hosted local prefix, and the signed digest over the
ordered LMDB Texters' raw bytes. It decrypts only with the recipient's first
accepted verification key, matching the pinned StreamPoster selection. A sealed
box shorter than its 48-byte overhead is malformed. Only authenticated-decryption
failure becomes `reject/decrypt`; keeper, storage and unexpected backend failures
propagate.

Authenticated plaintext must contain the SCS tag, authenticated sender Prefixer,
complete Bexter padding and a nonempty inner stream. Callers may submit `body`
through an independent parser; decryption does not recursively dispatch it.
Relays and replay consumers need not decrypt. Ciphertext stays in `essrs.`.
There is no claim that garbage collection or buffer clearing erases all runtime
or crypto-backend copies.

The pinned KERIpy StreamPoster builds the corresponding envelope, and KERIpy
already verifies the signed ESSR digest and provides recipient decryption through
Hab/Manager. This module composes those concerns with explicit SCS validation;
it does not imply those primitives are absent upstream.
