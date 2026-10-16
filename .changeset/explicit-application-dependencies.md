---
"keri-ts": major
"@keri-ts/tufa": patch
---

Pass concrete registry, transport, signing and contact-store dependencies into
application operations. Remove the runtime registry lookup export and update
credential/DID workflows, Notifier and Organizer constructors without compatibility
shims. CLI and HTTP adapters validate required capabilities before protocol effects.
