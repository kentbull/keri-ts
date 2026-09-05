# Opt-in durable mailbox admission

Status: implemented as an explicit SDK mode, pending release review. This is an additive consumer
contract, not a default fix for every existing mailbox caller. KERIpy's current poller appends bytes
to its in-memory message deck before storing `tops`; that ordering does not establish crash safety.

## Enablement and migration

Pass `mailboxAdmission: { mode: "durable", limits: { ... } }` to `createAgentRuntime` or
`MailboxPoller`. Omit it to retain legacy behavior, including the existing risk that the transport
cursor advances before downstream acceptance. Legacy mode creates no retained consumer obligations.
There is no new CLI switch or operator CLI in this change. This is an SDK contract for managed
consumers that can implement durable dispositions and idempotent application effects.

Do not enable durable mode without a retention operator and explicit disposition policy. Do not
switch it off or downgrade to a reader unaware of the inbox while retained work remains: quiesce
polling, inspect/export or finish that work, and explicitly dispose it first. The extra `mbin.`
consumer table belongs to the same Baser LMDB environment as `tops` (`witm.`), not to the separate
provider-side Mailboxer environment.

## Guarantees and non-guarantees

Each remote source tuple `(recipient, endpoint AID, topic, ordinal)` has a digest-derived identity
using an unambiguous JSON tuple, and an immutable raw-byte digest. Topics can contain delimiters.
Recipient/endpoint key components use base64url-safe characters so existing `tops` key separators
cannot alias sources. Ordinals must be nonnegative safe integers, contiguous with admitted per-topic
progress. Duplicate retained tuples must contain identical bytes. Conflicts and gaps fail closed.
Once an acknowledged tuple is removed, an older ordinal is rejected; the inbox does not pretend to
retain an unlimited history of previously acknowledged digests.

One synchronous outer LMDB transaction stores every record in a fetched batch and updates its
source cursor. Insertion, conflict, limit, or cursor-write failure rolls back both sides, including
earlier records in that batch. `tops` in durable mode means **durably acquired**, not verified or
completed by an application. No network, parser, or application callback runs inside this transaction.

`processOnce()` and `pollDo()` keep their signatures. Remote batches gain aligned `deliveries`
metadata. Retained pending bytes replay after reopen even when the provider returns no data.
Successful delivery is attempted once per poller lifetime; an endpoint failure/cancellation before
`processOnce()` returns does not suppress its undispatched records. A throwing continuous sink can
retry on the same poller. Delivered-ID tracking is pruned against retained state, bounding its memory
across acknowledged long-lived traffic. Source/delivery filters apply before decoding raw bytes.

This is at-least-once delivery across restarts. Application effects must be idempotent. A successful
`Reactor.processCompleteChunk()` call returns `void`; it is **not** a durable application receipt.
`settleMailboxPollBatch()` never automatically acknowledges inbox rows. EXN persistence, escrow
admission, and application effects are separate boundaries. General typed reactor outcomes and
application completion journals remain separate work.

## SDK operation and pressure recovery

Use `hby.db.mailboxInbox.retained()` to inspect versioned records, source identity, digest, byte size,
state and exact base64 payload. `pending()` projects replayable bytes; deadletters are excluded.
Both methods expose sensitive protocol content and belong behind the same access boundary as Baser.

After durable application completion or transfer to a protected durable recovery store, invoke
`dispose(delivery, { kind: "acknowledged", reason })`. Supply the exact delivery metadata; source or
digest mismatch is rejected. This removes retained payload, without moving the remote cursor back.
The explicit reason is a bounded caller assertion, not cryptographic evidence or a replacement for
its authorization policy.

For poison input, explicitly dispose as `deadletter` with a bounded reason. This retains the exact
bytes and continues counting them against quota. There is no automatic parser-based deletion,
automatic TTL purge, or claim that deadlettering completes the business operation. Operators can
inspect/export a deadletter and subsequently acknowledge the durable transfer.

Defaults bound one record to 4 MiB, one fetched batch to 16 MiB/256 records, and retained content to
64 MiB/4,096 records per Habery. Byte limits count raw payload; encoded storage and metadata add
overhead. Limits are configurable by trusted callers. Hitting a bound rejects the entire admission
without cursor advancement. Fetching may then be retried after consumers free capacity; callers
must apply their normal error/backoff policy. Existing transport buffering is outside this inbox
admission bound.

A pressure recovery operation is: inspect retained source/digest, write exact bytes to a protected
file/store, sync and verify that transfer, explicitly acknowledge those delivery IDs, then resume
polling from the unchanged next ordinal. Never free space by discarding unprocessed records without
a durable owner for them. Acknowledgment is deliberately outside parser control.

## Acceptance evidence

`mailbox-admission.test.ts` first reproduced the legacy failure: a signed reply was fetched and its
cursor stored, the caller abandoned the batch, and reopening with an empty remote transport lost
that reply. Durable mode now passes that boundary for both finite and continuous polling, including
actual runtime reply acceptance after reopen. Additional tests cover same-poller sink/network
failure and cancellation, rollback after a real `tops` write, duplicate/conflicting source tuples,
byte/count limits, arbitrary topic encoding, deadletter retention, source-bound disposition, and
protected export followed by explicit acknowledgment and capacity recovery. Legacy-default tests
preserve the old API behavior without introducing a hidden retention quota.

Expected admission failures expose `MailboxAdmissionError.kind`: `capacity` requires bounded backoff and consumer/operator disposition or a reviewed limit change; `conflict` requires source-integrity investigation; `gap` requires source/cursor reconciliation (including disposed or reordered ordinals); `invalid-input` requires correcting input or configuration. Retrying an unchanged oversized batch cannot resolve pressure. Database failures and malformed/unsupported retained records are invariant failures, not capacity signals. No policy should classify these conditions by matching diagnostic strings.

Both polling modes replay only registered topics. Retained bytes for other topics remain available for a later subscription or explicit operator disposition; unsubscribed bytes are not silently acknowledged.
