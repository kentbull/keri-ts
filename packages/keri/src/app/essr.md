# ESSR recipient processing

`EssrRecipient` is an explicit recipient service for the SCS plaintext envelope
emitted by KERIpy `StreamPoster` at commit
`927c0cb8794d7c84fc17143c67df64aab9deda6c`. That reference implements the sender;
this module is a new receiver integration, not a port of an upstream receiver.

Construct one service for an explicitly hosted `Hab`, its `PayloadStore`, a
finite ciphertext byte limit, and a finite concurrency limit. The default is
one active decrypt. Excess concurrent work is rejected immediately rather than
retained in a queue. Aggregate transfer size can exceed the message limit: the
limit applies to one logical sealed message, potentially split across several
Texters.

Run `yield* recipient.decrypt(said, ciphertext, signal)` after `Exchanger` accepts
the exchange. It is an Effection operation that aborts pending reads and joins
file cleanup before cancellation completes.
The service reloads the accepted EXN from `exns`, checks the `/essr/req` route,
matches signed `q.src` to the sender and `q.dest` to the hosted habitat, and
verifies the digest in `a` against the concatenated raw ciphertext. The supplied
`Payload` must expose those decoded bytes, not qualified Texter text.

The current first recipient verification key matches StreamPoster's selection.
The service opens raw sealed-box bytes through `Manager.open` and
`Decrypter.open`; the existing qualified `decrypt` methods keep their behavior.
It never tries unrelated hosted habitats as fallback keys.

Only authenticated plaintext proceeds to SCS framing checks: a Tag3 `SCS` tag,
the authenticated sender's Prefixer, a complete Bexter padding field, and a
nonempty remaining CESR stream. The header is text-qualified as emitted by the
pinned StreamPoster. The inner stream can then select its own supported domain
and genus through an independent parser.

No plaintext file is created before decryption and framing checks succeed. The
result has one owning `plaintext` file and a non-owning `body` view that skips
the SCS header on each read. Feed `body.open(signal)` into a new parser; it
reopens the file in bounded chunks and retains no full plaintext byte array.
Promoting the owner preserves the view; discarding it invalidates the view.
The caller must publish or discard the owner after processing.
`Baser.savePlaintext(said, plaintext, plaintext.size - body.size, signal)` publishes
its file and inner-stream offset; `getPlaintext(said)` reopens both views.

Ciphertext evidence remains separately owned by the accepted exchange. This
service neither deletes `.essrs` nor replaces its KERIpy-readable qualified
values with plaintext or pointers. Relays and replay consumers need not invoke
recipient decryption. Transport route wiring selects whether to invoke this
recipient operation for a hosted habitat.

Working memory includes one admitted ciphertext, one authenticated plaintext,
and crypto-library temporaries. This is bounded by message and concurrency
limits, not by the total transfer. Clearing the owned plaintext buffer after
writing is not a claim that the runtime or crypto backend erases every copy.
