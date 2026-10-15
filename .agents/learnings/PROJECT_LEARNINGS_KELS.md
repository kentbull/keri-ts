# KEL learnings

## Accepted state and decisions

`Kever` decides validity; `Kevery` routes, persists escrows, handles duplicates and
applies post-acceptance effects. Kever has no queue dependency: decision-carried
cue descriptions are data, and processing/publication stays with Kevery.
Baser prepares and writes accepted-event row/FEL metadata; Kevery turns clone
order anomalies into cues and owns admission/commit/publication sequencing.
Kever neither writes the event log nor prepares queue work. Delegation hint
repairs/removals are decision data; Kevery writes them after cue admission in the
same transaction as acceptance/escrow. Same-bucket retry keeps its existing row
while applying discovered repairs. Within one validation, later lookups see
pending repairs without durable publication.
Expected remote outcomes use typed decisions
under [ADR-0005](../../docs/adr/adr-0005-kel-decision-control-flow.md), not exceptions.
Attachment and KEL refusals carry their typed reason/code, message and actual
escrow instruction, not open diagnostic slots. Invalid-prefix messages retain the
caught parser detail; local habitat adapters forward the message alone.
Local inception/interaction uses the same acceptance path as remote events.
Kevery builds finalized first-seen/date, clone and acceptance cues before accepted
writes, and holds concrete CueDeck batches before duplicate/escrow effects too.
Baser logging checks the prospective FEL tail before writes. Kevery.processEvent
owns one native writer through decision, cue admission and durable effects, then
publishes live state/cues after commit. Plain EventMetadata carries log coordinates,
cues and accepted cache state; it has no executable decision lifecycle. The owner
explicitly sequences writes and publication and releases actual cue capacity.
processEvent refuses a caller-owned native writer before evaluation or admission;
its own successful commit is the publication boundary. The unused public
applyDecision is removed, so callers cannot apply stale decisions outside that
writer. Pure decideEvent remains an inspection seam. Group-prefix
publication follows admission. Default event escrow promotion uses the same
owning writer, including bucket movement/removal before post-commit publication;
same-bucket retries do not rewrite rows or emit additional cues.
Busy/limit refusal leaves that decision unapplied; an unexpected infrastructure
failure after writes is not a durable rollback or cue recovery guarantee.
Ordinary Runtime Deck keeps its conservative acceptance/duplicate count guard
until owned producers/consumers are fully ported; changing that boundary changes
ingress and escrow retry ownership even when the actual cue batch fits.
KEL and reply producers use CuePublisher for preflight and prepared publication;
queue consumption remains a separate responsibility during the composition migration.
Registry and credential TSN receivers share that producer seam without changing
their independent proof, trust, dependency, or Broker membership decisions.
KEL live/retried queries hold their concrete output batch before replay source-seal
repair. Capture construction remains separate admission work; refusal cannot repair `aess`.

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
Legacy TEL query replay captures management then credential extents, closes cursors
before yielding, and preserves frozen v2 proof counters with an explicit genus
selector. Requester material identifies the destination; upstream query signature
validation is TODO. Internal TSN production calls actual `vcState(vci)`, correcting
714's broken query keyword. Missing credentials retain the registry reply;
credential receiving and ordered TSN query replies are implemented. TEL/TSN
query boundaries narrow their actual ri/i/src fields from unknown input before
reading state; do not assert a metadata map. TSN preparation returns only the
reply records or refusal actually consumed; missing credentials retain the
registry reply without unused diagnostic result fields. Registry
receiving verifies BADA/trust/TEL correspondence.
State-record construction proves no acceptance. Complete-message caps do not prove native pre-read admission.
Revery BADA preserves microseconds. Its bounded proof plan discovers the complete
query batch before reply/proof/escrow writes. Same-call groups see virtual staged
pins in input order; externalEscrow leaves pending proofs with the semantic owner.
Reply outcomes distinguish notAccepted, caller-owned proofPending and semantic
dependencyPending. The last requires the receiver's closed escrow family; registry
and credential retry compare that semantic field, never diagnostic context keys.
Proof verification cannot choose a semantic family. The reflective Router validates
unknown handler results before returning the shared outcome contract. It transports
family names without importing receiver policy; each receiver closes its own set.
Escrow replay decisions carry kind/reason and optional diagnostic text only.
Keep useful failure/identity detail in messages; retry/purge policy uses typed
reasons, never diagnostic fields or parsed messages.
Resource refusals propagate through RPE replay without deleting its durable row.
Endpoint reply handlers derive their store from Revery. Each owns evaluation,
proof replacement and authorization/location pointer/projection writes in one
transaction, then publishes queries. Refuse caller-owned writers before effects;
a failed replacement preserves prior proof and releases unpublished cue credit.
KSN publication holds its concrete query batch while admitting the
actual keyStateSaved child on Kevery's deck, including distinct local decks.
Validate semantic correspondence before applying new proofs. Unverified replies
still apply their existing escrow/query effects. Revery.decideReply returns plain
ReplyPlan data with required accepted proof and complete signature alternatives.
Callers hold actual query batches, invoke Revery.writeReply explicitly and release
unpublished batches in finally. Keep evaluation and writes in one synchronous
owner turn; suspension permits stale BADA decisions. Broker has one typed finite
retry path used by both TSN receivers. Infrastructure and corruption failures
propagate unchanged and retain evidence; accept/drop remove only the family index.
There is no exception adapter or error-constructor hook for pending decisions.
Persist the outer reply SAID for BADA, not the contained TEL digest: actual 714's
registry handler confuses these domains and accepts older signed notices.
Registry TSN trust uses accepted configuration and issuer witnesses, never claimed
notice backers. Registry notice validation returns the existing record with all
validated fields required and fresh owned arrays. Both TSN receivers retain that
validated stored-registry type instead of discarding it and recovering fields with
assertions. Metadata correspondence compares typed fields, not erased dictionaries. The semantic receiver owns missing/partial proofs in Broker via
explicit external Revery escrow; preserve prior BADA evidence until publication.
Hold concrete query batches and the actual dependency/state child before
proof/Broker effects. Test exact family membership without bulk copies and check
the insertion invariant before publishing. Semantic rejected plans remain unapplied.
CredentialKelAnchor carries required integer `s` and digest `d` through the
credential-state builder, stored record and comparison. Registry/event seal `s`
is hex text; do not erase or conflate those two ordinal representations. Raw
registry seals reuse CESR's finite SAD fields with Partial: current KERIpy/TS TEL
lookup uses i/d and carries omitted s through raw state. projectRegistrySeal
projects only those known fields; it does not imply full TSN semantic acceptance.
The receiver still requires an empty or complete authenticated registry seal.
Credential notice decoding narrows unknown fields into an owned required record;
its seal type distinguishes empty from complete. Registry and credential builders
retain required outer fields through Tever and TSN cue production; serialized
maps are made only at the wire boundary. Keep registry-first/credential-second
tuple types and fresh owned state arrays. Do not run raw TEL state through the
stricter TSN validation merely to obtain a type. Compare
known fields and reuse the checked timestamp, without asserted hydration or
non-null recovery. Event kinds must be actual strings: String coercion can route
a signed array-valued kind into dependency escrow before correspondence checks.
TEL recovery must preserve credential `i` separately from the queried issuer.
TSN cue-to-wire routes require the signing attester suffix; actual 714 emits bare
routes. HTTP pair capture and success do not replace independent receiver proofs.
Credential TSN admission matches its own current TEL/registry/anchor record; accepted
revocation cannot be overwritten by a newly signed old issuance notice. Actual 714
accepts forged anchor metadata and old issuance state, intentional TS refusals.
Credential receiving holds query batches and admits actual dependency/state cues
before proof/Broker effects, using the same exact family membership invariant.
Busy refusal must preserve dependency indexes and prior accepted proof.

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
