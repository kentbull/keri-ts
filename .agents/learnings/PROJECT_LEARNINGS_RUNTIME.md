# Runtime and mailbox learnings

## Scopes and state

One host/runtime serves a Habery or command invocation; hosted-AID selection is
separate from listeners. Do not auto-host every Hab or expose signatory/AEID as a
normal identity. Endpoint-role support does not imply startup should seed that role.
Use signed loc/scheme replies through Revery, never direct locs/lans writes.
Alias config dt/curls is the bootstrap source; synthesize localhost only when both
config and accepted endpoints are absent.

Kever decides, Kevery routes KEL/KEL-derived replies, Revery owns BADA/reply
escrows, Oobiery owns introductions. Runtime and local Habery.kevery have distinct
cue decks. Incomplete query cues require QueryCoordinator to resolve a local
habitat and honest remote attester before producing wire. Hab.processCuesIter
remains the cue-semantics seam.

KERI/Tufa operations own lifecycle. Acquire source/frame/runtime resources before
work children so cancellation aborts and joins I/O before releasing permits or
owners. Promise adaptation belongs at real edges. Reactor serializes dispatch,
escrow and cue handling; a cue consumer must not reenter its guarded Reactor.
Receiving mailbox identity is an explicit per-message argument, never ambient
mutable request state.

Owned hydration uses an isolated consume callback with direct joined finalization.
A bare yielding finalizer can resume cancelled parent work; resource-only teardown
can hide disposal errors after delivery. Fail cleanup before returning to its caller.
KRAM handoff retains its local busy guard until that disposal and checked durable
acknowledgement finish. Failed callbacks, disposal or ack preserve ready retries;
callback side effects/owner adoption are at least once, without rollback.
Per-Baser active scope counts exclude synchronous cache maintenance, while
admission remains guarded per instance; neither supplies a shared memory budget.

Runtime store acquisition and ownership must be visible in composition-root
control flow. Default `acdc.rgy` and legacy TEL stores are scope-owned; readonly
Haberies get neither, and injected services remain caller-owned. The v2 manager
shares its one store with IPEX and Reactor; keep it separate from `vdr.rgy`. Factories retain
cleanup responsibility until returning their opened store. Explicit runtime close
and scope exit both join cleanup; scope exit after explicit close is harmless.

## Transport

Direct replies reserve query SAIDs before dispatch; only the final query owns the
HTTP response. Earlier responses transfer to ordinary delivery. A response scope
outlives fetch headers and must not inherit a request signal that aborts when the
handler returns. requestFrame/postCesr retain frame owners until consumption ends.

Replay captures first-seen ranges, hydrates one finite event and releases cursors
before transport suspension. Query credits remain charged through failed delivery;
bounded passes drain only their initial work. Generic witness and signed-exchange
HTTP share serializer output; authorization survives content-type retry. Receipt
responses are intentionally finite proofs.

HTTP shutdown closes runtime-owned response/SSE streams before awaiting listener
drain. Signals must wake the supervisor; task cancellation alone does not prove
the signal path. Otherwise active responses can force SIGKILL.

## Mailbox

Provider Mailboxer storage is shared runtime state above Habery; recipient tops
cursors remain durable Habery state. Remote fwd stores the inner message, not the
wrapper. Recipient authorization of the addressed mailbox gates storage. Read
authorization separately requires requester identity and current signature threshold;
query-SAID/cue correlation alone is not authentication. Recheck exact attachments
on HTTP intake, including cigars, old keys and duplicate indices. Also honor the
current dispatch refusal: a prior matching query cue cannot override sender policy. Public logs/ksn
queries retain separate policy; no insecure read override exists.

SSE consumes one complete event and awaits its consumer before another read.
Provider output reads only with HTTP demand. Finite processOnce returns typed
batches; long-lived pollDo is sink-based. Disconnect/timeout discards unfinished
events so their cursors can retry. Durable inbox admission has separate dispositions.

## CLI and follow-ups

Tufa owns CLI registration, role hosts, middleware and listeners; KERI exposes
library/runtime/DB. Choose withExistingHabery, withAgentRuntime or
withHabAndAgentRuntime for existing-store commands; ensureHby is create-if-missing
startup. Bootstrap tests use explicit config paths. Source runs do not qualify
the packed Node CLI.

[Runtime contract](../../docs/design-docs/runtime/INGRESS_AND_EGRESS.md),
[cue design](../../docs/design-docs/runtime/CUES.md),
[mailbox design](../../docs/design-docs/mailbox/MAILBOX.md).
Shared admission and first verified usable child evidence remain in the
[roadmap](../../docs/plans/PARITY_ROADMAP.md). Stale/timeout continuation breadth
and broader DB parity need source-grounded evidence, not repeated foundation work.
