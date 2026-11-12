---
"@keri-ts/hosting": patch
---

The CORS preflight now allows the `CESR-Genus` and `Authorization` request headers. A browser page could not send a v2 detached CESR POST (which carries `CESR-Genus`) or a witness TOTP code (`Authorization`) to a Tufa-hosted witness or mailbox: the preflight refused them.
