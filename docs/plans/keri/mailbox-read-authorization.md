# Mailbox Read Authorization via Verified `mbx` Query SAID Correlation

## Summary

- Secure mailbox reads by making the server stream only from the accepted
  `stream` cue that corresponds to the inbound `mbx` query `said`, mirroring
  KERIpy's `QryRpyMailboxIterable` correlation model as closely as practical.
- Enforce a second gate on every mailbox read: the addressed hosted mailbox AID
  must currently be authorized for the requested recipient before any SSE
  stream is opened.
- Add one explicit unsafe host-side operator override,
  `--insecure-mailbox-read-override`, that bypasses only the "matching accepted
  stream cue for this query `said`" requirement. It does not bypass
  mailbox-to-recipient authorization.
- Add `mailbox debug --recipient <aid>` so non-controller operator boxes can
  intentionally target a recipient mailbox when the host override is enabled.

## Key Changes

### Shared Server Mailbox Read Path

- In `packages/keri/src/app/server.ts`, keep parsing and ingesting the inbound
  CESR `qry` as today.
- For `route === "mbx"`, stop deriving SSE stream inputs directly from raw
  `q.i` and `q.topics`.
- After `processRuntimeRequest(...)`, look up and consume the accepted
  `StreamCue` whose `cue.serder.said` matches the inbound query `serder.said`.
- When a matching cue exists, derive `recipient pre` and `topics` from that
  cue, not from raw request fields.
- If no matching cue exists and the host override is disabled, return
  `403 Forbidden`.
- If no matching cue exists and the host override is enabled, fall back to the
  raw query's `i` and `topics` after normal shape validation.
- In both branches, require that the uniquely addressed hosted mailbox endpoint
  AID is currently authorized for that recipient; otherwise return
  `403 Forbidden`.

### Mailbox Director

- In `packages/keri/src/app/mailbox-director.ts`, add a helper that consumes
  one accepted mailbox `StreamCue` by query `said`, preserving unmatched cues
  in the deck.
- Add a helper for mailbox read authorization: given
  `(recipientPre, mailboxAid)`, return whether
  `[recipientPre, mailbox, mailboxAid]` is currently allowed or enabled in
  accepted end-role state.
- Keep `streamMailbox(...)` transport-only; do not move authorization into the
  stream iterator itself.

### Host Options And CLI

- Add `allowInsecureMailboxReadOverride?: boolean` to the shared host/server
  options path so both `tufa mailbox start` and `tufa agent` can enable it.
- Expose that as `--insecure-mailbox-read-override` on both host commands.
- Print a clear startup warning when enabled, stating that
  recipient-authenticated mailbox reads are being bypassed for debug/operator
  access.

### Mailbox Debug CLI

- In `packages/keri/src/app/cli/mailbox.ts`, add
  `mailbox debug --recipient <aid>`.
- Default remains current behavior: use the local habitat prefix when
  `--recipient` is absent.
- When `--recipient` is present, build the `mbx` query for that target
  recipient while still sending it to the selected mailbox endpoint.
- Do not add a separate client-side unsafe flag; the unsafe behavior is
  host-controlled only.

### Behavioral Decisions

- Recipient-only reads remain the default secure model.
- The unsafe override bypasses only cue-correlation and
  recipient-authenticated acceptance.
- The unsafe override does not bypass mailbox authorization, hosted-endpoint
  path resolution, or CESR query shape parsing.
- Keep the KERIpy-style one-shot cue correlation model instead of introducing
  a new token/session layer or detached HTTP-signature protocol.

## Test Plan

### Server And Authorization

- Valid signed `mbx` query from the rightful recipient produces a matching
  `stream` cue by `said` and returns SSE data.
- Query that does not produce a matching accepted `stream` cue returns `403`
  when override is off.
- The same query succeeds when override is on, provided the hosted mailbox AID
  is authorized for the targeted recipient.
- Query fails with `403` when the addressed hosted mailbox AID is not
  authorized for the recipient, even when override is on.
- Base-path and root-hosted mailbox routes still resolve the correct hosted
  mailbox AID for the authorization check.

### Mailbox Director

- `takeAcceptedMailboxReadBySaid(...)` returns the matching cue, consumes only
  that cue, and preserves unrelated queued `stream` cues.
- The mailbox authorization helper correctly accepts allowed/enabled end-role
  state and rejects missing/cut state.

### CLI And Operator Flows

- `mailbox debug --recipient <aid>` targets the supplied recipient instead of
  the local habitat prefix.
- Operator debug flow from a non-controller box fails against a strict host and
  succeeds against a host started with
  `--insecure-mailbox-read-override`.

### Regression Coverage

- Existing recipient-owned mailbox polling and challenge-verify flows continue
  to work unchanged without the override.
- Existing mailbox add/list/update/debug behavior remains intact when
  `--recipient` is not used.

## Assumptions And Defaults

- The nearest KERIpy parity point is correlation by query `said` through the
  accepted `stream` cue, not the current raw-request trust model and not a
  second detached request-signature scheme.
- We will not add delegated-reader support, session tokens, bearer auth, or
  mTLS-dependent authorization in this change.
- The override is intentionally host-side and unsafe by design; it exists only
  for operator inspection scenarios and should be opt-in, explicit, and noisy.
- The current synchronous `processRuntimeRequest(...)` plus cue draining model
  is sufficient for immediate cue lookup by `said`; no extra async wait loop is
  needed in this pass.
