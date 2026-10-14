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
KEL/RPY/VCP/ISS approval and group IPEX wrapper approval have separate owners.
All eight legacy coordination routes are registered; V2 nested processing is limited
to the four routes above, exactly as [714 validate][v2-routes] requires.

## Deferred legacy boundary

714 has real [peer revocation approval/fanout][legacy-rev]. TS retains REV
construction/notifications and individual revocation, but its CLI peer workflow
is unfinished. This is existing legacy behavior outside the approved V2 foundation
scope, not a reference stub or a new release-gating implementation project.

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

[v2-routes]: https://github.com/WebOfTrust/keripy/blob/7143832813cac6a394ab1faf9be83bb3372be87c/src/keri/app/grouping.py#L903
[legacy-rev]: https://github.com/WebOfTrust/keripy/blob/7143832813cac6a394ab1faf9be83bb3372be87c/src/keri/cli/commands/multisig/join.py#L848
