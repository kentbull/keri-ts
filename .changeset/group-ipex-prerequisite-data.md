---
"keri-ts": patch
---

A group presentation Grant that waits for its presentation registry update is now held as plain data, and the group
IPEX owner signs the member's contribution itself once it reads the update accepted. The exported
`GroupIpexPrerequisite` changed shape: `proceed` is gone and the prerequisite carries `anchor`, `grant` (the frozen
`PreparedGrantBody`) and `opening` (the presented-state `RegistryDisclosure`). A superseded registry update (another
accepted KEL event at the anchor's sequence number, or another accepted TEL event at the update's) now ends the
operation `failed`, naming the superseding event, instead of waiting forever; an update the members never approve
still waits until `abandonGroupIpex`. `IpexDiscloser.attachPresentationProof` is now the exported function
`attachPresentationProof(prepared, opening, source)`.
