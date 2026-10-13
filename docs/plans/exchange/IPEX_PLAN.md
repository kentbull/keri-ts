# IPEX plan

Owner: roadmap **3e**, partially delivered through #168. See the
[design](../../design-docs/exchange/IPEX.md) and
[delivery evidence](../../reports/parity/DELIVERED_THROUGH_168.md).

## Current boundary

V2 conversation routes validate prior exchange/parties/xid and response ordering.
Nested offer/grant validates disclosure plans, open/closed graphs, edge/schema
rules and each node's issuer proof independently. Registry evidence precedes
issuer anchors, then current issuer signatures. Exchanger persists accepted
parents and dependency escrows; observer registry imports are atomic and retain
newer heads. Pure body construction and byte-input ownership follow the multisig
split. V1 pathed workflows remain separate.

Evidence includes the frozen-upstream wire oracle, real two-Habery dependency
retry/reopen, observer chain import, independent child proofs, and cancellation
that joins blocked reads and disposes owners. This is not full production-path
or bounded-memory qualification.

## Remaining acceptance

1. Complete presentation registries only after [3f](EXCHANGE_ADMISSION_PLAN.md)
   supplies a receiver-observed KRAM historical cutoff. Never invent a sender
   timestamp or treat parent acceptance as a child proof.
2. Keep unsupported deeper nests, registry compact-attribute cases and unfinished
   processing guarded. Preserve frozen edge/operator outcomes and document any
   narrower TypeScript API rather than claiming unsupported operators work.
3. Exercise actual grant/admit coordination, dependencies, escrow/retry,
   duplicates, durable replay and failure cleanup in the complete maintained
   workflow inventory. Match route-specific Python commitments and signatures.
4. Preserve the existing single-to-single, 2-of-2-to-single, single-to-2-of-2
   and 2-of-2-to-2-of-2 workflow obligations, including lead-only final delivery,
   wrong prior linkage, stale escrow, insufficient signatures and non-member
   submissions. Use maintained scenario evidence; do not multiply an arbitrary
   Cartesian test matrix or change participants to obtain a pass.
5. Distinguish accepted EXN conversations, authenticated disclosed nodes, saved
   credentials and registry freshness; none implies all the others.

Issuer-side v2 registry machinery is not supplied by the observer reader/import
API. Full wire transport and runtime resource evidence remain phases 4–7.
