# Configured-source observer

The observer borrows its actual ProtocolProcessor, ACDC v2 RegistryStore and a
separately owned ObservationBaser. Supply fixed HTTPS sources, allowed reader
AIDs. Callers own store and host lifetime.

`pullOnce` makes signed bulk requests to those fixed sources. `run` repeats that
operation on a fixed cadence; incoming queries never initiate or accelerate it.
CA/URL-hostname verification and optional IP-to-DNS certificate mapping authenticate
the configured response source. Redirects cannot acquire observation credit.

Only complete, clean source responses renew URL-keyed accepted heads and local
completed time. Returned membership includes prior successful membership; unresolved
ordinals affect only their registry/scope. Old records/evidence survive failure or
restart, but an old prefix cannot renew a newer cached head. Cache-only signed
`tels`/`tels/head` responses serve accepted local evidence without custom freshness
headers or an observation-age gate. KRAM authenticates signed queries; serving
evidence makes no global-latest or absence-of-withheld-updates claim.

Selected Python service: kf-observer feec9004, declaring KERIpy 7ea525ba. Its dedicated
public TLS test fixtures are reused here; no sibling Python checkout is needed for
same-language unit tests. The independent npm package exposes the service and observation-store lifecycle; it adds no Tufa CLI.
