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
