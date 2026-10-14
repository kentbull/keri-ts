# CESR serialization and output ownership

`framePayload()` and `attachmentPayload()` return non-owning reopenable views of
one admitted frame. Ordinary metadata stays within the parser's frame budget;
ESSR wire is consumed incrementally through `essrChunks()`. The caller retains
every descendant `EssrPayload` owner until all output readers finish. Each child
is emitted as a `BodyWithAttachmentGroup`; non-native child bodies are qualified
Texters inside `NonNativeBodyGroup`. The child wrapper uses its parent's genus,
with any child genus selector scoped inside it. The body enclosure already
supplies the child boundary; another attachment wrapper would double its depth. Default output preserves each
node's resolved genus; an explicit `gvrsn` overrides every compatible node.
Native bodies still reject genus changes that require rebuilding their Serder.
The serializer preserves parent/child ownership, group order, child order, and
ESSR item order. It normalizes the attachment categories to ordinary leaves,
children, then ESSR; the parsed model does not retain original cross-category
interleaving. One payload view per admitted node and finite body/group metadata
remain under existing tree admission limits. No descendant ESSR is collected.
Cancellation closes active readers without disposing the caller's tree owners.
Finite annotation preserves the original tree wire. KERI consumer admission is route-specific; see the [exchange design](../exchange/MULTISIG.md)
and [IPEX design](../exchange/IPEX.md). HTTP inspection retains its separate guard. Output chunks are owned
copies of at most 64 KiB; custom ESSR wire readers retain the existing 1 MiB
maximum backing-allocation contract.

Each message's ordinary attachment leaves use one selected genus; enclosed
children may select their own genus inside their own boundary. The entire output
tree uses one attachment wire domain.
KERIpy `main` at `7143832813cac6a394ab1faf9be83bb3372be87c` permits a GVC only
at its beginning and rejects nested attachment enclosures or mixed domains.
Progressive parsing can accept broader scoped input, but forwarding normalizes
known leaf tuples rather than reproducing interior selectors. Transferable
signature tuples retain their required small controller counter. A genus
conversion that would need a big inner counter, or would reinterpret opaque
content, fails explicitly; same-genus opaque wire remains byte-preserving.

KERI's `requestFrame()` is an Effection resource. Header mode admits at most
64 KiB of text-qualified attachments by default; it uses the body's inferred
genus for the outer header and one initial selector when needed. Body mode
streams the complete admitted frame. A response remains readable inside its
resource scope; exit aborts and joins request preparation, fetch, upload, and
response cleanup. Failed-response diagnostics retain at most 16 KiB by default.
`postCesr()` awaits one frame's delivery and disposal before asking the parser
for its next output. Replay and mailbox output have their own [runtime ownership contract](../runtime/INGRESS_AND_EGRESS.md).
Shared runtime reservations remain incomplete.
