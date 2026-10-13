# KEL learnings

## Accepted state and decisions

`Kever` decides validity; `Kevery` routes, persists escrows, handles duplicates and
applies post-acceptance effects. Expected remote outcomes use typed decisions
under [ADR-0005](../../docs/adr/adr-0005-kel-decision-control-flow.md), not exceptions.
Local inception/interaction uses the same acceptance path as remote events.

`states.` is durable key-state authority; `kels.`/`fels.`/`dtss.` retain event
history. Habery.habs and db.kevers are caches. Query/event routing must use
`db.getKever` read-through after reopen. KEL membership alone is not a duplicate
when durable state trails the replayed event; repair state before short-circuiting.
Weighted kt/nt behavior uses Tholder.satisfy, never numeric shortcuts.

## Delegation and group state

- `delegate confirm` derives work from `delegables`; `/delegate/request` notices
  are UI hints. Wait for witnessed/query-backed local commitment before pinning
  `aess` and unescrowing. Remote protected shortcuts must not bypass local approval.
- Later accepted delegator anchors must repair missing `aess` for already accepted
  delegated events as well as promote pending pdes/delegables.
- Persist pending group habitat metadata before processing, but mark prefixes/groups
  and accepted member sets only after KEL acceptance. Pending rotations retain prior
  smids/rmids. Preserve witness signatures through pre-approval and approval replay.
- Rotation signatures independently index current keys and prior next commitments.
  Match current keys cryptographically to accepted ndigers; uncommitted replacements
  sign current-only. Recovery must satisfy prior rotation and new current thresholds,
  preserving unavailable participants' next commitments.
- Use public multisig CLI workflows in interoperability tests. Existing coverage
  includes both-direction single/multi-key and true-group delegation; preserve the
  actual topology rather than inferring arbitrary workflow support from it.

## Replay and evidence

Replay hydrates stored JSON/native bodies with SerderKERI and derives the minimum
attachment genus from body protocol/genus. It is **not fixed to v1**. Every inner
and outer counter follows that genus; v1 widens ordinals to Seqner while v2 retains
Number. TEL/credential export retains the same distinction through escrow/storage.
Frozen upstream accepts v1 TEL/ACDC bodies under v2 attachments but rejects v2 vcp.

Canonical transferable receipt output groups proofs by the complete receiptor
establishment seal (`-F` in v1). Durable vrcs quadruples and legacy decoding remain.
Each receipt signature verifies independently of the receiptor controller threshold;
missing state escrows, invalid evidence stops that receipt pass, and following
KEL/reply frames still dispatch. Emitting removed v1 `-D` can truncate current
reference OOBI streams before endpoint replies.

Use CESR structing records for source/seal projections. DispatchOrdinal retains
Seqner or Number rather than rehydrating every value through qb64.

## Related owners

[Delegation/endpoints](../../docs/design-docs/kel/DELEGATION_AND_ENDPOINTS.md),
[counter genus](../../docs/design-docs/cesr/ATTACHMENT_COUNTER_GVRSN.md),
[thresholds](../../docs/design-docs/kel/WEIGHTED_THRESHOLDS.md).
[Storage](PROJECT_LEARNINGS_STORAGE.md), [runtime](PROJECT_LEARNINGS_RUNTIME.md)
and [exchange](PROJECT_LEARNINGS_EXCHANGE.md) own their separate rules. Dated
delegation debugging reports are historical evidence, not current blockers.
