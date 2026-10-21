---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Validate group IPEX conversation parties and predecessors before a fresh approval. Grant authoring/approval requires the local verified credential and checks supplied source proofs against its accepted issuance and issuer KEL. A presenting group need not be the issuer. Valid minimal legacy grants remain supported when their authority is already local; missing member evidence stays pending without signing or fanout.

Preserve a stored grant's actual pathed proofs during delivery instead of replacing them with newly assembled artifacts. Join results and JSON now separate local `approved` state from child acceptance; `approval-pending` reports an unmet local preflight gate. Breaking-change guidance records the additional public approval result fact.
