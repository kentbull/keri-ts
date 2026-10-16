# CESR serialization

`framePayload()` and `attachmentPayload()` return derived reopenable byte views
of a complete frame. The frame contains ordinary bodies, attachments, child
records and optional ordered `Texter[]` ESSR evidence. Counters and output sizes
derive from that evidence; there is no parallel count/size manifest or parser
payload owner to dispose.

Each child is emitted as a BodyWithAttachmentGroup; non-native child bodies use
qualified Texters inside NonNativeBodyGroup. The wrapper uses its parent's genus
with any child selector scoped inside it. Default output preserves each node's
resolved genus; an explicit genus normalizes compatible descendants. Native
bodies reject genus changes that require rebuilding their Serder.

Serialization preserves child, leaf and ESSR item order and duplicates. It
normalizes categories to ordinary leaves, children, then ESSR; the parsed model
does not retain original cross-category interleaving. Repeated output reads
preserve the same evidence. Cancellation stops output; it does not invalidate
ordinary values. Finite annotation separately preserves original tree wire.

Each message's ordinary attachment leaves use one selected genus; enclosed
children may select their own genus inside their own boundary. The entire output
tree uses one attachment wire domain.
KERIpy `main` at `7143832813cac6a394ab1faf9be83bb3372be87c` permits a GVC only
at its beginning and rejects nested attachment enclosures or mixed domains.
Finite parsing can accept broader scoped input, but forwarding normalizes
known leaf tuples rather than reproducing interior selectors. Transferable
signature tuples retain their required small controller counter. A genus
conversion that would need a big inner counter, or would reinterpret opaque
content, fails explicitly; same-genus opaque wire remains byte-preserving.

KERI `requestFrame` owns request, upload and response resources in its Effection
scope. Header mode text-qualifies attachments, using the body's inferred outer
genus and one initial selector when needed. Body mode sends the complete frame.
`postCesr` awaits each delivery before requesting the next result. Real network
cleanup remains required. Remaining transport policy/bridge removal belongs to
the [parser plan](../../plans/cesr/CESR_PROGRESSIVE_PARSER_PLAN.md).
