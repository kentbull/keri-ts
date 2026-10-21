---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Remove autonomous legacy TEL signing, collection/hosting and backed-registry application authoring, including the private endorsement-choice table, runtime request flow/worker, hosting options, agent --backer-alias, registry --backers and Registry.rotate. Registry application options now express only NoBackers authoring and ordinary establishment policy.

Retain external legacy backed evidence decoding, exact historical quorum verification, observer escrows/retries, replay and credential presentation. Issuer multisig and KEL witnessing remain separate supported responsibilities. ADR-0014 rejects reintroduction without a newly justified requirement; the reference report preserves the retired design, and the 2.0.0 breaking guide lists removed APIs. No compatibility wrappers or migration machinery are retained.
