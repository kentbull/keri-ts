---
"keri-ts": major
---

Separate send-only messenger construction from HTTP query response ownership. Bind transport endpoints explicitly and use sendSource for ordinary message iteration; no old constructor or query-method compatibility shims remain.

Construct ordinary or finite stream delivery explicitly with `messengerFrom` or
`streamMessengerFrom`. Stream HTTP sends one opaque PUT and returns owned response
bytes; stream TCP admits the full payload through the existing raw socket writer.
