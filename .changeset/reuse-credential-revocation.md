---
"keri-ts": patch
---

Validate revocation authority before signing an issuer anchor. Repeated revocation reuses the original TEL event and anchor across reopen, including locally tracked pending publication, instead of constructing another event.
