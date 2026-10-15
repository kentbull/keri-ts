---
"keri-ts": minor
---

Use signer AID identifiers in query requests and continuations instead of retained Hab references. Resolve explicitly selected local signers through Habery before signing, preserve selections through routed cues, and defer unavailable identities without substituting the ambient signer.

Use the selected query signer for transport introductions. Poll every eligible witness mailbox when no explicit mailbox route exists, so an unresponsive or retired first witness cannot hide replies stored at other witnesses.
