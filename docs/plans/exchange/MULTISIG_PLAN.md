# Multisig plan

Owner: roadmap **3d**, delivered by #160–161. No duplicate implementation task
is pending. See the [design](../../design-docs/exchange/MULTISIG.md) and
[delivery evidence](../../reports/parity/DELIVERED_THROUGH_168.md).

## Supported boundary

V2 `/multisig/icp`, `/rot`, `/ixn` and `/rpy` bind one saidive child with the
route-specific commitment, child-kind and local membership checks. Local approval
controls processing; additional child signatures use ordinary KEL/reply escrows.
Fresh and reopened evidence preserve parent/child proof separation.

Synchronous body construction accepts a parsed Serder; byte convenience operations
own parsing, finite nested-wire collection and joined cleanup. Already-parsed
frames use borrowed serializer views without reparsing. V1 pathed wire and CLI
proposal/join remain supported and distinct.

## Remaining qualification

- Preserve real local-first/remote-first approval, retry, duplicate, reopen,
  failed publication and cancellation evidence in phase 7.
- Further descendants and unfinished routes remain guarded.
- Default native EXN construction remains unqualified: frozen reference
  construction leaves empty `ri/x/p` fields that its decoder rejects. Accepted
  JSON/CBOR/MGPK evidence does not qualify this path.
- Keep parent signatures and child evidence in one parent enclosure. Wrapper
  construction and wrapper acceptance do not authenticate or accept the child.

Broader sender policy belongs to [3f](EXCHANGE_ADMISSION_PLAN.md), resource limits
to [4](../runtime/RESOURCE_POLICY_PLAN.md), and full runtime tests to
[7](../qualification/QUALIFICATION_PLAN.md).
