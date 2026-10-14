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
