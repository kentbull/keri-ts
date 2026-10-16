# Graduated disclosure and KRAM interop acceptance

This is the acceptance matrix for the cleanup/release goal, extended by Kent's
2026-10-15 request. The single-controller HTTP apply/grant probe passes at
`366808c8`; it is standalone evidence and does not satisfy this maintained matrix.
The maintained `interop-ipex-disclosure.test.ts` covers both single-controller
HTTP directions for apply-first and offer-first conversations through admit, plus
spurn after apply and offer. Its ten additional edge cases exercise two-node
chains with I2I, NI2I, E1E and nested AND/OR. Each sends a failing grant followed by
a valid grant in the same conversation. I2I/E1E reject identity mismatches; NI2I
relaxes identity without allowing an unsigned far node; groups distinguish mixed
true/false reductions. Two independent issuer keys authenticate the chain nodes.
Both peers' stores assert accepted lineage, refused-grant absence and retained
partial nodes. Both nodes reveal status while retaining a private commitment.
Four larger-graph cases add a three-node I2I chain and a branching four-node
graph with a shared ancestor, in both directions. A missing descendant and an
unsigned shared ancestor are refused before complete controls succeed through
admit. Every node retains a partial disclosure. These are flat sibling artifacts
representing graph edges, not unsupported child-owned nested streams.
The selected reference is consolidated mailbox fork `331f32e4`; #485's initial
eight cases passed all twelve selected CI owners; #486's eighteen cases passed
the selected ACDC deep owner before the larger-graph extension.
These cases share the `interop-ipex-disclosure` owner, selected independently
for focused PRs and included in full mode. The CLI helper and both manual platform/
extended workflows take their functional peer pin from
[`keripy-reference.json`](../../../scripts/ci/keripy-reference.json); the older
workflow overrides no longer select a different fork revision. Frozen CESR table
sources remain a separate reference.
Eight additional cases in `interop-ipex-progressive.test.ts` exercise both
independent implementations with two signed I2I nodes. Four separate apply-through-
admit conversations reveal status, then a nested city, then email/role, then a
smaller status/role subset. All commitments stay identical; each grant retains its
own partials and unrelated postcode/private values stay hidden. Actual stored
replay preserves those partials without adding conversation rows. Dedicated
extra-field, missing-field and altered-plaintext/wrong-commitment-proof grants
are refused before a matching valid control in each direction.
Twelve cases in `interop-ipex-edge-refusals.test.ts` cover both directions for
unknown leaf/group operators, unexpected leaf fields, direct/inherited far-node
schema mismatches and a self-addressed schema with an invalid profile version.
Both issuers authenticate the bad graph: refusal is the named edge/schema gate.
A valid signed two-node counterpart then completes through admit; refused rows
and child evidence remain absent on both stores before and after that control.
Twenty cases in `interop-ipex-conversation-refusals.test.ts` cover grant/spurn
prior, exchange-id, recipient and sender mismatches in both directions. Foreign
senders use real independent keys with public KEL intake. Unknown exchange IDs
are stopped by KRAM as `unknownThread` before IPEX; other cases assert route
refusal. Legal opening-grant spurn retains conversation evidence without wallet
acceptance, a later admit cannot continue it, and negotiated-grant spurn refuses
before a valid admit. All cases deliver the actual signed wire before inspecting
refusal and complete matching valid controls. Separate topology and presentation cases below retain their own
limits; passing these cases alone does not close every family gate.

## Pairwise cases

Every family runs with a TypeScript discloser/Python disclosee and with those
implementations reversed. Both peers own independent stores, keys and protocol
processors. Every case must identify which implementation produced each message
and which implementation verified it. Keep cases named by direction and concern.

| Family                      | Positive path                                                                                                              | Refusal or independent control                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apply-first conversation    | apply → offer → agree → grant → admit, with authenticated nested credential evidence and accepted state at every recipient | Wrong prior, exchange ID or recipient cannot advance the conversation; matching valid traffic must still work                                        |
| Offer-first conversation    | offer → agree → grant → admit with no fabricated apply                                                                     | A later disclosure cannot exceed the offer's negotiated plan                                                                                         |
| I2I chain                   | A signed near/far credential chain whose near issuer equals the far issuee                                                 | Validly signed chain with a mismatched relationship is refused                                                                                       |
| NI2I chain                  | A signed chain with differing near issuer/far issuee is accepted under NI2I                                                | Missing far node or invalid far-node proof cannot become success                                                                                     |
| E1E chain                   | Near and far issuees match                                                                                                 | Different issuees fail the relation                                                                                                                  |
| Grouped edges               | Nested AND/OR with differing child truth values; schema pins are checked                                                   | Unsatisfied AND, all-false OR, malformed/unknown operator and wrong schema are refused                                                               |
| Multiple blinded attributes | Multiple distinct and nested fields remain commitments while the negotiated subset is disclosed                            | Extra disclosed fields, missing requested fields and altered values are refused; hidden values do not leak in transmitted or stored partials         |
| Progressive disclosure      | Separate valid conversations reveal different or increasing subsets of the same credential and chain                       | Credential commitments remain unchanged; unrelated attributes stay blinded; prior stored partial evidence does not silently become a full credential |
| Chained disclosure          | At least a multi-hop chain and a branching origin graph, with partial disclosure at more than one node                     | Edge evaluation uses authenticated disclosed evidence; parent signatures cannot authenticate unsigned children                                       |
| Spurn                       | Dedicated legal spurn cases after apply and offer, in both implementation directions                                       | No admit/credential acceptance from the refused conversation; wrong-sender or wrong-prior spurn is refused                                           |
| Opening-grant refusal       | Spurn an unsolicited flow-starting grant where the reference permits it                                                    | A negotiated non-opening grant cannot be spurned through that special rule                                                                           |

`I2I`, `NI2I`, `E1E` and AND/OR expectations come from KERIpy `71438328`
`src/keri/acdc/ipexing.py`; audit the selected reference before asserting a changed
expectation. An operator/schema failure is distinct from a missing dependency.
Preserve actual escrow semantics and positive controls.

## TypeScript operator support, separate from interop

DI2I and NOT belong in dedicated keri-ts tests, not KERIpy interop tests, until
the selected Python reference supports them. This exclusion applies to refusal
cases too: do not add an interop scenario asserting the current Python stub.
KERIpy `71438328` and inspected main `c102367e` leave both operators unsatisfied
in `src/keri/acdc/ipexing.py`. That is a reference limitation, not a requirement
to preserve refusal in TypeScript. Implement support when KERIpy supports it or
the semantics are sufficiently established; an upstream merge is not required
for TypeScript-only support. Do not modify KERIpy outside the authorized minimal
mailbox fixes. Claim pairwise operator coverage only after actual Python support
and successful independent peer tests.

The [ACDC operator specification](https://trustoverip.github.io/kswg-acdc-specification/)
defines delegation and negation. [KERIpy #1559](https://github.com/WebOfTrust/keripy/issues/1559)
and [open #1564](https://github.com/WebOfTrust/keripy/pull/1564) clarify DI2I at any
delegation depth. Test identity, multiple approved hops, unrelated issuers, absent
approvals and DND-forbidden hops with a disinterested verifier. Each hop needs the
delegator's anchored approval, not just the delegate's delpre assertion. Include
a witness-held KEL whose delegated inception precedes delegator approval. Avoid
an arbitrary depth cap or requiring approval of a later rotation to prove the
inception relationship.

The TS v2 graph now implements this DI2I profile. Seventeen dedicated cases cover
identity, approved depths one through three, an ordinary disinterested validator,
each missing approval in a witness-held chain, DND at root/intermediate hops,
missing KELs, unrelated/untargeted cases, aggregate issuees, an unapproved later
delegate rotation, the delegator's later witness change and a signed wrong-ordinal
approval followed by the valid counterpart. A signed grant stays
in proof escrow until its actual approval arrives. Read-only accepted-history
lookup neither repairs hints nor imposes a depth cap. Identity operator precedence
and targeted/untargeted defaults are also covered; the reference E1E entity-only
extension remains explicit. These are TS tests, not Python DI2I interop.

Node issuer authentication returns concrete authenticated evidence, a missing
dependency or refusal independently of conversation policy. TS NOT uses a
separate far-before-parent node-validity pass after every issuer and own schema
passes. Its accepted issuance vocabulary is `issued`/`revoked`, using receiver-
accepted observer evidence at each fresh validation. Known false relationships
and revoked far nodes may satisfy NOT; missing/stale/forged evidence, malformed
operators/schema resources and custom states cannot. Identity and additional
schema constraints remain independent. Dedicated TS tests cover both truth
values, nested AND/OR and NOT, actual observer state changes, missing KEL/schema/
TEL retry across reopen, stale disclosure refusal and retained historical grants.
This does not add Python NOT parity or imply global registry freshness. See the
[IPEX contract](../../design-docs/exchange/IPEX.md) for the precise boundaries.

Kent's execution priority is complete disclosure/operator acceptance first, then
KRAM/composed mailbox acceptance, then residual architecture cleanup, before
final qualification and publications. Multiple/nested blinding and progressive
reveal and pairwise malformed-edge/schema controls have dedicated maintained
cases. Conversation-link/spurn controls complete the supported pairwise family
matrix; final-source full qualification remains mandatory. Keep single-controller
HTTP evidence distinct from witnessed/multisig mailbox and registry-cutoff evidence.

## Transport, KRAM and topology

Use actual HTTP/TCP/mailbox ingress and signed IPEX messages. Do not rewrite
headers in fetch hooks, seed the receiver's issuer state, bypass handlers or treat
HTTP 2xx as protocol acceptance. Select protocol/counter context through production
APIs. Record exact source and interpreter provenance using existing test helpers.
Current upstream and the consolidated mailbox fork are distinct reference labels.

Start with independent single-controller peers. Extend the complete conversations
to multisig with independently signing controllers and real witnesses/mailboxes.
Preserve the existing participant topology where fixtures already establish it.
The maintained mailbox matrix in `interop-kram` has twelve cases through actual fork/Tufa
mailbox hosts: both directions with single controllers and independent two-of-two
member stores, four process-crash/reopen cases, and four witnessed-controller cases.
Controller KELs arrive through HTTP, never receiver seeding. A first group signature
remains pending without an SSE stream; the second opens the mailbox. Replay, stale
and foreign-key proofs produce no extra stream/cache state, and fresh barriers plus
a correctly signed counterpart prove the refusals were processed. TypeScript uses
production detached-header egress and Python uses its real HTTP client. Provider
payloads are fixture data: these cases qualify authenticated mailbox query admission.
The witnessed cases resolve real OOBIs, collect receipts from three KERIpy witnesses
with threshold two, and send stored controller/witness evidence through HTTP.
Both providers must accept that event with the correct witness list, threshold
and all three receipt indices. Each independent witness store must also contain
the accepted event and verified receipts. They do not qualify full witnessed IPEX
delivery, presentation-registry cutoffs or the final installed package set.

Restart cases SIGKILL the provider after observing committed partial or accepted
state, then reopen the same current-version stores in a different OS process.
They require the same provider identity and sender KEL, cached message identity/
timestamp and saved proof indices, threshold completion with only the remaining member proof,
and retired partial evidence. After another crash, replay cannot redispatch and
a fresh query retrieves the previously stored payload without republishing it.
No receiver KEL/proof seeding, migration or previous-version TS compatibility is
involved. Crash/reopen and witnessed cases are separate scenarios; the latter do
not claim witnessed restart coverage. Composed IPEX and presentation evidence
below remain distinct from provider authentication. No business-ack/outbox machinery.

`interop-ipex-presentation.test.ts`, also owned by `interop-kram`, composes TS
issuer, holder and receiver stores with three real KERIpy witnesses. Single and
independent two-of-two holders complete offer → agree → grant → admit through
HTTP. RegistryObserver is explicitly composed by the application; its parsed
intake is not an automatic Tufa route or a direct accepted-row write. The grant
waits for missing presentation TEL evidence across store reopen. A later accepted
binding cannot change its inclusive KRAM receipt cutoff. The group case separates
first-signature arrival from threshold completion; replay cannot refresh that
completed receipt. Stored partial credentials retain commitments and hidden data.
Two additional cases preserve these HTTP controls and deliver the grant, each
independent group contribution and its replay through the actual Python mailbox.
Production Poster forwarding follows signed mailbox endpoint authorization;
authenticated KRAM queries retrieve stored payloads over SSE before ordinary
receiver HTTP verification. Both grant/child bodies and parent signatures remain
exact; the ordered blind-state proofs and source seal survive Python's group
coalescing. Missing TEL escrow, reopen, immutable inclusive threshold-completion
receipt and later binding controls remain unchanged. The added receiver also has
three witnesses with threshold two; provider and independent witness stores prove
its accepted KEL and receipts. Offer/agree/admit remain direct HTTP in these cutoff
cases; the separate full mailbox conversations below cover their delivery.
These are TS credential processors with Python witnesses/provider, not pairwise
Python presentation-registry processing or process-crash recovery.

`interop-ipex-mailbox.test.ts` separately completes apply → offer → agree → grant
→ admit between independent TS issuer/holder/recipient stores through the actual
consolidated KERIpy mailbox. Single and two-of-two holders use three real Python
witnesses; issuer, holder and recipient KELs/receipts are independently accepted by
the provider and witness stores. Signed endpoint authorization precedes real
Poster forwarding. Each recipient queries the provider under its own KRAM identity,
then its own HTTP intake verifies the retrieved IPEX evidence. The group grant's
first contribution remains pending; the second completes it. Actual issuance
registry proofs authenticate the credential, retained partials hide plaintext and
nested children never become independently dispatched credentials. This qualifies
mailbox-carried TS IPEX with a Python provider, not Python credential processors,
presentation cutoffs over mailbox delivery or a witnessed process crash.

`interop-ipex-mailbox-pairwise.test.ts` adds independent Python and TypeScript
credential processors in both disclosure directions through the real Python
mailbox. The TS controller is single-signer or two-of-two with separate member
stores; both controllers have three Python witnesses with threshold two. Python
adds its witnesses by a receipted rotation. Actual Python StreamPoster/Poller and
TS Poster/signed KRAM queries carry the complete apply-through-admit lineage.
Three-node I2I chains and four-node I2I/NI2I branching graphs reject a delivered
missing/unsigned ancestor before the valid grant. Both processors retain the
same partial nodes and commitments without hidden plaintext or independent child
dispatch. Provider KEL/receipt/cache observations and each witness store establish
actual authentication and witnessing, separately from HTTP status.

These cases use signed unregistered credentials. They do not qualify Python
presentation-registry intake or witnessed crash recovery. The TS mailbox grant
cutoff cases above retain their separate registry evidence. The v1 witness KEL/OOBI context is explicit and independent of v2 IPEX
and mailbox framing. No reference source or accepted protocol rows are patched.

Check accepted exchange lineage and both parties' state through admit, verified
credential/root/chain commitments, retained partial nests, absence of private
plaintext, and concrete refusal/escrow outcomes. State exactly which stage or
operator a negative case proves; include a valid counterpart so missing setup
cannot masquerade as a security refusal. Reopen/replay assertions must inspect the
actual stored representation, not a separately retained producer object.

## Qualified baseline and regression floor

The maintained pairwise owner covers the requested conversation, graph/operator,
multiple/nested attribute, progressive, failure and spurn families. TS DI2I and
NOT remain separately qualified profiles, excluded from Python interop until
supported there. Preserve these cases rather than rebuilding the matrix.

The composed KRAM/mailbox, residual architecture, complete maintained/manual and
clean installed Node minimum/current gates pass for the published 1.0.0 baseline.
The [release report](../../reports/parity/CLEANUP_RELEASE_2026-10-16.md) records
exact heads, packages and limits. Future changes must preserve this matrix and
receive relevant qualification; an old scoped result does not certify a new set.

Share only necessary signing/transport/credential fixture setup. Do not build a
scenario framework or hide all assertions in one parameterized mega-test. Existing
suite ownership and CI scope controls remain authoritative; test inventory is not
execution evidence. Keep exact failures, skips and limitations in qualification
results. All release gates in QUALIFICATION_PLAN.md remain mandatory.
