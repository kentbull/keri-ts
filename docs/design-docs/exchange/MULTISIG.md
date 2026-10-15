# Multisig coordination and proposal ownership

Multisig wrappers coordinate member approval of a business event. The enclosed
KEL, TEL, reply or IPEX message retains its own signatures and processing rules.
Legacy v1 proposals use pathed embedded evidence; v2 nested intake currently
supports `/multisig/icp`, `/rot`, `/ixn` and `/rpy` only.

## Commitment and processing

A v2 proposal binds one saidive child to its exact route-specific signed SAID,
checks the allowed child ilk and local membership, and records the proposal.
Local approval of that child SAID precedes child processing. Additional child
signatures pass through normal KEL/reply validation and escrow. Parent acceptance
therefore does not establish child acceptance. Further descendants remain guarded.

Local-first approval borrows hydrated children; remote-first approval reopens
the exchange evidence. Exchanger owns accepted/escrow evidence and transactional
replacement. Replay preserves child proof enclosures. Group leadership considers
the group's own collected signature indices, excluding foreign endorsements.

Legacy `/multisig/exn` coordination indexes the embedded-section SAID in meids
and submitters in maids. Joining adds a member's group-index signature to the
business EXN; completion and external lead delivery remain separate decisions.
Single-sig habitats lead their own messages. Notification is a wakeup, not approval;
preserve first-notice behavior for an already indexed proposal.

## Construction and wire ownership

`multisigExnBody` is an ordinary synchronous function over a parsed SerderKERI and
route attributes/options. It checks route/child kind and constructs the commitment.
It performs no parsing, payload reads, storage, disposal or signature authentication.

Already-parsed callers retain their CesrFrame and use `nestedPayload` with the
existing serializer. These views borrow every child/payload owner until all readers
finish. Parent signatures and child evidence share one parent attachment enclosure.
V1 retains its pathed encoding and distinct aggregation key.

`prepareMultisigEventExn` is the byte-input Effection operation: own cancellable
parseBytes, delegate pure construction, collect nested wire under the finite 8 MiB
ceiling and dispose all parsed frames in finally. Cancellation aborts underlying
reads and joins cleanup. The returned finite bytes have no lazy owner dependency.
IPEX uses the [same responsibility split](IPEX.md).

## Scope and evidence

CLI proposal/join remains v1, as in frozen upstream. Default native EXN construction
with empty ri/x/p does not round-trip in the frozen reference and remains unqualified.
JSON/CBOR/MGPK acceptance/storage/replay evidence is recorded in the
[multisig plan](../../plans/exchange/MULTISIG_PLAN.md). The
[proof contract](EXCHANGE_PROOFS.md) and [storage contract](../db/PAYLOAD_STORAGE.md)
govern authentication and durability; full runtime qualification remains open.

## Event proposal input contract

The icp/rot/ixn/rpy builders share MultisigEventProposal through byte preparation
and synchronous body construction. Each route has its actual attributes: inception
requires signing/rotation members and derives gid from the child; rotation carries
gid and both lists; interaction carries gid and signing members; reply carries gid.
The child supplies its commitment. No open metadata slot or second child identity
is accepted. Attribute values remain immutable borrows through byte preparation;
the route selection is captured before parser suspension. Existing v1/v2 bytes,
child-kind checks and frame disposal remain separate from this input contract.
Other route builders and inbound membership/codec contracts are separate concerns.
