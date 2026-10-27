# Public registry registrar

`Registrar(processor, store, {publishers, observers, fullEvidence})` borrows the
actual `ProtocolProcessor` and its native `RegistryStore`. The caller owns stores,
KRAM configuration and HTTP host lifetime. The actual KRAM owner must be enabled,
non-exempt for these queries and have configured cache windows; the test uses the
selected Python catchall tuple `[1000,5000,60000,300000,5000,60000,300000]`. Pass `registrar.handle` to the public
hosting package's `createTufaApp({protocolHandler})` or ordinary server composition.

POST `/ingest` accepts one allow-listed, KRAM-authenticated KERI v2 `tels/publish`
query with public CESR text in `q.stream`. The common native processor alone owns
KEL/TEL acceptance, public openings and persistent pending evidence. Responses
report 200 accepted, 202 pending or 422 rejected outcomes; publication creates no
issuer alias, keys, custody or private application records.

POST `/` accepts observer-only `tels/bulk` or `regs` queries. `q.i` selects one
registry, a registry list, or all accepted registries; `q.sn` selects the first TEL
ordinal. Full evidence includes supporting controller/delegation KEL and framed
accepted TEL/public openings; the default preserves bare TEL responses. Unknown
explicit registries and wallet-shaped queries fail closed. Queries never fetch
upstream evidence. These responses make no freshness or global-latest claim.

The selected source is Python kf-registrar `7e934668`, declaring KERIpy `7ea525ba`.
Local admin authoring, witness administration and deployment/CLI policy are outside
this cut.
