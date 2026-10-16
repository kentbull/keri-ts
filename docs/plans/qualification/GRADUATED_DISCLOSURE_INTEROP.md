# Graduated disclosure and KRAM interop acceptance

This is the acceptance matrix for the cleanup/release goal, extended by Kent's
2026-10-15 request. The single-controller HTTP apply/grant probe passes at
`366808c8`; it is standalone evidence and does not satisfy this maintained matrix.
No row below is complete until its real peer assertions run successfully.

## Pairwise cases

Every family runs with a TypeScript discloser/Python disclosee and with those
implementations reversed. Both peers own independent stores, keys and protocol
processors. Every case must identify which implementation produced each message
and which implementation verified it. Keep cases named by direction and concern.

| Family                           | Positive path                                                                                                              | Refusal or independent control                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apply-first conversation         | apply → offer → agree → grant → admit, with authenticated nested credential evidence and accepted state at every recipient | Wrong prior, exchange ID or recipient cannot advance the conversation; matching valid traffic must still work                                        |
| Offer-first conversation         | offer → agree → grant → admit with no fabricated apply                                                                     | A later disclosure cannot exceed the offer's negotiated plan                                                                                         |
| I2I chain                        | A signed near/far credential chain whose near issuer equals the far issuee                                                 | Validly signed chain with a mismatched relationship is refused                                                                                       |
| NI2I chain                       | A signed chain with differing near issuer/far issuee is accepted under NI2I                                                | Missing far node or invalid far-node proof cannot become success                                                                                     |
| E1E chain                        | Near and far issuees match                                                                                                 | Different issuees fail the relation                                                                                                                  |
| Grouped edges                    | Nested AND/OR with differing child truth values; schema pins are checked                                                   | Unsatisfied AND, all-false OR, malformed/unknown operator and wrong schema are refused                                                               |
| Recognized unsupported operators | Record the current reference's explicit refusal of DI2I and NOT                                                            | Do not claim those relations are implemented or change KERIpy to manufacture support                                                                 |
| Multiple blinded attributes      | Multiple distinct and nested fields remain commitments while the negotiated subset is disclosed                            | Extra disclosed fields, missing requested fields and altered values are refused; hidden values do not leak in transmitted or stored partials         |
| Progressive disclosure           | Separate valid conversations reveal different or increasing subsets of the same credential and chain                       | Credential commitments remain unchanged; unrelated attributes stay blinded; prior stored partial evidence does not silently become a full credential |
| Chained disclosure               | At least a multi-hop chain and a branching origin graph, with partial disclosure at more than one node                     | Edge evaluation uses authenticated disclosed evidence; parent signatures cannot authenticate unsigned children                                       |
| Spurn                            | Dedicated legal spurn cases after apply and offer, in both implementation directions                                       | No admit/credential acceptance from the refused conversation; wrong-sender or wrong-prior spurn is refused                                           |
| Opening-grant refusal            | Spurn an unsolicited flow-starting grant where the reference permits it                                                    | A negotiated non-opening grant cannot be spurned through that special rule                                                                           |

`I2I`, `NI2I`, `E1E`, AND/OR and fail-closed DI2I/NOT expectations come from
KERIpy `71438328` `src/keri/acdc/ipexing.py`; audit the selected reference before
asserting a changed expectation. An operator/schema failure is distinct from a
missing dependency. Preserve actual escrow semantics and positive controls.

## Transport, KRAM and topology

Use actual HTTP/TCP/mailbox ingress and signed IPEX messages. Do not rewrite
headers in fetch hooks, seed the receiver's issuer state, bypass handlers or treat
HTTP 2xx as protocol acceptance. Select protocol/counter context through production
APIs. Record exact source and interpreter provenance using existing test helpers.
Current upstream and the consolidated mailbox fork are distinct reference labels.

Start with independent single-controller peers. Extend the complete conversations
to multisig with independently signing controllers and real witnesses/mailboxes.
Preserve the existing participant topology where fixtures already establish it.
KRAM gates include incomplete-proof escrow, completion by the remaining signatures,
replay refusal without duplicate dispatch, stale or invalid authentication refusal,
restart while pending and restart after acceptance. No business-ack/outbox machinery.

Check accepted exchange lineage and both parties' state through admit, verified
credential/root/chain commitments, retained partial nests, absence of private
plaintext, and concrete refusal/escrow outcomes. State exactly which stage or
operator a negative case proves; include a valid counterpart so missing setup
cannot masquerade as a security refusal. Reopen/replay assertions must inspect the
actual stored representation, not a separately retained producer object.

## Reviewable implementation rounds

1. Bring the proven pairwise single-controller HTTP path into maintained tests,
   extending it through offer/agree/admit and adding dedicated spurn cases. Refresh
   the consolidated mailbox reference pin and verify its actual imports.
2. Add focused chained-credential and leaf/group edge cases in both directions.
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
