# ESSR recipient processing

`EssrRecipient` is an explicit recipient service for the SCS plaintext envelope
emitted by KERIpy `StreamPoster` at commit
`7143832813cac6a394ab1faf9be83bb3372be87c`. That reference implements the sender;
this module is a new receiver integration, not a port of an upstream receiver.

Construct one service for an explicitly hosted `Hab`, its `PayloadStore`, a
finite ciphertext byte limit, the host's shared `ResourcePolicy`, and an optional
per-recipient concurrency limit (default one). Every recipient in the host must
borrow that same policy. Its default permits one active decryption across instances. Excess concurrent work is rejected immediately rather than
retained in a queue. Aggregate transfer size can exceed the message limit: the
limit applies to one logical sealed message, potentially split across several
Texters.

Run `yield* recipient.decrypt(said, ciphertext, signal)` after `Exchanger` accepts
the exchange. It is an Effection operation that aborts pending reads and joins
file cleanup before cancellation completes. Handle its `EssrDecision` exhaustively:

**`accept`**

- Meaning: Authentication and framing succeeded
- Ownership / caller responsibility: Consume `message`; publish or discard its `plaintext` owner

**`refuse`**

- Meaning: Admission policy: `busy`, `limit`, or `unaccepted`
- Ownership / caller responsibility: No plaintext; capacity may later clear, size remains inadmissible under the same policy, and processing requires durable exchange acceptance

**`reject`**

- Meaning: Verification failed: `envelope`, `digest`, `decrypt`, or `framing`
- Ownership / caller responsibility: No plaintext; do not interpret this as queued work

There is no automatic retry or queue. `EssrError` is removed. A declared size
above the ceiling refuses admission; a size below the sealed-box overhead is a
malformed envelope. Both stop before ciphertext reads/allocation. Invalid
`Payload.size` metadata or dishonest reader lengths throw `RangeError`, following
the payload contract. Cancellation and unexpected I/O, storage, invariant, or
programming failures propagate as exceptions, never ordinary decisions.
The service reloads the accepted EXN from `exns`, checks the `/essr/req` route,
matches signed `q.src` to the sender and `q.dest` to the hosted habitat, and
verifies the digest in `a` against the concatenated raw ciphertext. The supplied
`Payload` must expose those decoded bytes, not qualified Texter text.

The current first recipient verification key matches StreamPoster's selection.
The service opens raw sealed-box bytes through `Manager.open` and
`Decrypter.open`. Those raw APIs return `null` only for authenticated-decryption
failure. Key-store reads and key derivation happen outside that classification;
missing keys and corrupt keeper state propagate. The primitive adapter recognizes
only the pinned libsodium wrapper's authentication failure; other backend errors
propagate. Existing qualified `decrypt` methods still throw on authentication
failure, including while hydrating protected keeper data.
It never tries unrelated hosted habitats as fallback keys.

Only authenticated plaintext proceeds to SCS framing checks: a Tag3 `SCS` tag,
the authenticated sender's Prefixer, a complete Bexter padding field, and a
nonempty remaining CESR stream. The header is text-qualified as emitted by the
pinned StreamPoster. The inner stream can then select its own supported domain
and genus through an independent parser.

No plaintext file is created before decryption and framing checks succeed. The
accepted `message` has one owning `plaintext` file and a non-owning `body` view that skips
the SCS header on each read. Feed `body.open(signal)` into a new parser; it
reopens the file in bounded chunks and retains no full plaintext byte array.
Promoting the owner preserves the view; discarding it invalidates the view.
The caller must publish or discard the owner after processing. The recipient
releases every untransferred file, including when sink cleanup fails after
finish, and releases its reservation once. Scope cancellation joins input and
file cleanup before returning.
`Baser.savePlaintext(said, plaintext, plaintext.size - body.size, signal)` publishes
its file and inner-stream offset; `getPlaintext(said)` reopens both views.

Ciphertext evidence remains separately owned by the accepted exchange. This
service neither deletes `.essrs` nor replaces its KERIpy-readable qualified
values with plaintext or pointers. Relays and replay consumers need not invoke
recipient decryption. Transport route wiring selects whether to invoke this
recipient operation for a hosted habitat.

Before reading ciphertext, admission reserves one shared decryption slot and
`max(64 MiB, 8 × ciphertext size)` bytes. This is the approved initial conservative
crypto credit, not a measurement of native copies. Oversized configuration and
busy capacity remain distinct refusals. The reservation is held through input
cleanup and disposal of any untransferred plaintext, then released once. Successful
file ownership transfer releases crypto credit; subsequent file reads belong to
the consumer's admission boundary.

Streams, queues, storage copies and file-reader ownership still require integration
through the [shared-resource phase](../../plans/runtime/RESOURCE_POLICY_PLAN.md).
This recipient integration alone does not establish a runtime-wide memory bound.
Clearing the owned plaintext buffer after writing is not a claim that the runtime
or crypto backend erases every copy.
