---
"@keri-ts/tufa": patch
---

`tufa infra kf onboard` introduces the account to its watcher with `PUT /`, the route Python watcher-hk uses for raw CESR streams, so onboarding against a Python watcher no longer fails with HTTP 400.
