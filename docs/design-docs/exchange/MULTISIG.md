# Multisig coordination and proposal ownership

Multisig wrappers coordinate member approval of a business event. The enclosed
KEL, TEL, reply or IPEX message retains its own signatures and processing rules.
Legacy v1 proposals use pathed embedded evidence. V2 event proposals use
`/multisig/icp`, `/rot`, `/ixn` and `/rpy`; native registry proposals use
`/multisig/rip` and `/multisig/bup` with exactly two unnested TEL/anchor children.

Native registry approval binds the exact route, group, TEL and anchor. The anchor
must contain the full `{i,s,d}` TEL seal and every supplied source locator must
match it. BUP proposals require the accepted controlling RIP and exact next
ordinal/prior, or byte-identical accepted replay. Shared-anchor indexes never
confer consent to other TEL proposals. Accepted historical anchors reuse an exact
retained local contribution rather than signing again with current keys.

## Commitment and processing

A v2 proposal binds one saidive child to its exact route-specific signed SAID,
checks the allowed child ilk and local membership, and records the proposal.
Local approval of that child SAID precedes child processing. Additional child
signatures pass through normal KEL/reply validation and escrow. Parent acceptance
therefore does not establish child acceptance. Further descendants remain guarded.

Local-first approval borrows hydrated children; remote-first approval reopens
the exchange evidence. Exchanger owns accepted/escrow evidence and transactional
replacement. Commit the authenticated proposal/submitter indexes before awaiting
approval replay, so a peer wrapper arriving during replay sees that approval and
processes its own child. Replay preserves child proof enclosures. Group leadership considers
the group's own collected signature indices, excluding foreign endorsements.

Canonical V1 `/multisig/exn` coordination indexes the embedded-section SAID in
meids and submitters in maids, including native XIP Grants and EXN Admits.
Pathed child bytes retain their body and V2 proof enclosure; the outer version
does not select child proof framing. Joining adds a member's group-index signature
to the business exchange; completion and external lead delivery remain separate decisions.
Single-sig habitats lead their own messages. Notification is a wakeup, not approval;
preserve first-notice behavior for an already indexed proposal.

## Construction and wire ownership

`multisigExnBody` is an ordinary synchronous function over a parsed SerderKERI and
route attributes/options. It checks route/child kind and constructs the commitment.
It performs no parsing, payload reads, storage, disposal or signature authentication.

Already-parsed callers use `nestedPayload` with the existing serializer over
ordinary hydrated child values. Parent signatures and child evidence share one parent attachment enclosure.
V1 retains its pathed encoding and distinct aggregation key.

`prepareMultisigEventExn` is the byte-input Effection operation: synchronously
decode the finite child, delegate pure construction and collect nested wire.
Serialization observes cancellation; ordinary parsed frames need no disposal.
The returned finite bytes have no lazy owner dependency or application size policy.
IPEX uses the [same responsibility split](IPEX.md).

## Scope and evidence

Legacy KEL/reply/VDR command proposals retain V1 encoding. Native registry approval
uses the explicit V2 RIP/BUP contract above. Default native EXN construction
with empty ri/x/p does not round-trip in the frozen reference and remains unqualified.
JSON/CBOR/MGPK acceptance/storage/replay evidence is recorded in the
[multisig plan](../../plans/exchange/MULTISIG_PLAN.md). The
[proof contract](EXCHANGE_PROOFS.md) and [storage contract](../db/PAYLOAD_STORAGE.md)
govern authentication and durability. The [1.0.0 release report](../../reports/parity/CLEANUP_RELEASE_2026-10-16.md)
records composed qualification and its topology/profile limits.

## Event proposal input contract

The icp/rot/ixn/rpy builders share MultisigEventProposal through byte preparation
and synchronous body construction. Each route has its actual attributes: inception
requires signing/rotation members and derives gid from the child; rotation carries
gid and both lists; interaction carries gid and signing members; reply carries gid.
The child supplies its commitment. No open metadata slot or second child identity
is accepted. Attribute values remain immutable borrows through byte preparation;
the route selection is captured before parser suspension. Existing v1/v2 bytes,
child-kind and proof checks remain separate from this input contract.
Other route builders and inbound membership/codec contracts are separate concerns.

For a v1 outer proposal carrying a legacy child body with another attachment
genus, childGvrsn supplies the signed a.cgvrsn hint that KERIpy uses during replay.
The builder derives it; it is not an arbitrary caller attribute. Intrinsic child
genus or matching body/attachment versions need no hint. Frozen canonical-714
vectors cover all four routes and the intrinsic-genus omission case, comparing
complete parent bytes and supplemental bytes after removing KERIpy's separately
owned parent endorsement. This proves encoding parity, not complete bidirectional
approval interoperability; the receiving workflow remains a separate audit.

## CLI approval lifetime

`approvePendingMultisigProposal` approves one matching stored proposal. It has
no polling or deadline contract. CLI orchestration owns the host, waits, prompts
and output; background mailbox/query/escrow workers run once for the command and
join before stores close. Delegated-group completion observes those same workers.
It must not start a nested runtime over the same Habery.

`multisig join --approval-timeout <seconds>` sets one elapsed deadline for finding
a proposal and its local-completion fallback (default 60 seconds). Zero permits
an immediate stored-state attempt. Proposer approval waits also use elapsed
seconds rather than deriving a turn count. Acceptance remains the actual KEL or
endpoint-role state, not a mailbox poll or successful transmission.

## CLI group boundaries

A selected group alias does not authorize a single member to finish a group
operation. Command owners either coordinate member approval or refuse before
business signing and mutation. Normal store loading still occurs.

| Command family                            | Group behavior                                                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inception                                 | `multisig incept/join`; ordinary inception requires an unused alias.                                                                                                                                       |
| Interaction and rotation                  | `multisig interact/rotate`; ordinary commands refuse group aliases.                                                                                                                                        |
| Delegation confirmation                   | Group interaction approval/fanout; group rotation approval is explicitly unsupported.                                                                                                                      |
| Endpoint roles and mailbox administration | Explicit group propose/complete modes; mailbox removal remains unsupported for groups.                                                                                                                     |
| Raw text signing                          | Emits an identified partial member contribution with group signature indices, without collecting approval.                                                                                                 |
| Generic EXN send and challenge response   | Refuse group aliases; select a member or a supported group business workflow.                                                                                                                              |
| Location publication and query requester  | Require an endpoint-owner or member alias rather than an uncoordinated group signature.                                                                                                                    |
| DID binding                               | Refuses group aliases; group artifact generation exports accepted evidence.                                                                                                                                |
| Legacy VCP/ISS                            | Preflight, local approval, witnessed publication and restart are implemented; final peer gates remain.                                                                                                     |
| Legacy revocation and IPEX                | VCP/ISS/REV and all six IPEX verbs support member approval/fanout. REV delivery/export waits for accepted, publication-complete evidence; actual-peer lifecycle qualification remains in the release plan. |
| Inspection, verification and export       | Read accepted group state; do not author a group event.                                                                                                                                                    |

Revocation and IPEX completion remain implementation work. Selected VCP/ISS
checks do not replace the final interoperability matrix.
Native-v2 ACDC/registry authoring remains in its deferred roadmap.
