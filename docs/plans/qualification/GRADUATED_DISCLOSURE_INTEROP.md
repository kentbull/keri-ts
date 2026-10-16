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
The file now has its own `interop-ipex-disclosure` owner, selected independently
for focused PRs and included in full mode. The CLI helper and both manual platform/
extended workflows take their functional peer pin from
[`keripy-reference.json`](../../../scripts/ci/keripy-reference.json); the older
workflow overrides no longer select a different fork revision. Frozen CESR table
sources remain a separate reference.
This does not cover all malformed-edge/schema controls,
multiple/progressive attribute disclosures, multisig, witnesses/mailboxes, restart
or presentation-registry KRAM cutoffs.
The broader family gates below remain open until their real assertions pass.

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

For NOT, refactor authenticated node evidence, known validity/invalidity and
missing dependencies before changing behavior. The current grant pipeline
rejects every invalid node before edge evaluation; negating a relation boolean
would not implement NOT. [KERIpy #1554](https://github.com/WebOfTrust/keripy/issues/1554)
and [discussion #1571](https://github.com/WebOfTrust/keripy/discussions/1571) identify
revocation, freshness and reevaluation questions. Define the supported invalidity
evidence and time basis explicitly, then test known-valid and proved-invalid far
nodes, missing/stale evidence, operator composition and state changes. A missing
node or unauthenticated input must not become a successful negation. Report any
unresolved semantics precisely instead of treating blanket refusal as completion.

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
not claim witnessed restart coverage. Composed IPEX and presentation-registry
behavior remain required. No business-ack/outbox machinery.

`interop-ipex-presentation.test.ts`, also owned by `interop-kram`, composes TS
issuer, holder and receiver stores with three real KERIpy witnesses. Single and
independent two-of-two holders complete offer → agree → grant → admit through
HTTP. RegistryObserver is explicitly composed by the application; its parsed
intake is not an automatic Tufa route or a direct accepted-row write. The grant
waits for missing presentation TEL evidence across store reopen. A later accepted
binding cannot change its inclusive KRAM receipt cutoff. The group case separates
first-signature arrival from threshold completion; replay cannot refresh that
completed receipt. Stored partial credentials retain commitments and hidden data.
These are TS credential processors with Python witnesses, not pairwise Python
presentation-registry processing or mailbox-delivered IPEX. Those limits remain
distinct from the bidirectional mailbox authentication cases above.

Check accepted exchange lineage and both parties' state through admit, verified
credential/root/chain commitments, retained partial nests, absence of private
plaintext, and concrete refusal/escrow outcomes. State exactly which stage or
operator a negative case proves; include a valid counterpart so missing setup
cannot masquerade as a security refusal. Reopen/replay assertions must inspect the
actual stored representation, not a separately retained producer object.

## Reviewable implementation rounds

1. Qualify the maintained pairwise single-controller HTTP cases and refreshed
   consolidated mailbox reference pin in CI. Local real-peer coverage now includes
   offer/agree/admit and dedicated spurn cases in both directions.
2. Qualify the maintained two-node leaf/group and multi-hop/branching cases in
   both directions, then extend malformed-edge/schema controls. In separate
   keri-ts-only cases, refactor operator/node-validity
   decisions first, then implement DI2I and sufficiently defined NOT semantics in
   cohesive follow-ups. Keep both operators out of Python interop until supported.
3. Add multiple/nested blinding and progressive reveal cases, including leakage,
   commitment and stored-replay checks at multiple graph nodes.
4. Add multisig witness/mailbox conversations and KRAM restart/failure cases in
   cohesive cuts. Fix discovered production defects in dedicated targeted PRs.
5. Run all cases on the final source and required references with the full maintained
   battery and installed Node minimum/current packages before publication.

Share only necessary signing/transport/credential fixture setup. Do not build a
scenario framework or hide all assertions in one parameterized mega-test. Existing
suite ownership and CI scope controls remain authoritative; test inventory is not
execution evidence. Keep exact failures, skips and limitations in qualification
results. All release gates in QUALIFICATION_PLAN.md remain mandatory.
