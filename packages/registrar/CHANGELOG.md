# @keri-ts/registrar

## 2.0.0

First npm release, coordinated with cesr-ts and keri-ts 2.0.0.

### Minor Changes

- Run Registrar and Observer through normal TLS service commands with persistent private account enrollment. Keep configured Observer source access separate from revocable wallet publication/read permissions, and preserve both service state and permissions across restart.
- Add the public registrar application package for allow-listed signed publication and bulk registry queries, reusing native KEL/TEL acceptance and public HTTP hosting.

### Patch Changes

- Add scheduled HTTPS source observation and signed cache-only registry queries, with exact accepted heads and explicit freshness. Preserve CESR-v2 framing across full evidence replay and native query storage.
