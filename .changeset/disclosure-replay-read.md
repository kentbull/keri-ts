---
"keri-ts": patch
---

Read a group's completed credential disclosures back out of the runtime's stores. `listGroupDisclosures` lists the accepted Grants a group issued or holds that an accepted Admit answered, and `exportDisclosureStream` replays one of them as a single dependency-ordered CESR stream (KELs, registry TEL, the Grant, then its Admit) without signing, so a weight-0 member can serve it. `RegistryStore.registries` lists the registries a store has accepted, optionally by issuer.
