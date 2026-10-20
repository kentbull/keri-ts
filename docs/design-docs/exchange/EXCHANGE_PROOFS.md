# Exchange proof ownership

Sender source seals authenticate the EXN only when an accepted key event at the
claimed historical coordinates contains its SAID. The anchor may be an
interaction event; transferable signature groups instead require establishment
keys. Supplemental route evidence authenticates this same body independently;
it cannot authenticate a nested child. Routes explicitly select verified
supplemental factors and may return an escrow decision for unavailable
credential/KEL/TEL dependencies. Invalidity and missing evidence stay distinct.

Exchanger serializes resident nested evidence before its synchronous admission
turn. Authenticate current accepted state, verify the ESSR commitment and route
policy, and commit ordinary LMDB evidence in that writer. `verifyEvidence` and `verify`
cannot suspend. Handlers run after durable commit in the caller's operation.
First acceptance replaces provisional proof rows; verified accepted duplicates
accumulate proofs without borrowing old proofs to authenticate the current input.

`verifyEvidence` selects valid supplemental factors. `acceptsEvidence` independently
permits delivery of that selection to route verification, including an empty
selection when no hook exists. `acceptsSscs` permits nonempty validated sender
couples in verification and handling. `acceptsMissingEvidence` permits unresolved
supplemental factors to be queried and omitted and exposes missing coordinates to
the selection hook. No capability implies another.

Missing sender source state creates escrow only for `acceptsSscs` routes. Strict
supplemental or unresolved last-reference failures query and reject the attempt
without creating escrow. A rejection corresponding to KERIpy's
`MissingSignatureError` preserves an already existing escrow for retry; it does
not authorize a new one. Missing sender signatures and route dependency outcomes
can create escrow. Sender-signature query cues and route dependency proof cues
follow insertion of a new escrow row; missing-state query lists deduplicate their
coordinates within each reference-equivalent invocation.

After sender authentication, routes may name a complete missing schema SAID.
`emse.` stores the EXN at `(EXN SAID, schema SAID)` and `emsd.` its shared absolute
deadline. Each new pair emits `{kin: "query", q: {r: "schema", said: schemaSAID}}`;
the host schema fetcher is unimplemented. Retry rechecks proofs and preserves
signatures, source seals, nested/ESSR wire and mailbox/receiver provenance across
reopen. The deadline is first admission plus 20 seconds, or existing TMSC `xdt + pxl`; receiver receipt time is not the transaction opener. Sequential schema
dependencies keep that deadline. Equality remains eligible; strict expiry or
terminal rejection releases pending evidence, acceptance retains its wire.
Retries re-read stored proofs and deadlines in the final writer. Terminal removal clears pending evidence in the same transaction;
completion joins the ordinary LMDB flush. Overlapping scans skip accepted/obsolete candidates, preserving
each scan's captured horizon without an asynchronous Exchanger admission lock.
TS retains and enforces this deadline through partial-proof migrations; inspected
714 removes it after moving the final missing-schema branch to partial escrow.
ESSR commitment and qualified-payload syntax failures reject. Unexpected evidence
read or hashing failures propagate and roll back the retry transaction.
Storage/corruption failures propagate and retain pending ownership. Readonly
legacy opens leave absent schema-escrow tables absent. S3 owns IPEX schema gates.

An incomplete duplicate reports its pending attempt even when the exchange was
previously accepted. It cannot replace accepted evidence, create escrow, emit a
new-escrow cue, or invoke handling. `complete(said)` reports durable acceptance
separately from the current attempt's decision.

Resolve known last-establishment references before sender escrow so later key
rotation cannot reinterpret saved signatures. Store signature ordinals as 32-digit
hexadecimal keys for both Number and Seqner inputs, matching KERIpy and avoiding
duplicate rows after retry. Retain source triples in `ests.`
and approved foreign endorsers in `eidx.`; restore stored cigar verifier context
for retry and recheck all stored proof factors before replay. `ExchangeFactors`
is the attachment shape; `ExchangeProofVerification` returns its valid subset
plus invalid/missing observations. Resolved and authenticated records mark the
historical-resolution and route-selection boundaries. The latter names all
retained factors separately from selected supplemental factors.

Group leader selection considers the group's own signatures only, a deliberate
correction relative to the frozen reference's first stored signature group.
Safe-integer ordinal bounds are JavaScript/database limits, not protocol limits.
Legacy v1 parser intake still requires signatures; source-only intake is a v2
behavior. Unresolved sender state retains its dependency/refusal semantics. IPEX route
verification consumes these factors separately from child issuer proofs;
[message admission](MESSAGE_ADMISSION.md) owns implemented sender filtering and optional KRAM.

See the [exchange plan](../../plans/exchange/EXCHANGE_ADMISSION_PLAN.md) for its regression obligations and reference limits.
