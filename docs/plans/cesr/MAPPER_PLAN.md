# Mapper commitment and schema qualification

Owner: focused units in the [parity roadmap](../PARITY_ROADMAP.md).
Standalone saidive Mapper now verifies configured top-level claims through the
same semantic/raw/native binary constructor hook, with independent frozen Aggor
maps and tampered variants across JSON, CBOR, MGPK and CESR. Wire round-trip
checks remain. `makify` replaces claims and `verify:false` is an explicit opt-out.
Compactor overrides only claim verification to preserve expanded disclosure
construction; its group/wire checks remain. Aggor keeps independent verification.

Supplied shallow JSON schema resources preserve verified bare-root/bundle identities
across credential body formats. Schema-field construction uses that root ID as
its compact commitment; Serder verification rejects stale claims rather than
rederiving them. S1 independently checks bundle IDs, references and profile.
Frozen default/unbound schema construction remains format-specific. Final
qualification must distinguish these resource and default-builder paths.

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
SAID `EHGtNwaXjtaoEEg2HQghVed6XEtiV2Qrpxr9TaUzVO9q`. Recursive TypeScript
schema construction rewrote the nested `$id` to
`EApqU8I2fCrPY7oQXyDccHNO4VYsGeFjDy9zJusLpFnL` and the root to
`EPHvklGgtA6R7laJHgxOJAqWzg1Cmt4rvqv_exLlVw9b`, leaving `$ref` unchanged.
TypeScript preserves the original resource in expanded and section messages,
with compact s equal to the verified root ID. The actual frozen927 builder with
the 71438328 helper also preserves and validates this embedded JSON resource;
Serdering source matches both pins (blob `d71412759c8a87055f5e04a66319ed2ea098c9cb`)
and explicitly treats schema IDs as top-level. Existing tests qualify all four
body formats, raw reopen and S1 validation. Retaining supplied JSON resource IDs
across nonJSON body formats extends the reference's format-dependent builder
while preserving frozen defaults; it does not change the commitment oracle.

Qualify schema resource encoding separately from the credential body format.
For `acdcmap(israid="EJt3vzyzwZsSlL-LRyjG3lsJta_gxHjTmdbSYp6foOcx", attribute={"d":"","name":"Ada"}, kind=kind)`, the actual 71438328 validator
accepts the generated JSON schema but rejects generated CBOR, MGPK and CESR
schemas because their format-derived IDs do not bind the JSON resource encoding.
The 71438328 builder and Mapper source match frozen 927c0cb8 (Git blobs
`b05426a60a937641a68e0ca64137dc183188a7b0` and
`110146ab46add05eea8b5e80403972ffb4db5c6d` respectively); this is a verified
builder/profile seam, not a change to the commitment oracle. Keep all frozen
format commitments. A qualified correction must choose resource encoding
explicitly and verify its ID rather than assuming every body format shares the
JSON schema ID. Supplied bound JSON resources are qualified in every body format;
generated nonJSON defaults remain outside the mandatory JSON-resource profile.
