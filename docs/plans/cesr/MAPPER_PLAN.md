# Standalone Mapper claimed-SAID repair

Owner: final focused PR in the [parity roadmap](../PARITY_ROADMAP.md), unless a
demonstrated dependency requires it earlier. This validation gap remains open.

Reproduce: makify `{d: "", role: "holder"}` as JSON, change `role`, then construct
`Mapper({saidive: true, verify: true})`. The stale claimed `d` is accepted because
round-trip validation does not recompute that commitment.

Repair claimed-SAID verification in every supported serialization format with
independent valid and tampered fixtures. Reuse proven Aggor verification only
where semantics match; preserve aggregate framing, partial disclosure and
compactification boundaries. Do not conflate Compactor's disclosure construction
with cryptographic proof verification. Document intentional reference differences.

Keep the PR narrow, release-noted and independently reviewed. Rerun affected
credential/disclosure/interoperability checks and update final qualification;
the previous full inventory cannot qualify subsequently changed behavior.

The current-main 71438328 schema profile adds a focused bundled-resource case.
Given this exact JSON resource:

```json
{
  "$id": "did:keri:EIVGZurJI7YwSxfzXgyrVPiqEmuZjKQcPy1AtLIhfvVQ",
  "version": "1.0.0",
  "type": "object",
  "properties": { "name": { "type": "string" } }
}
```

Place it at `$defs.attribute` in a version `1.0.0` Draft 2020-12 object schema
with `properties.a.$ref` equal to that URI. A shallow verified Schemer root has
SAID `EHGtNwaXjtaoEEg2HQghVed6XEtiV2Qrpxr9TaUzVO9q`. `acdcmap` and
`SerderACDC({makify:true})` rewrite the nested `$id` to
`EApqU8I2fCrPY7oQXyDccHNO4VYsGeFjDy9zJusLpFnL` and the root to
`EPHvklGgtA6R7laJHgxOJAqWzg1Cmt4rvqv_exLlVw9b`, leaving `$ref` unchanged.
Correct and qualify this under the existing Mapper work; do not freeze the
rewrite as expected behavior. S1 schema override/cached-root evidence validates
the original resource and does not establish embedded construction parity.

Qualify schema resource encoding separately from the credential body format.
For `acdcmap(israid="EJt3vzyzwZsSlL-LRyjG3lsJta_gxHjTmdbSYp6foOcx",
attribute={"d":"","name":"Ada"}, kind=kind)`, the actual 71438328 validator
accepts the generated JSON schema but rejects generated CBOR, MGPK and CESR
schemas because their format-derived IDs do not bind the JSON resource encoding.
The 71438328 builder and Mapper source match frozen 927c0cb8 (Git blobs
`b05426a60a937641a68e0ca64137dc183188a7b0` and
`110146ab46add05eea8b5e80403972ffb4db5c6d` respectively); this is a verified
builder/profile seam, not a change to the commitment oracle. Keep all frozen
format commitments. A qualified correction must choose resource encoding
explicitly and verify its ID rather than assuming every body format shares the
JSON schema ID. S1/S3 cached JSON resource tests do not qualify generated embedded
schemas in every format.
