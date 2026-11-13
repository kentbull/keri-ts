---
"@keri-ts/registrar": minor
"@keri-ts/observer": minor
"@keri-ts/verifier": minor
"@keri-ts/hosting": patch
---

`@keri-ts/registrar`, `@keri-ts/observer` and `@keri-ts/verifier` were not republished with 2.2.0, and their 2.1.0 tarballs pin keri-ts 2.1.0 exactly, so a keri-ts 2.2 consumer could not use them. They are republished against keri-ts 2.2 with no API change of their own: their sources type-check and their package tests pass unchanged on the 2.2 sources. `@keri-ts/hosting` is republished as well, because its tarball pins keri-ts exactly and 2.2.0 would otherwise bring a second copy of keri-ts into a consumer's tree.
