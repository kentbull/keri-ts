# Mailbox read authorization

Private mailbox retrieval requires both authenticated recipient intent and an
accepted recipient-to-provider role. Query-SAID correlation alone proves neither.

Kevery.decideQuery requires requester identity to match the recipient and valid
signatures satisfying its **current accepted** threshold. Verify nontransferable
cigars too; duplicate indices do not add threshold weight. After rotation the
recipient must sign again with current keys. Public logs/ksn policy is separate.

Tufa authenticates the exact incoming envelope before consulting shared stream
cues. Attachments are outside the query SAID: a previously accepted body/cue cannot
authorize forged or old signatures. It then correlates the accepted stream cue and
checks the addressed mailbox's accepted recipient role before opening SSE.
Invalid/unverifiable HTTP reads return 403; callers can supply missing accepted
state and retry. Core query-not-found continuation remains available elsewhere.

There is no insecure host override or raw-query fallback. Signed queries are not
one-use tokens; this contract adds no nonce/replay window. This intentionally
tightens the permissive historical KERIpy 1.2.14 behavior.

Regression evidence covers foreign/forged requesters, insufficient and duplicate
indices, current threshold acceptance, rotation, cigars and missing-state
continuation. The real provider/recipient/sender fixture preserves all participants
and proves the recipient can retrieve the accepted message while a valid foreign
sender cannot. See the [mailbox design](MAILBOX.md) for storage and admin gates.
